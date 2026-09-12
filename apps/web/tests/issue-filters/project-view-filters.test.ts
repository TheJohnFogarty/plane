/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it, vi } from "vitest";
import type { IProjectView, TWorkItemFilterExpression } from "@plane/types";
import { EIssueLayoutTypes, EViewAccess } from "@plane/types";
import { ProjectViewIssuesFilter } from "@/store/issue/project-views/filter.store";

const createViewDetails = (overrides: Partial<IProjectView> = {}): IProjectView =>
  ({
    id: "view-1",
    access: EViewAccess.PUBLIC,
    name: "View",
    description: "",
    rich_filters: {},
    display_filters: { layout: EIssueLayoutTypes.LIST, order_by: "sort_order" },
    display_properties: { assignee: true },
    query: {},
    query_data: {},
    project: "project-1",
    workspace: "workspace",
    ...overrides,
  }) as IProjectView;

const createFilterStore = (fetchIssuesWithExistingPagination = vi.fn()) => {
  const store = new ProjectViewIssuesFilter({
    currentUserId: undefined,
    viewId: "view-1",
    projectViewIssues: { fetchIssuesWithExistingPagination },
    rootStore: {
      projectView: {
        getViewById: () => undefined,
      },
    },
  } as never);
  return { store, fetchIssuesWithExistingPagination };
};

describe("ProjectViewIssuesFilter.fetchFilters", () => {
  it("refetches issues when applied query params change", async () => {
    const { store, fetchIssuesWithExistingPagination } = createFilterStore();
    const nextFilters: TWorkItemFilterExpression = { state_id__exact: "state-1" };
    vi.spyOn(store.issueFilterService, "getViewDetails").mockResolvedValue(
      createViewDetails({
        rich_filters: nextFilters,
        display_filters: { layout: EIssueLayoutTypes.LIST, order_by: "sort_order" },
      })
    );
    store.filters["view-1"] = {
      richFilters: {},
      displayFilters: { layout: EIssueLayoutTypes.LIST, order_by: "sort_order" },
      displayProperties: { assignee: true },
      kanbanFilters: { group_by: [], sub_group_by: [] },
    };

    await store.fetchFilters("workspace", "project-1", "view-1");

    expect(store.getIssueFilters("view-1")?.richFilters).toEqual(nextFilters);
    expect(fetchIssuesWithExistingPagination).toHaveBeenCalledWith("workspace", "project-1", "view-1", "mutation");
  });

  it("does not refetch when applied query params stay the same", async () => {
    const { store, fetchIssuesWithExistingPagination } = createFilterStore();
    vi.spyOn(store.issueFilterService, "getViewDetails").mockResolvedValue(createViewDetails());
    store.filters["view-1"] = {
      richFilters: {},
      displayFilters: { layout: EIssueLayoutTypes.LIST, order_by: "sort_order" },
      displayProperties: { assignee: true },
      kanbanFilters: { group_by: [], sub_group_by: [] },
    };

    await store.fetchFilters("workspace", "project-1", "view-1");

    expect(fetchIssuesWithExistingPagination).not.toHaveBeenCalled();
  });

  it("keeps the local layout when remote view details use a different one", async () => {
    const { store, fetchIssuesWithExistingPagination } = createFilterStore();
    vi.spyOn(store.issueFilterService, "getViewDetails").mockResolvedValue(
      createViewDetails({
        display_filters: { layout: EIssueLayoutTypes.LIST, order_by: "sort_order" },
      })
    );
    store.filters["view-1"] = {
      richFilters: {},
      displayFilters: { layout: EIssueLayoutTypes.GANTT, order_by: "sort_order" },
      displayProperties: { assignee: true },
      kanbanFilters: { group_by: [], sub_group_by: [] },
    };

    await store.fetchFilters("workspace", "project-1", "view-1");

    expect(store.getIssueFilters("view-1")?.displayFilters?.layout).toBe(EIssueLayoutTypes.GANTT);
    expect(fetchIssuesWithExistingPagination).not.toHaveBeenCalled();
  });
});
