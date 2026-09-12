# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from datetime import date

import pytest

from plane.app.serializers import IssueCreateSerializer
from plane.db.models import Issue


@pytest.mark.unit
@pytest.mark.parametrize(
    "payload,valid",
    [
        ({"start_date": "2026-09-21"}, False),
        ({"target_date": "2026-09-09"}, False),
        ({"start_date": "2026-09-20"}, True),
        ({"target_date": "2026-09-10"}, True),
        ({"start_date": None}, True),
        ({"target_date": None}, True),
        ({"start_date": "2026-10-01", "target_date": "2026-10-10"}, True),
        ({"start_date": "2026-10-10", "target_date": "2026-10-01"}, False),
    ],
)
def test_partial_update_validates_resulting_schedule(payload, valid):
    issue = Issue(name="Task", start_date=date(2026, 9, 10), target_date=date(2026, 9, 20))
    serializer = IssueCreateSerializer(issue, data=payload, partial=True, context={"project_id": issue.project_id})
    assert serializer.is_valid() is valid
    if not valid:
        assert "Start date cannot exceed target date" in str(serializer.errors)


@pytest.mark.unit
def test_unrelated_edit_does_not_revalidate_legacy_schedule():
    issue = Issue(name="Task", start_date=date(2026, 9, 20), target_date=date(2026, 9, 10))
    serializer = IssueCreateSerializer(issue, data={"name": "Renamed"}, partial=True)
    assert serializer.is_valid(), serializer.errors
