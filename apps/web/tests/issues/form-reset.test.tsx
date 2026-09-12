/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { afterEach, describe, expect, it } from "vitest";
import type { TIssue } from "@plane/types";
import { useIssueFormReset } from "@/components/issues/issue-modal/use-issue-form-reset";

afterEach(cleanup);

function FormHarness({
  name = "",
  projectId = "project-one",
  resetKey = "initial",
}: {
  name?: string;
  projectId?: string;
  resetKey?: string;
}) {
  const [, setChanges] = useState(0);
  const { register, reset, watch } = useForm<TIssue>({ defaultValues: { name, project_id: projectId } });
  // The modal supplies new objects when reporting unsaved changes to its parent.
  useIssueFormReset({ name, description_html: "<p>Brief</p>", project_id: null }, projectId, reset, [resetKey]);
  return (
    <form onChange={() => setChanges((count) => count + 1)}>
      <input aria-label="Title" {...register("name")} />
      <select aria-label="Project" {...register("project_id")}>
        <option value="project-one">First project</option>
        <option value="project-two">Second project</option>
      </select>
      <output data-testid="project">{watch("project_id")}</output>
    </form>
  );
}

describe("issue form initialization", () => {
  it("keeps typed titles through form and parent rerenders", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<FormHarness />);
    await user.type(screen.getByRole("textbox", { name: "Title" }), "Build drivetrain");
    rerender(<FormHarness />);
    expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe("Build drivetrain");
  });

  it("loads changed source data when switching work items", () => {
    const { rerender } = render(<FormHarness name="First task" />);
    rerender(<FormHarness name="Second task" />);
    expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe("Second task");
  });

  it("applies a changed project", () => {
    const { rerender } = render(<FormHarness />);
    rerender(<FormHarness projectId="project-two" />);
    expect(screen.getByTestId("project").textContent).toBe("project-two");
  });

  it("preserves a user-selected project on parent rerenders", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<FormHarness />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Project" }), "project-two");
    rerender(<FormHarness />);
    expect(screen.getByTestId("project").textContent).toBe("project-two");
  });

  it("honors an explicit reset trigger", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<FormHarness name="Initial" />);
    await user.type(screen.getByRole("textbox", { name: "Title" }), " edited");
    rerender(<FormHarness name="Initial" resetKey="next" />);
    expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe("Initial");
  });
});
