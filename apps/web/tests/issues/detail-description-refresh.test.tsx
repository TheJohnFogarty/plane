import { createRef, forwardRef } from "react";
import type { ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EditorRefApi } from "@plane/editor";
import { EFileAssetType } from "@plane/types";
import { DescriptionInput } from "@/components/editor/rich-text/description-input";

vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/store/use-editor-asset", () => ({ useEditorAsset: () => ({}) }));
vi.mock("@/hooks/store/use-workspace", () => ({ useWorkspace: () => ({ getWorkspaceBySlug: () => ({ id: "ws" }) }) }));
vi.mock("@/components/editor/rich-text", () => ({
  RichTextEditor: forwardRef(function MockEditor(
    {
      initialValue,
      onChange,
    }: {
      initialValue: string;
      onChange: (json: object, html: string) => void;
    },
    _ref
  ) {
    return (
      <div>
        <output>{initialValue}</output>
        <button onClick={() => onChange({}, "<p>Unsaved edit</p>")}>Edit</button>
      </div>
    );
  }),
}));

function description(initialValue: string, onSubmit: ComponentProps<typeof DescriptionInput>["onSubmit"]) {
  return (
    <DescriptionInput
      key="task"
      entityId="task"
      initialValue={initialValue}
      workspaceSlug="ws"
      projectId="project"
      editorRef={createRef<EditorRefApi>()}
      fileAssetType={EFileAssetType.ISSUE_DESCRIPTION}
      onSubmit={onSubmit}
      setIsSubmitting={vi.fn()}
      disabled={false}
    />
  );
}

describe("detail description refresh", () => {
  it("preserves unsaved text when a background detail response arrives", async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    const view = render(description("<p>Original</p>", submit));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    view.rerender(description("<p>Remote refresh</p>", submit));
    view.unmount();
    await vi.waitFor(() =>
      expect(submit).toHaveBeenCalledWith(expect.objectContaining({ description_html: "<p>Unsaved edit</p>" }), false)
    );
  });
  it("accepts a background update when there are no local edits", () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    const view = render(description("<p>Original</p>", submit));
    view.rerender(description("<p>Remote refresh</p>", submit));
    expect(screen.getByText("<p>Remote refresh</p>")).toBeTruthy();
  });
});
