/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import {
  CycleIcon,
  StatePropertyIcon,
  ModuleIcon,
  MembersPropertyIcon,
  PriorityPropertyIcon,
  StartDatePropertyIcon,
  DueDatePropertyIcon,
  LabelPropertyIcon,
  UserCirclePropertyIcon,
  EstimatePropertyIcon,
  ParentPropertyIcon,
} from "@plane/propel/icons";
import { cn, getDate, renderFormattedPayloadDate, shouldHighlightIssueDueDate } from "@plane/utils";
import { DateDropdown } from "@/components/dropdowns/date";
import { EstimateDropdown } from "@/components/dropdowns/estimate";
import { ButtonAvatars } from "@/components/dropdowns/member/avatar";
import { MemberDropdown } from "@/components/dropdowns/member/dropdown";
import { PriorityDropdown } from "@/components/dropdowns/priority";
import { StateDropdown } from "@/components/dropdowns/state/dropdown";
import { SidebarPropertyListItem } from "@/components/common/layout/sidebar/property-list-item";
import { useProjectEstimates } from "@/hooks/store/estimates";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useMember } from "@/hooks/store/use-member";
import { useProject } from "@/hooks/store/use-project";
import { useProjectState } from "@/hooks/store/use-project-state";
import { WorkItemAdditionalSidebarProperties } from "@/plane-web/components/issues/issue-details/additional-properties";
import { IssueParentSelectRoot } from "@/plane-web/components/issues/issue-details/parent-select-root";
import { DateAlert } from "@/plane-web/components/issues/issue-details/sidebar/date-alert";
import { TransferHopInfo } from "@/plane-web/components/issues/issue-details/sidebar/transfer-hop-info";
import { IssueWorklogProperty } from "@/plane-web/components/issues/worklog/property";
import type { TIssueOperations } from "./issue-detail";
import { IssuePeekOverviewLoader } from "./peek-overview/loader";
import { WorkItemColorPicker } from "./work-item-color-picker";
import { IssueCycleSelect } from "./issue-detail/cycle-select";
import { IssueLabel } from "./issue-detail/label";
import { IssueModuleSelect } from "./issue-detail/module-select";

export type TWorkItemPropertyEditorProps = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  issueOperations: TIssueOperations;
  disabled: boolean;
  variant: "peek" | "detail";
};

export const WorkItemPropertyEditor = observer(function WorkItemPropertyEditor(props: TWorkItemPropertyEditorProps) {
  const { workspaceSlug, projectId, issueId, issueOperations, disabled, variant } = props;
  const { t } = useTranslation();
  const { getProjectById } = useProject();
  const { areEstimateEnabledByProjectId } = useProjectEstimates();
  const {
    issue: { getIssueById },
  } = useIssueDetail();
  const { getStateById } = useProjectState();
  const { getUserDetails } = useMember();

  const issue = getIssueById(issueId);
  if (!issue) {
    return <IssuePeekOverviewLoader removeRoutePeekId={() => undefined} />;
  }

  const createdByDetails = getUserDetails(issue.created_by);
  const projectDetails = getProjectById(issue.project_id);
  const stateDetails = getStateById(issue.state_id);
  const isEstimateEnabled = Boolean(projectDetails?.estimate) || areEstimateEnabledByProjectId(projectId);
  const isIntakeCreatedBy = createdByDetails?.display_name.includes("-intake");
  const variantStyles = {
    peek: { text: "text-body-xs-medium", fields: "mt-3 w-full space-y-3" },
    detail: { text: "text-body-xs-regular", fields: "mt-4 mb-2 space-y-2.5 truncate" },
  }[variant];
  const textClass = variantStyles.text;

  const minDate = issue.start_date ? getDate(issue.start_date) : undefined;
  const maxDate = issue.target_date ? getDate(issue.target_date) : undefined;

  const fields = (
    <div className={cn(variantStyles.fields, disabled && "opacity-60")}>
      <SidebarPropertyListItem icon={StatePropertyIcon} label={t("common.state")}>
        <StateDropdown
          value={issue?.state_id}
          onChange={(val) => issueOperations.update(workspaceSlug, projectId, issueId, { state_id: val })}
          projectId={projectId}
          disabled={disabled}
          buttonVariant="transparent-with-text"
          className="group w-full grow"
          buttonContainerClassName="w-full text-left h-7.5"
          buttonClassName={`${textClass} ${issue?.state_id ? "" : "text-placeholder"}`}
          dropdownArrow
          dropdownArrowClassName="h-3.5 w-3.5 hidden group-hover:inline"
        />
      </SidebarPropertyListItem>

      <SidebarPropertyListItem icon={MembersPropertyIcon} label={t("common.assignees")}>
        <MemberDropdown
          value={issue?.assignee_ids ?? undefined}
          onChange={(val) => issueOperations.update(workspaceSlug, projectId, issueId, { assignee_ids: val })}
          disabled={disabled}
          projectId={projectId}
          placeholder={t("issue.add.assignee")}
          multiple
          buttonVariant={issue?.assignee_ids?.length > 1 ? "transparent-without-text" : "transparent-with-text"}
          className="group w-full grow"
          buttonContainerClassName="w-full text-left h-7.5"
          buttonClassName={`${textClass} justify-between ${issue?.assignee_ids?.length > 0 ? "" : "text-placeholder"}`}
          hideIcon={issue.assignee_ids?.length === 0}
          dropdownArrow
          dropdownArrowClassName="h-3.5 w-3.5 hidden group-hover:inline"
        />
      </SidebarPropertyListItem>

      <SidebarPropertyListItem icon={PriorityPropertyIcon} label={t("common.priority")}>
        <PriorityDropdown
          value={issue?.priority}
          onChange={(val) => issueOperations.update(workspaceSlug, projectId, issueId, { priority: val })}
          disabled={disabled}
          buttonVariant="transparent-with-text"
          className="h-7.5 w-full grow rounded-sm"
          buttonContainerClassName="w-full text-left h-7.5"
          buttonClassName={`${textClass} whitespace-nowrap [&_svg]:size-3.5 ${!issue?.priority || issue?.priority === "none" ? "text-placeholder" : ""}`}
        />
      </SidebarPropertyListItem>

      {createdByDetails && (
        <SidebarPropertyListItem icon={UserCirclePropertyIcon} label={t("common.created_by")} childrenClassName="px-2">
          <ButtonAvatars showTooltip userIds={isIntakeCreatedBy ? null : createdByDetails.id} />
          <span className={`grow truncate ${textClass} leading-5 text-secondary`}>
            {isIntakeCreatedBy ? "Plane" : createdByDetails.display_name}
          </span>
        </SidebarPropertyListItem>
      )}

      <SidebarPropertyListItem icon={StartDatePropertyIcon} label={t("common.order_by.start_date")}>
        <DateDropdown
          value={issue.start_date}
          onChange={(val) =>
            issueOperations.update(workspaceSlug, projectId, issueId, {
              start_date: val ? renderFormattedPayloadDate(val) : null,
            })
          }
          placeholder={t("issue.add.start_date")}
          buttonVariant="transparent-with-text"
          maxDate={maxDate}
          disabled={disabled}
          className="group w-full grow"
          buttonContainerClassName="w-full text-left h-7.5"
          buttonClassName={`${textClass} ${issue?.start_date ? "" : "text-placeholder"}`}
          hideIcon
          clearIconClassName="h-3 w-3 hidden group-hover:inline"
        />
      </SidebarPropertyListItem>

      <SidebarPropertyListItem icon={DueDatePropertyIcon} label={t("common.order_by.due_date")}>
        <div className="flex w-full items-center gap-2">
          <DateDropdown
            value={issue.target_date}
            onChange={(val) =>
              issueOperations.update(workspaceSlug, projectId, issueId, {
                target_date: val ? renderFormattedPayloadDate(val) : null,
              })
            }
            placeholder={t("issue.add.due_date")}
            buttonVariant="transparent-with-text"
            minDate={minDate}
            disabled={disabled}
            className="group w-full grow"
            buttonContainerClassName="w-full text-left h-7.5"
            buttonClassName={cn(textClass, {
              "text-placeholder": !issue.target_date,
              "text-danger-primary": shouldHighlightIssueDueDate(issue.target_date, stateDetails?.group),
            })}
            hideIcon
            clearIconClassName="h-3 w-3 hidden group-hover:inline text-primary"
          />
          {issue.target_date && <DateAlert date={issue.target_date} workItem={issue} projectId={projectId} />}
        </div>
      </SidebarPropertyListItem>

      {isEstimateEnabled && (
        <SidebarPropertyListItem icon={EstimatePropertyIcon} label={t("common.estimate")}>
          <EstimateDropdown
            value={issue.estimate_point ?? undefined}
            onChange={(val) => issueOperations.update(workspaceSlug, projectId, issueId, { estimate_point: val })}
            projectId={projectId}
            disabled={disabled}
            buttonVariant="transparent-with-text"
            className="group w-full grow"
            buttonContainerClassName="w-full text-left h-7.5"
            buttonClassName={`${textClass} ${issue?.estimate_point !== undefined && issue?.estimate_point !== null ? "" : "text-placeholder"}`}
            placeholder={t("common.none")}
            hideIcon
            dropdownArrow
            dropdownArrowClassName="h-3.5 w-3.5 hidden group-hover:inline"
          />
        </SidebarPropertyListItem>
      )}

      {projectDetails?.module_view && (
        <SidebarPropertyListItem icon={ModuleIcon} label={t("common.modules")}>
          <IssueModuleSelect
            className="w-full grow"
            workspaceSlug={workspaceSlug}
            projectId={projectId}
            issueId={issueId}
            issueOperations={issueOperations}
            disabled={disabled}
          />
        </SidebarPropertyListItem>
      )}

      {projectDetails?.cycle_view && (
        <SidebarPropertyListItem
          icon={CycleIcon}
          label={t("common.cycle")}
          appendElement={<TransferHopInfo workItem={issue} />}
        >
          <IssueCycleSelect
            className="h-7.5 w-full grow"
            workspaceSlug={workspaceSlug}
            projectId={projectId}
            issueId={issueId}
            issueOperations={issueOperations}
            disabled={disabled}
          />
        </SidebarPropertyListItem>
      )}

      <SidebarPropertyListItem icon={ParentPropertyIcon} label={t("common.parent")}>
        <IssueParentSelectRoot
          className="h-7.5 w-full grow"
          disabled={disabled}
          issueId={issueId}
          issueOperations={issueOperations}
          projectId={projectId}
          workspaceSlug={workspaceSlug}
        />
      </SidebarPropertyListItem>

      <WorkItemColorPicker
        key={`${issue.id}-${issue.color ?? ""}`}
        color={issue.color ?? ""}
        disabled={disabled}
        onChange={(color) => issueOperations.update(workspaceSlug, projectId, issueId, { color })}
      />

      <SidebarPropertyListItem icon={LabelPropertyIcon} label={t("common.labels")}>
        <IssueLabel workspaceSlug={workspaceSlug} projectId={projectId} issueId={issueId} disabled={disabled} />
      </SidebarPropertyListItem>

      <IssueWorklogProperty workspaceSlug={workspaceSlug} projectId={projectId} issueId={issueId} disabled={disabled} />

      <WorkItemAdditionalSidebarProperties
        workItemId={issue.id}
        workItemTypeId={issue.type_id}
        projectId={projectId}
        workspaceSlug={workspaceSlug}
        isEditable={!disabled}
        isPeekView={variant === "peek"}
      />
    </div>
  );

  if (variant === "detail") {
    return (
      <div className="flex h-full w-full flex-col items-center divide-y-2 divide-subtle-1 overflow-hidden">
        <div className="h-full w-full overflow-y-auto px-6">
          <h5 className="mt-5 text-body-xs-medium">{t("common.properties")}</h5>
          {fields}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h6 className="text-body-xs-medium">{t("common.properties")}</h6>
      {fields}
    </div>
  );
});
