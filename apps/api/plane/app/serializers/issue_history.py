# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from .issue import IssueActivitySerializer, IssueCommentSerializer, IssueFlatSerializer, _activity_issue


class IssueHistorySummarySerializer(IssueFlatSerializer):
    class Meta(IssueFlatSerializer.Meta):
        fields = [
            field for field in IssueFlatSerializer.Meta.fields if field not in ("description_json", "description_html")
        ]


class IssueHistoryActivitySerializer(IssueActivitySerializer):
    def get_issue_detail(self, obj):
        issue = _activity_issue(obj)
        return IssueHistorySummarySerializer(issue).data if issue else None


class IssueHistoryCommentSerializer(IssueCommentSerializer):
    issue_detail = IssueHistorySummarySerializer(read_only=True, source="issue")
