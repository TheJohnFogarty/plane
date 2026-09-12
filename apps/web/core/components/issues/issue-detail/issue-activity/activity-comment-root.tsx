/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { useTranslation } from "@plane/i18n";
import { observer } from "mobx-react";
// plane imports
import type { E_SORT_ORDER, TActivityFilters, EActivityFilterType } from "@plane/constants";
import { BASE_ACTIVITY_FILTER_TYPES, filterActivityOnSelectedFilters } from "@plane/constants";
import type { TCommentsOperations } from "@plane/types";
// components
import { CommentCard } from "@/components/comments/card/root";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// plane web components
import { IssueAdditionalPropertiesActivity } from "@/plane-web/components/issues/issue-details/issue-properties-activity";
import { IssueActivityWorklog } from "@/plane-web/components/issues/worklog/activity/root";
// local imports
import { IssueActivityItem } from "./activity/activity-list";
import { IssueActivityLoader } from "./loader";

type TIssueActivityCommentRoot = {
  workspaceSlug: string;
  projectId: string;
  isIntakeIssue: boolean;
  issueId: string;
  selectedFilters: TActivityFilters[];
  activityOperations: TCommentsOperations;
  showAccessSpecifier?: boolean;
  disabled?: boolean;
  sortOrder: E_SORT_ORDER;
};

export const IssueActivityCommentRoot = observer(function IssueActivityCommentRoot(props: TIssueActivityCommentRoot) {
  const {
    workspaceSlug,
    isIntakeIssue,
    issueId,
    selectedFilters,
    activityOperations,
    showAccessSpecifier,
    projectId,
    disabled,
    sortOrder,
  } = props;
  const { t } = useTranslation();
  const [loadingMore, setLoadingMore] = useState(false);
  // store hooks
  const { activity, comment: commentStore } = useIssueDetail();
  const { getActivityAndCommentsByIssueId } = activity;
  const { getCommentById } = commentStore;
  const hasMore = activity.history.hasMore(issueId) || commentStore.history.hasMore(issueId);
  const hasError = activity.history.hasError(issueId) || commentStore.history.hasError(issueId);
  const loadMore = async () => {
    setLoadingMore(true);
    try {
      await Promise.allSettled([
        activity.history.hasError(issueId) && !activity.history.hasOlderError(issueId)
          ? activity.fetchActivities(workspaceSlug, projectId, issueId)
          : activity.fetchOlderActivities(workspaceSlug, projectId, issueId),
        commentStore.history.hasError(issueId) && !commentStore.history.hasOlderError(issueId)
          ? commentStore.fetchComments(workspaceSlug, projectId, issueId)
          : commentStore.fetchOlderComments(workspaceSlug, projectId, issueId),
      ]);
    } finally {
      setLoadingMore(false);
    }
  };
  // derived values
  const activityAndComments = getActivityAndCommentsByIssueId(issueId, sortOrder);

  if (!activityAndComments && !hasError) return <IssueActivityLoader />;

  const filteredActivityAndComments = filterActivityOnSelectedFilters(activityAndComments ?? [], selectedFilters);

  return (
    <div>
      {(hasMore || hasError) && (
        <button
          type="button"
          disabled={loadingMore}
          aria-busy={loadingMore}
          onClick={() => void loadMore()}
          className="my-2 rounded px-3 py-2 text-body-sm-medium text-secondary hover:bg-layer-2 disabled:opacity-50"
        >
          {t(hasError ? "common.retry" : "common.load_more")}
        </button>
      )}
      {filteredActivityAndComments.map((activityComment, index) => {
        const comment = getCommentById(activityComment.id);
        return activityComment.activity_type === "COMMENT" ? (
          <CommentCard
            key={activityComment.id}
            workspaceSlug={workspaceSlug}
            entityId={issueId}
            comment={comment}
            activityOperations={activityOperations}
            ends={index === 0 ? "top" : index === filteredActivityAndComments.length - 1 ? "bottom" : undefined}
            showAccessSpecifier={!!showAccessSpecifier}
            showCopyLinkOption={!isIntakeIssue}
            disabled={disabled}
            projectId={projectId}
            enableReplies
          />
        ) : BASE_ACTIVITY_FILTER_TYPES.includes(activityComment.activity_type as EActivityFilterType) ? (
          <IssueActivityItem
            key={activityComment.id}
            activityId={activityComment.id}
            ends={index === 0 ? "top" : index === filteredActivityAndComments.length - 1 ? "bottom" : undefined}
          />
        ) : activityComment.activity_type === "ISSUE_ADDITIONAL_PROPERTIES_ACTIVITY" ? (
          <IssueAdditionalPropertiesActivity
            key={activityComment.id}
            activityId={activityComment.id}
            ends={index === 0 ? "top" : index === filteredActivityAndComments.length - 1 ? "bottom" : undefined}
          />
        ) : activityComment.activity_type === "WORKLOG" ? (
          <IssueActivityWorklog
            key={activityComment.id}
            workspaceSlug={workspaceSlug}
            projectId={projectId}
            issueId={issueId}
            activityComment={activityComment}
            ends={index === 0 ? "top" : index === filteredActivityAndComments.length - 1 ? "bottom" : undefined}
          />
        ) : (
          <></>
        );
      })}
    </div>
  );
});
