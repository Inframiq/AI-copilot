"""Every template prints an education entry's GPA (labelled when the value
alone wouldn't say what it is) and honors, each editable in the Studio
without taking the institution with it."""
import html as htmllib
import re

import pytest
from app.services.ats import build_resume_text
from app.services.pdf import ALLOWED_TEMPLATES, TEMPLATES_REQUIRING_PHOTO, _gpa_label, render_resume_html

from tests.test_pdf import trusted_settings, _with_trusted_photo  # noqa: F401

TEMPLATES = sorted(ALLOWED_TEMPLATES - TEMPLATES_REQUIRING_PHOTO)
PHOTO_TEMPLATES = sorted(TEMPLATES_REQUIRING_PHOTO)
CONTENT = {
    "contact": {"name": "Asha Rao", "email": "asha@example.com"},
    "experience": [],
    "education": [
        {"institution": "GITAM", "degree": "B.Tech in CSE", "year": "2019", "gpa": "8.6/10", "honors": "First Class with Distinction"},
        {"institution": "Narayana Junior College", "degree": "Class XII", "year": "2015", "gpa": "92%"},
        {"institution": "IIT Madras", "degree": "M.Tech", "year": "2021"},
    ],
    "skills": [],
}


def _text(markup: str) -> str:
    body = re.sub(r"<style.*?</style>", " ", markup, flags=re.S)
    return " ".join(htmllib.unescape(re.sub(r"<[^>]+>", " ", body)).split())


def _check(markup: str) -> None:
    text = _text(markup)
    assert "GPA 8.6/10" in text
    assert "First Class with Distinction" in text
    assert "92%" in text and "GPA 92%" not in text
    # An entry with neither prints no stray separator after its year.
    assert not re.search(r"IIT Madras\W*[·|]\s*$", text)
    for path in ("education.0.gpa", "education.0.honors", "education.1.gpa", "education.0.institution"):
        assert f'data-field="{path}"' in markup, path
    # The institution's own editable text is just the institution.
    inst = re.search(r'data-field="education\.0\.institution"[^>]*>([^<]*)<', markup).group(1)
    assert inst.strip() == "GITAM"
    assert 'data-field="education.2.honors"' not in markup


@pytest.mark.parametrize("template_id", TEMPLATES)
def test_every_template_prints_gpa_and_honors(template_id):
    _check(render_resume_html(CONTENT, template_id))


@pytest.mark.parametrize("template_id", PHOTO_TEMPLATES)
def test_the_photo_templates_print_them_too(template_id, avatar_store, trusted_settings):
    _check(render_resume_html(_with_trusted_photo(CONTENT, avatar_store), template_id))


@pytest.mark.parametrize("value, label", [
    ("8.6", "GPA "), ("3.9/4.0", "GPA "), ("8.6/10", "GPA "),
    ("85%", ""), ("CGPA 8.6", ""), ("First Class", ""), ("", ""), (None, ""),
])
def test_a_bare_grade_is_labelled_gpa(value, label):
    assert _gpa_label(value) == label


def test_honors_count_as_resume_text():
    full_text, _ = build_resume_text(CONTENT)
    assert "First Class with Distinction" in full_text
