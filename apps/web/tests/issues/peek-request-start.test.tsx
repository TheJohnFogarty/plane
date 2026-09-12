import { render, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { expect, it, vi } from "vitest";
import { IssuePeekOverview } from "@/components/issues/peek-overview";
const state = vi.hoisted(() => ({ fetch: vi.fn().mockResolvedValue({ id: "task" }) }));
vi.mock("@/hooks/store/use-issue-detail", () => ({
  useIssueDetail: () => ({
    peekIssue: { workspaceSlug: "ws", projectId: "project", issueId: "task" },
    issue: { fetchIssue: state.fetch, hasIssueDetails: () => false },
  }),
}));
vi.mock("@/components/issues/peek-overview/loader", () => ({ IssuePeekOverviewLoader: () => <div>Loading code</div> }));
// The detail chunk has no fetching logic: loading must be owned by the lightweight shell.
vi.mock("@/components/issues/peek-overview/root", () => ({ IssuePeekOverview: () => <div>Detail chunk</div> }));
it("starts the task request in the shell instead of waiting for the detail chunk", async () => {
  render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <IssuePeekOverview />
    </SWRConfig>
  );
  await waitFor(() => expect(state.fetch).toHaveBeenCalledWith("ws", "project", "task"));
});
