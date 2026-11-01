"""Each role reaches the template as its own entry, remembering where it
came from in resume_content.

The Studio's data-field attributes address bullets by that index, so
editing a bullet must write back to the role it was shown under.

Roles at the same company are no longer grouped under one company header
(2026-11-01): the ATS reference wants each job as one line — title,
company, location, dates — and the grouped form put a promotion's earlier
role several lines from its company in the extracted text.
"""
from app.services.pdf import _experience_entries

EXPERIENCE = [
    {"company": "Acme", "title": "Engineer", "bullets": ["a"]},
    {"company": "Acme", "title": "Senior Engineer", "bullets": ["b"]},
    {"company": "Globex", "title": "Lead", "bullets": ["c"]},
]


def test_each_role_is_its_own_entry_with_its_index():
    entries = _experience_entries(EXPERIENCE)
    assert [e["_index"] for e in entries] == [0, 1, 2]
    assert [e["company"] for e in entries] == ["Acme", "Acme", "Globex"]


def test_entries_do_not_mutate_the_caller_s_dicts():
    # The entries are resume_content's own dicts; stamping an index onto them
    # in place would leak a render detail into stored resume data.
    source = [dict(e) for e in EXPERIENCE]
    _experience_entries(source)
    assert all("_index" not in e for e in source)


def test_the_role_content_is_otherwise_unchanged():
    role = _experience_entries(EXPERIENCE)[2]
    assert role["company"] == "Globex" and role["bullets"] == ["c"]


def test_an_empty_list_is_no_entries():
    assert _experience_entries([]) == []
    assert _experience_entries(None) == []
