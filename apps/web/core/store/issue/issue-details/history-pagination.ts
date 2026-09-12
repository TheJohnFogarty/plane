/** Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only */
import { makeObservable, observable, runInAction } from "mobx";

import type { TIssueHistoryPage, TIssueHistoryParams } from "@plane/types";
type HistoryEntry = { id: string; created_at: string };
type FetchPage<T> = (
  workspace: string,
  project: string,
  issue: string,
  params: TIssueHistoryParams
) => Promise<TIssueHistoryPage<T>>;

/** Shared paging rules for the two task-history streams. Entity data stays in its owning store. */
export class IssueHistoryPagination<T extends HistoryEntry> {
  private olderCursors = new Map<string, string | null>();
  private newest = new Map<string, HistoryEntry>();
  private errors = new Map<string, boolean>();
  private requests = new Map<string, Promise<T[]>>();

  constructor(private fetchPage: FetchPage<T>) {
    makeObservable<this, "olderCursors" | "errors">(this, { olderCursors: observable, errors: observable });
  }

  hasMore = (issueId: string) => Boolean(this.olderCursors.get(issueId));
  hasError = (issueId: string) => this.errors.has(issueId);
  hasOlderError = (issueId: string) => this.errors.get(issueId) === true;

  fetch = (workspace: string, project: string, issueId: string, older = false): Promise<T[]> => {
    const key = `${workspace}:${project}:${issueId}:${older}`;
    const pending = this.requests.get(key);
    if (pending) return pending;
    const request = this.load(workspace, project, issueId, older).finally(() => this.requests.delete(key));
    this.requests.set(key, request);
    return request;
  };

  private async load(workspace: string, project: string, issueId: string, older: boolean): Promise<T[]> {
    const newest = this.newest.get(issueId);
    const olderCursor = this.olderCursors.get(issueId);
    if (older && !olderCursor) return [];
    let params: TIssueHistoryParams = older
      ? { cursor: olderCursor! }
      : newest
        ? { after: newest.created_at, after_id: newest.id }
        : {};
    try {
      const items: T[] = [];
      let nextCursor: string | null;
      do {
        // Each cursor comes from the previous response; these requests cannot run in parallel.
        // eslint-disable-next-line no-await-in-loop
        const page = await this.fetchPage(workspace, project, issueId, params);
        items.push(...page.results);
        nextCursor = page.next_cursor;
        params = nextCursor ? { cursor: nextCursor } : {};
        // Refresh can span pages; initial load and explicit older load fetch one page.
        if (older || !newest) break;
      } while (nextCursor);
      runInAction(() => {
        if (older || !newest) this.olderCursors.set(issueId, nextCursor);
        this.errors.delete(issueId);
      });
      if (!older && items.length) this.newest.set(issueId, items[items.length - 1]);
      return items;
    } catch (error) {
      runInAction(() => this.errors.set(issueId, older));
      throw error;
    }
  }
}
