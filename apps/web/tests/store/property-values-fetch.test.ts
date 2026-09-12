/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it, vi } from "vitest";
import type { TIssuePropertyValuesMap } from "@plane/types";
import { IssueTypeStore } from "@/store/issue-type.store";
import type { CoreRootStore } from "@/store/root.store";

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

describe("IssueTypeStore.fetchPropertyValues", () => {
  it("dedupes in-flight fetches and returns the cached map afterward", async () => {
    const store = new IssueTypeStore({} as CoreRootStore);
    const deferred = createDeferred<TIssuePropertyValuesMap>();
    store.service = {
      getPropertyValues: vi.fn().mockReturnValue(deferred.promise),
    } as unknown as IssueTypeStore["service"];

    const first = store.fetchPropertyValues("ws", "project-1", "issue-1");
    const second = store.fetchPropertyValues("ws", "project-1", "issue-1");

    expect(store.service.getPropertyValues).toHaveBeenCalledTimes(1);

    deferred.resolve({ "prop-1": "value" });
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toEqual({ "prop-1": "value" });
    expect(secondResult).toEqual({ "prop-1": "value" });

    await store.fetchPropertyValues("ws", "project-1", "issue-1");
    expect(store.service.getPropertyValues).toHaveBeenCalledTimes(1);
  });
});
