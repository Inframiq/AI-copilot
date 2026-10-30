"""A phone number is written one standard way — the cases the forms are
tested against too (packages/types/phone-cases.json)."""
import json
import pathlib

import pytest

from app.services.phone import tidy_phone

CASES = json.loads((pathlib.Path(__file__).parents[3] / "packages/types/phone-cases.json").read_text("utf-8"))


@pytest.mark.parametrize("raw, tidy", CASES["tidy"])
def test_a_phone_is_written_the_standard_way(raw, tidy):
    assert tidy_phone(raw) == tidy
    # Already standard stays standard.
    assert tidy_phone(tidy) == tidy


@pytest.mark.parametrize("raw", CASES["unchanged"])
def test_anything_but_one_plain_number_is_left_as_written(raw):
    assert tidy_phone(raw) == raw


def test_no_country_code_is_the_start_of_another():
    # What lets a code be read off a number run together.
    from app.services.phone import COUNTRY_CODES
    assert not [(a, b) for a in COUNTRY_CODES for b in COUNTRY_CODES if a != b and b.startswith(a)]
