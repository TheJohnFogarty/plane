/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useRef, useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import type { EditorRefApi } from "@plane/editor";
import type { TIssue } from "@plane/types";
import { IssueDescriptionEditor } from "@/components/issues/issue-modal/components/description-editor";

vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/store/use-editor-asset", () => ({ useEditorAsset: () => ({}) }));
vi.mock("@/hooks/store/use-instance", () => ({ useInstance: () => ({ config: {} }) }));
vi.mock("@/hooks/store/use-workspace", () => ({
  useWorkspace: () => ({ getWorkspaceBySlug: () => ({ id: "workspace" }) }),
}));
vi.mock("@/hooks/use-platform-os", () => ({ usePlatformOS: () => ({ isMobile: false }) }));
vi.mock("@/hooks/use-keypress", () => ({ default: () => undefined }));
vi.mock("@/components/core/modals/gpt-assistant-popover", () => ({ GptAssistantPopover: () => null }));
vi.mock("@/components/editor/rich-text", () => ({
  RichTextEditor: ({
    initialValue,
    onChange,
  }: {
    initialValue: string;
    onChange: (json: object, html: string) => void;
  }) => (
    <textarea aria-label="Description" value={initialValue} onChange={(event) => onChange({}, event.target.value)} />
  ),
}));

function DescriptionHarness({ initial = "" }: { initial?: string }) {
  const { control, setValue, watch } = useForm<TIssue>({ defaultValues: { description_html: initial } });
  const [, setChanges] = useState(0);
  const editorRef = useRef<EditorRefApi>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <IssueDescriptionEditor
        control={control}
        isDraft={false}
        issueName="Task"
        issueId={undefined}
        descriptionHtmlData={initial}
        editorRef={editorRef}
        submitBtnRef={submitRef}
        gptAssistantModal={false}
        workspaceSlug="workspace"
        projectId="project"
        handleFormChange={() => setChanges((count) => count + 1)}
        handleDescriptionHTMLDataChange={(html) => setValue("description_html", html)}
        setGptAssistantModal={() => undefined}
        handleGptAssistantClose={() => undefined}
        onAssetUpload={() => undefined}
        onClose={() => undefined}
      />
      <output data-testid="saved-description">{watch("description_html")}</output>
    </>
  );
}

describe("task description initialization", () => {
  it("does not replace edits when the parent callback changes identity", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<DescriptionHarness initial="Initial brief" />);
    await user.type(screen.getByRole("textbox", { name: "Description" }), " with edits");
    rerender(<DescriptionHarness initial="Initial brief" />);
    expect(screen.getByTestId("saved-description").textContent).toBe("Initial brief with edits");
  });

  it("accepts new source descriptions, including an explicitly empty value", () => {
    const { rerender } = render(<DescriptionHarness initial="First brief" />);
    rerender(<DescriptionHarness initial="Second brief" />);
    expect(screen.getByTestId("saved-description").textContent).toBe("Second brief");
    rerender(<DescriptionHarness initial="" />);
    expect(screen.getByTestId("saved-description").textContent).toBe("");
  });
});
