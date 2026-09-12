import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TIssueOperations } from "@/components/issues/issue-operations";
import { IssueView } from "@/components/issues/peek-overview/view";

const state = vi.hoisted(() => ({
  loaded: false,
  fetching: true,
  issue: { id: "task", name: "Instant title", project_id: "project" },
}));
vi.mock("@/hooks/store/use-issue-detail", () => ({
  useIssueDetail: () => ({
    issue: {
      getIssueById: () => state.issue,
      getIsFetchingIssueDetails: () => state.fetching,
      hasIssueDetails: () => state.loaded,
    },
    setPeekIssue: vi.fn(),
    isAnyModalOpen: false,
  }),
}));
vi.mock("@/hooks/use-keypress", () => ({ default: () => undefined }));
vi.mock("@/hooks/use-peek-overview-outside-click", () => ({ default: () => undefined }));
vi.mock("@/components/issues/issue-detail/issue-activity", () => ({
  IssueActivity: () => <div>Activity loading</div>,
}));
vi.mock("@/components/issues/issue-detail-widgets", () => ({ IssueDetailWidgets: () => null }));
vi.mock("@/components/issues/work-item-property-editor", () => ({ WorkItemPropertyEditor: () => null }));
vi.mock("@/components/issues/peek-overview/error", () => ({ IssuePeekOverviewError: () => <div>Failed</div> }));
vi.mock("@/components/issues/peek-overview/header", () => ({ IssuePeekOverviewHeader: () => <div>Task header</div> }));
vi.mock("@/components/issues/peek-overview/issue-detail", () => ({
  PeekOverviewIssueDetails: () => <div>Task description</div>,
}));
vi.mock("@/components/issues/peek-overview/loader", () => ({
  IssuePeekOverviewLoader: () => <div>Detail loading</div>,
}));

function open() {
  return render(
    <IssueView
      workspaceSlug="workspace"
      projectId="project"
      issueId="task"
      is_archived={false}
      embedIssue
      isLoading
      issueOperations={{} as TIssueOperations}
    />
  );
}

describe("task opening", () => {
  beforeEach(() => {
    state.loaded = false;
    state.fetching = true;
  });
  it("keeps cached contents visible during background refresh", () => {
    state.loaded = true;
    open();
    expect(screen.getByText("Task description")).toBeTruthy();
    expect(screen.queryByText("Detail loading")).toBeNull();
  });
  it("does not mount an editor from a summary-only row", () => {
    state.fetching = false;
    open();
    expect(screen.queryByText("Task description")).toBeNull();
    expect(screen.getByText("Detail loading")).toBeTruthy();
  });
});
