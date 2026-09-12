/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { sortBy } from "lodash-es";
import { action, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
import type { TIssueProperty, TIssuePropertyOption, TIssuePropertyValuesMap, TIssueType } from "@plane/types";
import { IssueTypeService } from "@/services/issue/issue_type.service";
import type { CoreRootStore } from "./root.store";

type TIssueTypeFetchOptions = {
  force?: boolean;
};

export interface IIssueTypeStore {
  fetchedMap: Record<string, boolean>;
  enabledMap: Record<string, boolean>;
  projectTypeMap: Record<string, Record<string, TIssueType>>;
  projectRevisionMap: Record<string, number>;
  propertyValuesMap: Record<string, TIssuePropertyValuesMap>;
  getProjectIssueTypes: (projectId: string | undefined | null) => TIssueType[];
  getActiveProjectIssueTypes: (projectId: string | undefined | null) => TIssueType[];
  getActiveProjectProperties: (projectId: string | undefined | null) => TIssueProperty[];
  getProjectPropertyById: (
    projectId: string | undefined | null,
    propertyId: string | undefined | null
  ) => TIssueProperty | undefined;
  getPropertyById: (propertyId: string | undefined | null) => TIssueProperty | undefined;
  getDefaultIssueTypeId: (projectId: string | undefined | null) => string | null;
  getIssueTypeById: (projectId: string | undefined | null, typeId: string | undefined | null) => TIssueType | undefined;
  getPropertiesForType: (projectId: string | undefined | null, typeId: string | undefined | null) => TIssueProperty[];
  getActivePropertiesForType: (
    projectId: string | undefined | null,
    typeId: string | undefined | null
  ) => TIssueProperty[];
  getPropertyValues: (issueId: string | undefined | null) => TIssuePropertyValuesMap;
  isIssueTypeEnabled: (projectId: string | undefined | null) => boolean;
  isTypeInProject: (projectId: string | undefined | null, typeId: string | undefined | null) => boolean;
  fetchWorkItemTypesPropertiesAndOptions: (
    workspaceSlug: string,
    projectId: string,
    options?: TIssueTypeFetchOptions
  ) => Promise<TIssueType[]>;
  enableIssueTypes: (workspaceSlug: string, projectId: string) => Promise<TIssueType[]>;
  createIssueType: (workspaceSlug: string, projectId: string, data: Partial<TIssueType>) => Promise<TIssueType>;
  updateIssueType: (
    workspaceSlug: string,
    projectId: string,
    typeId: string,
    data: Partial<TIssueType>
  ) => Promise<TIssueType>;
  deleteIssueType: (workspaceSlug: string, projectId: string, typeId: string) => Promise<void>;
  createProperty: (
    workspaceSlug: string,
    projectId: string,
    typeId: string,
    data: Omit<Partial<TIssueProperty>, "options"> & { options?: Partial<TIssuePropertyOption>[] }
  ) => Promise<TIssueProperty>;
  updateProperty: (
    workspaceSlug: string,
    projectId: string,
    typeId: string,
    propertyId: string,
    data: Omit<Partial<TIssueProperty>, "options"> & { options?: Partial<TIssuePropertyOption>[] }
  ) => Promise<TIssueProperty>;
  deleteProperty: (workspaceSlug: string, projectId: string, typeId: string, propertyId: string) => Promise<void>;
  fetchPropertyValues: (workspaceSlug: string, projectId: string, issueId: string) => Promise<TIssuePropertyValuesMap>;
  fetchPropertyValuesBulk: (
    workspaceSlug: string,
    projectId: string,
    issueIds: string[]
  ) => Promise<Record<string, TIssuePropertyValuesMap>>;
  upsertPropertyValues: (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    propertyValues: TIssuePropertyValuesMap,
    validateRequired?: boolean
  ) => Promise<TIssuePropertyValuesMap>;
}

export class IssueTypeStore implements IIssueTypeStore {
  rootStore;
  fetchedMap: Record<string, boolean> = {};
  enabledMap: Record<string, boolean> = {};
  projectTypeMap: Record<string, Record<string, TIssueType>> = {};
  projectRevisionMap: Record<string, number> = {};
  propertyValuesMap: Record<string, TIssuePropertyValuesMap> = {};
  projectTypeIds: Record<string, string[]> = {};
  service;
  private fetchPromises = new Map<string, Promise<TIssueType[]>>();
  private propertyValueFetchPromises = new Map<string, Promise<TIssuePropertyValuesMap>>();

  constructor(_rootStore: CoreRootStore) {
    makeObservable(this, {
      fetchedMap: observable,
      enabledMap: observable,
      projectTypeMap: observable,
      projectRevisionMap: observable,
      propertyValuesMap: observable,
      projectTypeIds: observable,
      fetchWorkItemTypesPropertiesAndOptions: action,
      enableIssueTypes: action,
      createIssueType: action,
      updateIssueType: action,
      deleteIssueType: action,
      createProperty: action,
      updateProperty: action,
      deleteProperty: action,
      fetchPropertyValues: action,
      fetchPropertyValuesBulk: action,
      upsertPropertyValues: action,
    });
    this.rootStore = _rootStore;
    this.service = new IssueTypeService();
  }

  getProjectIssueTypes = computedFn((projectId: string | undefined | null) => {
    if (!projectId) return [];
    const projectTypes = this.projectTypeIds[projectId] || [];
    const projectTypeMap = this.projectTypeMap[projectId] || {};
    return projectTypes.map((id) => projectTypeMap[id]).filter(Boolean);
  });

  getActiveProjectIssueTypes = computedFn((projectId: string | undefined | null) =>
    this.getProjectIssueTypes(projectId).filter((type) => type.is_active)
  );

  getActiveProjectProperties = computedFn((projectId: string | undefined | null) => {
    if (!projectId) return [];
    const propertyMap = new Map<string, TIssueProperty>();
    for (const type of this.getActiveProjectIssueTypes(projectId)) {
      for (const property of this.getActivePropertiesForType(projectId, type.id)) {
        if (!propertyMap.has(property.id)) propertyMap.set(property.id, property);
      }
    }
    return sortBy(Array.from(propertyMap.values()), (property) => property.name);
  });

  getProjectPropertyById = computedFn((projectId: string | undefined | null, propertyId: string | undefined | null) => {
    if (!projectId || !propertyId) return undefined;
    for (const type of this.getProjectIssueTypes(projectId)) {
      const property = this.getPropertiesForType(projectId, type.id).find((item) => item.id === propertyId);
      if (property) return property;
    }
    return undefined;
  });

  getPropertyById = computedFn((propertyId: string | undefined | null) => {
    if (!propertyId) return undefined;
    for (const projectId of Object.keys(this.projectTypeMap)) {
      const property = this.getProjectPropertyById(projectId, propertyId);
      if (property) return property;
    }
    return undefined;
  });

  getDefaultIssueTypeId = computedFn((projectId: string | undefined | null) => {
    const defaultType = this.getProjectIssueTypes(projectId).find((type) => type.is_default && type.is_active);
    return defaultType?.id || null;
  });

  getIssueTypeById = computedFn((projectId: string | undefined | null, typeId: string | undefined | null) => {
    if (!projectId || !typeId) return undefined;
    return this.projectTypeMap[projectId]?.[typeId];
  });

  getPropertiesForType = computedFn((projectId: string | undefined | null, typeId: string | undefined | null) => {
    if (!projectId || !typeId) return [];
    return this.projectTypeMap[projectId]?.[typeId]?.properties || [];
  });

  getActivePropertiesForType = computedFn((projectId: string | undefined | null, typeId: string | undefined | null) =>
    this.getPropertiesForType(projectId, typeId).filter((property) => property.is_active)
  );

  getPropertyValues = computedFn((issueId: string | undefined | null) => {
    if (!issueId) return {};
    return this.propertyValuesMap[issueId] || {};
  });

  isIssueTypeEnabled = computedFn((projectId: string | undefined | null) => {
    if (!projectId) return false;
    return Boolean(this.enabledMap[projectId]);
  });

  isTypeInProject = computedFn((projectId: string | undefined | null, typeId: string | undefined | null) => {
    if (!projectId || !typeId) return false;
    return (this.projectTypeIds[projectId] || []).includes(typeId);
  });

  private _setProjectTypes(projectId: string, types: TIssueType[], enabled: boolean) {
    this.projectTypeIds[projectId] = types.map((t) => t.id);
    this.projectTypeMap[projectId] = Object.fromEntries(types.map((type) => [type.id, type]));
    this.projectRevisionMap[projectId] = (this.projectRevisionMap[projectId] ?? 0) + 1;
    this.enabledMap[projectId] = enabled;
    this.fetchedMap[projectId] = true;
  }

  async fetchWorkItemTypesPropertiesAndOptions(
    workspaceSlug: string,
    projectId: string,
    options: TIssueTypeFetchOptions = {}
  ) {
    if (!options.force && this.fetchedMap[projectId]) {
      return this.getProjectIssueTypes(projectId);
    }

    const requestKey = `${workspaceSlug}:${projectId}`;
    const inFlightRequest = this.fetchPromises.get(requestKey);
    if (inFlightRequest) return inFlightRequest;

    const request = this.service
      .getWorkItemTypesPropertiesAndOptions(workspaceSlug, projectId)
      .then((response) => {
        const issueTypes = response.issue_types || [];
        runInAction(() => {
          this._setProjectTypes(projectId, issueTypes, response.is_issue_type_enabled);
        });
        return issueTypes;
      })
      .finally(() => {
        this.fetchPromises.delete(requestKey);
      });

    this.fetchPromises.set(requestKey, request);
    return request;
  }

  async enableIssueTypes(workspaceSlug: string, projectId: string) {
    const response = await this.service.enableIssueTypes(workspaceSlug, projectId);
    runInAction(() => {
      this._setProjectTypes(projectId, response.issue_types || [], true);
    });
    // Keep project store in sync
    const project = this.rootStore.projectRoot.project.projectMap[projectId];
    if (project) {
      runInAction(() => {
        project.is_issue_type_enabled = true;
      });
    }
    return response.issue_types || [];
  }

  async createIssueType(workspaceSlug: string, projectId: string, data: Partial<TIssueType>) {
    const type = await this.service.createIssueType(workspaceSlug, projectId, data);
    await this.fetchWorkItemTypesPropertiesAndOptions(workspaceSlug, projectId, { force: true });
    return type;
  }

  async updateIssueType(workspaceSlug: string, projectId: string, typeId: string, data: Partial<TIssueType>) {
    const type = await this.service.updateIssueType(workspaceSlug, projectId, typeId, data);
    await this.fetchWorkItemTypesPropertiesAndOptions(workspaceSlug, projectId, { force: true });
    return type;
  }

  async deleteIssueType(workspaceSlug: string, projectId: string, typeId: string) {
    await this.service.deleteIssueType(workspaceSlug, projectId, typeId);
    await this.fetchWorkItemTypesPropertiesAndOptions(workspaceSlug, projectId, { force: true });
  }

  async createProperty(
    workspaceSlug: string,
    projectId: string,
    typeId: string,
    data: Omit<Partial<TIssueProperty>, "options"> & { options?: Partial<TIssuePropertyOption>[] }
  ) {
    const property = await this.service.createProperty(workspaceSlug, projectId, typeId, data);
    await this.fetchWorkItemTypesPropertiesAndOptions(workspaceSlug, projectId, { force: true });
    return property;
  }

  async updateProperty(
    workspaceSlug: string,
    projectId: string,
    typeId: string,
    propertyId: string,
    data: Omit<Partial<TIssueProperty>, "options"> & { options?: Partial<TIssuePropertyOption>[] }
  ) {
    const property = await this.service.updateProperty(workspaceSlug, projectId, typeId, propertyId, data);
    await this.fetchWorkItemTypesPropertiesAndOptions(workspaceSlug, projectId, { force: true });
    return property;
  }

  async deleteProperty(workspaceSlug: string, projectId: string, typeId: string, propertyId: string) {
    await this.service.deleteProperty(workspaceSlug, projectId, typeId, propertyId);
    await this.fetchWorkItemTypesPropertiesAndOptions(workspaceSlug, projectId, { force: true });
  }

  async fetchPropertyValues(workspaceSlug: string, projectId: string, issueId: string) {
    if (issueId in this.propertyValuesMap) {
      return this.propertyValuesMap[issueId];
    }

    const requestKey = `${workspaceSlug}:${projectId}:${issueId}`;
    const inFlightRequest = this.propertyValueFetchPromises.get(requestKey);
    if (inFlightRequest) return inFlightRequest;

    const request = this.service
      .getPropertyValues(workspaceSlug, projectId, issueId)
      .then((values) => {
        const nextValues = values || {};
        runInAction(() => {
          this.propertyValuesMap[issueId] = nextValues;
        });
        return nextValues;
      })
      .finally(() => {
        this.propertyValueFetchPromises.delete(requestKey);
      });

    this.propertyValueFetchPromises.set(requestKey, request);
    return request;
  }

  async fetchPropertyValuesBulk(workspaceSlug: string, projectId: string, issueIds: string[]) {
    const uniqueIds = Array.from(new Set(issueIds.filter(Boolean)));
    if (uniqueIds.length === 0) return {};

    const valuesByIssue = await this.service.getPropertyValuesBulk(workspaceSlug, projectId, uniqueIds);
    runInAction(() => {
      for (const [issueId, values] of Object.entries(valuesByIssue || {})) {
        this.propertyValuesMap[issueId] = values || {};
      }
      // Ensure requested ids without values are marked as loaded (empty map)
      for (const issueId of uniqueIds) {
        if (!this.propertyValuesMap[issueId]) {
          this.propertyValuesMap[issueId] = {};
        }
      }
    });
    return valuesByIssue || {};
  }

  async upsertPropertyValues(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    propertyValues: TIssuePropertyValuesMap,
    validateRequired = true
  ) {
    const values = await this.service.upsertPropertyValues(
      workspaceSlug,
      projectId,
      issueId,
      propertyValues,
      validateRequired
    );
    runInAction(() => {
      this.propertyValuesMap[issueId] = { ...this.propertyValuesMap[issueId], ...values };
    });
    return values;
  }
}
