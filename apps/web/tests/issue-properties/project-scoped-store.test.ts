/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it, vi } from "vitest";
import type { EUserProjectRoles, IProjectUserPropertiesResponse, TIssueProperty, TIssueType } from "@plane/types";
import { EIssueLayoutTypes } from "@plane/types";
import type { RootStore } from "@/plane-web/store/root.store";
import type { CoreRootStore } from "@/store/root.store";
import { IssueTypeStore } from "@/store/issue-type.store";
import type { IMemberRootStore } from "@/store/member";
import { BaseProjectMemberStore } from "@/store/member/project/base-project-member.store";
import { ProjectIssuesFilter } from "@/store/issue/project/filter.store";

class TestProjectMemberStore extends BaseProjectMemberStore {
  getUserProjectRole = () => undefined;
  getProjectMemberRoleForUpdate = (_projectId: string, _userId: string, role: EUserProjectRoles) => role;
  processMemberRemoval = () => {};
}

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

const createProperty = (projectId: string, id: string, name: string): TIssueProperty => ({
  id,
  issue_type_id: "shared-task-type",
  name,
  property_type: "TEXT",
  is_required: false,
  is_active: true,
  sort_order: 1,
  settings: {},
  options: [],
  project_id: projectId,
  workspace_id: "workspace-1",
});

const createType = (projectId: string, properties: TIssueProperty[]): TIssueType => ({
  id: "shared-task-type",
  name: "Task",
  is_epic: false,
  is_active: true,
  is_default: true,
  level: 0,
  project_issue_type_id: `link-${projectId}`,
  properties,
  workspace_id: "workspace-1",
});

const createUserProperties = (customProperties: Record<string, boolean> = {}): IProjectUserPropertiesResponse =>
  ({
    rich_filters: {},
    display_filters: { layout: "list" },
    display_properties: {
      assignee: true,
      custom_properties: customProperties,
    },
    sort_order: 1,
    preferences: {
      pages: { block_display: false },
      navigation: {
        default_tab: "work_items",
        hide_in_more_menu: [],
      },
    },
  }) as IProjectUserPropertiesResponse;

const createMemberStore = () => {
  const rootStore = {
    router: {},
    user: {},
    projectRoot: { project: {} },
  } as RootStore;
  return new TestProjectMemberStore({} as IMemberRootStore, rootStore);
};

describe("IssueTypeStore project scoping", () => {
  it("keeps distinct property snapshots when projects share the same type ID", async () => {
    const store = new IssueTypeStore({} as CoreRootStore);
    const projectAProperty = createProperty("project-a", "property-a", "Property A");
    const getDefinitions = vi
      .spyOn(store.service, "getWorkItemTypesPropertiesAndOptions")
      .mockImplementation(async (_workspaceSlug, projectId) => ({
        is_issue_type_enabled: true,
        issue_types: [createType(projectId, projectId === "project-a" ? [projectAProperty] : [])],
      }));

    await store.fetchWorkItemTypesPropertiesAndOptions("workspace", "project-a");
    await store.fetchWorkItemTypesPropertiesAndOptions("workspace", "project-b");

    expect(store.getActiveProjectProperties("project-a").map((property) => property.id)).toEqual(["property-a"]);
    expect(store.getActiveProjectProperties("project-b")).toEqual([]);
    expect(store.getIssueTypeById("project-a", "shared-task-type")?.project_issue_type_id).toBe("link-project-a");
    expect(store.getIssueTypeById("project-b", "shared-task-type")?.project_issue_type_id).toBe("link-project-b");

    await store.fetchWorkItemTypesPropertiesAndOptions("workspace", "project-a");
    expect(getDefinitions).toHaveBeenCalledTimes(2);
    expect(store.getActiveProjectProperties("project-a").map((property) => property.id)).toEqual(["property-a"]);
  });

  it("deduplicates concurrent definition requests", async () => {
    const store = new IssueTypeStore({} as CoreRootStore);
    const deferred = createDeferred<{
      is_issue_type_enabled: boolean;
      issue_types: TIssueType[];
    }>();
    const getDefinitions = vi
      .spyOn(store.service, "getWorkItemTypesPropertiesAndOptions")
      .mockReturnValue(deferred.promise);

    const first = store.fetchWorkItemTypesPropertiesAndOptions("workspace", "project-a");
    const second = store.fetchWorkItemTypesPropertiesAndOptions("workspace", "project-a");
    deferred.resolve({
      is_issue_type_enabled: true,
      issue_types: [createType("project-a", [])],
    });

    await Promise.all([first, second]);
    expect(getDefinitions).toHaveBeenCalledTimes(1);
  });

  it("clears a failed in-flight request so a later fetch can retry", async () => {
    const store = new IssueTypeStore({} as CoreRootStore);
    const getDefinitions = vi
      .spyOn(store.service, "getWorkItemTypesPropertiesAndOptions")
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce({
        is_issue_type_enabled: true,
        issue_types: [createType("project-a", [])],
      });

    await expect(store.fetchWorkItemTypesPropertiesAndOptions("workspace", "project-a")).rejects.toThrow(
      "temporary failure"
    );
    await expect(store.fetchWorkItemTypesPropertiesAndOptions("workspace", "project-a")).resolves.toHaveLength(1);
    expect(getDefinitions).toHaveBeenCalledTimes(2);
  });
});

describe("project user-properties bootstrap", () => {
  it("prunes foreign custom display IDs without touching another project", () => {
    const rootIssueStore = {
      currentUserId: undefined,
      rootStore: {},
    };
    const issueFilter = new ProjectIssuesFilter(rootIssueStore as never);
    issueFilter.filters["project-a"] = {
      richFilters: {},
      displayFilters: { layout: EIssueLayoutTypes.LIST },
      displayProperties: {
        custom_properties: {
          "property-a": true,
          "property-foreign": true,
        },
      },
      kanbanFilters: { group_by: [], sub_group_by: [] },
    };
    issueFilter.filters["project-b"] = {
      richFilters: {},
      displayFilters: { layout: EIssueLayoutTypes.LIST },
      displayProperties: {
        custom_properties: {
          "property-b": true,
        },
      },
      kanbanFilters: { group_by: [], sub_group_by: [] },
    };

    issueFilter.pruneCustomDisplayProperties("project-a", ["property-a"]);

    expect(issueFilter.getIssueFilters("project-a")?.displayProperties?.custom_properties).toEqual({
      "property-a": true,
    });
    expect(issueFilter.getIssueFilters("project-b")?.displayProperties?.custom_properties).toEqual({
      "property-b": true,
    });
  });

  it("reuses cached preferences and deep-merges custom display toggles", async () => {
    const store = createMemberStore();
    const initial = createUserProperties({ "property-a": true });
    const getProperties = vi.spyOn(store.projectService, "getProjectUserProperties").mockResolvedValue(initial);

    await store.fetchProjectUserProperties("workspace", "project-a");
    await store.fetchProjectUserProperties("workspace", "project-a");
    store.setProjectUserProperties("project-a", {
      display_properties: {
        custom_properties: { "property-b": false },
      },
    });

    expect(getProperties).toHaveBeenCalledTimes(1);
    expect(store.getProjectUserProperties("project-a")?.display_properties.custom_properties).toEqual({
      "property-a": true,
      "property-b": false,
    });
    expect(store.getProjectUserProperties("project-a")?.display_filters.layout).toBe("list");
  });

  it("shares an in-flight preference request with the project issue filter", async () => {
    const memberStore = createMemberStore();
    const deferred = createDeferred<IProjectUserPropertiesResponse>();
    const getProperties = vi
      .spyOn(memberStore.projectService, "getProjectUserProperties")
      .mockReturnValue(deferred.promise);
    const rootIssueStore = {
      currentUserId: undefined,
      rootStore: {
        memberRoot: {
          project: memberStore,
        },
      },
    };
    const issueFilter = new ProjectIssuesFilter(rootIssueStore as never);

    const wrapperRequest = memberStore.fetchProjectUserProperties("workspace", "project-a");
    const filterRequest = issueFilter.fetchFilters("workspace", "project-a");
    deferred.resolve(createUserProperties({ "property-a": true }));

    await Promise.all([wrapperRequest, filterRequest]);
    // A second call after cache warm must not hit the network again.
    await memberStore.fetchProjectUserProperties("workspace", "project-a");
    expect(getProperties).toHaveBeenCalledTimes(1);
    expect(issueFilter.getIssueFilters("project-a")?.displayProperties?.custom_properties).toEqual({
      "property-a": true,
    });
  });

  it("does not rewrite filters when fetchRef matches the hydrated document", async () => {
    const memberStore = createMemberStore();
    const properties = createUserProperties({ "property-a": true });
    vi.spyOn(memberStore.projectService, "getProjectUserProperties").mockResolvedValue(properties);
    const rootIssueStore = {
      currentUserId: undefined,
      rootStore: {
        memberRoot: {
          project: memberStore,
        },
      },
    };
    const issueFilter = new ProjectIssuesFilter(rootIssueStore as never);

    await memberStore.fetchProjectUserProperties("workspace", "project-a");
    issueFilter.hydrateFilters("workspace", "project-a");
    const hydratedDisplayFilters = issueFilter.filters["project-a"].displayFilters;
    const hydratedDisplayProperties = issueFilter.filters["project-a"].displayProperties;

    await issueFilter.fetchFilters("workspace", "project-a");

    expect(issueFilter.filters["project-a"].displayFilters).toBe(hydratedDisplayFilters);
    expect(issueFilter.filters["project-a"].displayProperties).toBe(hydratedDisplayProperties);
    expect(issueFilter.getIssueFilters("project-a")?.displayFilters?.group_by).toBeNull();
  });

  it("does not hydrate default filters when user properties are not cached", async () => {
    const memberStore = createMemberStore();
    const properties = createUserProperties({ "property-a": true });
    vi.spyOn(memberStore.projectService, "getProjectUserProperties").mockResolvedValue(properties);
    const rootIssueStore = {
      currentUserId: undefined,
      rootStore: {
        memberRoot: {
          project: memberStore,
        },
      },
    };
    const issueFilter = new ProjectIssuesFilter(rootIssueStore as never);

    issueFilter.hydrateFilters("workspace", "project-a");
    expect(issueFilter.getIssueFilters("project-a")).toBeUndefined();

    await issueFilter.fetchFilters("workspace", "project-a");
    expect(issueFilter.getIssueFilters("project-a")?.displayProperties?.custom_properties).toEqual({
      "property-a": true,
    });
  });

  it("refetches issues when remote filters change query-affecting params", async () => {
    const memberStore = createMemberStore();
    const remote = createUserProperties();
    remote.display_filters = { layout: EIssueLayoutTypes.LIST, order_by: "-created_at" };
    vi.spyOn(memberStore.projectService, "getProjectUserProperties").mockResolvedValue(remote);
    const fetchIssuesWithExistingPagination = vi.fn();
    const rootIssueStore = {
      currentUserId: undefined,
      projectIssues: { fetchIssuesWithExistingPagination },
      rootStore: {
        memberRoot: {
          project: memberStore,
        },
      },
    };
    const issueFilter = new ProjectIssuesFilter(rootIssueStore as never);
    issueFilter.filters["project-a"] = {
      richFilters: {},
      displayFilters: { layout: EIssueLayoutTypes.LIST, order_by: "sort_order" },
      displayProperties: { assignee: true },
      kanbanFilters: { group_by: [], sub_group_by: [] },
    };

    await issueFilter.fetchFilters("workspace", "project-a");

    expect(issueFilter.getIssueFilters("project-a")?.displayFilters?.order_by).toBe("-created_at");
    expect(fetchIssuesWithExistingPagination).toHaveBeenCalledWith("workspace", "project-a", "mutation");
  });

  it("drops a stale user-properties response after a newer update starts", async () => {
    const store = createMemberStore();
    const firstUpdate = createDeferred<IProjectUserPropertiesResponse>();
    const secondUpdate = createDeferred<IProjectUserPropertiesResponse>();
    const updateProperties = vi
      .spyOn(store.projectService, "updateProjectUserProperties")
      .mockReturnValueOnce(firstUpdate.promise)
      .mockReturnValueOnce(secondUpdate.promise);

    const first = store.updateProjectUserProperties("workspace", "project-a", {
      display_filters: { layout: EIssueLayoutTypes.KANBAN },
    });
    const second = store.updateProjectUserProperties("workspace", "project-a", {
      display_filters: { layout: EIssueLayoutTypes.LIST },
    });

    expect(store.getProjectUserProperties("project-a")?.display_filters.layout).toBe(EIssueLayoutTypes.LIST);

    const staleKanban = createUserProperties();
    staleKanban.display_filters = { layout: EIssueLayoutTypes.KANBAN };
    firstUpdate.resolve(staleKanban);
    await first;
    expect(store.getProjectUserProperties("project-a")?.display_filters.layout).toBe(EIssueLayoutTypes.LIST);

    const listProperties = createUserProperties();
    listProperties.display_filters = { layout: EIssueLayoutTypes.LIST };
    secondUpdate.resolve(listProperties);
    await second;

    expect(updateProperties).toHaveBeenCalledTimes(2);
    expect(store.getProjectUserProperties("project-a")?.display_filters.layout).toBe(EIssueLayoutTypes.LIST);
  });

  it("does not let an in-flight fetch overwrite a newer optimistic update", async () => {
    const store = createMemberStore();
    const deferredFetch = createDeferred<IProjectUserPropertiesResponse>();
    vi.spyOn(store.projectService, "getProjectUserProperties").mockReturnValue(deferredFetch.promise);
    vi.spyOn(store.projectService, "updateProjectUserProperties").mockResolvedValue(createUserProperties());

    const fetchPromise = store.fetchProjectUserProperties("workspace", "project-a");
    await store.updateProjectUserProperties("workspace", "project-a", {
      display_filters: { layout: EIssueLayoutTypes.LIST },
    });
    expect(store.getProjectUserProperties("project-a")?.display_filters.layout).toBe(EIssueLayoutTypes.LIST);

    const staleKanban = createUserProperties();
    staleKanban.display_filters = { layout: EIssueLayoutTypes.KANBAN };
    deferredFetch.resolve(staleKanban);
    await fetchPromise;

    expect(store.getProjectUserProperties("project-a")?.display_filters.layout).toBe(EIssueLayoutTypes.LIST);
  });

  it("does not overwrite a newer local layout from a remote document", async () => {
    const memberStore = createMemberStore();
    const remote = createUserProperties();
    remote.display_filters = { layout: EIssueLayoutTypes.LIST, order_by: "sort_order" };
    vi.spyOn(memberStore.projectService, "getProjectUserProperties").mockResolvedValue(remote);
    const fetchIssuesWithExistingPagination = vi.fn();
    const rootIssueStore = {
      currentUserId: undefined,
      projectIssues: { fetchIssuesWithExistingPagination },
      rootStore: {
        memberRoot: {
          project: memberStore,
        },
      },
    };
    const issueFilter = new ProjectIssuesFilter(rootIssueStore as never);
    issueFilter.filters["project-a"] = {
      richFilters: {},
      displayFilters: { layout: EIssueLayoutTypes.GANTT, order_by: "sort_order" },
      displayProperties: { assignee: true },
      kanbanFilters: { group_by: [], sub_group_by: [] },
    };

    await issueFilter.fetchFilters("workspace", "project-a");

    expect(issueFilter.getIssueFilters("project-a")?.displayFilters?.layout).toBe(EIssueLayoutTypes.GANTT);
    expect(fetchIssuesWithExistingPagination).not.toHaveBeenCalled();
  });

  it("does not refetch issues when remote filters match the hydrated query params", async () => {
    const memberStore = createMemberStore();
    const properties = createUserProperties({ "property-a": true });
    vi.spyOn(memberStore.projectService, "getProjectUserProperties").mockResolvedValue(properties);
    const fetchIssuesWithExistingPagination = vi.fn();
    const rootIssueStore = {
      currentUserId: undefined,
      projectIssues: { fetchIssuesWithExistingPagination },
      rootStore: {
        memberRoot: {
          project: memberStore,
        },
      },
    };
    const issueFilter = new ProjectIssuesFilter(rootIssueStore as never);

    await memberStore.fetchProjectUserProperties("workspace", "project-a");
    issueFilter.hydrateFilters("workspace", "project-a");
    await issueFilter.fetchFilters("workspace", "project-a");

    expect(fetchIssuesWithExistingPagination).not.toHaveBeenCalled();
  });
});
