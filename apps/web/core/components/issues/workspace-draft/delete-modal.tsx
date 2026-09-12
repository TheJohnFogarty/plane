/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */
import { useState } from "react";
import { observer } from "mobx-react";
// types
import { PROJECT_ERROR_MESSAGES, EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { EIssuesStoreType } from "@plane/types";
import type { TWorkspaceDraftIssue } from "@plane/types";
// ui
import { AlertModalCore } from "@plane/ui";
// hooks
import { useIssues } from "@/hooks/store/use-issues";
import { useUser, useUserPermissions } from "@/hooks/store/user";

type Props = {
  isOpen: boolean;
  handleClose: () => void;
  dataId?: string | null | undefined;
  data?: TWorkspaceDraftIssue;
  onSubmit?: () => Promise<void>;
};

export const WorkspaceDraftIssueDeleteIssueModal = observer(function WorkspaceDraftIssueDeleteIssueModal(props: Props) {
  const { dataId, data, isOpen, handleClose, onSubmit } = props;
  // states
  const [isDeleting, setIsDeleting] = useState(false);
  // store hooks
  const { issues } = useIssues(EIssuesStoreType.WORKSPACE_DRAFT);
  const { allowPermissions } = useUserPermissions();
  const { t } = useTranslation();
  const { data: currentUser } = useUser();

  // derived values
  const canPerformProjectAdminActions = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.PROJECT);

  if (!dataId && !data) return null;

  // derived values
  const issue = data ? data : dataId ? issues.getIssueById(dataId) : undefined;
  if (!issue) return null;
  const isIssueCreator = issue?.created_by === currentUser?.id;
  const authorized = isIssueCreator || canPerformProjectAdminActions;

  const onClose = () => {
    setIsDeleting(false);
    handleClose();
  };

  const handleIssueDelete = async () => {
    setIsDeleting(true);

    if (!authorized) {
      setToast({
        title: t(PROJECT_ERROR_MESSAGES.permissionError.i18n_title),
        type: TOAST_TYPE.ERROR,
        message:
          PROJECT_ERROR_MESSAGES.permissionError.i18n_message && t(PROJECT_ERROR_MESSAGES.permissionError.i18n_message),
      });
      onClose();
      return;
    }
    if (onSubmit)
      try {
        await onSubmit();
        setToast({
          type: TOAST_TYPE.SUCCESS,
          title: `${t("success")}!`,
          message: t("workspace_draft_issues.toasts.deleted.success"),
        });
        onClose();
      } catch (errors) {
        const apiError = errors as { error?: string };
        const isPermissionError = apiError.error === "Only admin or creator can delete the work item";
        const currentError = isPermissionError
          ? PROJECT_ERROR_MESSAGES.permissionError
          : PROJECT_ERROR_MESSAGES.issueDeleteError;
        setToast({
          title: t(currentError.i18n_title),
          type: TOAST_TYPE.ERROR,
          message: currentError.i18n_message && t(currentError.i18n_message),
        });
      } finally {
        onClose();
      }
  };

  return (
    <AlertModalCore
      handleClose={onClose}
      handleSubmit={handleIssueDelete}
      isSubmitting={isDeleting}
      isOpen={isOpen}
      title={t("workspace_draft_issues.delete_modal.title")}
      content={<>{t("workspace_draft_issues.delete_modal.description")}</>}
      primaryButtonText={{
        loading: t("deleting"),
        default: t("delete"),
      }}
      secondaryButtonText={t("cancel")}
    />
  );
});
