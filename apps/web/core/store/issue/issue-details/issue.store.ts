/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */
import { makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
// types
import type { TIssue, TIssueServiceType } from "@plane/types";
import { EIssueServiceType } from "@plane/types";
// services
import { IssueArchiveService, WorkspaceDraftService, IssueService } from "@/services/issue";
// types
import type { IIssueDetail } from "./root.store";

export interface IIssueStoreActions {
  // actions
  fetchIssue: (workspaceSlug: string, projectId: string, issueId: string) => Promise<TIssue>;
  updateIssue: (workspaceSlug: string, projectId: string, issueId: string, data: Partial<TIssue>) => Promise<void>;
  removeIssue: (workspaceSlug: string, projectId: string, issueId: string) => Promise<void>;
  archiveIssue: (workspaceSlug: string, projectId: string, issueId: string) => Promise<void>;
  addCycleToIssue: (workspaceSlug: string, projectId: string, cycleId: string, issueId: string) => Promise<void>;
  addIssueToCycle: (workspaceSlug: string, projectId: string, cycleId: string, issueIds: string[]) => Promise<void>;
  removeIssueFromCycle: (workspaceSlug: string, projectId: string, cycleId: string, issueId: string) => Promise<void>;
  changeModulesInIssue: (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    addModuleIds: string[],
    removeModuleIds: string[]
  ) => Promise<void>;
  removeIssueFromModule: (workspaceSlug: string, projectId: string, moduleId: string, issueId: string) => Promise<void>;
  fetchIssueWithIdentifier: (workspaceSlug: string, project_identifier: string, sequence_id: string) => Promise<TIssue>;
}

export interface IIssueStore extends IIssueStoreActions {
  getIsFetchingIssueDetails: (issueId: string | undefined) => boolean;
  hasIssueDetails: (issueId: string | undefined) => boolean;
  // helper methods
  getIssueById: (issueId: string) => TIssue | undefined;
  getIssueIdByIdentifier: (issueIdentifier: string, workspaceSlug?: string) => string | undefined;
}

export class IssueStore implements IIssueStore {
  fetchingIssueDetails = new Set<string>();
  loadedIssueDetails = new Map<string, string>();
  // root store
  rootIssueDetailStore: IIssueDetail;
  // services
  serviceType;
  issueService;
  epicService;
  issueArchiveService;
  draftWorkItemService;
  private fetchPromises = new Map<string, Promise<TIssue>>();

  constructor(rootStore: IIssueDetail, serviceType: TIssueServiceType) {
    makeObservable(this, {
      fetchingIssueDetails: observable,
      loadedIssueDetails: observable,
    });
    // root store
    this.rootIssueDetailStore = rootStore;
    // services
    this.serviceType = serviceType;
    this.issueService = new IssueService(serviceType);
    this.epicService = new IssueService(EIssueServiceType.EPICS);
    this.issueArchiveService = new IssueArchiveService(serviceType);
    this.draftWorkItemService = new WorkspaceDraftService();
  }

  getIsFetchingIssueDetails = computedFn((issueId: string | undefined) => {
    if (!issueId) return false;

    return this.fetchingIssueDetails.has(issueId);
  });

  hasIssueDetails = (issueId: string | undefined) =>
    Boolean(issueId && this.loadedIssueDetails.has(issueId) && this.getIssueById(issueId));

  // helper methods
  getIssueById = computedFn((issueId: string) => {
    if (!issueId) return undefined;
    return this.rootIssueDetailStore.rootIssueStore.issues.getIssueById(issueId) ?? undefined;
  });

  getIssueIdByIdentifier = (issueIdentifier: string, workspaceSlug?: string) => {
    if (!issueIdentifier) return undefined;
    const id = this.rootIssueDetailStore.rootIssueStore.issues.getIssueIdByIdentifier(issueIdentifier);
    if (workspaceSlug && (!id || this.loadedIssueDetails.get(id) !== workspaceSlug)) return undefined;
    return id;
  };

  // actions
  fetchIssue = async (workspaceSlug: string, projectId: string, issueId: string) => {
    const cacheKey = `${workspaceSlug}:${projectId}:${issueId}`;
    const inFlightRequest = this.fetchPromises.get(cacheKey);
    if (inFlightRequest) return inFlightRequest;

    const request = this.loadIssueDetails(workspaceSlug, projectId, issueId).finally(() => {
      this.fetchPromises.delete(cacheKey);
    });
    this.fetchPromises.set(cacheKey, request);
    return request;
  };

  private loadIssueDetails = async (workspaceSlug: string, projectId: string, issueId: string) => {
    const query = {
      expand: "issue_reactions,issue_attachments,issue_link,parent",
    };

    runInAction(() => this.fetchingIssueDetails.add(issueId));
    try {
      // Start the primary request first. Auxiliary sections never gate the editor.
      const request = this.issueService.retrieve(workspaceSlug, projectId, issueId, query);
      this.fetchIssueWidgets(workspaceSlug, projectId, issueId);
      const issue = await request;
      if (!issue) throw new Error("Work item not found");
      this.hydrateIssue(issue, workspaceSlug);
      return issue;
    } finally {
      runInAction(() => this.fetchingIssueDetails.delete(issueId));
    }
  };

  private fetchIssueWidgets = (workspaceSlug: string, projectId: string, issueId: string) => {
    const widgets = {
      activity: () => this.rootIssueDetailStore.activity.fetchActivities(workspaceSlug, projectId, issueId),
      comments: () => this.rootIssueDetailStore.comment.fetchComments(workspaceSlug, projectId, issueId),
      subIssues: () => this.rootIssueDetailStore.subIssues.fetchSubIssues(workspaceSlug, projectId, issueId),
      relations: () => this.rootIssueDetailStore.relation.fetchRelations(workspaceSlug, projectId, issueId),
    };
    for (const [section, fetch] of Object.entries(widgets)) {
      void fetch().catch((error: unknown) => console.error(`Failed to load task ${section}`, error));
    }
  };

  private hydrateIssue = (issue: TIssue, workspaceSlug: string) => {
    runInAction(() => {
      const { issue_reactions, issue_link, issue_attachments, parent, ...details } = issue;
      this.rootIssueDetailStore.rootIssueStore.issues.addIssue([details]);
      // Parent expansion is a summary, never evidence that its detail is loaded.
      if (parent?.id) this.rootIssueDetailStore.rootIssueStore.issues.addIssue([parent as TIssue]);
      if (issue_reactions) this.rootIssueDetailStore.addReactions(issue.id, issue_reactions);
      if (issue_link) this.rootIssueDetailStore.addLinks(issue.id, issue_link);
      if (issue_attachments) this.rootIssueDetailStore.addAttachments(issue.id, issue_attachments);
      this.rootIssueDetailStore.addSubscription(issue.id, issue.is_subscribed);
      this.loadedIssueDetails.set(issue.id, workspaceSlug);
    });
  };

  updateIssue = async (workspaceSlug: string, projectId: string, issueId: string, data: Partial<TIssue>) => {
    const currentStore =
      this.serviceType === EIssueServiceType.EPICS
        ? this.rootIssueDetailStore.rootIssueStore.projectEpics
        : this.rootIssueDetailStore.rootIssueStore.projectIssues;

    await Promise.all([
      currentStore.updateIssue(workspaceSlug, projectId, issueId, data),
      this.rootIssueDetailStore.activity.fetchActivities(workspaceSlug, projectId, issueId),
    ]);
  };

  removeIssue = async (workspaceSlug: string, projectId: string, issueId: string) => {
    const currentStore =
      this.serviceType === EIssueServiceType.EPICS
        ? this.rootIssueDetailStore.rootIssueStore.projectEpics
        : this.rootIssueDetailStore.rootIssueStore.projectIssues;
    currentStore.removeIssue(workspaceSlug, projectId, issueId);
  };

  archiveIssue = async (workspaceSlug: string, projectId: string, issueId: string) => {
    const currentStore =
      this.serviceType === EIssueServiceType.EPICS
        ? this.rootIssueDetailStore.rootIssueStore.projectEpics
        : this.rootIssueDetailStore.rootIssueStore.projectIssues;
    currentStore.archiveIssue(workspaceSlug, projectId, issueId);
  };

  addCycleToIssue = async (workspaceSlug: string, projectId: string, cycleId: string, issueId: string) => {
    await this.rootIssueDetailStore.rootIssueStore.cycleIssues.addCycleToIssue(
      workspaceSlug,
      projectId,
      cycleId,
      issueId
    );
    await this.rootIssueDetailStore.activity.fetchActivities(workspaceSlug, projectId, issueId);
  };

  addIssueToCycle = async (workspaceSlug: string, projectId: string, cycleId: string, issueIds: string[]) => {
    await this.rootIssueDetailStore.rootIssueStore.cycleIssues.addIssueToCycle(
      workspaceSlug,
      projectId,
      cycleId,
      issueIds,
      false
    );
    if (issueIds && issueIds.length > 0)
      await this.rootIssueDetailStore.activity.fetchActivities(workspaceSlug, projectId, issueIds[0]);
  };

  removeIssueFromCycle = async (workspaceSlug: string, projectId: string, cycleId: string, issueId: string) => {
    const cycle = await this.rootIssueDetailStore.rootIssueStore.cycleIssues.removeIssueFromCycle(
      workspaceSlug,
      projectId,
      cycleId,
      issueId
    );
    await this.rootIssueDetailStore.activity.fetchActivities(workspaceSlug, projectId, issueId);
    return cycle;
  };

  changeModulesInIssue = async (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    addModuleIds: string[],
    removeModuleIds: string[]
  ) => {
    await this.rootIssueDetailStore.rootIssueStore.moduleIssues.changeModulesInIssue(
      workspaceSlug,
      projectId,
      issueId,
      addModuleIds,
      removeModuleIds
    );
    await this.rootIssueDetailStore.activity.fetchActivities(workspaceSlug, projectId, issueId);
  };

  removeIssueFromModule = async (workspaceSlug: string, projectId: string, moduleId: string, issueId: string) => {
    const currentModule = await this.rootIssueDetailStore.rootIssueStore.moduleIssues.removeIssuesFromModule(
      workspaceSlug,
      projectId,
      moduleId,
      [issueId]
    );
    await this.rootIssueDetailStore.activity.fetchActivities(workspaceSlug, projectId, issueId);
    return currentModule;
  };

  fetchIssueWithIdentifier = async (workspaceSlug: string, project_identifier: string, sequence_id: string) => {
    const cacheKey = `${workspaceSlug}:${project_identifier}:${sequence_id}`;
    const inFlightRequest = this.fetchPromises.get(cacheKey);
    if (inFlightRequest) return inFlightRequest;

    const request = this.loadIssueDetailsByIdentifier(workspaceSlug, project_identifier, sequence_id).finally(() => {
      this.fetchPromises.delete(cacheKey);
    });
    this.fetchPromises.set(cacheKey, request);
    return request;
  };

  private loadIssueDetailsByIdentifier = async (
    workspaceSlug: string,
    project_identifier: string,
    sequence_id: string
  ) => {
    const issueIdentifier = `${project_identifier}-${sequence_id}`;
    const knownId = this.getIssueIdByIdentifier(issueIdentifier, workspaceSlug);
    const knownIssue = knownId ? this.getIssueById(knownId) : undefined;
    if (knownIssue?.project_id) return this.fetchIssue(workspaceSlug, knownIssue.project_id, knownIssue.id);

    const issue = await this.issueService.retrieveWithIdentifier(workspaceSlug, project_identifier, sequence_id, {
      expand: "issue_reactions,issue_attachments,issue_link,parent",
    });
    if (!issue?.id || !issue.project_id) throw new Error("Issue not found");
    this.hydrateIssue(issue, workspaceSlug);
    this.rootIssueDetailStore.rootIssueStore.issues.addIssueIdentifier(issueIdentifier, issue.id);
    this.fetchIssueWidgets(workspaceSlug, issue.project_id, issue.id);
    return issue;
  };
}
