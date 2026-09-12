/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useEffect } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane constants
import { ISSUE_DISPLAY_PROPERTIES } from "@plane/constants";
// plane i18n
import { useTranslation } from "@plane/i18n";
// types
import type { IIssueDisplayProperties, TIssueDisplayPropertyKey, TIssueProperty } from "@plane/types";
import { isCustomPropertyDisplayEnabled } from "@plane/utils";
// hooks
import { useIssueType } from "@/hooks/store/use-issue-type";
import { useProject } from "@/hooks/store/use-project";
// components
import { FilterHeader } from "@/components/common/filters";

type Props = {
  displayProperties: IIssueDisplayProperties;
  displayPropertiesToRender: TIssueDisplayPropertyKey[];
  handleUpdate: (updatedDisplayProperties: Partial<IIssueDisplayProperties>) => void;
  /** Focused project — prefer over useParams so display lists cannot drift from filter state. */
  projectId?: string;
  cycleViewDisabled?: boolean;
  moduleViewDisabled?: boolean;
  isEpic?: boolean;
};

export const FilterDisplayProperties = observer(function FilterDisplayProperties(props: Props) {
  const {
    displayProperties,
    displayPropertiesToRender,
    handleUpdate,
    projectId: projectIdProp,
    cycleViewDisabled = false,
    moduleViewDisabled = false,
    isEpic = false,
  } = props;
  // hooks
  const { t } = useTranslation();
  const { workspaceSlug, projectId: projectIdParam } = useParams();
  const issueTypeStore = useIssueType();
  const { getProjectById } = useProject();
  // states
  const [previewEnabled, setPreviewEnabled] = React.useState(true);

  const projectIdStr = projectIdProp ?? (projectIdParam ? String(projectIdParam) : undefined);
  const workspaceSlugStr = workspaceSlug ? String(workspaceSlug) : undefined;
  const projectDetails = projectIdStr ? getProjectById(projectIdStr) : undefined;
  const areIssueTypesEnabled = projectIdStr ? issueTypeStore.isIssueTypeEnabled(projectIdStr) : false;
  const areProjectIssueTypesFetched = projectIdStr ? !!issueTypeStore.fetchedMap[projectIdStr] : false;

  useEffect(() => {
    if (!workspaceSlugStr || !projectIdStr) return;
    if (areProjectIssueTypesFetched) return;
    if (projectDetails?.is_issue_type_enabled === false) return;
    void issueTypeStore.fetchWorkItemTypesPropertiesAndOptions(workspaceSlugStr, projectIdStr);
  }, [
    workspaceSlugStr,
    projectIdStr,
    issueTypeStore,
    areProjectIssueTypesFetched,
    projectDetails?.is_issue_type_enabled,
  ]);

  // Filter out "cycle" and "module" keys if cycleViewDisabled or moduleViewDisabled is true
  // Also filter out display properties that should not be rendered
  const filteredDisplayProperties = ISSUE_DISPLAY_PROPERTIES.filter((property) => {
    if (!displayPropertiesToRender.includes(property.key)) return false;
    switch (property.key) {
      case "cycle":
        return !cycleViewDisabled;
      case "modules":
        return !moduleViewDisabled;
      default:
        return true;
    }
  }).map((property) => ({
    key: property.key,
    titleTranslationKey:
      isEpic && property.key === "sub_issue_count"
        ? "issue.display.properties.work_item_count"
        : property.titleTranslationKey,
  }));

  const customProperties: TIssueProperty[] =
    projectIdStr && areIssueTypesEnabled ? issueTypeStore.getActiveProjectProperties(projectIdStr) : [];

  const handleCustomPropertyToggle = (propertyId: string) => {
    const currentlyEnabled = isCustomPropertyDisplayEnabled(displayProperties, propertyId);
    handleUpdate({
      custom_properties: {
        [propertyId]: !currentlyEnabled,
      },
    });
  };

  return (
    <>
      <FilterHeader
        title={t("issue.display.properties.label")}
        isPreviewEnabled={previewEnabled}
        handleIsPreviewEnabled={() => setPreviewEnabled(!previewEnabled)}
      />
      {previewEnabled && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {filteredDisplayProperties.map((displayProperty) => (
            <button
              key={displayProperty.key}
              type="button"
              className={`rounded-sm border px-2 py-0.5 text-11 transition-all ${
                (
                  displayProperty.key === "parent"
                    ? displayProperties.parent !== false
                    : displayProperties?.[displayProperty.key]
                )
                  ? "border-accent-strong bg-accent-primary text-on-color"
                  : "border-subtle hover:bg-layer-1"
              }`}
              onClick={() =>
                handleUpdate({
                  [displayProperty.key]:
                    displayProperty.key === "parent"
                      ? displayProperties.parent === false
                      : !displayProperties?.[displayProperty.key],
                })
              }
            >
              {t(displayProperty.titleTranslationKey)}
            </button>
          ))}
          {customProperties.map((property) => {
            const isEnabled = isCustomPropertyDisplayEnabled(displayProperties, property.id);
            return (
              <button
                key={property.id}
                type="button"
                className={`rounded-sm border px-2 py-0.5 text-11 transition-all ${
                  isEnabled ? "border-accent-strong bg-accent-primary text-on-color" : "border-subtle hover:bg-layer-1"
                }`}
                onClick={() => handleCustomPropertyToggle(property.id)}
              >
                {property.name}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
});
