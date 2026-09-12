/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { Control, FieldValues } from "react-hook-form";

type AccessControllerProps<TFieldValues extends FieldValues> = {
  control: Control<TFieldValues>;
};

export function AccessController<TFieldValues extends FieldValues>(_props: AccessControllerProps<TFieldValues>) {
  return <></>;
}
