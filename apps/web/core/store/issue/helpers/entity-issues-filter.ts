/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { isEmpty, isEqual, set } from "lodash-es";
import { runInAction } from "mobx";
import { computedFn } from "mobx-utils";
import type { TSupportedFilterTypeForUpdate } from "@plane/constants";
import type {
  IIssueFilters,
  IssuePaginationOptions,
  TIssueParams,
  TSupportedFilterForUpdate,
  TWorkItemFilterExpression,
} from "@plane/types";
import { EIssuesStoreType } from "@plane/types";
import { handleIssueQueryParamsByLayout } from "@plane/utils";
import type { TCollectionRef } from "./collection-ref";
import type { TFilterPropertySource } from "./issue-filter-helper.store";
import { IssueFilterHelperStore } from "./issue-filter-helper.store";
import type { IIssueRootStore } from "../root.store";

export type TEntityFilterScope = {
  storeType: EIssuesStoreType;
  extraQueryParam?: Extract<TIssueParams, "cycle" | "module">;
};

export abstract class EntityIssuesFilter extends IssueFilterHelperStore {
  filters: Record<string, IIssueFilters> = {};
  rootIssueStore: IIssueRootStore;

  constructor(rootStore: IIssueRootStore) {
    super();
    this.rootIssueStore = rootStore;
  }

  abstract readonly scope: TEntityFilterScope;
  abstract routerEntityId(): string | undefined;
  abstract fetchRemote(ref: TCollectionRef): Promise<TFilterPropertySource>;
  abstract persist(ref: TCollectionRef, payload: Record<string, unknown>): Promise<unknown>;
  abstract refetchIssues(ref: TCollectionRef): void;
  abstract clearIssues(): void;

  hydrateFrom(_ref: TCollectionRef): TFilterPropertySource | IIssueFilters | undefined {
    return undefined;
  }

  get issueFilters() {
    const entityId = this.routerEntityId();
    if (!entityId) return undefined;
    return this.getIssueFilters(entityId);
  }

  get appliedFilters() {
    const entityId = this.routerEntityId();
    if (!entityId) return undefined;
    return this.getAppliedFilters(entityId);
  }

  getIssueFilters(entityId: string) {
    const displayFilters = this.filters[entityId] || undefined;
    if (isEmpty(displayFilters)) return undefined;
    return this.computedIssueFilters(displayFilters);
  }

  getAppliedFilters(entityId: string) {
    const userFilters = this.getIssueFilters(entityId);
    if (!userFilters) return undefined;

    const filteredParams = handleIssueQueryParamsByLayout(userFilters?.displayFilters?.layout, "issues");
    if (!filteredParams) return undefined;

    const extra = this.scope.extraQueryParam;
    if (extra && filteredParams.includes(extra)) filteredParams.splice(filteredParams.indexOf(extra), 1);

    return this.computedFilteredParams(userFilters.richFilters, userFilters.displayFilters, filteredParams);
  }

  getFilterParams = computedFn(
    (
      options: IssuePaginationOptions,
      entityId: string,
      cursor: string | undefined,
      groupId: string | undefined,
      subGroupId: string | undefined
    ) => {
      const filterParams = { ...this.getAppliedFilters(entityId) };
      if (this.scope.extraQueryParam) filterParams[this.scope.extraQueryParam] = entityId;
      return this.getPaginationParams(filterParams, options, cursor, groupId, subGroupId);
    }
  );

  hydrateRef = (ref: TCollectionRef) => {
    if (!isEmpty(this.filters[ref.entityId])) return;
    const source = this.hydrateFrom(ref);
    if (!source) return;
    if (isCopiedIssueFilters(source)) {
      this.copyEntityFilters(this.filters, ref.entityId, source);
      return;
    }
    this.writeEntityFilters(
      this.filters,
      ref.entityId,
      ref.workspaceSlug,
      this.scope.storeType,
      this.rootIssueStore.currentUserId,
      source && "displayFilters" in source ? undefined : source
    );
  };

  fetchRef = async (ref: TCollectionRef) => {
    this.hydrateRef(ref);
    const hadDocument = !isEmpty(this.filters[ref.entityId]);
    const previousApplied = hadDocument ? this.getAppliedFilters(ref.entityId) : undefined;
    const remote = await this.fetchRemote(ref);
    const wrote = this.writeEntityFilters(
      this.filters,
      ref.entityId,
      ref.workspaceSlug,
      this.scope.storeType,
      this.rootIssueStore.currentUserId,
      remote
    );
    if (!wrote || !hadDocument) return;
    if (!isEqual(previousApplied, this.getAppliedFilters(ref.entityId))) {
      this.refetchIssues(ref);
    }
  };

  updateExpressionRef = async (ref: TCollectionRef, filters: TWorkItemFilterExpression) => {
    runInAction(() => {
      set(this.filters, [ref.entityId, "richFilters"], filters);
    });
    this.refetchIssues(ref);
    await this.persist(ref, { rich_filters: filters });
  };

  updateFiltersRef = async (
    ref: TCollectionRef,
    type: TSupportedFilterTypeForUpdate,
    patch: TSupportedFilterForUpdate
  ) => {
    await this.commitFilterTypeUpdate({
      filters: this.filters,
      entityId: ref.entityId,
      type,
      patch,
      clear: () => this.clearIssues(),
      refetch: () => this.refetchIssues(ref),
      persistDisplayFilters: (displayFilters) => this.persist(ref, { display_filters: displayFilters }),
      persistDisplayProperties: (displayProperties) => this.persist(ref, { display_properties: displayProperties }),
      persistKanbanFilters: (kanbanFilters) => {
        const currentUserId = this.rootIssueStore.currentUserId;
        if (!currentUserId) return;
        this.handleIssuesLocalFilters.set(this.scope.storeType, type, ref.workspaceSlug, ref.entityId, currentUserId, {
          kanban_filters: kanbanFilters,
        });
      },
    });
  };
}

export function isCopiedIssueFilters(
  source: TFilterPropertySource | IIssueFilters | undefined
): source is IIssueFilters {
  return !!source && "displayFilters" in source && source.displayFilters !== undefined;
}
