/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { isEmpty, isEqual, set } from "lodash-es";
import { runInAction } from "mobx";
// plane constants
import type { TSupportedFilterTypeForUpdate } from "@plane/constants";
import {
  EIssueFilterType,
  EIssueGroupByToServerOptions,
  EServerGroupByToFilterOptions,
  ENABLE_ISSUE_DEPENDENCIES,
} from "@plane/constants";
import type {
  EIssuesStoreType,
  IIssueDisplayFilterOptions,
  IIssueDisplayProperties,
  IIssueFilterOptions,
  IIssueFilters,
  IIssueFiltersResponse,
  IssuePaginationOptions,
  TIssueKanbanFilters,
  TIssueParams,
  TStaticViewTypes,
  TSupportedFilterForUpdate,
  TWorkItemFilterExpression,
} from "@plane/types";
import { EIssueLayoutTypes } from "@plane/types";
// helpers
import { getComputedDisplayFilters, getComputedDisplayProperties, mergeDisplayProperties } from "@plane/utils";
// helpers
import { isHierarchyLayout } from "@/components/issues/issue-layouts/hierarchy.helpers";
import { shouldExcludeEpicsFromKanbanParams } from "@/helpers/kanban-epic-filter";
// lib
import { storage } from "@/lib/local-storage";
import { getEnabledDisplayFilters } from "@/plane-web/store/issue/helpers/filter-utils";

interface ILocalStoreIssueFilters {
  key: EIssuesStoreType;
  workspaceSlug: string;
  viewId: string | undefined; // It can be projectId, moduleId, cycleId, projectViewId
  userId: string | undefined;
  filters: IIssueFilters;
}

export interface IBaseIssueFilterStore {
  // observables
  filters: Record<string, IIssueFilters>;
  //computed
  appliedFilters: Partial<Record<TIssueParams, string | boolean>> | undefined;
  issueFilters: IIssueFilters | undefined;
}

export interface IIssueFilterHelperStore {
  computedIssueFilters(filters: IIssueFilters): IIssueFilters;
  computedFilteredParams(
    richFilters: TWorkItemFilterExpression,
    displayFilters: IIssueDisplayFilterOptions | undefined,
    acceptableParamsByLayout: TIssueParams[]
  ): Partial<Record<TIssueParams, string | boolean>>;
  computedFilters(filters: IIssueFilterOptions): IIssueFilterOptions;
  getFilterConditionBasedOnViews: (
    currentUserId: string | undefined,
    type: TStaticViewTypes
  ) => Partial<Record<TIssueParams, string>> | undefined;
  computedDisplayFilters(
    displayFilters: IIssueDisplayFilterOptions,
    defaultValues?: IIssueDisplayFilterOptions
  ): IIssueDisplayFilterOptions;
  computedDisplayProperties(filters: IIssueDisplayProperties): IIssueDisplayProperties;
}

export type TFilterPropertySource =
  | {
      rich_filters?: TWorkItemFilterExpression;
      display_filters?: IIssueDisplayFilterOptions;
      display_properties?: IIssueDisplayProperties;
    }
  | null
  | undefined;

export class IssueFilterHelperStore implements IIssueFilterHelperStore {
  // Work-item Kanban hides Epic-type cards by default. Epic boards override this.
  excludeEpicTypesOnKanban = true;

  /**
   * @description This method is used to apply the display filters on the issues
   * @param {IIssueFilters} filters
   * @returns {IIssueFilters}
   */
  computedIssueFilters = (filters: IIssueFilters): IIssueFilters => ({
    richFilters: isEmpty(filters?.richFilters) ? {} : filters?.richFilters,
    displayFilters: isEmpty(filters?.displayFilters) ? undefined : filters?.displayFilters,
    displayProperties: isEmpty(filters?.displayProperties) ? undefined : filters?.displayProperties,
    kanbanFilters: isEmpty(filters?.kanbanFilters) ? undefined : filters?.kanbanFilters,
  });

  /**
   * @description This method is used to convert the filters array params to string params
   * @param {TWorkItemFilterExpression} richFilters
   * @param {IIssueDisplayFilterOptions} displayFilters
   * @param {string[]} acceptableParamsByLayout
   * @returns {Partial<Record<TIssueParams, string | boolean>>}
   */
  computedFilteredParams = (
    richFilters: TWorkItemFilterExpression,
    displayFilters: IIssueDisplayFilterOptions | undefined,
    acceptableParamsByLayout: TIssueParams[]
  ): Partial<Record<TIssueParams, string | boolean>> => {
    // Spreadsheet / Gantt nest children under parents — never fetch children as root rows.
    // List is flat: always include children so they appear under their own group header.
    const hierarchyLayout = isHierarchyLayout(displayFilters?.layout);

    const computedDisplayFilters: Partial<Record<TIssueParams, undefined | string[] | boolean | string>> = {
      group_by: displayFilters?.group_by ? EIssueGroupByToServerOptions[displayFilters.group_by] : undefined,
      sub_group_by: displayFilters?.sub_group_by
        ? EIssueGroupByToServerOptions[displayFilters.sub_group_by]
        : undefined,
      order_by: displayFilters?.order_by || undefined,
      sub_issue: hierarchyLayout ? false : (displayFilters?.sub_issue ?? true),
    };

    const issueFiltersParams: Partial<Record<TIssueParams, boolean | string>> = {};
    Object.keys(computedDisplayFilters).forEach((key) => {
      const _key = key as TIssueParams;
      const _value: string | boolean | string[] | undefined = computedDisplayFilters[_key];
      const nonEmptyArrayValue = Array.isArray(_value) && _value.length === 0 ? undefined : _value;
      if (nonEmptyArrayValue != undefined && acceptableParamsByLayout.includes(_key))
        issueFiltersParams[_key] = Array.isArray(nonEmptyArrayValue)
          ? nonEmptyArrayValue.join(",")
          : nonEmptyArrayValue;
    });

    // Hierarchy layouts always exclude parented issues from the root list, even when the
    // sub_issue toggle is not part of acceptableParamsByLayout (toggle is hidden there).
    if (hierarchyLayout) {
      issueFiltersParams.sub_issue = false;
    }

    if (displayFilters?.layout === EIssueLayoutTypes.LIST) {
      issueFiltersParams.sub_issue = true;
    }

    if (
      shouldExcludeEpicsFromKanbanParams({
        layout: displayFilters?.layout,
        richFilters,
        excludeEpicTypesOnKanban: this.excludeEpicTypesOnKanban,
      })
    ) {
      issueFiltersParams.exclude_epics = true;
    }

    // work item filters
    if (richFilters) issueFiltersParams.filters = JSON.stringify(richFilters);

    if (displayFilters?.layout) issueFiltersParams.layout = displayFilters?.layout;

    if (ENABLE_ISSUE_DEPENDENCIES && displayFilters?.layout === EIssueLayoutTypes.GANTT)
      issueFiltersParams["expand"] = "issue_relation,issue_related";

    return issueFiltersParams;
  };

  /**
   * @description This method is used to apply the filters on the issues
   * @param {IIssueFilterOptions} filters
   * @returns {IIssueFilterOptions}
   */
  computedFilters = (filters: IIssueFilterOptions): IIssueFilterOptions => ({
    priority: filters?.priority || null,
    state: filters?.state || null,
    state_group: filters?.state_group || null,
    assignees: filters?.assignees || null,
    mentions: filters?.mentions || null,
    created_by: filters?.created_by || null,
    labels: filters?.labels || null,
    cycle: filters?.cycle || null,
    module: filters?.module || null,
    start_date: filters?.start_date || null,
    target_date: filters?.target_date || null,
    project: filters?.project || null,
    team_project: filters?.team_project || null,
    subscriber: filters?.subscriber || null,
    issue_type: filters?.issue_type || null,
  });

  /**
   * @description This method is used to get the filter conditions based on the views
   * @param currentUserId
   * @param type
   * @returns
   */
  getFilterConditionBasedOnViews: IIssueFilterHelperStore["getFilterConditionBasedOnViews"] = (currentUserId, type) => {
    if (!currentUserId) return undefined;
    switch (type) {
      case "assigned":
        return {
          assignees: currentUserId,
        };
      case "created":
        return {
          created_by: currentUserId,
        };
      case "subscribed":
        return {
          subscriber: currentUserId,
        };
      case "all-issues":
      default:
        return undefined;
    }
  };

  /**
   * @description This method is used to apply the display filters on the issues
   * @param {IIssueDisplayFilterOptions} displayFilters
   * @returns {IIssueDisplayFilterOptions}
   */
  computedDisplayFilters = (
    displayFilters: IIssueDisplayFilterOptions,
    defaultValues?: IIssueDisplayFilterOptions
  ): IIssueDisplayFilterOptions => {
    const computedFilters = getComputedDisplayFilters(displayFilters, defaultValues);
    return getEnabledDisplayFilters(computedFilters);
  };

  /**
   * @description This method is used to apply the display properties on the issues
   * @param {IIssueDisplayProperties} displayProperties
   * @returns {IIssueDisplayProperties}
   */
  computedDisplayProperties = (displayProperties: IIssueDisplayProperties): IIssueDisplayProperties =>
    getComputedDisplayProperties(displayProperties);

  /**
   * Build the filter document writeEntityFilters would persist, without mutating the map.
   */
  protected buildEntityFilters(
    workspaceSlug: string,
    entityId: string,
    storeType: EIssuesStoreType,
    currentUserId: string | undefined,
    properties: TFilterPropertySource,
    displayFilterDefaults?: IIssueDisplayFilterOptions
  ): IIssueFilters {
    const kanbanFilters: TIssueKanbanFilters = {
      group_by: [],
      sub_group_by: [],
    };
    if (currentUserId) {
      const localFilters = this.handleIssuesLocalFilters.get(storeType, workspaceSlug, entityId, currentUserId);
      kanbanFilters.group_by = localFilters?.kanban_filters?.group_by || [];
      kanbanFilters.sub_group_by = localFilters?.kanban_filters?.sub_group_by || [];
    }

    return {
      richFilters: properties?.rich_filters ?? {},
      displayFilters: this.computedDisplayFilters(
        properties?.display_filters ?? ({} as IIssueDisplayFilterOptions),
        displayFilterDefaults
      ),
      displayProperties: this.computedDisplayProperties(
        properties?.display_properties ?? ({} as IIssueDisplayProperties)
      ),
      kanbanFilters,
    };
  }

  protected entityFiltersMatch(current: IIssueFilters | undefined, next: IIssueFilters): boolean {
    if (!current) return false;
    return (
      isEqual(current.richFilters ?? {}, next.richFilters ?? {}) &&
      isEqual(current.displayFilters, next.displayFilters) &&
      isEqual(current.displayProperties, next.displayProperties) &&
      isEqual(current.kanbanFilters, next.kanbanFilters)
    );
  }

  /**
   * URL layout is write-through. A late remote document must not flip list/board/timeline
   * after persistLayout has already updated the in-memory document.
   */
  protected withPreservedLayout(current: IIssueFilters | undefined, next: IIssueFilters): IIssueFilters {
    return withPreservedLayout(current, next);
  }

  /**
   * Write display/rich/kanban filters for an entity. Used to hydrate from cache or apply a network response.
   * Returns false when the computed document already matches the stored one so observers do not churn.
   */
  protected writeEntityFilters(
    filters: Record<string, IIssueFilters>,
    entityId: string,
    workspaceSlug: string,
    storeType: EIssuesStoreType,
    currentUserId: string | undefined,
    properties: TFilterPropertySource,
    displayFilterDefaults?: IIssueDisplayFilterOptions
  ) {
    const next = this.withPreservedLayout(
      filters[entityId],
      this.buildEntityFilters(workspaceSlug, entityId, storeType, currentUserId, properties, displayFilterDefaults)
    );
    if (this.entityFiltersMatch(filters[entityId], next)) return false;

    runInAction(() => {
      set(filters, [entityId, "richFilters"], next.richFilters);
      set(filters, [entityId, "displayFilters"], next.displayFilters);
      set(filters, [entityId, "displayProperties"], next.displayProperties);
      set(filters, [entityId, "kanbanFilters"], next.kanbanFilters);
    });
    return true;
  }

  protected copyEntityFilters(filters: Record<string, IIssueFilters>, entityId: string, source: IIssueFilters) {
    runInAction(() => {
      set(filters, [entityId, "richFilters"], source.richFilters);
      set(filters, [entityId, "displayFilters"], source.displayFilters);
      set(filters, [entityId, "displayProperties"], source.displayProperties);
      set(filters, [entityId, "kanbanFilters"], source.kanbanFilters);
    });
  }

  handleIssuesLocalFilters = {
    fetchFiltersFromStorage: () => {
      const _filters = storage.get("issue_local_filters");
      return _filters ? JSON.parse(_filters) : [];
    },

    get: (
      currentView: EIssuesStoreType,
      workspaceSlug: string,
      viewId: string | undefined, // It can be projectId, moduleId, cycleId, projectViewId
      userId: string | undefined
    ) => {
      const storageFilters = this.handleIssuesLocalFilters.fetchFiltersFromStorage();
      const currentFilterIndex = storageFilters.findIndex(
        (filter: ILocalStoreIssueFilters) =>
          filter.key === currentView &&
          filter.workspaceSlug === workspaceSlug &&
          filter.viewId === viewId &&
          filter.userId === userId
      );
      if (currentFilterIndex < 0) return undefined;

      return storageFilters[currentFilterIndex]?.filters || {};
    },

    set: (
      currentView: EIssuesStoreType,
      filterType: EIssueFilterType,
      workspaceSlug: string,
      viewId: string | undefined, // It can be projectId, moduleId, cycleId, projectViewId
      userId: string | undefined,
      filters: Partial<IIssueFiltersResponse & { kanban_filters: TIssueKanbanFilters }>
    ) => {
      const storageFilters = this.handleIssuesLocalFilters.fetchFiltersFromStorage();
      const currentFilterIndex = storageFilters.findIndex(
        (filter: ILocalStoreIssueFilters) =>
          filter.key === currentView &&
          filter.workspaceSlug === workspaceSlug &&
          filter.viewId === viewId &&
          filter.userId === userId
      );

      if (currentFilterIndex < 0)
        storageFilters.push({
          key: currentView,
          workspaceSlug: workspaceSlug,
          viewId: viewId,
          userId: userId,
          filters: filters,
        });
      else
        storageFilters[currentFilterIndex] = {
          ...storageFilters[currentFilterIndex],
          filters: {
            ...storageFilters[currentFilterIndex].filters,
            [filterType]: filters[filterType as keyof IIssueFiltersResponse],
          },
        };
      // All group_by "filters" are stored in a single array, will cause inconsistency in case of duplicated values
      storage.set("issue_local_filters", JSON.stringify(storageFilters));
    },
  };

  getShouldReFetchIssues = (displayFilters: IIssueDisplayFilterOptions) => {
    const SERVER_DISPLAY_FILTERS = ["order_by", "sub_issue", "type"];
    return SERVER_DISPLAY_FILTERS.some((key) => Object.prototype.hasOwnProperty.call(displayFilters, key));
  };

  /**
   * Shared kanban/group_by rules used by every entity filter store.
   */
  normalizeKanbanDisplayFilters(
    updated: IIssueDisplayFilterOptions,
    defaultGroupBy: IIssueDisplayFilterOptions["group_by"] = "state"
  ): IIssueDisplayFilterOptions {
    const next = { ...updated };
    if (next.group_by === null) {
      next.sub_group_by = null;
    }
    if (next.layout === "kanban" && next.group_by === next.sub_group_by) {
      next.sub_group_by = null;
    }
    if (next.layout === "kanban" && next.group_by === null) {
      next.group_by = defaultGroupBy;
    }
    return next;
  }

  /**
   * Merge a display-filter patch onto the current document without mutating the patch.
   */
  applyDisplayFilterUpdate(
    current: IIssueDisplayFilterOptions,
    patch: IIssueDisplayFilterOptions,
    defaultGroupBy: IIssueDisplayFilterOptions["group_by"] = "state"
  ): IIssueDisplayFilterOptions {
    return this.normalizeKanbanDisplayFilters({ ...current, ...patch }, defaultGroupBy);
  }

  applyLocalEntityPatch(
    filters: Record<string, IIssueFilters>,
    entityId: string,
    path: "displayFilters" | "displayProperties" | "kanbanFilters",
    patch: Record<string, unknown>
  ) {
    runInAction(() => {
      Object.keys(patch).forEach((key) => {
        set(filters, [entityId, path, key], patch[key]);
      });
    });
  }

  /**
   * One filter document writer: apply display / property / kanban updates
   * onto `filters[entityId]` and return the merged document slice.
   */
  applyFilterTypeUpdate(args: {
    filters: Record<string, IIssueFilters>;
    entityId: string;
    type: TSupportedFilterTypeForUpdate;
    patch: TSupportedFilterForUpdate;
    defaultKanbanGroupBy?: IIssueDisplayFilterOptions["group_by"];
  }):
    | {
        displayFilters?: IIssueDisplayFilterOptions;
        displayProperties?: IIssueDisplayProperties;
        kanbanFilters?: TIssueKanbanFilters;
      }
    | undefined {
    const { filters, entityId, type, patch, defaultKanbanGroupBy = "state" } = args;
    if (isEmpty(filters) || isEmpty(filters[entityId])) return undefined;

    switch (type) {
      case EIssueFilterType.DISPLAY_FILTERS: {
        const updated = patch as IIssueDisplayFilterOptions;
        const current = filters[entityId].displayFilters as IIssueDisplayFilterOptions;
        const displayFilters = this.applyDisplayFilterUpdate(current, updated, defaultKanbanGroupBy);
        this.applyLocalEntityPatch(filters, entityId, "displayFilters", {
          ...updated,
          group_by: displayFilters.group_by,
          sub_group_by: displayFilters.sub_group_by,
        } as Record<string, unknown>);
        return { displayFilters };
      }
      case EIssueFilterType.DISPLAY_PROPERTIES: {
        const updated = patch as IIssueDisplayProperties;
        const displayProperties = mergeDisplayProperties(
          filters[entityId].displayProperties as IIssueDisplayProperties,
          updated
        );
        runInAction(() => {
          Object.keys(updated).forEach((key) => {
            set(filters, [entityId, "displayProperties", key], displayProperties[key as keyof IIssueDisplayProperties]);
          });
        });
        return { displayProperties };
      }
      case EIssueFilterType.KANBAN_FILTERS: {
        const updated = patch as TIssueKanbanFilters;
        const kanbanFilters = {
          ...(filters[entityId].kanbanFilters as TIssueKanbanFilters),
          ...updated,
        };
        this.applyLocalEntityPatch(filters, entityId, "kanbanFilters", updated as Record<string, unknown>);
        return { kanbanFilters };
      }
      default:
        return undefined;
    }
  }

  /**
   * Apply a filter patch, persist via strategy, and refetch only when the inbound patch requires it.
   */
  async commitFilterTypeUpdate(args: {
    filters: Record<string, IIssueFilters>;
    entityId: string;
    type: TSupportedFilterTypeForUpdate;
    patch: TSupportedFilterForUpdate;
    defaultKanbanGroupBy?: IIssueDisplayFilterOptions["group_by"];
    clear?: () => void;
    refetch?: () => void;
    persistDisplayFilters?: (filters: IIssueDisplayFilterOptions) => Promise<unknown> | unknown;
    persistDisplayProperties?: (properties: IIssueDisplayProperties) => Promise<unknown> | unknown;
    persistKanbanFilters?: (filters: TIssueKanbanFilters) => void;
    forceRefetch?: boolean;
  }): Promise<boolean> {
    const previousGroupBy = args.filters[args.entityId]?.displayFilters?.group_by;
    const previousSubGroupBy = args.filters[args.entityId]?.displayFilters?.sub_group_by;
    const applied = this.applyFilterTypeUpdate({
      filters: args.filters,
      entityId: args.entityId,
      type: args.type,
      patch: args.patch,
      defaultKanbanGroupBy: args.defaultKanbanGroupBy,
    });
    if (!applied) return false;

    if (applied.displayFilters) {
      const displayPatch =
        args.type === EIssueFilterType.DISPLAY_FILTERS ? (args.patch as IIssueDisplayFilterOptions) : {};
      const groupingChanged =
        applied.displayFilters.group_by !== previousGroupBy ||
        applied.displayFilters.sub_group_by !== previousSubGroupBy;
      const isLayoutDrivenNormalize =
        groupingChanged &&
        displayPatch.layout !== undefined &&
        displayPatch.group_by === undefined &&
        displayPatch.sub_group_by === undefined;
      if (groupingChanged && !isLayoutDrivenNormalize) {
        args.clear?.();
      }
      if (args.forceRefetch || groupingChanged || this.getShouldReFetchIssues(displayPatch)) {
        args.refetch?.();
      }
      await args.persistDisplayFilters?.(applied.displayFilters);
    }

    if (applied.displayProperties) {
      await args.persistDisplayProperties?.(applied.displayProperties);
    }

    if (applied.kanbanFilters) {
      args.persistKanbanFilters?.(applied.kanbanFilters);
    }

    return true;
  }

  /**
   * This Method is used to construct the url params along with paginated values
   * @param filterParams params generated from filters
   * @param options pagination options
   * @param cursor cursor if exists
   * @param groupId groupId if to fetch By group
   * @param subGroupId groupId if to fetch By sub group
   * @returns
   */
  getPaginationParams(
    filterParams: Partial<Record<TIssueParams, string | boolean>> | undefined,
    options: IssuePaginationOptions,
    cursor: string | undefined,
    groupId?: string,
    subGroupId?: string
  ) {
    // if cursor exists, use the cursor. If it doesn't exist construct the cursor based on per page count
    const pageCursor = cursor ? cursor : groupId ? `${options.perPageCount}:1:0` : `${options.perPageCount}:0:0`;

    // pagination params
    const paginationParams: Partial<Record<TIssueParams, string | boolean>> = {
      ...filterParams,
      cursor: pageCursor,
      per_page: options.perPageCount.toString(),
    };

    // If group by is specifically sent through options, like that for calendar layout, use that to group
    if (options.groupedBy) {
      paginationParams.group_by = options.groupedBy;
    }

    // If before and after dates are sent from option to filter by then, add them to filter the options
    if (options.after && options.before) {
      paginationParams["target_date"] = `${options.after};after,${options.before};before`;
    }

    // If groupId is passed down, add a filter param for that group Id
    if (groupId) {
      const groupBy = paginationParams["group_by"] as EIssueGroupByToServerOptions | undefined;
      delete paginationParams["group_by"];

      if (groupBy) {
        const groupByFilterOption = EServerGroupByToFilterOptions[groupBy];
        paginationParams[groupByFilterOption] = groupId;
      }
    }

    // If subGroupId is passed down, add a filter param for that subGroup Id
    if (subGroupId) {
      const subGroupBy = paginationParams["sub_group_by"] as EIssueGroupByToServerOptions | undefined;
      delete paginationParams["sub_group_by"];

      if (subGroupBy) {
        const subGroupByFilterOption = EServerGroupByToFilterOptions[subGroupBy];
        paginationParams[subGroupByFilterOption] = subGroupId;
      }
    }

    return paginationParams;
  }
}

export function withPreservedLayout(current: IIssueFilters | undefined, next: IIssueFilters): IIssueFilters {
  const localLayout = current?.displayFilters?.layout;
  if (!localLayout || next.displayFilters?.layout === localLayout) {
    return next;
  }
  return {
    ...next,
    displayFilters: {
      ...next.displayFilters,
      layout: localLayout,
    },
  };
}
