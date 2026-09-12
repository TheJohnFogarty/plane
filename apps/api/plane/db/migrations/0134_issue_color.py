# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.core.validators import RegexValidator
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("db", "0133_github_repository_unique_project_repository_id")]
    operations = [
        migrations.AddField(
            model_name="issue",
            name="color",
            field=models.CharField(
                max_length=7,
                blank=True,
                default="",
                validators=[RegexValidator(r"^#[0-9a-fA-F]{6}$", "Enter a six-digit hex color.")],
            ),
        ),
    ]
