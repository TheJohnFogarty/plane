/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it, vi } from "vitest";
import type { TIssue } from "@plane/types";
import { EIssueServiceType } from "@plane/types";
import { IssueStore } from "@/store/issue/issue-details/issue.store";
import type { IIssueDetail } from "@/store/issue/issue-details/root.store";

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

const createIssue = (overrides: Partial<TIssue> = {}): TIssue =>
  ({
    id: "issue-1",
    sequence_id: 12,
    name: "Work item",
    description_html: "<p>body</p>",
    sort_order: 1,
    state_id: "state-1",
    priority: "none",
    label_ids: [],
    assignee_ids: [],
    estimate_point: null,
    sub_issues_count: 0,
    attachment_count: 0,
    link_count: 0,
    project_id: "project-1",
    parent_id: null,
    cycle_id: null,
    module_ids: [],
    type_id: "type-1",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    start_date: null,
    target_date: null,
    completed_at: null,
    archived_at: null,
    created_by: "user-1",
    updated_by: "user-1",
    is_draft: false,
    is_subscribed: false,
    is_epic: false,
    ...overrides,
  }) as TIssue;

const createDetailStore = () => {
  const issuesMap = new Map<string, TIssue>();
  const identifiers = new Map<string, string>();
  const fetchActivities = vi.fn().mockResolvedValue([]);
  const fetchComments = vi.fn().mockResolvedValue([]);
  const fetchSubIssues = vi.fn().mockResolvedValue({ sub_issues: [], state_distribution: {} });
  const fetchRelations = vi.fn().mockResolvedValue({});
  const epicFetchActivities = vi.fn().mockResolvedValue([]);

  const detail = {
    rootIssueStore: {
      issues: {
        getIssueById: (issueId: string) => issuesMap.get(issueId),
        getIssueIdByIdentifier: (identifier: string) => identifiers.get(identifier),
        addIssue: vi.fn((issues: TIssue[]) => {
          issues.forEach((issue) => issuesMap.set(issue.id, { ...issuesMap.get(issue.id), ...issue }));
        }),
        addIssueIdentifier: vi.fn((identifier: string, id: string) => identifiers.set(identifier, id)),
      },
      epicDetail: {
        activity: { fetchActivities: epicFetchActivities },
        comment: { fetchComments: vi.fn() },
        subIssues: { fetchSubIssues: vi.fn() },
        relation: { fetchRelations: vi.fn() },
        addReactions: vi.fn(),
        addLinks: vi.fn(),
        addAttachments: vi.fn(),
        addSubscription: vi.fn(),
        rootIssueStore: {
          issues: {
            addIssueIdentifier: vi.fn(),
          },
        },
      },
    },
    activity: { fetchActivities },
    comment: { fetchComments },
    subIssues: { fetchSubIssues },
    relation: { fetchRelations },
    addReactions: vi.fn(),
    addLinks: vi.fn(),
    addAttachments: vi.fn(),
    addSubscription: vi.fn(),
  } as unknown as IIssueDetail;

  return {
    detail,
    issuesMap,
    fetchActivities,
    fetchComments,
    fetchSubIssues,
    fetchRelations,
    epicFetchActivities,
  };
};

const createStore = (detail: IIssueDetail) => {
  const store = new IssueStore(detail, EIssueServiceType.ISSUES);
  store.issueService = {
    retrieve: vi.fn(),
    retrieveWithIdentifier: vi.fn(),
  } as unknown as IssueStore["issueService"];
  return store;
};

describe("IssueStore detail fetch coordination", () => {
  it.each([false, true])("makes detail available while widgets are pending (epic=%s)", async (isEpic) => {
    const { detail, fetchActivities } = createDetailStore();
    const store = createStore(detail);
    const widgets = createDeferred<unknown[]>();
    fetchActivities.mockReturnValue(widgets.promise);
    vi.mocked(store.issueService.retrieve).mockResolvedValue(createIssue({ is_epic: isEpic }));

    const pending = store.fetchIssue("ws", "project-1", "issue-1");
    expect(store.getIsFetchingIssueDetails("issue-1")).toBe(true);
    const result = await Promise.race([
      pending,
      Promise.resolve().then(() => new Promise<null>((resolve) => setTimeout(() => resolve(null), 50))),
    ]);
    try {
      expect(result?.description_html).toBe("<p>body</p>");
      expect(store.hasIssueDetails("issue-1")).toBe(true);
      expect(store.getIsFetchingIssueDetails("issue-1")).toBe(false);
      expect(detail.rootIssueStore.issues.addIssue).toHaveBeenCalledTimes(1);
    } finally {
      widgets.resolve([]);
      await pending;
    }
  });

  it("resolves browse detail without waiting for widgets", async () => {
    const { detail, fetchRelations } = createDetailStore();
    const store = createStore(detail);
    const widgets = createDeferred<object>();
    fetchRelations.mockReturnValue(widgets.promise);
    vi.mocked(store.issueService.retrieveWithIdentifier).mockResolvedValue(createIssue());
    const pending = store.fetchIssueWithIdentifier("ws", "TASK", "12");
    const result = await Promise.race([pending, new Promise<null>((resolve) => setTimeout(() => resolve(null), 50))]);
    widgets.resolve({});
    await pending;
    expect(result?.id).toBe("issue-1");
  });

  it("tracks overlapping task fetches independently and cleans up failures", async () => {
    const { detail } = createDetailStore();
    const store = createStore(detail);
    const first = createDeferred<TIssue>();
    const second = createDeferred<TIssue>();
    vi.mocked(store.issueService.retrieve).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const a = store.fetchIssue("ws", "project-1", "a");
    const b = store.fetchIssue("ws", "project-1", "b");
    expect(store.getIsFetchingIssueDetails("a")).toBe(true);
    expect(store.getIsFetchingIssueDetails("b")).toBe(true);
    second.resolve(createIssue({ id: "b" }));
    await b;
    expect(store.getIsFetchingIssueDetails("a")).toBe(true);
    first.reject(new Error("offline"));
    await expect(a).rejects.toThrow("offline");
    expect(store.getIsFetchingIssueDetails("a")).toBe(false);
    expect(store.hasIssueDetails("a")).toBe(false);
  });

  it("keeps cached details available while refreshing the server payload", async () => {
    const { detail } = createDetailStore();
    const store = createStore(detail);
    vi.mocked(store.issueService.retrieve).mockResolvedValueOnce(createIssue());
    await store.fetchIssue("ws", "project-1", "issue-1");
    const refresh = createDeferred<TIssue>();
    vi.mocked(store.issueService.retrieve).mockReturnValueOnce(refresh.promise);
    const pending = store.fetchIssue("ws", "project-1", "issue-1");
    expect(store.hasIssueDetails("issue-1")).toBe(true);
    expect(store.getIssueById("issue-1")?.description_html).toBe("<p>body</p>");
    refresh.resolve(createIssue({ description_html: "<p>Updated remotely</p>" }));
    await pending;
    expect(store.issueService.retrieve).toHaveBeenCalledTimes(2);
    expect(store.getIssueById("issue-1")?.description_html).toBe("<p>Updated remotely</p>");
  });

  it("does not reject fetchIssue when a widget request fails", async () => {
    const { detail, fetchActivities, fetchComments } = createDetailStore();
    const store = createStore(detail);
    fetchActivities.mockRejectedValue(new Error("activity failed"));
    fetchComments.mockResolvedValue([]);
    (store.issueService.retrieve as ReturnType<typeof vi.fn>).mockResolvedValue(createIssue());

    await expect(store.fetchIssue("ws", "project-1", "issue-1")).resolves.toMatchObject({ id: "issue-1" });
    expect(store.getIsFetchingIssueDetails("issue-1")).toBe(false);
  });

  it("seeds a parent from the expand payload instead of retrieving it again", async () => {
    const { detail } = createDetailStore();
    const store = createStore(detail);
    const parent = {
      id: "parent-1",
      name: "Parent",
      project_id: "project-1",
      sequence_id: 4,
      type_id: "type-1",
    };
    (store.issueService.retrieve as ReturnType<typeof vi.fn>).mockResolvedValue(
      createIssue({ parent_id: "parent-1", parent })
    );

    await store.fetchIssue("ws", "project-1", "issue-1");

    expect(store.issueService.retrieve).toHaveBeenCalledTimes(1);
    expect(store.getIssueById("parent-1")).toMatchObject(parent);
    expect(store.hasIssueDetails("parent-1")).toBe(false);
  });

  it("writes identifier widgets to the invoking store even when the work item is an epic", async () => {
    const { detail, fetchActivities, epicFetchActivities } = createDetailStore();
    const store = createStore(detail);
    (store.issueService.retrieveWithIdentifier as ReturnType<typeof vi.fn>).mockResolvedValue(
      createIssue({ is_epic: true })
    );

    await store.fetchIssueWithIdentifier("ws", "OFF26", "12");

    expect(fetchActivities).toHaveBeenCalledWith("ws", "project-1", "issue-1");
    expect(epicFetchActivities).not.toHaveBeenCalled();
    expect(detail.rootIssueStore.issues.addIssueIdentifier).toHaveBeenCalledWith("OFF26-12", "issue-1");
  });

  it("does not reuse a cached identifier from another workspace", async () => {
    const { detail } = createDetailStore();
    const store = createStore(detail);
    vi.mocked(store.issueService.retrieveWithIdentifier).mockResolvedValueOnce(createIssue());
    await store.fetchIssueWithIdentifier("one", "TASK", "12");
    expect(store.getIssueIdByIdentifier("TASK-12")).toBe("issue-1");
    expect(store.getIssueIdByIdentifier("TASK-12", "one")).toBe("issue-1");
    vi.mocked(store.issueService.retrieveWithIdentifier).mockResolvedValueOnce(
      createIssue({ id: "other", project_id: "other-project" })
    );
    await store.fetchIssueWithIdentifier("two", "TASK", "12");
    expect(store.issueService.retrieveWithIdentifier).toHaveBeenCalledTimes(2);
    expect(store.issueService.retrieve).not.toHaveBeenCalled();
  });

  it("dedupes in-flight fetchIssueWithIdentifier calls", async () => {
    const { detail } = createDetailStore();
    const store = createStore(detail);
    const retrieve = createDeferred<TIssue>();
    (store.issueService.retrieveWithIdentifier as ReturnType<typeof vi.fn>).mockReturnValue(retrieve.promise);

    const first = store.fetchIssueWithIdentifier("ws", "OFF26", "12");
    const second = store.fetchIssueWithIdentifier("ws", "OFF26", "12");

    retrieve.resolve(createIssue({ is_epic: true }));
    await Promise.all([first, second]);

    expect(store.issueService.retrieveWithIdentifier).toHaveBeenCalledTimes(1);
  });
});
