/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { ALL_ISSUES } from "@plane/constants";
import { EIssueLayoutTypes, type IIssueFilters } from "@plane/types";

export function shouldShowIssueLayoutLoader(
  isInitialLoading: boolean,
  listKey: string | undefined,
  listBelongsToRoute: boolean
) {
  return isInitialLoading || (listKey !== undefined && !listBelongsToRoute);
}

export function hasUngroupedIssueIds(groupedIssueIds: unknown): boolean {
  return (
    !!groupedIssueIds &&
    typeof groupedIssueIds === "object" &&
    Array.isArray((groupedIssueIds as Record<string, unknown>)[ALL_ISSUES])
  );
}

export function syncGanttBlocksAfterInit(
  initGantt: () => void,
  setBlockIds: (ids: string[]) => void,
  ungroupedIssueIds: unknown
) {
  initGantt();
  setBlockIds(Array.isArray(ungroupedIssueIds) ? ungroupedIssueIds : []);
}

export function shouldRenderCollectionLoader(args: {
  workspaceSlug?: string;
  projectId?: string;
  entityId?: string;
  workItemFilters?: IIssueFilters;
  initialWorkItemFilters?: IIssueFilters;
  urlLayout?: EIssueLayoutTypes;
  storedLayout?: EIssueLayoutTypes;
  syncLayout?: boolean;
}): boolean {
  if (
    !args.workspaceSlug ||
    !args.projectId ||
    !args.entityId ||
    !args.workItemFilters ||
    !args.initialWorkItemFilters
  ) {
    return true;
  }
  return !!args.syncLayout && !!args.urlLayout && args.storedLayout !== args.urlLayout;
}
