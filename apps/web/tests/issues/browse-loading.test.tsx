import type { ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { IssueDetailsPage } from "../../app/(all)/[workspaceSlug]/(projects)/browse/[workItem]/page";
const state = vi.hoisted(() => ({ loaded: true }));
vi.mock("swr", () => ({ default: () => ({ data: undefined, isLoading: true, error: undefined }) }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/store/use-issue-detail", () => ({
  useIssueDetail: () => ({
    fetchIssueWithIdentifier: vi.fn(),
    issue: {
      getIssueIdByIdentifier: () => "task",
      hasIssueDetails: () => state.loaded,
      getIssueById: () => ({ id: "task", project_id: "project", sequence_id: 12, name: "Task" }),
      getIsFetchingIssueDetails: () => true,
    },
  }),
}));
vi.mock("@/hooks/store/use-project", () => ({
  useProject: () => ({
    getProjectByIdentifier: () => ({ id: "project", identifier: "TASK" }),
    getProjectById: () => ({ id: "project", identifier: "TASK" }),
  }),
}));
vi.mock("@/hooks/store/use-app-theme", () => ({
  useAppTheme: () => ({ toggleIssueDetailSidebar: vi.fn(), issueDetailSidebarCollapsed: false }),
}));
vi.mock("@/hooks/use-app-router", () => ({ useAppRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/use-issue-properties", () => ({ useWorkItemProperties: vi.fn() }));
vi.mock("@/layouts/auth-layout/project-wrapper", () => ({
  ProjectAuthWrapper: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/core/page-title", () => ({ PageHead: () => null }));
vi.mock("@/components/common/empty-state", () => ({ EmptyState: () => null }));
vi.mock("@/plane-web/components/browse/workItem-detail", () => ({
  WorkItemDetailRoot: () => <div>Task contents</div>,
}));
beforeEach(() => {
  state.loaded = true;
});
function open() {
  return render(
    <IssueDetailsPage
      {...({ params: { workspaceSlug: "ws", workItem: "TASK-12" } } as ComponentProps<typeof IssueDetailsPage>)}
    />
  );
}
it("shows a previously loaded task before the browse request resolves", () => {
  open();
  expect(screen.getByText("Task contents")).toBeTruthy();
});
it("does not treat an identifier's summary as a loaded description", () => {
  state.loaded = false;
  open();
  expect(screen.queryByText("Task contents")).toBeNull();
});
