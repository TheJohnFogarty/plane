/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import type { TIssue } from "@plane/types";
import { useIssueById } from "@/hooks/store/use-issues";

export const KanbanParentBadge = observer(function KanbanParentBadge({ issue }: { issue: TIssue }) {
  const { t } = useTranslation();
  const storedParent = useIssueById(issue.parent_id);
  // A parent may be excluded from this board's filters or pagination.
  const summary = issue.parent_summary?.id === issue.parent_id ? issue.parent_summary : undefined;
  const parent = storedParent ?? summary;
  if (!issue.parent_id || !parent?.name) return null;

  const color = /^#[0-9a-f]{6}$/i.test(parent.color ?? "") ? parent.color : undefined;
  const identifier = summary ? `${summary.project_identifier}-${summary.sequence_id}` : undefined;
  const title = [identifier, parent.name].filter(Boolean).join(" · ");

  return (
    <div className="min-w-0 space-y-1">
      <div className="text-11 text-tertiary">{t("common.parent")}</div>
      <div
        title={title}
        className="flex w-fit max-w-full items-center gap-1.5 rounded-sm border border-subtle px-1.5 py-0.5 text-11 text-primary"
        style={color ? { borderColor: color, backgroundColor: `${color}18` } : undefined}
      >
        <span
          className="size-2.5 shrink-0 rounded-xs bg-layer-3"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
        <span className="truncate">{title}</span>
      </div>
    </div>
  );
});
