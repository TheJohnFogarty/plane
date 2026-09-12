/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState, type FC } from "react";
import { observer } from "mobx-react";
import type { TIssueProperty } from "@plane/types";
import {
  BooleanPropertyIcon,
  DropdownPropertyIcon,
  HashPropertyIcon,
  LabelPropertyIcon,
  MembersPropertyIcon,
  StartDatePropertyIcon,
} from "@plane/propel/icons";
import { SidebarPropertyListItem } from "@/components/common/layout/sidebar/property-list-item";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useIssueType } from "@/hooks/store/use-issue-type";
import { IssuePropertyInput } from "@/plane-web/components/issues/issue-properties/property-input";

export type TWorkItemAdditionalSidebarProperties = {
  workItemId: string;
  workItemTypeId: string | null | undefined;
  projectId: string;
  workspaceSlug: string;
  isEditable: boolean;
  isPeekView?: boolean;
};

function getPropertyIcon(property: TIssueProperty): FC<{ className?: string }> {
  switch (property.property_type) {
    case "BOOLEAN":
      return BooleanPropertyIcon;
    case "DROPDOWN":
      return DropdownPropertyIcon;
    case "DATE":
      return StartDatePropertyIcon;
    case "MEMBER":
      return MembersPropertyIcon;
    case "NUMBER":
      return HashPropertyIcon;
    case "URL":
    case "TEXT":
    default:
      return LabelPropertyIcon;
  }
}

export const WorkItemAdditionalSidebarProperties = observer(function WorkItemAdditionalSidebarProperties(
  props: TWorkItemAdditionalSidebarProperties
) {
  const { workItemId, workItemTypeId, projectId, workspaceSlug, isEditable } = props;
  const issueTypeStore = useIssueType();
  const { updateIssue } = useIssueDetail();
  const [localValues, setLocalValues] = useState<Record<string, unknown>>({});
  const didAutoAssignType = useRef<string | null>(null);

  useEffect(() => {
    if (!workspaceSlug || !projectId) return;
    if (!issueTypeStore.fetchedMap[projectId]) {
      void issueTypeStore.fetchWorkItemTypesPropertiesAndOptions(workspaceSlug, projectId);
    }
  }, [workspaceSlug, projectId, issueTypeStore]);

  useEffect(() => {
    if (!workspaceSlug || !projectId || !workItemId) return;
    if (workItemId in issueTypeStore.propertyValuesMap) return;
    void issueTypeStore.fetchPropertyValues(workspaceSlug, projectId, workItemId).then((values) => {
      setLocalValues(values || {});
      return undefined;
    });
  }, [workspaceSlug, projectId, workItemId, issueTypeStore]);

  const storedValues = issueTypeStore.propertyValuesMap[workItemId];
  const hasStoredValues = workItemId in issueTypeStore.propertyValuesMap;
  const defaultTypeId = issueTypeStore.getDefaultIssueTypeId(projectId);
  const effectiveTypeId = workItemTypeId || defaultTypeId;

  useEffect(() => {
    if (hasStoredValues) setLocalValues(storedValues || {});
  }, [hasStoredValues, storedValues]);

  // Legacy issues may lack type_id after types were enabled — assign the default once
  useEffect(() => {
    if (didAutoAssignType.current === workItemId) return;
    if (!issueTypeStore.isIssueTypeEnabled(projectId)) return;
    if (workItemTypeId || !defaultTypeId || !isEditable) return;
    if (!workspaceSlug || !projectId || !workItemId) return;

    didAutoAssignType.current = workItemId;
    void updateIssue(workspaceSlug, projectId, workItemId, { type_id: defaultTypeId });
  }, [workItemTypeId, defaultTypeId, isEditable, workspaceSlug, projectId, workItemId, issueTypeStore, updateIssue]);

  if (!issueTypeStore.isIssueTypeEnabled(projectId) || !effectiveTypeId) return null;

  const properties = issueTypeStore.getActivePropertiesForType(projectId, effectiveTypeId);
  if (!properties.length) return null;

  const handleChange = async (propertyId: string, value: unknown) => {
    setLocalValues((prev) => ({ ...prev, [propertyId]: value }));
    if (!isEditable) return;
    try {
      await issueTypeStore.upsertPropertyValues(workspaceSlug, projectId, workItemId, { [propertyId]: value }, false);
    } catch {
      // keep local value; errors surface via toast elsewhere if needed
    }
  };

  return (
    <>
      {properties.map((property) => {
        const label = property.is_required ? `${property.name} *` : property.name;
        return (
          <SidebarPropertyListItem key={property.id} icon={getPropertyIcon(property)} label={label}>
            <IssuePropertyInput
              property={property}
              projectId={projectId}
              value={localValues[property.id]}
              hideLabel
              variant="sidebar"
              disabled={!isEditable || (property.settings?.display_format || property.settings?.format) === "readonly"}
              onChange={(value) => handleChange(property.id, value)}
            />
          </SidebarPropertyListItem>
        );
      })}
    </>
  );
});
