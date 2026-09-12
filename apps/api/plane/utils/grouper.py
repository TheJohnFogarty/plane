# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.contrib.postgres.aggregates import ArrayAgg
from django.contrib.postgres.fields import ArrayField
from django.db.models import (
    BooleanField,
    Case,
    Q,
    QuerySet,
    OuterRef,
    Subquery,
    UUIDField,
    Value,
    When,
)
from django.db.models.functions import Coalesce, JSONObject

# Module imports
from plane.db.models import (
    Cycle,
    Issue,
    Label,
    Module,
    Project,
    ProjectMember,
    State,
    WorkspaceMember,
    IssueAssignee,
    ModuleIssue,
    IssueLabel,
)
from typing import Optional, Dict, Any, Union, List, Iterable


ISSUE_BOARD_FIELDS = [
    "id",
    "name",
    "color",
    "parent_summary",
    "state_id",
    "sort_order",
    "completed_at",
    "estimate_point",
    "priority",
    "start_date",
    "target_date",
    "sequence_id",
    "project_id",
    "parent_id",
    "cycle_id",
    "sub_issues_count",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
    "attachment_count",
    "link_count",
    "is_draft",
    "archived_at",
    "state__group",
    "type_id",
    "is_epic",
    "assignee_ids",
    "label_ids",
    "module_ids",
]

_GROUP_FIELD_TO_RELATION = {
    "label_ids": "labels__id",
    "assignee_ids": "assignees__id",
    "module_ids": "issue_module__module_id",
}

_RELATION_TO_GROUP_FIELD = {value: key for key, value in _GROUP_FIELD_TO_RELATION.items()}


def annotate_issue_relation_ids(queryset: QuerySet[Issue], skip: Optional[Iterable[str]] = None) -> QuerySet[Issue]:
    """Canonical relation IDs and parent summary for board and detail."""
    skip = set(skip or ())
    annotations = {
        "parent_summary": Subquery(
            Issue.objects.filter(pk=OuterRef("parent_id"), workspace_id=OuterRef("workspace_id"))
            .annotate(
                summary=JSONObject(
                    id="id",
                    name="name",
                    color="color",
                    sequence_id="sequence_id",
                    project_id="project_id",
                    project_identifier="project__identifier",
                )
            )
            .values("summary")[:1]
        ),
    }

    if "assignee_ids" not in skip:
        annotations["assignee_ids"] = Coalesce(
            Subquery(
                IssueAssignee.objects.filter(issue_id=OuterRef("pk"), deleted_at__isnull=True)
                .values("issue_id")
                .annotate(arr=ArrayAgg("assignee_id", distinct=True))
                .values("arr")
            ),
            Value([], output_field=ArrayField(UUIDField())),
        )
    if "label_ids" not in skip:
        annotations["label_ids"] = Coalesce(
            Subquery(
                IssueLabel.objects.filter(issue_id=OuterRef("pk"), deleted_at__isnull=True)
                .values("issue_id")
                .annotate(arr=ArrayAgg("label_id", distinct=True))
                .values("arr")
            ),
            Value([], output_field=ArrayField(UUIDField())),
        )
    if "module_ids" not in skip:
        annotations["module_ids"] = Coalesce(
            Subquery(
                ModuleIssue.objects.filter(
                    issue_id=OuterRef("pk"),
                    deleted_at__isnull=True,
                    module__archived_at__isnull=True,
                )
                .values("issue_id")
                .annotate(arr=ArrayAgg("module_id", distinct=True))
                .values("arr")
            ),
            Value([], output_field=ArrayField(UUIDField())),
        )
    return queryset.annotate(**annotations) if annotations else queryset


def board_row_value_fields(group_by: Optional[str] = None, sub_group_by: Optional[str] = None) -> List[str]:
    fields = list(ISSUE_BOARD_FIELDS)
    for grouped in (group_by, sub_group_by):
        mapped = _RELATION_TO_GROUP_FIELD.get(grouped)
        if mapped and mapped in fields:
            fields.remove(mapped)
            fields.append(grouped)
    return fields


def issue_queryset_grouper(
    queryset: QuerySet[Issue],
    group_by: Optional[str],
    sub_group_by: Optional[str],
) -> QuerySet[Issue]:
    group_filters = {
        "assignees__id": Q(issue_assignee__deleted_at__isnull=True),
        "labels__id": Q(label_issue__deleted_at__isnull=True),
        "issue_module__module_id": Q(issue_module__deleted_at__isnull=True),
    }
    for group_key in [group_by, sub_group_by]:
        if group_key in group_filters:
            queryset = queryset.filter(group_filters[group_key])

    skip = {
        key
        for key, grouped_name in _GROUP_FIELD_TO_RELATION.items()
        if grouped_name in {group_by, sub_group_by}
    }
    return annotate_issue_relation_ids(queryset, skip=skip)


def issue_on_results(
    issues: QuerySet[Issue],
    group_by: Optional[str],
    sub_group_by: Optional[str],
) -> List[Dict[str, Any]]:
    issues = issues.annotate(
        is_epic=Case(
            When(type__is_epic=True, then=Value(True)),
            default=Value(False),
            output_field=BooleanField(),
        )
    )
    return list(issues.values(*board_row_value_fields(group_by, sub_group_by)))


def issue_group_values(
    field: str,
    slug: str,
    project_id: Optional[str] = None,
    filters: Dict[str, Any] = {},
    queryset: Optional[QuerySet] = None,
) -> List[Union[str, Any]]:
    if field == "state_id":
        queryset = State.objects.filter(is_triage=False, workspace__slug=slug).values_list("id", flat=True)
        if project_id:
            return list(queryset.filter(project_id=project_id))
        return list(queryset)

    if field == "labels__id":
        queryset = Label.objects.filter(workspace__slug=slug).values_list("id", flat=True)
        if project_id:
            return list(queryset.filter(project_id=project_id)) + ["None"]
        return list(queryset) + ["None"]

    if field == "assignees__id":
        if project_id:
            return list(
                ProjectMember.objects.filter(workspace__slug=slug, project_id=project_id, is_active=True).values_list(
                    "member_id", flat=True
                )
            )
        return list(
            WorkspaceMember.objects.filter(workspace__slug=slug, is_active=True).values_list("member_id", flat=True)
        )

    if field == "issue_module__module_id":
        queryset = Module.objects.filter(workspace__slug=slug).values_list("id", flat=True)
        if project_id:
            return list(queryset.filter(project_id=project_id)) + ["None"]
        return list(queryset) + ["None"]

    if field == "cycle_id":
        queryset = Cycle.objects.filter(workspace__slug=slug).values_list("id", flat=True)
        if project_id:
            return list(queryset.filter(project_id=project_id)) + ["None"]
        return list(queryset) + ["None"]

    if field == "project_id":
        queryset = Project.objects.filter(workspace__slug=slug).values_list("id", flat=True)
        return list(queryset)

    if field == "priority":
        return ["low", "medium", "high", "urgent", "none"]

    if field == "state__group":
        return ["backlog", "unstarted", "started", "completed", "cancelled"]

    if field == "target_date":
        queryset = queryset.values_list("target_date", flat=True).distinct()
        if project_id:
            return list(queryset.filter(project_id=project_id))
        else:
            return list(queryset)

    if field == "start_date":
        queryset = queryset.values_list("start_date", flat=True).distinct()
        if project_id:
            return list(queryset.filter(project_id=project_id))
        else:
            return list(queryset)

    if field == "created_by":
        queryset = queryset.values_list("created_by", flat=True).distinct()
        if project_id:
            return list(queryset.filter(project_id=project_id))
        else:
            return list(queryset)

    return []
