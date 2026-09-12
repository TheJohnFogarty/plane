# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import json

# Django imports
from django.utils import timezone
from django.db.models import Q, UUIDField, Value
from django.core.serializers.json import DjangoJSONEncoder
from django.db.models.functions import Coalesce
from django.contrib.postgres.aggregates import ArrayAgg
from django.contrib.postgres.fields import ArrayField

# Third Party imports
from rest_framework.response import Response
from rest_framework import status

# Module imports
from .. import BaseViewSet
from plane.app.serializers import IssueRelationSerializer, RelatedIssueSerializer
from plane.app.permissions import ProjectEntityPermission
from plane.db.models import (
    Project,
    IssueRelation,
    Issue,
)
from plane.bgtasks.issue_activities_task import issue_activity
from plane.utils.issue_relation_mapper import get_actual_relation, get_inverse_relation
from plane.utils.host import base_host


class IssueRelationViewSet(BaseViewSet):
    serializer_class = IssueRelationSerializer
    model = IssueRelation
    permission_classes = [ProjectEntityPermission]

    def list(self, request, slug, project_id, issue_id):
        groups = {
            key: []
            for key in (
                "blocking",
                "blocked_by",
                "duplicate",
                "relates_to",
                "start_after",
                "start_before",
                "finish_after",
                "finish_before",
            )
        }
        edges = list(
            IssueRelation.objects.filter(Q(issue_id=issue_id) | Q(related_issue_id=issue_id))
            .filter(workspace__slug=slug)
            .values_list("issue_id", "related_issue_id", "relation_type")
        )
        if not edges:
            return Response(groups, status=status.HTTP_200_OK)

        counterparts = {key: set() for key in groups}
        for source, target, relation in edges:
            outgoing = str(source) == str(issue_id)
            group = relation if outgoing else get_inverse_relation(relation)
            if group in counterparts:
                counterparts[group].add(target if outgoing else source)

        related_ids = set().union(*counterparts.values())
        issues = (
            Issue.issue_objects.filter(workspace__slug=slug, pk__in=related_ids)
            .annotate(
                label_ids=Coalesce(
                    ArrayAgg(
                        "labels__id",
                        distinct=True,
                        filter=Q(labels__id__isnull=False, label_issue__deleted_at__isnull=True),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
                assignee_ids=Coalesce(
                    ArrayAgg(
                        "assignees__id",
                        distinct=True,
                        filter=Q(
                            assignees__id__isnull=False,
                            assignees__member_project__is_active=True,
                            issue_assignee__deleted_at__isnull=True,
                        ),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
            )
            .order_by("-created_at", "id")
            .values(
                "id",
                "name",
                "state_id",
                "sort_order",
                "priority",
                "sequence_id",
                "project_id",
                "label_ids",
                "assignee_ids",
                "created_at",
                "updated_at",
                "created_by",
                "updated_by",
            )
        )
        for issue in issues:
            for group, ids in counterparts.items():
                if issue["id"] in ids:
                    groups[group].append({**issue, "relation_type": group})
        return Response(groups, status=status.HTTP_200_OK)

    def create(self, request, slug, project_id, issue_id):
        relation_type = request.data.get("relation_type", None)
        if relation_type is None:
            return Response(
                {"message": "Issue relation type is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        issues = request.data.get("issues", [])
        project = Project.objects.get(pk=project_id)

        # Scope to workspace to prevent cross-tenant IDOR
        # Relations can cross projects so only workspace scope is enforced
        issues = list(
            Issue.issue_objects.filter(
                workspace__slug=slug,
                pk__in=issues,
            ).values_list("id", flat=True)
        )

        issue_relation = IssueRelation.objects.bulk_create(
            [
                IssueRelation(
                    issue_id=(issue if relation_type in ["blocking", "start_after", "finish_after"] else issue_id),
                    related_issue_id=(
                        issue_id if relation_type in ["blocking", "start_after", "finish_after"] else issue
                    ),
                    relation_type=(get_actual_relation(relation_type)),
                    project_id=project_id,
                    workspace_id=project.workspace_id,
                    created_by=request.user,
                    updated_by=request.user,
                )
                for issue in issues
            ],
            batch_size=10,
            ignore_conflicts=True,
        )

        issue_activity.delay(
            type="issue_relation.activity.created",
            requested_data=json.dumps(request.data, cls=DjangoJSONEncoder),
            actor_id=str(request.user.id),
            issue_id=str(issue_id),
            project_id=str(project_id),
            current_instance=None,
            epoch=int(timezone.now().timestamp()),
            notification=True,
            origin=base_host(request=request, is_app=True),
        )

        if relation_type in ["blocking", "start_after", "finish_after"]:
            return Response(
                RelatedIssueSerializer(issue_relation, many=True).data,
                status=status.HTTP_201_CREATED,
            )
        else:
            return Response(
                IssueRelationSerializer(issue_relation, many=True).data,
                status=status.HTTP_201_CREATED,
            )

    def remove_relation(self, request, slug, project_id, issue_id):
        related_issue = request.data.get("related_issue", None)

        issue_relations = IssueRelation.objects.filter(
            workspace__slug=slug,
        ).filter(
            Q(issue_id=related_issue, related_issue_id=issue_id) | Q(issue_id=issue_id, related_issue_id=related_issue)
        )
        issue_relations = issue_relations.first()
        current_instance = json.dumps(IssueRelationSerializer(issue_relations).data, cls=DjangoJSONEncoder)
        issue_relations.delete()
        issue_activity.delay(
            type="issue_relation.activity.deleted",
            requested_data=json.dumps(request.data, cls=DjangoJSONEncoder),
            actor_id=str(request.user.id),
            issue_id=str(issue_id),
            project_id=str(project_id),
            current_instance=current_instance,
            epoch=int(timezone.now().timestamp()),
            notification=True,
            origin=base_host(request=request, is_app=True),
        )
        return Response(status=status.HTTP_204_NO_CONTENT)
