import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { E_SORT_ORDER } from "@plane/constants";
import type { TCommentsOperations } from "@plane/types";
import { IssueActivityCommentRoot } from "@/components/issues/issue-detail/issue-activity/activity-comment-root";
const state = vi.hoisted(() => ({ older: vi.fn().mockResolvedValue([]), refresh: vi.fn(), error: false }));
vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/store/use-issue-detail", () => ({
  useIssueDetail: () => ({
    activity: {
      getActivityAndCommentsByIssueId: () => [],
      history: { hasMore: () => true, hasError: () => state.error, hasOlderError: () => state.error },
      fetchOlderActivities: state.older,
      fetchActivities: state.refresh,
    },
    comment: {
      getCommentById: () => undefined,
      history: { hasMore: () => false, hasError: () => false },
      fetchOlderComments: vi.fn(),
      fetchComments: vi.fn(),
    },
  }),
}));
vi.mock("@/components/comments/card/root", () => ({ CommentCard: () => null }));
vi.mock("@/plane-web/components/issues/issue-details/issue-properties-activity", () => ({
  IssueAdditionalPropertiesActivity: () => null,
}));
vi.mock("@/plane-web/components/issues/worklog/activity/root", () => ({ IssueActivityWorklog: () => null }));
vi.mock("@/components/issues/issue-detail/issue-activity/activity/activity-list", () => ({
  IssueActivityItem: () => null,
}));
vi.mock("@/components/issues/issue-detail/issue-activity/loader", () => ({
  IssueActivityLoader: () => <div>Loading</div>,
}));
describe("task history", () => {
  it.each([false, true])(
    "loads or retries older history even when filters leave the current page empty (retry=%s)",
    async (retry) => {
      state.error = retry;
      vi.clearAllMocks();
      render(
        <IssueActivityCommentRoot
          workspaceSlug="ws"
          projectId="project"
          issueId="task"
          isIntakeIssue={false}
          selectedFilters={[]}
          activityOperations={{} as TCommentsOperations}
          showAccessSpecifier={false}
          sortOrder={E_SORT_ORDER.ASC}
        />
      );
      expect(state.older).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole("button", { name: retry ? "common.retry" : "common.load_more" }));
      expect(state.older).toHaveBeenCalledWith("ws", "project", "task");
      expect(state.refresh).not.toHaveBeenCalled();
    }
  );
});
