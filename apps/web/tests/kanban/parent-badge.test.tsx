/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TIssue } from "@plane/types";
import { KanbanParentBadge } from "@/components/issues/issue-layouts/kanban/parent-badge";

const { getParent } = vi.hoisted(() => ({ getParent: vi.fn() }));
vi.mock("@/hooks/store/use-issues", () => ({ useIssueById: getParent }));
vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: () => "Parent" }) }));
const issue = {
  parent_id: "parent",
  parent_summary: {
    id: "parent",
    name: "Integration",
    color: "#8250df",
    sequence_id: 42,
    project_identifier: "ROBOT",
    project_id: "project",
  },
} as TIssue;

afterEach(() => {
  cleanup();
  getParent.mockReset();
});

describe("Kanban parent badge", () => {
  it("shows a colored, identifiable parent without fetching a filtered-out epic", () => {
    render(<KanbanParentBadge issue={issue} />);
    expect(screen.getByText("Parent")).toBeTruthy();
    const badge = screen.getByTitle("ROBOT-42 · Integration");
    expect(badge.style.borderColor).toBe("rgb(130, 80, 223)");
  });
  it("reflects edits to a loaded parent's name and color", () => {
    getParent.mockReturnValue({ name: "Controls", color: "#123456" });
    render(<KanbanParentBadge issue={issue} />);
    expect(screen.getByTitle("ROBOT-42 · Controls").style.borderColor).toBe("rgb(18, 52, 86)");
  });
  it("omits stale parent data after changing the relationship", () => {
    const { container } = render(<KanbanParentBadge issue={{ ...issue, parent_id: "new-parent" }} />);
    expect(container.textContent).toBe("");
  });
  it("omits parentless items", () => {
    const { container } = render(<KanbanParentBadge issue={{ ...issue, parent_id: null }} />);
    expect(container.textContent).toBe("");
  });
  it("keeps uncolored parents readable", () => {
    render(<KanbanParentBadge issue={{ ...issue, parent_summary: { ...issue.parent_summary!, color: "" } }} />);
    expect(screen.getByTitle("ROBOT-42 · Integration").style.borderColor).toBe("");
  });
});
