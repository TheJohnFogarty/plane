# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import json

# Django imports
from django.core.serializers.json import DjangoJSONEncoder
from django.db.models import Exists, OuterRef, Prefetch, Q
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.gzip import gzip_page

# Third Party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers import (
    IssueCreateSerializer,
    IssueDetailSerializer,
    IssueListDetailSerializer,
    IssueSerializer,
    ProjectUserPropertySerializer,
)
from plane.bgtasks.issue_activities_task import issue_activity
from plane.bgtasks.issue_description_version_task import issue_description_version_task
from plane.bgtasks.notification_task import deleted_issue_requested_data
from plane.bgtasks.recent_visited_task import recent_visited_task
from plane.bgtasks.webhook_task import model_activity
from plane.db.models import (
    CycleIssue,
    IntakeIssue,
    Issue,
    IssueRelation,
    IssueSubscriber,
    ProjectUserProperty,
    ModuleIssue,
    Project,
    ProjectMember,
    UserRecentVisit,
)
from plane.utils.filters import IssueComplexFilterBackend, IssueFilterSet
from plane.utils.global_paginator import paginate
from plane.utils.host import base_host
from plane.utils.grouper import issue_on_results
from plane.utils.issue_detail import prepare_issue_detail_queryset
from plane.utils.issue_query import (
    ISSUE_BOARD_FIELDS,
    INTAKE_BOARD_COUNT_FILTER,
    SavedViewNotFound,
    annotate_issue_detail_qs,
    guest_issue_access_q,
    is_restricted_guest,
    list_issue_board,
    prepare_issue_board,
    restrict_guest_issues,
    serialize_issue_board_row,
    wants_property_values,
)
from plane.utils.timezone_converter import user_timezone_converter
from plane.utils.work_item import WorkItemCreateError, create_work_item

from .. import BaseAPIView, BaseViewSet


class IssueListEndpoint(BaseAPIView):
    filter_backends = (IssueComplexFilterBackend,)
    filterset_class = IssueFilterSet

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id):
        issue_ids = request.GET.get("issues", False)

        if not issue_ids:
            return Response({"error": "Issues are required"}, status=status.HTTP_400_BAD_REQUEST)

        issue_ids = [issue_id for issue_id in issue_ids.split(",") if issue_id != ""]

        # Base queryset with basic filters
        queryset = Issue.issue_objects.filter(workspace__slug=slug, project_id=project_id, pk__in=issue_ids)

        queryset = queryset.filter(state__deleted_at__isnull=True)
        if self.fields or self.expand:
            queryset = queryset.select_related("workspace", "project", "state", "parent").prefetch_related(
                "assignees", "labels", "issue_module__module"
            )
        try:
            prepared = prepare_issue_board(self, request, queryset=queryset, slug=slug, project_id=project_id)
        except SavedViewNotFound as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        issue_queryset = prepared.issue_queryset.distinct()

        recent_visited_task.delay(
            slug=slug,
            project_id=project_id,
            entity_name="project",
            entity_identifier=project_id,
            user_id=request.user.id,
        )

        if self.fields or self.expand:
            issues = IssueSerializer(issue_queryset, many=True, fields=self.fields, expand=self.expand).data
        else:
            issues = issue_on_results(
                issues=issue_queryset,
                group_by=prepared.group_by,
                sub_group_by=prepared.sub_group_by,
            )
            issues = user_timezone_converter(issues, ["created_at", "updated_at"], request.user.user_timezone)
        return Response(issues, status=status.HTTP_200_OK)


class IssueViewSet(BaseViewSet):
    model = Issue
    webhook_event = "issue"
    search_fields = ["name"]
    filter_backends = (IssueComplexFilterBackend,)
    filterset_class = IssueFilterSet

    def get_serializer_class(self):
        return IssueCreateSerializer if self.action in ["create", "update", "partial_update"] else IssueSerializer

    def get_queryset(self):
        issues = Issue.issue_objects.filter(
            project_id=self.kwargs.get("project_id"),
            workspace__slug=self.kwargs.get("slug"),
        ).distinct()

        return issues

    def apply_annotations(self, issues):
        return annotate_issue_detail_qs(issues)

    @method_decorator(gzip_page)
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def list(self, request, slug, project_id):
        project = Project.objects.get(pk=project_id, workspace__slug=slug)
        recent_visited_task.delay(
            slug=slug,
            project_id=project_id,
            entity_name="project",
            entity_identifier=project_id,
            user_id=request.user.id,
        )
        return list_issue_board(
            self,
            request,
            slug=slug,
            project_id=project_id,
            queryset=self.get_queryset(),
            restrict_guest=True,
            project=project,
            count_filter=INTAKE_BOARD_COUNT_FILTER,
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def create(self, request, slug, project_id):
        project = Project.objects.get(pk=project_id)
        try:
            issue = create_work_item(
                project=project,
                actor=request.user,
                data=request.data,
            )
        except WorkItemCreateError as exc:
            return Response(exc.payload, status=exc.status_code)

        issue_id = str(issue.id)
        issue_activity.delay(
            type="issue.activity.created",
            requested_data=json.dumps(self.request.data, cls=DjangoJSONEncoder),
            actor_id=str(request.user.id),
            issue_id=issue_id,
            project_id=str(project_id),
            current_instance=None,
            epoch=int(timezone.now().timestamp()),
            notification=True,
            origin=base_host(request=request, is_app=True),
        )
        model_activity.delay(
            model_name="issue",
            model_id=issue_id,
            requested_data=request.data,
            current_instance=None,
            actor_id=request.user.id,
            slug=slug,
            origin=base_host(request=request, is_app=True),
        )
        issue_description_version_task.delay(
            updated_issue=json.dumps(request.data, cls=DjangoJSONEncoder),
            issue_id=issue_id,
            user_id=request.user.id,
            is_creating=True,
        )
        board_row = serialize_issue_board_row(
            issue.id,
            user_timezone=request.user.user_timezone,
            project_id=project_id,
            expand_property_values=wants_property_values(request),
        )
        return Response(board_row, status=status.HTTP_201_CREATED)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], creator=True, model=Issue)
    def retrieve(self, request, slug, project_id, pk=None):
        project = Project.objects.get(pk=project_id, workspace__slug=slug)

        issue = (
            prepare_issue_detail_queryset(
                Issue.objects.filter(project_id=project_id, workspace__slug=slug, pk=pk),
                self.expand,
            )
            .annotate(
                is_subscribed=Exists(
                    IssueSubscriber.objects.filter(
                        workspace__slug=slug,
                        project_id=project_id,
                        issue_id=OuterRef("pk"),
                        subscriber=request.user,
                    )
                )
            )
            .first()
        )
        if not issue:
            return Response(
                {"error": "The required object does not exist."},
                status=status.HTTP_404_NOT_FOUND,
            )

        """
        if the role is guest and guest_view_all_features is false and owned by is not
        the requesting user then dont show the issue
        """

        if (
            is_restricted_guest(slug=slug, project_id=project_id, user=request.user, project=project)
            and issue.created_by != request.user
        ):
            return Response(
                {"error": "You are not allowed to view this issue"},
                status=status.HTTP_403_FORBIDDEN,
            )

        recent_visited_task.delay(
            slug=slug,
            entity_name="issue",
            entity_identifier=pk,
            user_id=request.user.id,
            project_id=project_id,
        )

        serializer = IssueDetailSerializer(issue, expand=self.expand)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], creator=True, model=Issue)
    def partial_update(self, request, slug, project_id, pk=None):
        skip_activity = request.data.pop("skip_activity", False)
        is_description_update = request.data.get("description_html") is not None

        issue = self.apply_annotations(self.get_queryset()).filter(pk=pk).first()

        if not issue:
            return Response({"error": "Issue not found"}, status=status.HTTP_404_NOT_FOUND)

        current_instance = json.dumps(IssueDetailSerializer(issue).data, cls=DjangoJSONEncoder)

        requested_data = json.dumps(self.request.data, cls=DjangoJSONEncoder)
        serializer = IssueCreateSerializer(issue, data=request.data, partial=True, context={"project_id": project_id})
        if serializer.is_valid():
            serializer.save()
            # Check if the update is a migration description update
            is_migration_description_update = skip_activity and is_description_update
            # Log all the updates
            if not is_migration_description_update:
                issue_activity.delay(
                    type="issue.activity.updated",
                    requested_data=requested_data,
                    actor_id=str(request.user.id),
                    issue_id=str(pk),
                    project_id=str(project_id),
                    current_instance=current_instance,
                    epoch=int(timezone.now().timestamp()),
                    notification=True,
                    origin=base_host(request=request, is_app=True),
                )
                model_activity.delay(
                    model_name="issue",
                    model_id=str(serializer.data.get("id", None)),
                    requested_data=request.data,
                    current_instance=current_instance,
                    actor_id=request.user.id,
                    slug=slug,
                    origin=base_host(request=request, is_app=True),
                )
                # updated issue description version
                issue_description_version_task.delay(
                    updated_issue=current_instance,
                    issue_id=str(serializer.data.get("id", None)),
                    user_id=request.user.id,
                )
            return Response(status=status.HTTP_204_NO_CONTENT)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission([ROLE.ADMIN], creator=True, model=Issue)
    def destroy(self, request, slug, project_id, pk=None):
        issue = Issue.objects.get(workspace__slug=slug, project_id=project_id, pk=pk)
        current_instance = json.dumps(IssueSerializer(issue).data, cls=DjangoJSONEncoder)
        requested_data = deleted_issue_requested_data(issue)

        issue.delete()
        # delete the issue from recent visits
        UserRecentVisit.objects.filter(
            project_id=project_id,
            workspace__slug=slug,
            entity_identifier=pk,
            entity_name="issue",
        ).delete(soft=False)
        issue_activity.delay(
            type="issue.activity.deleted",
            requested_data=requested_data,
            actor_id=str(request.user.id),
            issue_id=str(pk),
            project_id=str(project_id),
            current_instance=current_instance,
            epoch=int(timezone.now().timestamp()),
            notification=True,
            origin=base_host(request=request, is_app=True),
            subscriber=False,
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProjectUserDisplayPropertyEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def patch(self, request, slug, project_id):
        issue_property, _ = ProjectUserProperty.objects.get_or_create(
            user=request.user,
            project_id=project_id,
        )

        serializer = ProjectUserPropertySerializer(
            issue_property,
            data=request.data,
            partial=True,
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id):
        issue_property, _ = ProjectUserProperty.objects.get_or_create(user=request.user, project_id=project_id)
        serializer = ProjectUserPropertySerializer(issue_property)
        return Response(serializer.data, status=status.HTTP_200_OK)


class BulkDeleteIssuesEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN])
    def delete(self, request, slug, project_id):
        issue_ids = request.data.get("issue_ids", [])

        if not len(issue_ids):
            return Response({"error": "Issue IDs are required"}, status=status.HTTP_400_BAD_REQUEST)

        issues = Issue.issue_objects.filter(workspace__slug=slug, project_id=project_id, pk__in=issue_ids)
        issue_list = list(issues)
        delete_payloads = [
            (
                str(issue.id),
                deleted_issue_requested_data(issue),
                json.dumps(IssueSerializer(issue).data, cls=DjangoJSONEncoder),
            )
            for issue in issue_list
        ]

        total_issues = len(issue_list)

        # First, delete all related cycle issues
        CycleIssue.objects.filter(issue__in=issues).delete()

        # Then, delete all related module issues
        ModuleIssue.objects.filter(issue__in=issues).delete()

        # Finally, delete the issues themselves
        issues.delete()

        for issue_id, requested_data, current_instance in delete_payloads:
            issue_activity.delay(
                type="issue.activity.deleted",
                requested_data=requested_data,
                actor_id=str(request.user.id),
                issue_id=issue_id,
                project_id=str(project_id),
                current_instance=current_instance,
                epoch=int(timezone.now().timestamp()),
                notification=True,
                origin=base_host(request=request, is_app=True),
                subscriber=False,
            )

        return Response(
            {"message": f"{total_issues} issues were deleted"},
            status=status.HTTP_200_OK,
        )


class DeletedIssuesListViewSet(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id):
        filters = {}
        if request.GET.get("updated_at__gt", None) is not None:
            filters = {"updated_at__gt": request.GET.get("updated_at__gt")}
        deleted_issues = (
            Issue.all_objects.filter(workspace__slug=slug, project_id=project_id)
            .filter(Q(archived_at__isnull=False) | Q(deleted_at__isnull=False))
            .filter(**filters)
            .values_list("id", flat=True)
        )

        return Response(deleted_issues, status=status.HTTP_200_OK)


class IssuePaginatedViewSet(BaseViewSet):
    def get_queryset(self):
        workspace_slug = self.kwargs.get("slug")
        project_id = self.kwargs.get("project_id")

        issue_queryset = Issue.issue_objects.filter(workspace__slug=workspace_slug, project_id=project_id)

        return annotate_issue_detail_qs(issue_queryset.select_related("state", "type"))

    def process_paginated_result(self, fields, results, timezone):
        paginated_data = results.values(*fields)

        # converting the datetime fields in paginated data
        datetime_fields = ["created_at", "updated_at"]
        paginated_data = user_timezone_converter(paginated_data, datetime_fields, timezone)

        return paginated_data

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def list(self, request, slug, project_id):
        cursor = request.GET.get("cursor", None)
        is_description_required = request.GET.get("description", "false")
        updated_at = request.GET.get("updated_at__gt", None)

        required_fields = list(ISSUE_BOARD_FIELDS)

        if str(is_description_required).lower() == "true":
            required_fields.append("description_html")

        # querying issues
        base_queryset = Issue.issue_objects.filter(workspace__slug=slug, project_id=project_id)

        base_queryset = base_queryset.order_by("updated_at")
        queryset = self.get_queryset().order_by("updated_at")

        project = Project.objects.get(pk=project_id, workspace__slug=slug)
        base_queryset = restrict_guest_issues(
            base_queryset, slug=slug, project_id=project_id, user=request.user, project=project
        )
        queryset = restrict_guest_issues(queryset, slug=slug, project_id=project_id, user=request.user, project=project)

        # filtering issues by greater then updated_at given by the user
        if updated_at:
            base_queryset = base_queryset.filter(updated_at__gt=updated_at)
            queryset = queryset.filter(updated_at__gt=updated_at)

        paginated_data = paginate(
            base_queryset=base_queryset,
            queryset=queryset,
            cursor=cursor,
            on_result=lambda results: self.process_paginated_result(
                required_fields, results, request.user.user_timezone
            ),
        )

        return Response(paginated_data, status=status.HTTP_200_OK)


class IssueDetailEndpoint(BaseAPIView):
    filter_backends = (IssueComplexFilterBackend,)
    filterset_class = IssueFilterSet

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id):
        permission_subquery = (
            Issue.issue_objects.filter(workspace__slug=slug, project_id=project_id, id=OuterRef("id"))
            .filter(guest_issue_access_q(self.request.user))
            .values("id")
        )
        issue = (
            Issue.issue_objects.filter(workspace__slug=slug, project_id=project_id)
            .filter(Exists(permission_subquery))
            .select_related("state", "type")
        )

        if self.expand:
            if "issue_relation" in self.expand:
                issue = issue.prefetch_related(
                    Prefetch(
                        "issue_relation",
                        queryset=IssueRelation.objects.select_related("related_issue"),
                    )
                )
            if "issue_related" in self.expand:
                issue = issue.prefetch_related(
                    Prefetch(
                        "issue_related",
                        queryset=IssueRelation.objects.select_related("issue"),
                    )
                )

        prepared = prepare_issue_board(self, request, queryset=issue)
        return self.paginate(
            request=request,
            order_by=prepared.order_by_param,
            queryset=prepared.issue_queryset,
            total_count_queryset=prepared.filtered_issue_queryset,
            on_results=lambda issues: IssueListDetailSerializer(
                issues, many=True, fields=self.fields, expand=self.expand
            ).data,
        )


class IssueBulkUpdateDateEndpoint(BaseAPIView):
    def validate_dates(self, current_start, current_target, new_start, new_target):
        """
        Validate that start date is before target date.
        """
        from datetime import datetime

        start = new_start or current_start
        target = new_target or current_target

        # Convert string dates to datetime objects if they're strings
        if isinstance(start, str):
            start = datetime.strptime(start, "%Y-%m-%d").date()
        if isinstance(target, str):
            target = datetime.strptime(target, "%Y-%m-%d").date()

        if start and target and start > target:
            return False
        return True

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id):
        updates = request.data.get("updates", [])

        issue_ids = [update["id"] for update in updates]
        epoch = int(timezone.now().timestamp())

        # Fetch all relevant issues in a single query
        issues = list(Issue.objects.filter(id__in=issue_ids, workspace__slug=slug, project_id=project_id))
        issues_dict = {str(issue.id): issue for issue in issues}
        issues_to_update = []

        for update in updates:
            issue_id = update["id"]
            issue = issues_dict.get(issue_id)

            if not issue:
                continue

            start_date = update.get("start_date")
            target_date = update.get("target_date")
            validate_dates = self.validate_dates(issue.start_date, issue.target_date, start_date, target_date)
            if not validate_dates:
                return Response(
                    {"message": "Start date cannot exceed target date"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if start_date:
                issue_activity.delay(
                    type="issue.activity.updated",
                    requested_data=json.dumps({"start_date": update.get("start_date")}),
                    current_instance=json.dumps({"start_date": str(issue.start_date)}),
                    issue_id=str(issue_id),
                    actor_id=str(request.user.id),
                    project_id=str(project_id),
                    epoch=epoch,
                )
                issue.start_date = start_date
                issues_to_update.append(issue)

            if target_date:
                issue_activity.delay(
                    type="issue.activity.updated",
                    requested_data=json.dumps({"target_date": update.get("target_date")}),
                    current_instance=json.dumps({"target_date": str(issue.target_date)}),
                    issue_id=str(issue_id),
                    actor_id=str(request.user.id),
                    project_id=str(project_id),
                    epoch=epoch,
                )
                issue.target_date = target_date
                issues_to_update.append(issue)

        # Bulk update issues
        Issue.objects.bulk_update(issues_to_update, ["start_date", "target_date"])

        return Response({"message": "Issues updated successfully"}, status=status.HTTP_200_OK)


class IssueMetaEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="PROJECT")
    def get(self, request, slug, project_id, issue_id):
        issue = Issue.issue_objects.only("sequence_id", "project__identifier").get(
            id=issue_id, project_id=project_id, workspace__slug=slug
        )
        return Response(
            {
                "sequence_id": issue.sequence_id,
                "project_identifier": issue.project.identifier,
            },
            status=status.HTTP_200_OK,
        )


class IssueDetailIdentifierEndpoint(BaseAPIView):
    def strict_str_to_int(self, s):
        if not s.isdigit() and not (s.startswith("-") and s[1:].isdigit()):
            raise ValueError("Invalid integer string")
        return int(s)

    def get(self, request, slug, project_identifier, issue_identifier):
        # Check if the issue identifier is a valid integer
        try:
            issue_identifier = self.strict_str_to_int(issue_identifier)
        except ValueError:
            return Response(
                {"error": "Invalid issue identifier"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Fetch the project
        project = Project.objects.get(identifier__iexact=project_identifier, workspace__slug=slug)

        # Check if the user is a member of the project
        if not ProjectMember.objects.filter(
            workspace__slug=slug,
            project_id=project.id,
            member=request.user,
            is_active=True,
        ).exists():
            return Response(
                {"error": "You are not allowed to view this issue"},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Fetch the issue
        issue = (
            prepare_issue_detail_queryset(
                Issue.objects.filter(project_id=project.id, workspace__slug=slug, sequence_id=issue_identifier),
                self.expand,
            )
            .annotate(
                is_subscribed=Exists(
                    IssueSubscriber.objects.filter(
                        workspace__slug=slug,
                        project_id=project.id,
                        issue__sequence_id=issue_identifier,
                        subscriber=request.user,
                    )
                )
            )
            .annotate(
                is_intake=Exists(
                    IntakeIssue.objects.filter(
                        issue=OuterRef("id"),
                        status__in=[-2, 0],
                        workspace__slug=slug,
                        project_id=project.id,
                    )
                )
            )
            .first()
        )

        # Check if the issue exists
        if not issue:
            return Response(
                {"error": "The required object does not exist."},
                status=status.HTTP_404_NOT_FOUND,
            )

        """
        if the role is guest and guest_view_all_features is false and owned by is not
        the requesting user then dont show the issue
        """

        if (
            is_restricted_guest(slug=slug, project_id=project.id, user=request.user, project=project)
            and issue.created_by != request.user
        ):
            return Response(
                {"error": "You are not allowed to view this issue"},
                status=status.HTTP_403_FORBIDDEN,
            )

        recent_visited_task.delay(
            slug=slug,
            entity_name="issue",
            entity_identifier=str(issue.id),
            user_id=str(request.user.id),
            project_id=str(project.id),
        )

        # Serialize the issue
        serializer = IssueDetailSerializer(issue, expand=self.expand)
        return Response(serializer.data, status=status.HTTP_200_OK)
