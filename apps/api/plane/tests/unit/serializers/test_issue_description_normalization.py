# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from importlib import import_module

import pytest
from django.db import connection
from django.db.migrations.loader import MigrationLoader
from django.test import override_settings

from plane.app.serializers import IssueCreateSerializer
from plane.db.models import Issue, Project
from plane.utils.description_normalization import normalize_description_html, normalize_description_json


IMAGE = '<image-component src="asset-id" width="350px" height="auto"></image-component>'
EMPTY = '<p class="editor-paragraph-block" data-id="blank"></p>'


@pytest.mark.unit
@pytest.mark.parametrize(
    "value,expected",
    [
        (IMAGE + EMPTY * 10, IMAGE),
        ("<p>Instructions</p>" + EMPTY * 13, "<p>Instructions</p>"),
        ("<p>Before</p>" + EMPTY + "<p>After</p>" + EMPTY, "<p>Before</p>" + EMPTY + "<p>After</p>"),
        (IMAGE + "<p><strong> &nbsp; </strong><br></p>", IMAGE),
        ("<p><img src='asset-id'></p>" + EMPTY, "<p><img src='asset-id'></p>"),
        (
            '<p><span data-type="mention" data-id="user"></span></p>' + EMPTY,
            '<p><span data-type="mention" data-id="user"></span></p>',
        ),
        ('<p><a href="https://example.com"></a></p>' + EMPTY, '<p><a href="https://example.com"></a></p>'),
        ("<pre>\n\n</pre>" + EMPTY, "<pre>\n\n</pre>"),
        ("<table><tr><td><p></p></td></tr></table>" + EMPTY, "<table><tr><td><p></p></td></tr></table>"),
        ("<p>Do not rewrite &nbsp; &#38;</p>\n\n" + EMPTY, "<p>Do not rewrite &nbsp; &#38;</p>"),
        ("<p>Line\rbreak</p>\r\n" + EMPTY, "<p>Line\rbreak</p>"),
        ("<p>Text</p>", "<p>Text</p>"),
        (EMPTY * 10, "<p></p>"),
        (" \n\t", "<p></p>"),
        (None, "<p></p>"),
    ],
)
def test_trailing_paragraph_cleanup_preserves_meaningful_content(value, expected):
    result = normalize_description_html(value)
    assert result == expected
    assert normalize_description_html(result) == result


@pytest.mark.unit
def test_json_cleanup_preserves_images_mentions_and_interior_spacing():
    image = {"type": "imageComponent", "attrs": {"src": "asset-id"}}
    empty = {"type": "paragraph"}
    mention = {"type": "paragraph", "content": [{"type": "mention", "attrs": {"id": "user"}}]}
    document = {"type": "doc", "content": [image, empty, mention, empty, empty]}
    assert normalize_description_json(document) == {"type": "doc", "content": [image, empty, mention]}
    assert len(document["content"]) == 5
    assert normalize_description_json({"type": "doc", "content": [empty] * 10}) == {"type": "doc", "content": [empty]}
    assert normalize_description_json({}) == {}


@pytest.mark.unit
@pytest.mark.django_db
def test_create_update_and_partial_save_normalize_descriptions(workspace):
    project = Project.objects.create(name="Descriptions", identifier="DESC", workspace=workspace)
    issue = Issue.objects.create(
        name="Image task", project=project, workspace=workspace, description_html=IMAGE + EMPTY * 10
    )
    issue.refresh_from_db()
    assert issue.description_html == IMAGE

    serializer = IssueCreateSerializer(issue, data={"description_html": "<p>Notes</p>" + EMPTY * 10}, partial=True)
    assert serializer.is_valid(), serializer.errors
    serializer.save()
    issue.refresh_from_db()
    assert issue.description_html == "<p>Notes</p>"
    assert issue.description_stripped == "Notes"

    issue.description_html = "<p>Updated</p>" + EMPTY
    issue.save(update_fields=["description_html"])
    issue.refresh_from_db()
    assert issue.description_html == "<p>Updated</p>"
    assert issue.description_stripped == "Updated"


@pytest.mark.unit
@pytest.mark.django_db
def test_migration_cleans_existing_descriptions_without_changing_edit_timestamp(workspace):
    project = Project.objects.create(name="Manufacturing", identifier="MANU", workspace=workspace)
    issue = Issue.objects.create(name="26C-SHT-P009", project=project, workspace=workspace)
    Issue.objects.filter(pk=issue.pk).update(description_html=IMAGE + EMPTY * 10)
    original_updated_at = issue.updated_at
    migration = import_module("plane.db.migrations.0135_normalize_issue_descriptions")
    with override_settings(MIGRATION_MODULES={}):
        historical_apps = MigrationLoader(connection).project_state(("db", "0134_issue_color")).apps
    with connection.schema_editor() as schema_editor:
        migration.normalize_issue_descriptions(historical_apps, schema_editor)
    issue.refresh_from_db()
    assert issue.description_html == IMAGE
    assert issue.updated_at == original_updated_at
