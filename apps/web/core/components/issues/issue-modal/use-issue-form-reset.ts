/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef } from "react";
import { isEqual } from "lodash-es";
import type { UseFormReset } from "react-hook-form";
import { DEFAULT_WORK_ITEM_FORM_VALUES } from "@plane/constants";
import type { TIssue } from "@plane/types";

export function useIssueFormReset(
  data: Partial<TIssue> | undefined,
  projectId: string | null | undefined,
  reset: UseFormReset<TIssue>,
  resetProperties?: unknown[]
) {
  const previous = useRef<{
    data: Partial<TIssue> | undefined;
    projectId: string | null | undefined;
    resetProperties: unknown[] | undefined;
  } | null>(null);

  useEffect(() => {
    const next = { data, projectId, resetProperties };
    // Parent change notifications recreate these objects while the user types.
    // Only changed initialization values should replace unsaved form values.
    if (isEqual(previous.current, next)) return;
    previous.current = next;
    if (data) reset({ ...DEFAULT_WORK_ITEM_FORM_VALUES, ...data, project_id: data.project_id ?? projectId });
  }, [data, projectId, reset, resetProperties]);
}
