"""A degree's short form written in full (services/degree_names.py). The
web's lib/degree-names.ts passes the same cases
(packages/types/degree-name-cases.json)."""
import json
import pathlib

import pytest

from app.services.degree_names import full_degree_name

CASES = json.loads(
    (pathlib.Path(__file__).parents[3] / "packages/types/degree-name-cases.json").read_text("utf-8")
)


@pytest.mark.parametrize("written,full", CASES["full"])
def test_a_short_form_is_written_in_full(written, full):
    assert full_degree_name(written) == full


@pytest.mark.parametrize("written", CASES["none"])
def test_nothing_is_offered_without_a_short_form(written):
    assert full_degree_name(written) is None


def test_the_full_name_is_already_in_full():
    for _, full in CASES["full"]:
        assert full_degree_name(full) is None
