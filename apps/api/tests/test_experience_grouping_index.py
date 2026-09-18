"""Grouped roles remember where they came from in resume_content.

Templates iterate experience_groups, not experience, and grouping merges
adjacent roles at the same company. So a role's position inside a group says
nothing about its index in resume_content — and the Studio's data-field
attributes address bullets by that index. Without the original index carried
through, editing a bullet on the second company would write to the first.
"""
from app.services.pdf import _group_experience_by_company

EXPERIENCE = [
    {"company": "Acme", "title": "Engineer", "bullets": ["a"]},
    {"company": "Acme", "title": "Senior Engineer", "bullets": ["b"]},
    {"company": "Globex", "title": "Lead", "bullets": ["c"]},
]


def test_each_role_carries_its_index_in_the_original_list():
    groups = _group_experience_by_company(EXPERIENCE)
    assert [r["_index"] for r in groups[0]["roles"]] == [0, 1]
    assert [r["_index"] for r in groups[1]["roles"]] == [2]


def test_a_single_role_group_still_carries_its_index():
    groups = _group_experience_by_company([{"company": "Solo", "bullets": []}])
    assert groups[0]["roles"][0]["_index"] == 0


def test_grouping_does_not_mutate_the_caller_s_entries():
    # The entries are resume_content's own dicts; stamping an index onto them
    # in place would leak a render detail into stored resume data.
    source = [dict(e) for e in EXPERIENCE]
    _group_experience_by_company(source)
    assert all("_index" not in e for e in source)


def test_the_role_content_is_otherwise_unchanged():
    groups = _group_experience_by_company(EXPERIENCE)
    role = groups[1]["roles"][0]
    assert role["company"] == "Globex" and role["bullets"] == ["c"]


def test_an_empty_list_groups_to_nothing():
    assert _group_experience_by_company([]) == []
