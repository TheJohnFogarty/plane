/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WorkItemColorPicker } from "@/components/issues/work-item-color-picker";

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@plane/propel/toast", () => ({ setToast: toast, TOAST_TYPE: { ERROR: "error" } }));
afterEach(() => {
  cleanup();
  toast.mockReset();
});

it("saves the selected color only on Save", async () => {
  const onChange = vi.fn().mockResolvedValue(undefined);
  render(<WorkItemColorPicker color="" disabled={false} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText("background_color"), { target: { value: "#123456" } });
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("save"));
  await waitFor(() => expect(onChange).toHaveBeenCalledWith("#123456"));
});

it("can clear a previously saved color", async () => {
  const onChange = vi.fn().mockResolvedValue(undefined);
  render(<WorkItemColorPicker color="#123456" disabled={false} onChange={onChange} />);
  fireEvent.click(screen.getByText("remove"));
  await waitFor(() => expect(onChange).toHaveBeenCalledWith(""));
});

it("prevents changes for read-only items", () => {
  const onChange = vi.fn();
  render(<WorkItemColorPicker color="#123456" disabled onChange={onChange} />);
  expect((screen.getByLabelText("background_color") as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByText("remove"));
  expect(onChange).not.toHaveBeenCalled();
});

it("reports failed saves and allows retrying", async () => {
  const onChange = vi.fn().mockRejectedValue(new Error("Failed"));
  render(<WorkItemColorPicker color="" disabled={false} onChange={onChange} />);
  fireEvent.click(screen.getByText("save"));
  await waitFor(() => expect(toast).toHaveBeenCalledOnce());
  expect((screen.getByText("save") as HTMLButtonElement).disabled).toBe(false);
});
