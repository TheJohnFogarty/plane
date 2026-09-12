# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from bs4 import BeautifulSoup, Comment, NavigableString, Tag


def normalize_description_html(value: str | None) -> str:
    """Trim trailing blank paragraphs without rewriting retained HTML.

    Only ordinary formatting and breaks count as empty. Images, mentions,
    embeds, links, and unknown nodes must survive even when they have no text.
    Used by migration 0135; preserve this normalization contract.
    """
    if not value or not value.strip():
        return "<p></p>"

    soup = BeautifulSoup(value, "html.parser")
    first_removed = None
    formatting_tags = {"p", "span", "strong", "b", "em", "i", "u", "s", "strike", "br"}
    formatting_attrs = {"class", "style", "data-id"}
    for node in reversed(soup.contents):
        if isinstance(node, NavigableString) and not isinstance(node, Comment) and not node.strip():
            continue
        if not isinstance(node, Tag) or node.name != "p" or node.get_text().strip():
            break
        if any(
            tag.name not in formatting_tags or set(tag.attrs) - formatting_attrs for tag in [node, *node.find_all(True)]
        ):
            break
        first_removed = node

    if first_removed is None:
        return value
    # html.parser records the opening tag's source position. Slice the original
    # string so image attributes, entities, and interior whitespace stay exact.
    lines = value.split("\n")
    offset = sum(len(line) + 1 for line in lines[: first_removed.sourceline - 1]) + first_removed.sourcepos
    return value[:offset].rstrip() or "<p></p>"


def normalize_description_json(value: dict) -> dict:
    """Apply the same trailing-paragraph rule to a Tiptap document."""
    if not isinstance(value, dict) or value.get("type") != "doc" or not isinstance(value.get("content"), list):
        return value
    content = value["content"]
    end = len(content)
    while end:
        node = content[end - 1]
        if not isinstance(node, dict) or node.get("type") != "paragraph":
            break
        children = node.get("content", [])
        if not isinstance(children, list) or any(
            not isinstance(child, dict)
            or not (
                child.get("type") == "hardBreak"
                or (child.get("type") == "text" and not child.get("text", "").strip() and not child.get("marks"))
            )
            for child in children
        ):
            break
        end -= 1
    if end == len(content):
        return value
    return {**value, "content": content[:end] or [{"type": "paragraph"}]}
