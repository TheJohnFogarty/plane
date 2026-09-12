/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { EViewAccess } from "@plane/types";

type FilterByAccessProps = {
  appliedFilters: EViewAccess[] | undefined;
  handleUpdate: (val: string | string[]) => void;
  searchQuery: string;
  accessFilters: { key: EViewAccess; value: string }[];
};

export function FilterByAccess(_props: FilterByAccessProps) {
  return <></>;
}
