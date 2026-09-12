/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it, vi } from "vitest";
import { EIssueFilterType } from "@plane/constants";
import type { IIssueDisplayFilterOptions, IIssueFilters } from "@plane/types";
import { EIssueLayoutTypes, EIssuesStoreType } from "@plane/types";
import type { TFilterPropertySource } from "@/store/issue/helpers/issue-filter-helper.store";
import { IssueFilterHelperStore } from "@/store/issue/helpers/issue-filter-helper.store";

const seedFilters = (displayFilters: IIssueDisplayFilterOptions): Record<string, IIssueFilters> => ({
  entity: {
    richFilters: {},
    displayFilters,
    displayProperties: {},
    kanbanFilters: { group_by: [], sub_group_by: [] },
  },
});

describe("commitFilterTypeUpdate", () => {
  it("refetches without clearing when kanban normalization changes grouping", async () => {
    const store = new IssueFilterHelperStore();
    const filters = seedFilters({ layout: EIssueLayoutTypes.LIST, group_by: null });
    const clear = vi.fn();
    const refetch = vi.fn();

    await store.commitFilterTypeUpdate({
      filters,
      entityId: "entity",
      type: EIssueFilterType.DISPLAY_FILTERS,
      patch: { layout: EIssueLayoutTypes.KANBAN },
      clear,
      refetch,
    });

    expect(filters.entity.displayFilters?.group_by).toBe("state");
    expect(clear).not.toHaveBeenCalled();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("does not mutate the inbound display-filter patch", async () => {
    const store = new IssueFilterHelperStore();
    const filters = seedFilters({ layout: EIssueLayoutTypes.LIST, group_by: null });
    const patch: IIssueDisplayFilterOptions = { layout: EIssueLayoutTypes.KANBAN };

    await store.commitFilterTypeUpdate({
      filters,
      entityId: "entity",
      type: EIssueFilterType.DISPLAY_FILTERS,
      patch,
    });

    expect(patch).toEqual({ layout: EIssueLayoutTypes.KANBAN });
    expect(filters.entity.displayFilters?.group_by).toBe("state");
  });

  it("does not clear or refetch on a layout-only change", async () => {
    const store = new IssueFilterHelperStore();
    const filters = seedFilters({ layout: EIssueLayoutTypes.LIST, group_by: "state" });
    const clear = vi.fn();
    const refetch = vi.fn();

    await store.commitFilterTypeUpdate({
      filters,
      entityId: "entity",
      type: EIssueFilterType.DISPLAY_FILTERS,
      patch: { layout: EIssueLayoutTypes.KANBAN },
      clear,
      refetch,
    });

    expect(clear).not.toHaveBeenCalled();
    expect(refetch).not.toHaveBeenCalled();
  });

  it("clears and refetches when grouping changes", async () => {
    const store = new IssueFilterHelperStore();
    const filters = seedFilters({ layout: EIssueLayoutTypes.LIST, group_by: "state" });
    const clear = vi.fn();
    const refetch = vi.fn();

    await store.commitFilterTypeUpdate({
      filters,
      entityId: "entity",
      type: EIssueFilterType.DISPLAY_FILTERS,
      patch: { group_by: "priority" },
      clear,
      refetch,
    });

    expect(clear).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("refetches without clearing when order_by changes", async () => {
    const store = new IssueFilterHelperStore();
    const filters = seedFilters({ layout: EIssueLayoutTypes.LIST, group_by: "state", order_by: "sort_order" });
    const clear = vi.fn();
    const refetch = vi.fn();

    await store.commitFilterTypeUpdate({
      filters,
      entityId: "entity",
      type: EIssueFilterType.DISPLAY_FILTERS,
      patch: { order_by: "-created_at" },
      clear,
      refetch,
    });

    expect(clear).not.toHaveBeenCalled();
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

class TestableFilterStore extends IssueFilterHelperStore {
  write(filters: Record<string, IIssueFilters>, entityId: string, properties: TFilterPropertySource) {
    return this.writeEntityFilters(filters, entityId, "acme", EIssuesStoreType.PROJECT, undefined, properties);
  }
}

describe("writeEntityFilters", () => {
  const remote: TFilterPropertySource = {
    rich_filters: {},
    display_filters: { layout: EIssueLayoutTypes.LIST, group_by: "state" },
    display_properties: { assignee: true },
  };

  it("does not replace the stored document when the remote payload matches", () => {
    const store = new TestableFilterStore();
    const filters: Record<string, IIssueFilters> = {};

    expect(store.write(filters, "project-a", remote)).toBe(true);
    const firstDisplayFilters = filters["project-a"].displayFilters;
    const firstDisplayProperties = filters["project-a"].displayProperties;

    expect(store.write(filters, "project-a", remote)).toBe(false);
    expect(filters["project-a"].displayFilters).toBe(firstDisplayFilters);
    expect(filters["project-a"].displayProperties).toBe(firstDisplayProperties);
  });

  it("keeps the in-memory layout when a remote document uses a different one", () => {
    const store = new TestableFilterStore();
    const filters: Record<string, IIssueFilters> = {};

    store.write(filters, "project-a", {
      ...remote,
      display_filters: { layout: EIssueLayoutTypes.GANTT, group_by: "state" },
    });
    expect(
      store.write(filters, "project-a", {
        ...remote,
        display_filters: { layout: EIssueLayoutTypes.LIST, group_by: "state" },
      })
    ).toBe(false);
    expect(filters["project-a"].displayFilters?.layout).toBe(EIssueLayoutTypes.GANTT);
  });

  it("writes when grouping differs from the hydrated document", () => {
    const store = new TestableFilterStore();
    const filters: Record<string, IIssueFilters> = {};

    store.write(filters, "project-a", remote);
    expect(
      store.write(filters, "project-a", {
        ...remote,
        display_filters: { layout: EIssueLayoutTypes.LIST, group_by: "priority" },
      })
    ).toBe(true);
    expect(filters["project-a"].displayFilters?.group_by).toBe("priority");
  });
});
