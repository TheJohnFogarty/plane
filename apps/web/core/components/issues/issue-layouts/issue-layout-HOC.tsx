/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "react-router";
import { EIssueLayoutTypes } from "@plane/types";
import { CalendarLayoutLoader } from "@/components/ui/loader/layouts/calendar-layout-loader";
import { GanttLayoutLoader } from "@/components/ui/loader/layouts/gantt-layout-loader";
import { KanbanLayoutLoader } from "@/components/ui/loader/layouts/kanban-layout-loader";
import { ListLayoutLoader } from "@/components/ui/loader/layouts/list-layout-loader";
import { SpreadsheetLayoutLoader } from "@/components/ui/loader/layouts/spreadsheet-layout-loader";
import { useIssues } from "@/hooks/store/use-issues";
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
import { listKeyMatchesCollection } from "@/store/issue/helpers/collection-ref";
import { hasUngroupedIssueIds, shouldShowIssueLayoutLoader } from "./collection-layout-ready";
import { IssueLayoutEmptyState } from "./empty-states";

export function ActiveLoader(props: { layout: EIssueLayoutTypes | undefined }) {
  switch (props.layout) {
    case EIssueLayoutTypes.LIST:
      return <ListLayoutLoader />;
    case EIssueLayoutTypes.KANBAN:
      return <KanbanLayoutLoader />;
    case EIssueLayoutTypes.SPREADSHEET:
      return <SpreadsheetLayoutLoader />;
    case EIssueLayoutTypes.CALENDAR:
      return <CalendarLayoutLoader />;
    case EIssueLayoutTypes.GANTT:
      return <GanttLayoutLoader />;
    default:
      return <ListLayoutLoader />;
  }
}

interface Props {
  children: string | React.ReactNode | React.ReactNode[];
  layout: EIssueLayoutTypes;
}

export const IssueLayoutHOC = observer(function IssueLayoutHOC(props: Props) {
  const { layout } = props;

  const storeType = useIssueStoreType();
  const { issues } = useIssues(storeType);
  const { workspaceSlug, projectId, cycleId, moduleId, viewId, globalViewId } = useParams();
  const entityId = cycleId ?? moduleId ?? viewId ?? globalViewId ?? projectId;
  const listKey = "listKey" in issues ? issues.listKey : undefined;
  const listBelongsToRoute = listKeyMatchesCollection(listKey, {
    workspaceSlug: workspaceSlug?.toString(),
    projectId: projectId?.toString(),
    entityId: entityId?.toString(),
  });

  const isInitialLoading = "isInitialLoading" in issues && issues.isInitialLoading;
  const isCollectionEmpty = "isCollectionEmpty" in issues && issues.isCollectionEmpty;
  const groupedIssueIds = "groupedIssueIds" in issues ? issues.groupedIssueIds : undefined;

  if (shouldShowIssueLayoutLoader(!!isInitialLoading, listKey, listBelongsToRoute)) {
    return <ActiveLoader layout={layout} />;
  }

  if (layout === EIssueLayoutTypes.GANTT && !hasUngroupedIssueIds(groupedIssueIds)) {
    return <ActiveLoader layout={layout} />;
  }

  if (isCollectionEmpty && layout !== EIssueLayoutTypes.CALENDAR) {
    return <IssueLayoutEmptyState storeType={storeType} />;
  }

  return <>{props.children}</>;
});
