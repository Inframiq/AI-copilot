"""plain_text(): the shared cases, and the walk over saved content."""
import json
import pathlib

import pytest

from app.services.plain_text import plain_deep, plain_text

_CASES = json.loads(
    (pathlib.Path(__file__).parents[3] / "packages/types/plain-text-cases.json").read_text("utf8")
)["cases"]


@pytest.mark.parametrize(("raw", "plain"), _CASES)
def test_the_shared_cases(raw, plain):
    assert plain_text(raw) == plain


@pytest.mark.parametrize(("raw", "plain"), _CASES)
def test_cleaning_twice_changes_nothing(raw, plain):
    assert plain_text(plain) == plain


def test_every_string_in_nested_content_is_cleaned_and_nothing_else_moves():
    content = {
        "contact": {"name": "Jane\u00a0Doe", "photo_url": None},
        "experience": [{"bullets": ["Cut cost \u2014 by 20%", "\u201cOwned\u201d it"], "projects": []}],
        "line_spacing": 1.25,
        "skills": [],
    }
    assert plain_deep(content) == {
        "contact": {"name": "Jane Doe", "photo_url": None},
        "experience": [{"bullets": ["Cut cost - by 20%", "\"Owned\" it"], "projects": []}],
        "line_spacing": 1.25,
        "skills": [],
    }
