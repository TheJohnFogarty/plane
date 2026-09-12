# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from unittest.mock import patch
import pytest
from django.utils import timezone
from plane.db.models import Issue, IssueActivity, IssueComment, Project, ProjectMember

pytestmark = [pytest.mark.unit, pytest.mark.django_db]


@pytest.mark.parametrize("kind,model", [("issue-property", IssueActivity), ("issue-comment", IssueComment)])
def test_history_is_paged_compact_and_stable_for_equal_timestamps(workspace, create_user, session_client, kind, model):
    project = Project.objects.create(name="History", identifier="HIST", workspace=workspace)
    ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
    issue = Issue.objects.create(
        name="Small task", project=project, workspace=workspace, description_html="<p>Do not repeat this body</p>"
    )
    rows = [
        model.objects.create(issue=issue, project=project, workspace=workspace, actor=create_user) for _ in range(7)
    ]
    model.objects.filter(pk__in=[row.pk for row in rows]).update(created_at=timezone.now())
    url = f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/{issue.id}/history/"
    with patch("celery.app.task.Task.apply_async"):
        page = session_client.get(url, {"activity_type": kind, "limit": 3}).json()
        assert isinstance(page, dict), "history must return a bounded page"
        assert len(page["results"]) == 3
        newest = page["results"][-1]
        seen = []
        while True:
            seen.extend(row["id"] for row in page["results"])
            assert len(page["results"]) <= 3
            for row in page["results"]:
                assert "description_html" not in row["issue_detail"]
                assert "description_json" not in row["issue_detail"]
                assert row["issue_detail"]["name"] == issue.name
            if not page["next_cursor"]:
                break
            page = session_client.get(url, {"activity_type": kind, "limit": 3, "cursor": page["next_cursor"]}).json()
        assert len(seen) == len(set(seen)) == 7
        delta = session_client.get(
            url, {"activity_type": kind, "limit": 3, "after": newest["created_at"], "after_id": newest["id"]}
        ).json()
        assert delta["results"] == []
        assert session_client.get(url, {"activity_type": kind, "limit": 3, "cursor": "bad"}).status_code == 400
        # Other clients retain their array contract.
        assert isinstance(session_client.get(url, {"activity_type": kind}).json(), list)
