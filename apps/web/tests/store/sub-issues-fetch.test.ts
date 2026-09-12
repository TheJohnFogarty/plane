/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it, vi } from "vitest";
import type { TIssue, TIssueSubIssues } from "@plane/types";
import { EIssueServiceType } from "@plane/types";

vi.mock("@/lib/store-context", () => ({
  rootStore: {
    projectRoot: {
      project: {
        getProjectIdentifierById: () => "OFF26",
      },
    },
  },
  StoreContext: {},
}));

const { IssueSubIssuesStore } = await import("@/store/issue/issue-details/sub_issues.store");
type IIssueDetail = import("@/store/issue/issue-details/root.store").IIssueDetail;

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

describe("IssueSubIssuesStore.fetchSubIssues", () => {
  it("reuses an in-flight request for the same parent", async () => {
    const addIssue = vi.fn();
    const updateIssue = vi.fn();
    const detail = {
      rootIssueStore: {
        issues: { addIssue, updateIssue },
      },
    } as unknown as IIssueDetail;

    const store = new IssueSubIssuesStore(detail, EIssueServiceType.ISSUES);
    const deferred = createDeferred<TIssueSubIssues>();
    store.issueService = {
      subIssues: vi.fn().mockReturnValue(deferred.promise),
    } as unknown as (typeof store)["issueService"];

    const first = store.fetchSubIssues("ws", "project-1", "parent-1");
    const second = store.fetchSubIssues("ws", "project-1", "parent-1");

    expect(store.issueService.subIssues).toHaveBeenCalledTimes(1);

    deferred.resolve({
      sub_issues: [{ id: "child-1" } as TIssue],
      state_distribution: {
        backlog: [],
        unstarted: [],
        started: [],
        completed: [],
        cancelled: [],
      },
    });

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toBe(secondResult);
    expect(store.subIssuesByIssueId("parent-1")).toEqual(["child-1"]);
  });
});
