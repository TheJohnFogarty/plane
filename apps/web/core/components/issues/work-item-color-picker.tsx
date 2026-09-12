/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { Palette } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { SidebarPropertyListItem } from "@/components/common/layout/sidebar/property-list-item";

export function WorkItemColorPicker({
  color,
  disabled,
  onChange,
}: {
  color: string;
  disabled: boolean;
  onChange: (color: string) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(color || "#8250df");
  const [saving, setSaving] = useState(false);
  const save = async (nextColor: string) => {
    if (disabled || saving) return;
    setSaving(true);
    try {
      await onChange(nextColor);
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: t("error"), message: t("something_went_wrong_please_try_again") });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SidebarPropertyListItem icon={Palette} label={t("background_color")}>
      <div className="flex items-center gap-2 px-2 text-11">
        <input
          type="color"
          aria-label={t("background_color")}
          value={value}
          disabled={disabled || saving}
          onChange={(event) => setValue(event.target.value)}
          className="size-6 cursor-pointer rounded-sm border border-subtle bg-transparent disabled:cursor-default"
        />
        <button
          type="button"
          disabled={disabled || saving || value === color}
          onClick={() => void save(value)}
          className="text-secondary disabled:opacity-50"
        >
          {t("save")}
        </button>
        {color && (
          <button
            type="button"
            disabled={disabled || saving}
            onClick={() => void save("")}
            className="text-secondary disabled:opacity-50"
          >
            {t("remove")}
          </button>
        )}
      </div>
    </SidebarPropertyListItem>
  );
}
