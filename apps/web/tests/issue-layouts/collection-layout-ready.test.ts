/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { isValidElement } from "react";
import { describe, expect, it } from "vitest";
import { ALL_ISSUES } from "@plane/constants";
import { EIssueLayoutTypes } from "@plane/types";
import {
  hasUngroupedIssueIds,
  shouldRenderCollectionLoader,
  shouldShowIssueLayoutLoader,
  syncGanttBlocksAfterInit,
} from "@/components/issues/issue-layouts/collection-layout-ready";
import { ActiveLoader } from "@/components/issues/issue-layouts/issue-layout-HOC";

describe("collection layout readiness", () => {
  it("renders a loader when the filter map is empty instead of returning null", () => {
    expect(
      shouldRenderCollectionLoader({
        workspaceSlug: "acme",
        projectId: "proj-1",
        entityId: "proj-1",
      })
    ).toBe(true);
    expect(
      shouldRenderCollectionLoader({
        workspaceSlug: "acme",
        projectId: "proj-1",
        entityId: "proj-1",
        workItemFilters: {
          richFilters: {},
          displayFilters: undefined,
          displayProperties: undefined,
          kanbanFilters: undefined,
        },
        initialWorkItemFilters: {
          richFilters: {},
          displayFilters: undefined,
          displayProperties: undefined,
          kanbanFilters: undefined,
        },
      })
    ).toBe(false);
  });

  it("shows a loader when the stored layout lags the URL layout", () => {
    const readyArgs = {
      workspaceSlug: "acme",
      projectId: "proj-1",
      entityId: "proj-1",
      workItemFilters: {
        richFilters: {},
        displayFilters: { layout: EIssueLayoutTypes.KANBAN },
        displayProperties: undefined,
        kanbanFilters: undefined,
      },
      initialWorkItemFilters: {
        richFilters: {},
        displayFilters: { layout: EIssueLayoutTypes.KANBAN },
        displayProperties: undefined,
        kanbanFilters: undefined,
      },
    };

    expect(
      shouldRenderCollectionLoader({
        ...readyArgs,
        urlLayout: EIssueLayoutTypes.LIST,
        storedLayout: EIssueLayoutTypes.KANBAN,
        syncLayout: true,
      })
    ).toBe(true);
    expect(
      shouldRenderCollectionLoader({
        ...readyArgs,
        urlLayout: EIssueLayoutTypes.LIST,
        storedLayout: EIssueLayoutTypes.LIST,
        syncLayout: true,
      })
    ).toBe(false);
    expect(
      shouldRenderCollectionLoader({
        ...readyArgs,
        storedLayout: EIssueLayoutTypes.KANBAN,
        syncLayout: true,
      })
    ).toBe(false);
    expect(
      shouldRenderCollectionLoader({
        ...readyArgs,
        urlLayout: EIssueLayoutTypes.LIST,
        storedLayout: EIssueLayoutTypes.KANBAN,
        syncLayout: false,
      })
    ).toBe(false);
  });

  it("shows a loader when the list key belongs to another project", () => {
    expect(shouldShowIssueLayoutLoader(false, "acme:proj-a:proj-a:{}", false)).toBe(true);
    expect(shouldShowIssueLayoutLoader(false, "acme:proj-b:proj-b:{}", true)).toBe(false);
    expect(shouldShowIssueLayoutLoader(false, undefined, false)).toBe(false);
    expect(shouldShowIssueLayoutLoader(true, "acme:proj-b:proj-b:{}", true)).toBe(true);
  });

  it("treats a missing ALL_ISSUES array as not ready for gantt", () => {
    expect(hasUngroupedIssueIds(undefined)).toBe(false);
    expect(hasUngroupedIssueIds({ state: ["issue-1"] })).toBe(false);
    expect(hasUngroupedIssueIds({ [ALL_ISSUES]: ["issue-1"] })).toBe(true);
    expect(hasUngroupedIssueIds({ [ALL_ISSUES]: [] })).toBe(true);
  });

  it("restores block ids in the same tick as initGantt", () => {
    const timeline = {
      blockIds: undefined as string[] | undefined,
      initGantt() {
        this.blockIds = undefined;
      },
      setBlockIds(ids: string[]) {
        this.blockIds = ids;
      },
    };

    syncGanttBlocksAfterInit(
      () => timeline.initGantt(),
      (ids) => timeline.setBlockIds(ids),
      ["issue-1", "issue-2"]
    );
    expect(timeline.blockIds).toEqual(["issue-1", "issue-2"]);

    syncGanttBlocksAfterInit(
      () => timeline.initGantt(),
      (ids) => timeline.setBlockIds(ids),
      { state: ["issue-1"] }
    );
    expect(timeline.blockIds).toEqual([]);
  });

  it("builds ActiveLoader without a Suspense blank frame", () => {
    const node = ActiveLoader({ layout: EIssueLayoutTypes.LIST });
    expect(isValidElement(node)).toBe(true);
    expect(node).not.toBeNull();
    expect(String(node.type)).not.toMatch(/Suspense/i);
  });
});
