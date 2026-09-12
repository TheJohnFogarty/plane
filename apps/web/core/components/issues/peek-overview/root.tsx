/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useCallback } from "react";
import { observer } from "mobx-react";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import type { IWorkItemPeekOverview } from "@plane/types";
import { EIssueServiceType, EIssuesStoreType } from "@plane/types";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useIssues } from "@/hooks/store/use-issues";
import { useUserPermissions } from "@/hooks/store/user";
import { useIssueStoreType } from "@/hooks/use-issue-layout-store";
import { useWorkItemProperties } from "@/hooks/use-issue-properties";
import { createIssueOperations } from "../issue-operations";
import { IssueView } from "./view";

export const IssuePeekOverview = observer(function IssuePeekOverview(
  props: IWorkItemPeekOverview & { isLoading?: boolean; isError?: boolean }
) {
  const { embedIssue = false, embedRemoveCurrentNotification, storeType: issueStoreFromProps } = props;
  const { t } = useTranslation();
  const { allowPermissions } = useUserPermissions();

  const {
    issues: { restoreIssue },
  } = useIssues(EIssuesStoreType.ARCHIVED);
  const {
    peekIssue,
    setPeekIssue,
    issue: { fetchIssue },
    fetchActivities,
  } = useIssueDetail();
  const issueStoreType = useIssueStoreType();
  const storeType = issueStoreFromProps ?? issueStoreType;
  const { issues } = useIssues(storeType);

  useWorkItemProperties(
    peekIssue?.projectId,
    peekIssue?.workspaceSlug,
    peekIssue?.issueId,
    storeType === EIssuesStoreType.EPIC ? EIssueServiceType.EPICS : EIssueServiceType.ISSUES
  );

  const removeRoutePeekId = useCallback(() => {
    setPeekIssue(undefined);
    if (embedIssue) embedRemoveCurrentNotification?.();
  }, [embedIssue, embedRemoveCurrentNotification, setPeekIssue]);

  const issueOperations = useMemo(
    () =>
      createIssueOperations({
        t,
        fetchIssue: async (workspaceSlug, projectId, issueId) => {
          await fetchIssue(workspaceSlug, projectId, issueId);
        },
        updateIssue: async (workspaceSlug, projectId, issueId, data) => {
          if (!issues?.updateIssue) return;
          await issues.updateIssue(workspaceSlug, projectId, issueId, data);
        },
        removeIssue: async (workspaceSlug, projectId, issueId) => {
          if (!issues?.removeIssue) return;
          await issues.removeIssue(workspaceSlug, projectId, issueId);
        },
        archiveIssue: issues?.archiveIssue
          ? (workspaceSlug, projectId, issueId) => issues.archiveIssue(workspaceSlug, projectId, issueId)
          : undefined,
        restoreIssue,
        addCycleToIssue: issues?.addCycleToIssue
          ? (workspaceSlug, projectId, cycleId, issueId) =>
              issues.addCycleToIssue(workspaceSlug, projectId, cycleId, issueId)
          : undefined,
        addIssueToCycle: issues?.addIssueToCycle
          ? (workspaceSlug, projectId, cycleId, issueIds) =>
              issues.addIssueToCycle(workspaceSlug, projectId, cycleId, issueIds)
          : undefined,
        removeIssueFromCycle: issues?.removeIssueFromCycle
          ? (workspaceSlug, projectId, cycleId, issueId) =>
              issues.removeIssueFromCycle(workspaceSlug, projectId, cycleId, issueId)
          : undefined,
        removeIssueFromModule: issues?.removeIssuesFromModule
          ? (workspaceSlug, projectId, moduleId, issueId) =>
              issues.removeIssuesFromModule(workspaceSlug, projectId, moduleId, [issueId])
          : undefined,
        changeModulesInIssue: issues?.changeModulesInIssue
          ? (workspaceSlug, projectId, issueId, addModuleIds, removeModuleIds) =>
              issues.changeModulesInIssue(workspaceSlug, projectId, issueId, addModuleIds, removeModuleIds)
          : undefined,
        onRemoveSuccess: removeRoutePeekId,
        afterMutation: (workspaceSlug, projectId, issueId) => {
          fetchActivities(workspaceSlug, projectId, issueId);
        },
      }),
    [fetchActivities, fetchIssue, issues, removeRoutePeekId, restoreIssue, t]
  );

  if (!peekIssue?.workspaceSlug || !peekIssue?.projectId || !peekIssue?.issueId) return <></>;

  // Check if issue is editable, based on user role
  const isEditable = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.PROJECT,
    peekIssue?.workspaceSlug,
    peekIssue?.projectId
  );

  return (
    <IssueView
      workspaceSlug={peekIssue.workspaceSlug}
      projectId={peekIssue.projectId}
      issueId={peekIssue.issueId}
      isLoading={props.isLoading}
      isError={props.isError}
      is_archived={!!peekIssue.isArchived}
      disabled={!isEditable}
      embedIssue={embedIssue}
      embedRemoveCurrentNotification={embedRemoveCurrentNotification}
      issueOperations={issueOperations}
    />
  );
});
