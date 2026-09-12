# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest

from plane.app.serializers import IssueCreateSerializer, IssueDetailSerializer
from plane.db.models import Issue, Project
from plane.utils.grouper import issue_on_results, issue_queryset_grouper
from plane.utils.issue_query import annotate_issue_detail_qs


@pytest.mark.unit
@pytest.mark.parametrize(
    "color,valid",
    [
        ("#8250df", True),
        ("#ABC123", True),
        ("", True),
        ("red", False),
        ("#abc", False),
        ("#1234567", False),
        (None, False),
    ],
)
def test_color_validation(color, valid):
    serializer = IssueCreateSerializer(Issue(name="Task"), data={"color": color}, partial=True)
    assert serializer.is_valid() is valid, serializer.errors


@pytest.mark.unit
@pytest.mark.django_db
def test_board_parent_summary_survives_parent_filtering_and_updates(workspace, django_assert_num_queries):
    project = Project.objects.create(name="Board", identifier="BOARD", workspace=workspace)
    parent = Issue.objects.create(name="Epic", project=project, workspace=workspace, color="#8250df")
    child = Issue.objects.create(name="Task", project=project, workspace=workspace, parent=parent)

    def rows(group=None):
        qs = annotate_issue_detail_qs(Issue.issue_objects.filter(pk=child.pk))
        return issue_on_results(issue_queryset_grouper(qs, group, None), group, None)

    with django_assert_num_queries(1):
        result = rows()[0]
    assert result["parent_summary"]["name"] == "Epic"
    assert result["parent_summary"]["color"] == "#8250df"
    assert result["parent_summary"]["project_identifier"] == "BOARD"
    assert result["parent_summary"]["id"] == str(parent.id)
    assert rows("state_id")[0]["parent_summary"] == result["parent_summary"]

    serializer = IssueCreateSerializer(parent, data={"color": "#123456"}, partial=True)
    assert serializer.is_valid(), serializer.errors
    serializer.save()
    assert rows()[0]["parent_summary"]["color"] == "#123456"
    detail = annotate_issue_detail_qs(Issue.objects.filter(pk=parent.pk)).get()
    assert IssueDetailSerializer(detail).data["color"] == "#123456"

    child.parent = None
    child.save()
    assert rows()[0]["parent_summary"] is None


@pytest.mark.unit
@pytest.mark.django_db
def test_deleted_parent_is_not_exposed(workspace):
    from django.utils import timezone

    project = Project.objects.create(name="Board", identifier="BOARD", workspace=workspace)
    parent = Issue.objects.create(name="Epic", project=project, workspace=workspace)
    child = Issue.objects.create(name="Task", project=project, workspace=workspace, parent=parent)
    Issue.objects.filter(pk=parent.pk).update(deleted_at=timezone.now())
    row = annotate_issue_detail_qs(Issue.objects.filter(pk=child.pk)).values("parent_summary").get()
    assert row["parent_summary"] is None
