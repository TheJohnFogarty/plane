# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

"""Bounded, stable task history pages, including incremental refreshes."""

from uuid import UUID

from django.core import signing
from django.db.models import Q
from django.utils.dateparse import parse_datetime
from rest_framework.exceptions import ValidationError


def issue_history_page(queryset, request, serializer_class, issue_id):
    params = request.query_params
    kind = params.get("activity_type")
    scope = [str(issue_id), kind]
    direction = "older"
    timestamp = row_id = None
    try:
        limit = int(params.get("limit", 50))
        if not 1 <= limit <= 100:
            raise ValueError("Invalid limit")
        if params.get("cursor"):
            raw_time, raw_id, direction, cursor_scope = signing.loads(params["cursor"], salt="issue-history")
            if cursor_scope != scope or direction not in ("older", "newer"):
                raise ValueError("Invalid cursor")
            timestamp, row_id = parse_datetime(raw_time), UUID(raw_id)
        elif params.get("after"):
            direction = "newer"
            timestamp, row_id = parse_datetime(params["after"]), UUID(params["after_id"])
        if (params.get("cursor") or params.get("after")) and timestamp is None:
            raise ValueError("Invalid timestamp")
    except (ValueError, TypeError, KeyError, signing.BadSignature) as exc:
        raise ValidationError({"cursor": "Invalid history pagination parameters."}) from exc

    if timestamp is not None:
        comparison = "lt" if direction == "older" else "gt"
        queryset = queryset.filter(
            Q(**{f"created_at__{comparison}": timestamp}) | Q(created_at=timestamp, **{f"id__{comparison}": row_id})
        )
    prefix = "-" if direction == "older" else ""
    rows = list(queryset.order_by(f"{prefix}created_at", f"{prefix}id")[: limit + 1])
    has_more = len(rows) > limit
    rows = rows[:limit]
    cursor = None
    if has_more:
        last = rows[-1]
        cursor = signing.dumps([last.created_at.isoformat(), str(last.id), direction, scope], salt="issue-history")
    if direction == "older":
        rows.reverse()
    return {"results": serializer_class(rows, many=True).data, "next_cursor": cursor}
