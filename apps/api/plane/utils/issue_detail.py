# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Prepare task detail data once, regardless of how the route identifies it."""

from django.db.models import Prefetch

from plane.db.models import FileAsset, IssueLink, IssueReaction
from plane.utils.issue_query import annotate_issue_detail_qs


def prepare_issue_detail_queryset(queryset, expand):
    expand = set(expand or ())
    related = ["state", "type"]
    related.extend(field for field in ("parent", "workspace", "project") if field in expand)
    queryset = annotate_issue_detail_qs(queryset.select_related(*related))
    prefetches = {
        "issue_reactions": Prefetch("issue_reactions", queryset=IssueReaction.objects.select_related("actor")),
        "issue_link": Prefetch("issue_link", queryset=IssueLink.objects.select_related("created_by")),
        "assignees": "assignees",
        "labels": "labels",
    }
    for field, prefetch in prefetches.items():
        if field in expand:
            queryset = queryset.prefetch_related(prefetch)
    if "issue_attachments" in expand:
        queryset = queryset.prefetch_related(
            Prefetch(
                "assets",
                queryset=FileAsset.objects.filter(entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT),
                to_attr="detail_attachments",
            )
        )
    return queryset
