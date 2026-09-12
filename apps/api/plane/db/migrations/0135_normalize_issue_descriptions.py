# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.db import migrations

from plane.utils.description_normalization import normalize_description_html, normalize_description_json
from plane.utils.html_processor import strip_tags


def normalize_issue_descriptions(apps, schema_editor):
    Issue = apps.get_model("db", "Issue")
    issues = Issue._base_manager.using(schema_editor.connection.alias)
    for issue in issues.only("pk", "description_html", "description_json").iterator(chunk_size=500):
        html = normalize_description_html(issue.description_html)
        document = normalize_description_json(issue.description_json)
        if html == issue.description_html and document == issue.description_json:
            continue
        # Avoid overwriting a description edited while this migration runs.
        issues.filter(
            pk=issue.pk,
            description_html=issue.description_html,
            description_json=issue.description_json,
        ).update(description_html=html, description_json=document, description_stripped=strip_tags(html))


class Migration(migrations.Migration):
    atomic = False
    dependencies = [("db", "0134_issue_color")]
    operations = [migrations.RunPython(normalize_issue_descriptions, migrations.RunPython.noop)]
