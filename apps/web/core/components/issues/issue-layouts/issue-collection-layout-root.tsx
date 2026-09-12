/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { isEmpty } from "lodash-es";
import { observer } from "mobx-react";
import { useParams } from "react-router";
import useSWR from "swr";
import {
  ISSUE_DISPLAY_FILTERS_BY_PAGE,
  PROJECT_VIEW_TRACKER_ELEMENTS,
  type TIssueCollectionKind,
} from "@plane/constants";
import { EIssueLayoutTypes, EIssuesStoreType } from "@plane/types";
import { Spinner } from "@plane/ui";
import { TransferIssues } from "@/components/cycles/transfer-issues";
import { TransferIssuesModal } from "@/components/cycles/transfer-issues-modal";
import { useCycle } from "@/hooks/store/use-cycle";
import { useIssueType } from "@/hooks/store/use-issue-type";
import { useIssues } from "@/hooks/store/use-issues";
import { useProjectView } from "@/hooks/store/use-project-view";
import { bindCollectionOps } from "@/store/issue/helpers/collection-ops";
import { resolveCollectionRef } from "@/store/issue/helpers/collection-ref";
import { shouldRenderCollectionLoader } from "./collection-layout-ready";
import { ActiveLoader } from "./issue-layout-HOC";
import { IssueLayoutShell } from "./issue-layout-shell";
import { useCollectionLayoutRoute } from "./use-collection-layout-route";

const COLLECTION_KIND: Partial<Record<EIssuesStoreType, TIssueCollectionKind>> = {
  [EIssuesStoreType.PROJECT]: "issues",
  [EIssuesStoreType.CYCLE]: "cycles",
  [EIssuesStoreType.MODULE]: "modules",
  [EIssuesStoreType.PROJECT_VIEW]: "views",
};

const TRACKER_SAVE_VIEW: Partial<Record<EIssuesStoreType, string>> = {
  [EIssuesStoreType.PROJECT]: PROJECT_VIEW_TRACKER_ELEMENTS.PROJECT_HEADER_SAVE_AS_VIEW_BUTTON,
  [EIssuesStoreType.CYCLE]: PROJECT_VIEW_TRACKER_ELEMENTS.CYCLE_HEADER_SAVE_AS_VIEW_BUTTON,
  [EIssuesStoreType.MODULE]: PROJECT_VIEW_TRACKER_ELEMENTS.MODULE_HEADER_SAVE_AS_VIEW_BUTTON,
  [EIssuesStoreType.PROJECT_VIEW]: PROJECT_VIEW_TRACKER_ELEMENTS.HEADER_SAVE_VIEW_BUTTON,
};

type TIssueCollectionLayoutRootProps = {
  storeType:
    | EIssuesStoreType.PROJECT
    | EIssuesStoreType.CYCLE
    | EIssuesStoreType.MODULE
    | EIssuesStoreType.PROJECT_VIEW
    | EIssuesStoreType.ARCHIVED;
};

function CycleTransferHeader(props: { cycleId: string }) {
  const { cycleId } = props;
  const { getCycleById } = useCycle();
  const [transferIssuesModal, setTransferIssuesModal] = useState(false);
  const cycleDetails = getCycleById(cycleId);
  const cycleStatus = cycleDetails?.status?.toLocaleLowerCase() ?? "draft";
  const isProgressSnapshotEmpty = isEmpty(cycleDetails?.progress_snapshot);
  const transferableIssuesCount = cycleDetails
    ? cycleDetails.backlog_issues + cycleDetails.unstarted_issues + cycleDetails.started_issues
    : 0;
  const canTransferIssues = isProgressSnapshotEmpty && transferableIssuesCount > 0;

  return (
    <>
      <TransferIssuesModal
        handleClose={() => setTransferIssuesModal(false)}
        cycleId={cycleId}
        isOpen={transferIssuesModal}
      />
      {cycleStatus === "completed" ? (
        <TransferIssues
          handleClick={() => setTransferIssuesModal(true)}
          canTransferIssues={canTransferIssues}
          disabled={!isEmpty(cycleDetails?.progress_snapshot)}
        />
      ) : null}
    </>
  );
}

export const IssueCollectionLayoutRoot = observer(function IssueCollectionLayoutRoot(
  props: TIssueCollectionLayoutRootProps
) {
  const { storeType } = props;
  const params = useParams();
  const ids = useMemo(
    () => ({
      workspaceSlug: params.workspaceSlug,
      projectId: params.projectId,
      cycleId: params.cycleId,
      moduleId: params.moduleId,
      viewId: params.viewId,
    }),
    [params.cycleId, params.moduleId, params.projectId, params.viewId, params.workspaceSlug]
  );
  const collectionRef = resolveCollectionRef(storeType, ids);
  const workspaceSlug = collectionRef?.workspaceSlug;
  const projectId = collectionRef?.projectId ?? ids.projectId;
  const entityId = collectionRef?.entityId;

  const { issues, issuesFilter } = useIssues(storeType);
  const collectionOps = useMemo(
    () => bindCollectionOps(storeType, issues, issuesFilter, ids),
    [ids, issues, issuesFilter, storeType]
  );
  const issueTypeStore = useIssueType();
  const { getViewById } = useProjectView();
  const collectionKind = COLLECTION_KIND[storeType];

  useLayoutEffect(() => {
    if (!collectionRef) return;
    collectionOps.hydrateFilters(collectionRef);
  }, [collectionOps, collectionRef]);

  const workItemFilters = entityId ? issuesFilter.getIssueFilters(entityId) : undefined;
  const projectView = storeType === EIssuesStoreType.PROJECT_VIEW && entityId ? getViewById(entityId) : undefined;
  const initialWorkItemFilters =
    storeType === EIssuesStoreType.PROJECT_VIEW && projectView
      ? {
          displayFilters: workItemFilters?.displayFilters,
          displayProperties: workItemFilters?.displayProperties,
          kanbanFilters: workItemFilters?.kanbanFilters,
          richFilters: projectView.rich_filters,
        }
      : workItemFilters;

  const persistLayout = useCallback(
    (layout: EIssueLayoutTypes) => {
      if (!collectionRef) return;
      collectionOps.persistLayout(collectionRef, layout);
    },
    [collectionOps, collectionRef]
  );

  const { activeLayout, urlLayout } = useCollectionLayoutRoute({
    kind: collectionKind ?? "issues",
    workspaceSlug,
    projectId,
    entityId,
    storedLayout: workItemFilters?.displayFilters?.layout,
    hasFilters: !!workItemFilters && !!collectionKind,
    persistLayout,
  });

  const swrKey =
    workspaceSlug && projectId && entityId ? `${storeType}_ISSUES_${workspaceSlug}_${projectId}_${entityId}` : null;

  useSWR(
    swrKey,
    async () => {
      if (!collectionRef) return true;
      await collectionOps.fetchFilters(collectionRef);
      return true;
    },
    { revalidateIfStale: false, revalidateOnFocus: false }
  );

  const areProjectIssueTypesFetched = projectId ? !!issueTypeStore.fetchedMap[projectId] : false;
  const projectTypeRevision = projectId ? (issueTypeStore.projectRevisionMap[projectId] ?? 0) : 0;

  useEffect(() => {
    if (storeType !== EIssuesStoreType.PROJECT || !projectId || !areProjectIssueTypesFetched) return;
    const allowedPropertyIds = issueTypeStore.getActiveProjectProperties(projectId).map((property) => property.id);
    if ("pruneCustomDisplayProperties" in issuesFilter) {
      issuesFilter.pruneCustomDisplayProperties(projectId, allowedPropertyIds);
    }
  }, [areProjectIssueTypesFetched, issueTypeStore, issuesFilter, projectId, projectTypeRevision, storeType]);

  const updateRichFilters = useCallback(
    (filters: Parameters<typeof collectionOps.updateFilterExpression>[1]) => {
      if (!collectionRef) return;
      return collectionOps.updateFilterExpression(collectionRef, filters);
    },
    [collectionOps, collectionRef]
  );

  const isArchived = storeType === EIssuesStoreType.ARCHIVED;
  const resolvedLayout = isArchived ? EIssueLayoutTypes.LIST : activeLayout;
  const showLoader = shouldRenderCollectionLoader({
    workspaceSlug,
    projectId,
    entityId,
    workItemFilters,
    initialWorkItemFilters,
    urlLayout,
    storedLayout: workItemFilters?.displayFilters?.layout,
    syncLayout: !!collectionKind && !isArchived,
  });

  if (showLoader || !workspaceSlug || !projectId || !entityId || !initialWorkItemFilters) {
    return <ActiveLoader layout={resolvedLayout} />;
  }

  return (
    <IssueLayoutShell
      storeType={storeType}
      workspaceSlug={workspaceSlug as string}
      projectId={projectId}
      entityId={entityId as string}
      activeLayout={resolvedLayout}
      workItemFilters={initialWorkItemFilters}
      filtersToShowByLayout={
        isArchived
          ? ISSUE_DISPLAY_FILTERS_BY_PAGE.archived_issues.filters
          : ISSUE_DISPLAY_FILTERS_BY_PAGE.issues.filters
      }
      updateFilters={updateRichFilters}
      enableSaveView={!isArchived}
      enableUpdateView={storeType === EIssuesStoreType.PROJECT_VIEW}
      saveViewLabel={storeType === EIssuesStoreType.PROJECT_VIEW ? "Save as" : undefined}
      trackerSaveView={TRACKER_SAVE_VIEW[storeType]}
      contentClassName={
        storeType === EIssuesStoreType.PROJECT
          ? "relative h-full w-full overflow-auto bg-surface-1"
          : "relative h-full w-full overflow-auto"
      }
      header={storeType === EIssuesStoreType.CYCLE && entityId ? <CycleTransferHeader cycleId={entityId} /> : undefined}
      toolbar={
        storeType === EIssuesStoreType.PROJECT && issues?.getIssueLoader() === "mutation" ? (
          <div className="shadow-sm fixed top-[70px] right-[20px] z-50 flex h-[40px] w-[40px] items-center justify-center rounded-sm bg-layer-1">
            <Spinner className="h-4 w-4" />
          </div>
        ) : null
      }
    />
  );
});
