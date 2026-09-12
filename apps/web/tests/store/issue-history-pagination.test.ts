import { describe, expect, it, vi } from "vitest";
import { IssueHistoryPagination } from "@/store/issue/issue-details/history-pagination";

type Entry = { id: string; created_at: string };
const entry = (id: string): Entry => ({ id, created_at: "2026-09-11T00:00:00Z" });

describe("task history pagination", () => {
  it("retains the failed direction so retry requests the same older page", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ results: [entry("b")], next_cursor: "older" })
      .mockRejectedValueOnce(new Error("offline"));
    const history = new IssueHistoryPagination<Entry>(request);
    await history.fetch("ws", "project", "task");
    await expect(history.fetch("ws", "project", "task", true)).rejects.toThrow("offline");
    expect(history.hasOlderError("task")).toBe(true);
    expect(history.hasMore("task")).toBe(true);
  });
  it("loads one initial page and fetches older entries only on demand", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ results: [entry("b"), entry("c")], next_cursor: "older" })
      .mockResolvedValueOnce({ results: [entry("a")], next_cursor: null });
    const history = new IssueHistoryPagination<Entry>(request);
    expect(await history.fetch("ws", "project", "task")).toEqual([entry("b"), entry("c")]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(history.hasMore("task")).toBe(true);
    expect(await history.fetch("ws", "project", "task", true)).toEqual([entry("a")]);
    expect(history.hasMore("task")).toBe(false);
    expect(request.mock.calls[1][3]).toEqual({ cursor: "older" });
  });

  it("refreshes newer entries without losing the older cursor or skipping timestamp ties", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ results: [entry("b")], next_cursor: "older" })
      .mockResolvedValueOnce({ results: [entry("c")], next_cursor: "newer" })
      .mockResolvedValueOnce({ results: [entry("d")], next_cursor: null });
    const history = new IssueHistoryPagination<Entry>(request);
    await history.fetch("ws", "project", "task");
    expect(await history.fetch("ws", "project", "task")).toEqual([entry("c"), entry("d")]);
    expect(request.mock.calls[1][3]).toEqual({ after: entry("b").created_at, after_id: "b" });
    expect(request.mock.calls[2][3]).toEqual({ cursor: "newer" });
    expect(history.hasMore("task")).toBe(true);
  });

  it("deduplicates requests and allows retry after a failed page", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ results: [], next_cursor: null });
    const history = new IssueHistoryPagination<Entry>(request);
    const first = history.fetch("ws", "project", "task");
    const second = history.fetch("ws", "project", "task");
    await expect(first).rejects.toThrow("offline");
    await expect(second).rejects.toThrow("offline");
    expect(request).toHaveBeenCalledTimes(1);
    expect(history.hasError("task")).toBe(true);
    await history.fetch("ws", "project", "task");
    expect(history.hasError("task")).toBe(false);
  });
});
