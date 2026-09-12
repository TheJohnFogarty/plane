/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { concat, orderBy, set, uniq, update } from "lodash-es";
import { action, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
// plane package imports
import type { E_SORT_ORDER } from "@plane/constants";
import { EActivityFilterType } from "@plane/constants";
import type {
  TIssueActivityComment,
  TIssueActivity,
  TIssueActivityMap,
  TIssueActivityIdMap,
  TIssueServiceType,
} from "@plane/types";
import { EIssueServiceType } from "@plane/types";
// plane web constants
// services
import { IssueHistoryPagination } from "@/store/issue/issue-details/history-pagination";
import { IssueActivityService } from "@/services/issue";
// store
import type { CoreRootStore } from "@/store/root.store";

export type TActivityLoader = "fetch" | "mutate" | undefined;

export interface IIssueActivityStoreActions {
  // actions
  fetchActivities: (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    loaderType?: TActivityLoader
  ) => Promise<TIssueActivity[]>;
}

export interface IIssueActivityStore extends IIssueActivityStoreActions {
  history: IssueHistoryPagination<TIssueActivity>;
  fetchOlderActivities: (workspace: string, project: string, issue: string) => Promise<TIssueActivity[]>;
  // observables
  loader: TActivityLoader;
  activities: TIssueActivityIdMap;
  activityMap: TIssueActivityMap;
  // helper methods
  getActivitiesByIssueId: (issueId: string) => string[] | undefined;
  getActivityById: (activityId: string) => TIssueActivity | undefined;
  getActivityAndCommentsByIssueId: (issueId: string, sortOrder: E_SORT_ORDER) => TIssueActivityComment[] | undefined;
}

export class IssueActivityStore implements IIssueActivityStore {
  // observables
  loader: TActivityLoader = "fetch";
  activities: TIssueActivityIdMap = {};
  activityMap: TIssueActivityMap = {};
  // services
  serviceType;
  issueActivityService;
  history: IssueHistoryPagination<TIssueActivity>;

  constructor(
    protected store: CoreRootStore,
    serviceType: TIssueServiceType = EIssueServiceType.ISSUES
  ) {
    makeObservable(this, {
      // observables
      loader: observable.ref,
      activities: observable,
      activityMap: observable,
      // actions
      fetchActivities: action,
    });
    this.serviceType = serviceType;
    // services
    this.issueActivityService = new IssueActivityService(this.serviceType);
    this.history = new IssueHistoryPagination((workspace, project, issue, params) =>
      this.issueActivityService.getIssueActivitiesPage(workspace, project, issue, params)
    );
  }

  // helper methods
  getActivitiesByIssueId = (issueId: string) => {
    if (!issueId) return undefined;
    return this.activities[issueId] ?? undefined;
  };

  getActivityById = (activityId: string) => {
    if (!activityId) return undefined;
    return this.activityMap[activityId] ?? undefined;
  };

  protected buildActivityAndCommentItems(issueId: string): TIssueActivityComment[] | undefined {
    if (!issueId) return undefined;

    const activityComments: TIssueActivityComment[] = [];

    const currentStore =
      this.serviceType === EIssueServiceType.EPICS ? this.store.issue.epicDetail : this.store.issue.issueDetail;

    const activities = this.getActivitiesByIssueId(issueId);
    const comments = currentStore.comment.getCommentsByIssueId(issueId);

    if (!activities && !comments) return undefined;

    (activities ?? []).forEach((activityId) => {
      const activity = this.getActivityById(activityId);
      if (!activity) return;
      const type =
        activity.field === "state"
          ? EActivityFilterType.STATE
          : activity.field === "assignees"
            ? EActivityFilterType.ASSIGNEE
            : activity.field === null
              ? EActivityFilterType.DEFAULT
              : EActivityFilterType.ACTIVITY;
      activityComments.push({
        id: activity.id,
        activity_type: type,
        created_at: activity.created_at,
      });
    });

    (comments ?? []).forEach((commentId) => {
      const comment = currentStore.comment.getCommentById(commentId);
      if (!comment) return;
      activityComments.push({
        id: comment.id,
        activity_type: EActivityFilterType.COMMENT,
        created_at: comment.created_at,
      });
    });

    return activityComments;
  }

  protected sortActivityComments(items: TIssueActivityComment[], sortOrder: E_SORT_ORDER): TIssueActivityComment[] {
    return orderBy(items, [(e) => new Date(e.created_at || 0), "id"], [sortOrder, sortOrder]);
  }

  getActivityAndCommentsByIssueId = computedFn((issueId: string, sortOrder: E_SORT_ORDER) => {
    const baseItems = this.buildActivityAndCommentItems(issueId);
    if (!baseItems) return undefined;
    return this.sortActivityComments(baseItems, sortOrder);
  });

  // actions
  public async fetchActivities(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    loaderType: TActivityLoader = "fetch"
  ) {
    try {
      this.loader = loaderType;

      const activities = await this.history.fetch(workspaceSlug, projectId, issueId);
      this.applyActivities(issueId, activities);
      return activities;
    } finally {
      runInAction(() => {
        this.loader = undefined;
      });
    }
  }

  fetchOlderActivities = async (workspace: string, project: string, issueId: string) => {
    const activities = await this.history.fetch(workspace, project, issueId, true);
    this.applyActivities(issueId, activities);
    return activities;
  };

  private applyActivities(issueId: string, activities: TIssueActivity[]) {
    const activityIds = activities.map((activity) => activity.id);

    runInAction(() => {
      update(this.activities, issueId, (existingActivityIds) => {
        if (!existingActivityIds) return activityIds;
        return uniq(concat(existingActivityIds, activityIds));
      });
      activities.forEach((activity) => {
        set(this.activityMap, activity.id, activity);
      });
      this.loader = undefined;
    });
  }
}
