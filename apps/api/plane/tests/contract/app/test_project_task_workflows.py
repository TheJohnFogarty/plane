# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Project task workflows through the same session API used by the web app.

Only asynchronous delivery is stubbed: permissions, serializers, queries and
database writes run normally. Run with docker-compose-test.yml, never the
restored local database.
"""

from datetime import date
from unittest.mock import patch

import pytest

from plane.db.models import (
    Cycle,
    CycleIssue,
    Issue,
    IssueAssignee,
    IssueComment,
    IssueLabel,
    IssueView,
    Label,
    Module,
    ModuleIssue,
    Project,
    ProjectMember,
    State,
    User,
    WorkspaceMember,
)


pytestmark = [pytest.mark.contract, pytest.mark.django_db]


@pytest.fixture(autouse=True)
def asynchronous_delivery():
    with patch("celery.app.task.Task.apply_async"):
        yield


@pytest.fixture
def task_project(workspace, create_user):
    project = Project.objects.create(name="Task workflows", identifier="TASK", workspace=workspace)
    ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
    State.objects.create(name="Todo", group="backlog", default=True, project=project, workspace=workspace)
    State.objects.create(name="In progress", group="started", project=project, workspace=workspace)
    State.objects.create(name="Done", group="completed", project=project, workspace=workspace)
    return project


@pytest.fixture
def task_url(task_project):
    return f"/api/workspaces/{task_project.workspace.slug}/projects/{task_project.id}/issues/"


@pytest.fixture
def task(session_client, task_url):
    response = session_client.post(task_url, {"name": "Plan drivetrain"}, format="json")
    assert response.status_code == 201, response.data
    return Issue.objects.get(pk=response.data["id"])


def board_rows(client, url, **params):
    response = client.get(url, params)
    assert response.status_code == 200, response.data
    return response.data["results"]


def test_create_returns_complete_board_row_and_persists_relations(
    session_client,
    task_url,
    task_project,
    create_user,
):
    project = task_project
    label = Label.objects.create(name="Mechanical", project=project, workspace=project.workspace)
    cycle = Cycle.objects.create(name="Sprint", project=project, workspace=project.workspace, owned_by=create_user)
    module = Module.objects.create(name="Drive", project=project, workspace=project.workspace)
    payload = {
        "name": "Build drivetrain",
        "description_html": "<p>Check the mounting holes</p>",
        "priority": "high",
        "start_date": "2026-09-11",
        "target_date": "2026-09-18",
        "assignee_ids": [str(create_user.id)],
        "label_ids": [str(label.id)],
        "cycle_id": str(cycle.id),
        "module_ids": [str(module.id)],
    }
    response = session_client.post(task_url, payload, format="json")
    assert response.status_code == 201, response.data
    issue = Issue.objects.get(pk=response.data["id"])
    assert issue.project_id == project.id
    assert issue.state.group == "backlog"
    assert issue.priority == "high"
    assert str(issue.start_date) == payload["start_date"]
    assert str(issue.target_date) == payload["target_date"]
    assert list(issue.assignees.all()) == [create_user]
    assert list(issue.labels.all()) == [label]
    assert CycleIssue.objects.filter(issue=issue, cycle=cycle).exists()
    assert ModuleIssue.objects.filter(issue=issue, module=module).exists()
    row = response.json()
    assert row["state_id"] == str(issue.state_id)
    assert row["assignee_ids"] == [str(create_user.id)]
    assert row["label_ids"] == [str(label.id)]
    assert row["cycle_id"] == str(cycle.id)
    assert row["module_ids"] == [str(module.id)]
    detail = session_client.get(f"{task_url}{issue.id}/")
    assert detail.status_code == 200
    assert detail.data["description_html"] == payload["description_html"]
    assert str(issue.id) in {str(row["id"]) for row in board_rows(session_client, task_url)}


def test_edit_preserves_omitted_fields_and_can_clear_assignments(session_client, task_url, task, create_user):
    label = Label.objects.create(name="Electrical", project=task.project, workspace=task.workspace)
    url = f"{task_url}{task.id}/"
    response = session_client.patch(
        url,
        {
            "name": "Wire drivetrain",
            "description_html": "<p>Use labeled cables</p>",
            "priority": "urgent",
            "assignee_ids": [str(create_user.id)],
            "label_ids": [str(label.id)],
        },
        format="json",
    )
    assert response.status_code == 204, response.data
    response = session_client.patch(url, {"name": "Inspect wiring"}, format="json")
    assert response.status_code == 204
    task.refresh_from_db()
    assert task.name == "Inspect wiring"
    assert task.priority == "urgent"
    assert task.description_html == "<p>Use labeled cables</p>"
    assert list(task.assignees.all()) == [create_user]
    assert list(task.labels.all()) == [label]
    response = session_client.patch(url, {"assignee_ids": [], "label_ids": []}, format="json")
    assert response.status_code == 204
    assert not IssueAssignee.objects.filter(issue=task).exists()
    assert not IssueLabel.objects.filter(issue=task).exists()
    detail = session_client.get(url)
    assert detail.status_code == 200
    assert detail.data["assignee_ids"] == []
    assert detail.data["label_ids"] == []


def test_complete_and_reopen_updates_completion_timestamp(session_client, task_url, task):
    url = f"{task_url}{task.id}/"
    for group in ["started", "completed", "started"]:
        state = State.objects.get(project=task.project, group=group)
        response = session_client.patch(url, {"state_id": str(state.id)}, format="json")
        assert response.status_code == 204
        task.refresh_from_db()
        assert task.state_id == state.id
        assert (task.completed_at is not None) == (group == "completed")


@pytest.mark.parametrize(
    "payload",
    [
        {"name": ""},
        {"priority": "invalid"},
        {"start_date": "2026-09-20", "target_date": "2026-09-10"},
        {"cycle_id": "invalid"},
        {"module_ids": ["invalid"]},
    ],
)
def test_invalid_create_does_not_leave_partial_task(session_client, task_url, task_project, payload):
    before = Issue.objects.filter(project=task_project).count()
    response = session_client.post(task_url, {"name": "Invalid task", **payload}, format="json")
    assert response.status_code == 400, response.data
    assert Issue.objects.filter(project=task_project).count() == before


@pytest.mark.parametrize("field", ["state_id", "parent_id", "cycle_id", "module_ids"])
def test_create_rejects_relations_from_another_project(
    session_client,
    task_url,
    task_project,
    create_user,
    field,
):
    other = Project.objects.create(name="Other", identifier="OTHER", workspace=task_project.workspace)
    state = State.objects.create(name="Todo", group="backlog", project=other, workspace=other.workspace)
    objects = {
        "state_id": state,
        "parent_id": Issue.objects.create(name="Other task", project=other, workspace=other.workspace, state=state),
        "cycle_id": Cycle.objects.create(
            name="Other sprint", project=other, workspace=other.workspace, owned_by=create_user
        ),
        "module_ids": Module.objects.create(name="Other module", project=other, workspace=other.workspace),
    }
    value = str(objects[field].id)
    before = Issue.objects.filter(project=task_project).count()
    response = session_client.post(
        task_url,
        {
            "name": "Wrong project relation",
            field: [value] if field == "module_ids" else value,
        },
        format="json",
    )
    assert response.status_code == 400, response.data
    assert Issue.objects.filter(project=task_project).count() == before


def test_priority_filter_and_saved_view_return_exact_matching_tasks(session_client, task_url, task, create_user):
    task.priority = "urgent"
    task.save()
    other = session_client.post(task_url, {"name": "Later", "priority": "low"}, format="json")
    assert other.status_code == 201
    rows = board_rows(session_client, task_url, priority="urgent")
    assert {str(row["id"]) for row in rows} == {str(task.id)}
    view = IssueView.objects.create(
        name="Urgent work",
        workspace=task.workspace,
        project=task.project,
        owned_by=create_user,
        filters={"priority": ["urgent"]},
    )
    rows = board_rows(session_client, task_url, view_id=str(view.id))
    assert {str(row["id"]) for row in rows} == {str(task.id)}


def test_subtask_create_list_and_detach(session_client, task_url, task):
    response = session_client.post(task_url, {"name": "Check bolts", "parent_id": str(task.id)}, format="json")
    assert response.status_code == 201, response.data
    child = Issue.objects.get(pk=response.data["id"])
    assert child.parent_id == task.id
    url = f"{task_url}{task.id}/sub-issues/"
    response = session_client.get(url)
    assert response.status_code == 200
    assert {str(row["id"]) for row in response.data["sub_issues"]} == {str(child.id)}
    response = session_client.patch(f"{task_url}{child.id}/", {"parent_id": None}, format="json")
    assert response.status_code == 204
    child.refresh_from_db()
    assert child.parent_id is None
    response = session_client.get(url)
    assert response.status_code == 200
    assert response.data["sub_issues"] == []


def test_archive_requires_completion_and_unarchive_restores_board_membership(session_client, task_url, task):
    url = f"{task_url}{task.id}/archive/"
    assert session_client.post(url).status_code == 400
    task.refresh_from_db()
    assert task.archived_at is None
    done = State.objects.get(project=task.project, group="completed")
    assert session_client.patch(f"{task_url}{task.id}/", {"state_id": str(done.id)}, format="json").status_code == 204
    assert session_client.post(url).status_code == 200
    task.refresh_from_db()
    assert task.archived_at is not None
    assert board_rows(session_client, task_url) == []
    assert session_client.delete(url).status_code == 204
    task.refresh_from_db()
    assert task.archived_at is None
    assert {str(row["id"]) for row in board_rows(session_client, task_url)} == {str(task.id)}


def test_delete_removes_task_from_board_and_detail(session_client, task_url, task):
    url = f"{task_url}{task.id}/"
    assert session_client.delete(url).status_code == 204
    assert not Issue.objects.filter(pk=task.id).exists()
    assert board_rows(session_client, task_url) == []
    assert session_client.get(url).status_code == 404


def test_comment_create_edit_delete(session_client, task_url, task):
    url = f"{task_url}{task.id}/comments/"
    response = session_client.post(url, {"comment_html": "<p>Ready for review</p>"}, format="json")
    assert response.status_code == 201, response.data
    comment = IssueComment.objects.get(pk=response.data["id"])
    assert comment.issue_id == task.id
    detail_url = f"{url}{comment.id}/"
    response = session_client.patch(detail_url, {"comment_html": "<p>Review complete</p>"}, format="json")
    assert response.status_code == 200, response.data
    comment.refresh_from_db()
    assert comment.comment_html == "<p>Review complete</p>"
    assert session_client.delete(detail_url).status_code == 204
    assert not IssueComment.objects.filter(pk=comment.id).exists()


@pytest.mark.parametrize("method", ["post", "patch", "delete"])
def test_guest_cannot_mutate_another_members_task(session_client, task_url, task, api_client, method):
    guest = User.objects.create(email="guest-workflow@example.com", username="guest-workflow")
    WorkspaceMember.objects.create(workspace=task.workspace, member=guest, role=5)
    ProjectMember.objects.create(project=task.project, member=guest, role=5, is_active=True)
    api_client.force_authenticate(user=guest)
    url = task_url if method == "post" else f"{task_url}{task.id}/"
    before = Issue.objects.filter(project=task.project).count()
    response = getattr(api_client, method)(url, {"name": "Unauthorized edit"}, format="json")
    assert response.status_code == 403, response.data
    task.refresh_from_db()
    assert task.name == "Plan drivetrain"
    assert Issue.objects.filter(project=task.project).count() == before


@pytest.mark.parametrize("filter_name", ["state", "assignees", "labels"])
def test_board_filters_exclude_nonmatching_tasks(session_client, task_url, task, create_user, filter_name):
    label = Label.objects.create(name="Match", project=task.project, workspace=task.workspace)
    started = State.objects.get(project=task.project, group="started")
    response = session_client.patch(
        f"{task_url}{task.id}/",
        {
            "state_id": str(started.id),
            "assignee_ids": [str(create_user.id)],
            "label_ids": [str(label.id)],
        },
        format="json",
    )
    assert response.status_code == 204
    response = session_client.post(task_url, {"name": "Unmatched"}, format="json")
    assert response.status_code == 201
    values = {"state": started.id, "assignees": create_user.id, "labels": label.id}
    rows = board_rows(session_client, task_url, **{filter_name: str(values[filter_name])})
    assert {str(row["id"]) for row in rows} == {str(task.id)}


@pytest.mark.parametrize("order_by", ["sequence_id", "-sequence_id"])
def test_board_ordering_is_stable(session_client, task_url, task, order_by):
    response = session_client.post(task_url, {"name": "Second task"}, format="json")
    assert response.status_code == 201
    expected = [str(task.id), str(response.data["id"])]
    if order_by.startswith("-"):
        expected.reverse()
    assert [str(row["id"]) for row in board_rows(session_client, task_url, order_by=order_by)] == expected


def test_move_between_cycles_and_remove(session_client, task_url, task, create_user):
    cycles = [
        Cycle.objects.create(
            name=f"Sprint {index}",
            project=task.project,
            workspace=task.workspace,
            owned_by=create_user,
        )
        for index in range(2)
    ]
    base_url = task_url.removesuffix("issues/")
    for cycle in cycles:
        url = f"{base_url}cycles/{cycle.id}/cycle-issues/"
        response = session_client.post(url, {"issues": [str(task.id)]}, format="json")
        assert response.status_code == 201, response.data
        assert list(CycleIssue.objects.filter(issue=task).values_list("cycle_id", flat=True)) == [cycle.id]
    assert session_client.delete(f"{url}{task.id}/").status_code == 204
    assert not CycleIssue.objects.filter(issue=task).exists()


def test_add_and_remove_module_membership(session_client, task_url, task):
    module = Module.objects.create(name="Assembly", project=task.project, workspace=task.workspace)
    url = f"{task_url}{task.id}/modules/"
    response = session_client.post(url, {"modules": [str(module.id)]}, format="json")
    assert response.status_code == 201, response.data
    assert ModuleIssue.objects.filter(issue=task, module=module).exists()
    response = session_client.post(url, {"removed_modules": [str(module.id)]}, format="json")
    assert response.status_code == 201
    assert not ModuleIssue.objects.filter(issue=task).exists()


def test_bulk_delete_only_removes_selected_project_tasks(session_client, task_url, task):
    kept = session_client.post(task_url, {"name": "Keep this task"}, format="json")
    assert kept.status_code == 201
    other = Project.objects.create(name="Other", identifier="OTHER", workspace=task.workspace)
    foreign = Issue.objects.create(name="Other project task", project=other, workspace=task.workspace)
    url = task_url.removesuffix("issues/") + "bulk-delete-issues/"
    response = session_client.delete(url, {"issue_ids": [str(task.id), str(foreign.id)]}, format="json")
    assert response.status_code == 200, response.data
    assert not Issue.objects.filter(pk=task.id).exists()
    assert Issue.objects.filter(pk=foreign.id).exists()
    assert {str(row["id"]) for row in board_rows(session_client, task_url)} == {str(kept.data["id"])}


@pytest.mark.parametrize("payload", [{"start_date": "2026-09-21"}, {"target_date": "2026-09-09"}])
def test_single_date_edit_cannot_invert_existing_schedule(session_client, task_url, task, payload):
    task.start_date = date(2026, 9, 10)
    task.target_date = date(2026, 9, 20)
    task.save()
    response = session_client.patch(f"{task_url}{task.id}/", payload, format="json")
    assert response.status_code == 400, response.data
    task.refresh_from_db()
    assert task.start_date == date(2026, 9, 10)
    assert task.target_date == date(2026, 9, 20)


@pytest.mark.parametrize("field", ["start_date", "target_date"])
def test_date_can_be_cleared_without_changing_other_date(session_client, task_url, task, field):
    task.start_date = date(2026, 9, 10)
    task.target_date = date(2026, 9, 20)
    task.save()
    response = session_client.patch(f"{task_url}{task.id}/", {field: None}, format="json")
    assert response.status_code == 204
    task.refresh_from_db()
    assert getattr(task, field) is None
    if field == "start_date":
        assert task.target_date == date(2026, 9, 20)
    else:
        assert task.start_date == date(2026, 9, 10)
