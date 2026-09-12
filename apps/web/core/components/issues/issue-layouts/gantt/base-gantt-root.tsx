/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useCallback, useLayoutEffect, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { ALL_ISSUES, EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { EIssuesStoreType, IBlockUpdateData, TIssue } from "@plane/types";
import { EIssueLayoutTypes, EIssueServiceType, GANTT_TIMELINE_TYPE } from "@plane/types";
import { renderFormattedPayloadDate } from "@plane/utils";
// components
import { TimeLineTypeContext } from "@/components/gantt-chart/contexts";
import { GanttChartRoot } from "@/components/gantt-chart/root";
import { IssueGanttSidebar } from "@/components/gantt-chart/sidebar/issues/sidebar";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useIssues } from "@/hooks/store/use-issues";
import { useUserPermissions } from "@/hooks/store/user";
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
import { useIssuesActions } from "@/hooks/use-issues-actions";
import { useTimeLineChart } from "@/hooks/use-timeline-chart";
import { useBulkOperationStatus } from "@/hooks/use-bulk-operation-status";
// local imports
import { hasUngroupedIssueIds, syncGanttBlocksAfterInit } from "../collection-layout-ready";
import { IssueLayoutHOC } from "../issue-layout-HOC";
import { GanttQuickAddIssueButton } from "../quick-add/button/gantt";
import { QuickAddIssueRoot } from "../quick-add/root";
import { IssueGanttBlock } from "./blocks";

interface IBaseGanttRoot {
  viewId?: string | undefined;
  isCompletedCycle?: boolean;
  isEpic?: boolean;
}

export type GanttStoreType =
  | EIssuesStoreType.PROJECT
  | EIssuesStoreType.MODULE
  | EIssuesStoreType.CYCLE
  | EIssuesStoreType.PROJECT_VIEW
  | EIssuesStoreType.EPIC;

const MAX_NESTING_DEPTH = 3;

export const BaseGanttRoot = observer(function BaseGanttRoot(props: IBaseGanttRoot) {
  const { viewId, isCompletedCycle = false, isEpic = false } = props;
  const { t } = useTranslation();
  // router
  const { workspaceSlug, projectId } = useParams();

  const storeType = useIssueStoreType() as GanttStoreType;
  const { issues, issuesFilter } = useIssues(storeType);
  const { fetchIssues, fetchNextIssues, updateIssue, quickAddIssue } = useIssuesActions(storeType);
  const { initGantt, setBlockIds } = useTimeLineChart(GANTT_TIMELINE_TYPE.ISSUE);
  const { subIssues: subIssuesStore, issue: issueStore } = useIssueDetail(EIssueServiceType.ISSUES);
  // store hooks
  const { allowPermissions } = useUserPermissions();

  const appliedDisplayFilters = issuesFilter.issueFilters?.displayFilters;
  // plane web hooks
  const isBulkOperationsEnabled = useBulkOperationStatus();

  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [quickAddDates] = useState<{ start_date: string; target_date: string }>(() => {
    const nextDay = new Date();
    nextDay.setDate(nextDay.getDate() + 1);
    return {
      start_date: renderFormattedPayloadDate(new Date()) ?? "",
      target_date: renderFormattedPayloadDate(nextDay) ?? "",
    };
  });

  useLayoutEffect(() => {
    fetchIssues("init-loader", { canGroup: false, perPageCount: 100 }, viewId);
  }, [fetchIssues, storeType, viewId]);

  const ungroupedIssueIds = issues.groupedIssueIds?.[ALL_ISSUES];
  const rootIssueIds = hasUngroupedIssueIds(issues.groupedIssueIds) ? (ungroupedIssueIds as string[]) : [];

  useLayoutEffect(() => {
    syncGanttBlocksAfterInit(initGantt, setBlockIds, issues.groupedIssueIds?.[ALL_ISSUES]);
  }, [initGantt, issues, setBlockIds]);

  const nextPageResults = issues.getPaginationData(undefined, undefined)?.nextPageResults;

  const { enableIssueCreation } = issues?.viewFlags || {};

  const onToggleExpand = useCallback(
    (blockId: string) => {
      const isCurrentlyExpanded = expandedIds.has(blockId);
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (isCurrentlyExpanded) {
          next.delete(blockId);
        } else {
          next.add(blockId);
        }
        return next;
      });

      // Fetch outside the state updater so expand works even when MobX mutates subIssues in place.
      if (!isCurrentlyExpanded && workspaceSlug) {
        const issueProjectId = issueStore.getIssueById(blockId)?.project_id ?? projectId?.toString();
        if (issueProjectId) {
          void subIssuesStore.fetchSubIssues(workspaceSlug.toString(), issueProjectId, blockId);
        }
      }
    },
    [expandedIds, issueStore, projectId, subIssuesStore, workspaceSlug]
  );

  // Compute during render so MobX tracks subIssuesByIssueId reads and re-flattens after fetch.
  const hierarchicalIssueIds: string[] = [];
  const nestingLevels: Record<string, number> = {};

  const walk = (id: string, level: number) => {
    if (level > MAX_NESTING_DEPTH) return;
    hierarchicalIssueIds.push(id);
    nestingLevels[id] = level;
    if (!expandedIds.has(id) || level >= MAX_NESTING_DEPTH) return;
    const children = subIssuesStore.subIssuesByIssueId(id) ?? [];
    for (const childId of children) {
      walk(childId, level + 1);
    }
  };

  for (const id of rootIssueIds) {
    walk(id, 0);
  }

  const loadMoreIssues = useCallback(() => {
    fetchNextIssues();
  }, [fetchNextIssues]);

  const updateIssueBlockStructure = async (issue: TIssue, data: IBlockUpdateData) => {
    if (!workspaceSlug) return;

    const payload: any = { ...data };
    if (data.sort_order) payload.sort_order = data.sort_order.newSortOrder;

    if (updateIssue) await updateIssue(issue.project_id, issue.id, payload);
  };

  const isAllowed = allowPermissions([EUserPermissions.ADMIN, EUserPermissions.MEMBER], EUserPermissionsLevel.PROJECT);
  const updateBlockDates = useCallback(
    (
      updates: {
        id: string;
        start_date?: string;
        target_date?: string;
      }[]
    ) =>
      issues.updateIssueDates(workspaceSlug.toString(), updates, projectId.toString()).catch(() => {
        setToast({
          type: TOAST_TYPE.ERROR,
          title: t("toast.error"),
          message: "Error while updating work item dates, Please try again Later",
        });
      }),
    [issues, projectId, workspaceSlug, t]
  );

  const quickAdd =
    enableIssueCreation && isAllowed && !isCompletedCycle && quickAddDates ? (
      <QuickAddIssueRoot
        layout={EIssueLayoutTypes.GANTT}
        QuickAddButton={GanttQuickAddIssueButton}
        containerClassName="sticky bottom-0 z-[1]"
        prePopulatedData={quickAddDates}
        quickAddCallback={quickAddIssue}
        isEpic={isEpic}
      />
    ) : undefined;

  return (
    <IssueLayoutHOC layout={EIssueLayoutTypes.GANTT}>
      <TimeLineTypeContext.Provider value={GANTT_TIMELINE_TYPE.ISSUE}>
        <div className="h-full w-full">
          <GanttChartRoot
            border={false}
            title={isEpic ? t("epic.label", { count: 2 }) : t("issue.label", { count: 2 })}
            loaderTitle={isEpic ? t("epic.label", { count: 2 }) : t("issue.label", { count: 2 })}
            blockIds={hierarchicalIssueIds}
            blockUpdateHandler={updateIssueBlockStructure}
            blockToRender={(data: TIssue) => <IssueGanttBlock issueId={data.id} isEpic={isEpic} />}
            sidebarToRender={(sidebarProps) => (
              <IssueGanttSidebar
                {...sidebarProps}
                showAllBlocks
                isEpic={isEpic}
                expandedIds={expandedIds}
                nestingLevels={nestingLevels}
                onToggleExpand={onToggleExpand}
              />
            )}
            enableBlockLeftResize={isAllowed}
            enableBlockRightResize={isAllowed}
            enableBlockMove={isAllowed}
            enableReorder={appliedDisplayFilters?.order_by === "sort_order" && isAllowed}
            enableAddBlock={isAllowed}
            enableSelection={isBulkOperationsEnabled && isAllowed}
            quickAdd={quickAdd}
            loadMoreBlocks={loadMoreIssues}
            canLoadMoreBlocks={nextPageResults}
            updateBlockDates={updateBlockDates}
            showAllBlocks
            enableDependency
            isEpic={isEpic}
          />
        </div>
      </TimeLineTypeContext.Provider>
    </IssueLayoutHOC>
  );
});
