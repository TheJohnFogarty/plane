# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from types import SimpleNamespace
from uuid import uuid4
from unittest.mock import patch

import pytest
from rest_framework.renderers import JSONRenderer

from plane.app.serializers import IssueDetailSerializer, IssueLiteSerializer
from plane.app.views.issue.relation import IssueRelationViewSet
from plane.db.models import Issue, IssueRelation, Project

pytestmark = [pytest.mark.unit, pytest.mark.django_db]


def relation_data(workspace, project, issue):
    view = IssueRelationViewSet()
    view.kwargs = {"slug": workspace.slug}
    response = view.list(SimpleNamespace(), workspace.slug, project.id, issue.id)
    JSONRenderer().render(response.data)
    return response.data


def test_empty_relations_cost_one_query(workspace, django_assert_num_queries):
    project = Project.objects.create(name="Loading", identifier="LOAD", workspace=workspace)
    issue = Issue.objects.create(name="Task", project=project, workspace=workspace)
    with django_assert_num_queries(1):
        data = relation_data(workspace, project, issue)
    assert len(data) == 8
    assert all(not rows for rows in data.values())


@pytest.mark.parametrize(
    "relation,forward,reverse",
    [
        ("blocked_by", "blocked_by", "blocking"),
        ("start_before", "start_before", "start_after"),
        ("finish_before", "finish_before", "finish_after"),
        ("duplicate", "duplicate", "duplicate"),
        ("relates_to", "relates_to", "relates_to"),
    ],
)
def test_relation_directions_use_two_queries(workspace, django_assert_num_queries, relation, forward, reverse):
    project = Project.objects.create(name="Loading", identifier="LOAD", workspace=workspace)
    issue = Issue.objects.create(name="Task", project=project, workspace=workspace)
    other = Issue.objects.create(name="Other", project=project, workspace=workspace)
    IssueRelation.objects.create(
        issue=issue, related_issue=other, relation_type=relation, project=project, workspace=workspace
    )
    with django_assert_num_queries(2):
        outgoing = relation_data(workspace, project, issue)
    with django_assert_num_queries(2):
        incoming = relation_data(workspace, project, other)
    assert [row["id"] for row in outgoing[forward]] == [other.id]
    assert [row["id"] for row in incoming[reverse]] == [issue.id]
    assert outgoing[forward][0]["relation_type"] == forward
    assert outgoing[forward][0]["label_ids"] == []
    assert outgoing[forward][0]["assignee_ids"] == []


def test_expanded_parent_is_serialized_once():
    parent = Issue(id=uuid4(), name="Parent", project_id=uuid4(), workspace_id=uuid4(), sequence_id=1)
    child = Issue(
        id=uuid4(),
        name="Child",
        project_id=parent.project_id,
        workspace_id=parent.workspace_id,
        parent=parent,
        sequence_id=2,
        description_html="<p>small</p>",
    )
    child.cycle_id = None
    calls = []
    original = IssueLiteSerializer.to_representation

    def count(self, instance):
        calls.append(instance.id)
        return original(self, instance)

    with patch.object(IssueLiteSerializer, "to_representation", count):
        data = IssueDetailSerializer(child, expand=["parent"]).data
    assert data["parent"]["name"] == "Parent"
    assert calls == [parent.id]


def test_detail_query_prepares_only_requested_expansions(workspace, django_assert_num_queries):
    from plane.db.models import IssueType
    from plane.utils.issue_detail import prepare_issue_detail_queryset

    project = Project.objects.create(name="Loading", identifier="LOAD", workspace=workspace)
    epic_type = IssueType.objects.create(name="Epic", workspace=workspace, is_epic=True)
    issue = Issue.objects.create(name="Epic", project=project, workspace=workspace, type=epic_type)
    with django_assert_num_queries(1):
        loaded = prepare_issue_detail_queryset(Issue.objects.filter(pk=issue.pk), []).get()
        data = IssueDetailSerializer(loaded).data
    assert data["is_epic"] is True
    expand = ["parent", "issue_reactions", "issue_link", "issue_attachments"]
    with django_assert_num_queries(4):
        loaded = prepare_issue_detail_queryset(Issue.objects.filter(pk=issue.pk), expand).get()
    with django_assert_num_queries(0):
        data = IssueDetailSerializer(loaded, expand=expand).data
    assert data["issue_attachments"] == []
    assert data["issue_link"] == []
    assert data["issue_reactions"] == []
