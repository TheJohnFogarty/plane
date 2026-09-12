# Project task testing

The session API workflow suite exercises the endpoints used by the web app with
real Django permissions, serializers, database queries, and persistence. Celery
delivery is stubbed so tests do not send notifications or depend on workers.
It does not replace browser tests for rendering, drag and drop, or navigation.

## Run locally

Run from the repository root after creating local environment files with
`./setup.sh` if needed. The test compose file uses separate services and a tmpfs
Postgres data directory. Never point pytest at the restored development database.

```sh
docker compose -f docker-compose-test.yml run --rm --build api-tests \
  pytest plane/tests/contract/app/test_project_task_workflows.py \
  plane/tests/unit/serializers/test_issue_dates.py \
  plane/tests/unit/utils/test_work_item.py \
  plane/tests/unit/utils/test_issue_query.py \
  plane/tests/unit/utils/test_issue_filters_sub_issue.py -q --tb=short

pnpm --filter web test
pnpm turbo run check:types --filter=web
```

The `Project task workflows` GitHub Actions workflow runs the backend selection
and web regression suite on relevant API/web/package pull requests and manual
dispatch. It uses example environment files, a separate compose project, and no
production secrets. Backend JUnit results are uploaded even when tests fail.
The workflow must be pushed before GitHub can run it; hosted CI has not run yet.

## Coverage

| Workflow     | Assertions                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Create       | Default state, description, dates, priority, assignees, labels, cycle and modules persist; returned board row agrees with detail/list |
| Edit         | Title and description persist; omitted properties survive; clearing assignments and labels is reflected in detail                     |
| Status       | Start, complete and reopen; completion timestamp follows state                                                                        |
| Scheduling   | Invalid create ranges and single-date updates fail without mutation; either date can be cleared; equal dates are valid                |
| Validation   | Invalid names, priorities, IDs and foreign project relations leave no partial task                                                    |
| Boards       | Exact matching tasks for priority/state/assignee/label filters and a saved view; sequence ordering                                    |
| Hierarchy    | Create and list a subtask; detach it and verify the parent list updates                                                               |
| Cycle/module | Move a task between cycles without duplicate active membership; remove cycle/module membership                                        |
| Archive      | Reject unfinished tasks; archive completed tasks; restore their board membership                                                      |
| Comments     | Create, edit and delete with persisted content checks                                                                                 |
| Delete       | Remove from list and detail; bulk delete preserves unselected and foreign-project tasks                                               |
| Permissions  | Guests cannot create, edit or delete another member's tasks                                                                           |

Supporting unit tests cover atomic creation, required custom properties, query
composition, hierarchy filters, and schedule validation. Add regressions here
when a task bug is reproduced; assert persisted state and exact IDs, not only
HTTP success codes.

The web suite also includes seven form regressions in
`apps/web/tests/issues/form-reset.test.tsx` and
`apps/web/tests/issues/description-initialization.test.tsx`. These use React Hook
Form to check typed title/description persistence, project selection, new source
data, and explicit reset triggers. The description test stubs the rich editor;
it does not exercise the editor's document model or upload behavior.

## Validation on 2026-09-11

- Restored VPS backup `20260911-0315` into `plane_pgdata` and `plane_uploads`.
  Previous local volumes were copied to `plane_pgdata_devbak` and
  `plane_uploads_devbak`; Redis and RabbitMQ were recreated.
- API instances returned 200; login reached Code Orange; OFF26 showed 30 tasks.
- `/issues` redirected to `/issues/list`; sidebar project navigation preserved
  the document; the existing Offseason Projects Kanban view rendered tasks.
- MANUOFF26-14 loaded its inline image. Its existing PDF attachment redirected
  from the local API to `localhost:9000`, returning HTTP 200 and 174,163 bytes
  with a valid PDF signature.
- Backend selection: **89 passed**, including **32 new workflow cases** and
  **9 new date serializer cases**. Web suite: **202 passed** in 36 files, including
  **7 new form regression cases**. Web type check, scoped Python/TypeScript lint,
  and formatting of the new files passed. The existing issue serializer has
  unrelated formatting differences, which were left unchanged.
- The new tests reproduced a partial-date validation bug before the fix: PATCH
  of only one date could invert the existing schedule. Both failing cases now
  reject the change and preserve the stored dates.
- Browser creation exposed form resets that erased titles and descriptions on
  parent rerenders. Initialization now compares source values; description
  initialization ignores callback identity changes; null project defaults no
  longer overwrite the chosen project. The final UI probe persisted its title
  and description after reopening. Editing its title and setting Done also
  persisted, including the completion timestamp.
- Created local probes OFF26-31 and OFF26-32, both named with the
  `LOCAL QA probe 20260911-task-workflows` prefix. Both were deleted through the
  local API after validation; no active probe tasks remain.
- Development hot reload briefly produced React's synchronous-suspension error
  while package outputs were rebuilding. A fresh load recovered; subsequent
  project navigation passed. Production behavior was not tested.
- React Doctor scanned 3,401 files across the current branch and reported
  50/100 with 1,344 diagnostics. This broad scan includes existing changes and
  is not a clean health gate or a measured before/after score for these fixes.

## Remaining browser automation gaps

The API suite cannot prove drag/drop persistence, all five layout renderers,
filter-bar interactions, keyboard operation, upload progress/cancel/retry,
multi-user collaborative editing, or browser-level role behavior. The browser
checks above were agent-driven, not a committed browser regression suite.
Notifications and webhook delivery also need separate worker integration tests.
Use synthetic fixtures for future CI browser tests; keep production backups and
credentials out of CI and recorded artifacts.

Use `http://localhost:3000` for the running local stack, not `127.0.0.1`.
