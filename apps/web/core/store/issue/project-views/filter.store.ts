/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { isEmpty, isEqual, set } from "lodash-es";
import { action, computed, makeObservable, observable, runInAction } from "mobx";
// base class
import { computedFn } from "mobx-utils";
import type { TSupportedFilterTypeForUpdate } from "@plane/constants";
import type {
  IIssueDisplayFilterOptions,
  IIssueDisplayProperties,
  IIssueFilters,
  TIssueParams,
  IssuePaginationOptions,
  IProjectView,
  TWorkItemFilterExpression,
  TSupportedFilterForUpdate,
} from "@plane/types";
import { EIssuesStoreType } from "@plane/types";
import { handleIssueQueryParamsByLayout } from "@plane/utils";
// services
import { ViewService } from "@/services/view.service";
import type { IBaseIssueFilterStore } from "../helpers/issue-filter-helper.store";
import { IssueFilterHelperStore } from "../helpers/issue-filter-helper.store";
// helpers
// types
import type { IIssueRootStore } from "../root.store";
// constants

export interface IProjectViewIssuesFilter extends IBaseIssueFilterStore {
  //helper actions
  getFilterParams: (
    options: IssuePaginationOptions,
    viewId: string,
    cursor: string | undefined,
    groupId: string | undefined,
    subGroupId: string | undefined
  ) => Partial<Record<TIssueParams, string | boolean>>;
  getIssueFilters(viewId: string): IIssueFilters | undefined;
  // helper actions
  mutateFilters: (workspaceSlug: string, viewId: string, viewDetails: IProjectView) => void;
  hydrateFilters: (workspaceSlug: string, viewId: string) => void;
  // action
  fetchFilters: (workspaceSlug: string, projectId: string, viewId: string) => Promise<void>;
  updateFilterExpression: (
    workspaceSlug: string,
    projectId: string,
    viewId: string,
    filters: TWorkItemFilterExpression
  ) => Promise<void>;
  updateFilters: (
    workspaceSlug: string,
    projectId: string,
    filterType: TSupportedFilterTypeForUpdate,
    filters: TSupportedFilterForUpdate,
    viewId: string
  ) => Promise<void>;
  resetFilters: (workspaceSlug: string, viewId: string) => void;
}

export class ProjectViewIssuesFilter extends IssueFilterHelperStore implements IProjectViewIssuesFilter {
  // observables
  filters: { [viewId: string]: IIssueFilters } = {};
  // root store
  rootIssueStore;
  // services
  issueFilterService;

  constructor(_rootStore: IIssueRootStore) {
    super();
    makeObservable(this, {
      // observables
      filters: observable,
      // computed
      issueFilters: computed,
      appliedFilters: computed,
      // actions
      fetchFilters: action,
      hydrateFilters: action,
      updateFilters: action,
      resetFilters: action,
    });
    // root store
    this.rootIssueStore = _rootStore;
    // services
    this.issueFilterService = new ViewService();
  }

  get issueFilters() {
    const viewId = this.rootIssueStore.viewId;
    if (!viewId) return undefined;

    return this.getIssueFilters(viewId);
  }

  get appliedFilters() {
    const viewId = this.rootIssueStore.viewId;
    if (!viewId) return undefined;

    return this.getAppliedFilters(viewId);
  }

  getIssueFilters(viewId: string) {
    const displayFilters = this.filters[viewId] || undefined;
    if (isEmpty(displayFilters)) return undefined;

    const _filters: IIssueFilters = this.computedIssueFilters(displayFilters);

    return _filters;
  }

  getAppliedFilters(viewId: string) {
    const userFilters = this.getIssueFilters(viewId);
    if (!userFilters) return undefined;

    const filteredParams = handleIssueQueryParamsByLayout(userFilters?.displayFilters?.layout, "issues");
    if (!filteredParams) return undefined;

    const filteredRouteParams: Partial<Record<TIssueParams, string | boolean>> = this.computedFilteredParams(
      userFilters?.richFilters,
      userFilters?.displayFilters,
      filteredParams
    );

    return filteredRouteParams;
  }

  getFilterParams = computedFn(
    (
      options: IssuePaginationOptions,
      viewId: string,
      cursor: string | undefined,
      groupId: string | undefined,
      subGroupId: string | undefined
    ) => {
      const filterParams = this.getAppliedFilters(viewId);

      const paginationParams = this.getPaginationParams(filterParams, options, cursor, groupId, subGroupId);
      return paginationParams;
    }
  );

  mutateFilters: IProjectViewIssuesFilter["mutateFilters"] = action((workspaceSlug, viewId, viewDetails) => {
    const richFilters: TWorkItemFilterExpression = viewDetails?.rich_filters;
    const displayFilters: IIssueDisplayFilterOptions = this.computedDisplayFilters(viewDetails?.display_filters);
    const displayProperties: IIssueDisplayProperties = this.computedDisplayProperties(viewDetails?.display_properties);

    // fetching the kanban toggle helpers in the local storage
    const kanbanFilters = {
      group_by: [],
      sub_group_by: [],
    };
    const currentUserId = this.rootIssueStore.currentUserId;
    if (currentUserId) {
      const _kanbanFilters = this.handleIssuesLocalFilters.get(
        EIssuesStoreType.PROJECT_VIEW,
        workspaceSlug,
        viewId,
        currentUserId
      );
      kanbanFilters.group_by = _kanbanFilters?.kanban_filters?.group_by || [];
      kanbanFilters.sub_group_by = _kanbanFilters?.kanban_filters?.sub_group_by || [];
    }

    const next = this.withPreservedLayout(this.filters[viewId], {
      richFilters,
      displayFilters,
      displayProperties,
      kanbanFilters,
    });

    runInAction(() => {
      set(this.filters, [viewId, "richFilters"], next.richFilters);
      set(this.filters, [viewId, "displayFilters"], next.displayFilters);
      set(this.filters, [viewId, "displayProperties"], next.displayProperties);
      set(this.filters, [viewId, "kanbanFilters"], next.kanbanFilters);
    });
  });

  hydrateFilters = (workspaceSlug: string, viewId: string) => {
    if (!isEmpty(this.filters[viewId])) return;
    const viewDetails = this.rootIssueStore.rootStore.projectView.getViewById(viewId);
    if (!viewDetails) return;
    this.mutateFilters(workspaceSlug, viewId, viewDetails);
  };

  fetchFilters = async (workspaceSlug: string, projectId: string, viewId: string) => {
    try {
      const hadDocument = !isEmpty(this.filters[viewId]);
      const previousApplied = hadDocument ? this.getAppliedFilters(viewId) : undefined;
      const viewDetails = await this.issueFilterService.getViewDetails(workspaceSlug, projectId, viewId);
      this.mutateFilters(workspaceSlug, viewId, viewDetails);
      if (!hadDocument) return;
      if (!isEqual(previousApplied, this.getAppliedFilters(viewId))) {
        this.rootIssueStore.projectViewIssues.fetchIssuesWithExistingPagination(
          workspaceSlug,
          projectId,
          viewId,
          "mutation"
        );
      }
    } catch (error) {
      console.log("error while fetching project view filters", error);
      throw error;
    }
  };

  /**
   * NOTE: This method is designed as a fallback function for the work item filter store.
   * Only use this method directly when initializing filter instances.
   * For regular filter updates, use this method as a fallback function for the work item filter store methods instead.
   */
  updateFilterExpression: IProjectViewIssuesFilter["updateFilterExpression"] = async (
    workspaceSlug,
    projectId,
    viewId,
    filters
  ) => {
    try {
      runInAction(() => {
        set(this.filters, [viewId, "richFilters"], filters);
      });

      this.rootIssueStore.projectViewIssues.fetchIssuesWithExistingPagination(
        workspaceSlug,
        projectId,
        viewId,
        "mutation"
      );
    } catch (error) {
      console.log("error while updating rich filters", error);
      throw error;
    }
  };

  updateFilters: IProjectViewIssuesFilter["updateFilters"] = async (
    workspaceSlug,
    projectId,
    type,
    filters,
    viewId
  ) => {
    try {
      await this.commitFilterTypeUpdate({
        filters: this.filters,
        entityId: viewId,
        type,
        patch: filters,
        clear: () => this.rootIssueStore.projectViewIssues.clear(true),
        refetch: () =>
          this.rootIssueStore.projectViewIssues.fetchIssuesWithExistingPagination(
            workspaceSlug,
            projectId,
            viewId,
            "mutation"
          ),
        persistKanbanFilters: (kanbanFilters) => {
          const currentUserId = this.rootIssueStore.currentUserId;
          if (currentUserId)
            this.handleIssuesLocalFilters.set(
              EIssuesStoreType.PROJECT_VIEW,
              type,
              workspaceSlug,
              viewId,
              currentUserId,
              {
                kanban_filters: kanbanFilters,
              }
            );
        },
      });
    } catch (error) {
      if (viewId) this.fetchFilters(workspaceSlug, projectId, viewId);
      throw error;
    }
  };

  /**
   * @description resets the filters for a project view
   * @param workspaceSlug
   * @param viewId
   */
  resetFilters: IProjectViewIssuesFilter["resetFilters"] = action((workspaceSlug, viewId) => {
    const viewDetails = this.rootIssueStore.rootStore.projectView.getViewById(viewId);
    if (!viewDetails) return;
    this.mutateFilters(workspaceSlug, viewId, viewDetails);
  });
}
