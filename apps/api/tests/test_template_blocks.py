"""Every template draws its sections from templates/_blocks.html.

A template owns its look (style, header, a small style table); the sections
themselves are written once, so a fix reaches every template. Before
2026-11-01 each template carried its own copy of every section, and they
drifted: Modern, Minimal, Professional and Sidebar printed project bullets
the Studio could not edit, and no template let the objective be edited.
"""
import re
from pathlib import Path

import pytest

from app.services.pdf import ALLOWED_TEMPLATES, TEMPLATE_FILES, TEMPLATES_REQUIRING_PHOTO, render_resume_html

TEMPLATES = Path(__file__).resolve().parents[1] / "templates"


@pytest.mark.parametrize("template_id", sorted(set(ALLOWED_TEMPLATES) - set(TEMPLATE_FILES)))
def test_the_template_uses_the_shared_sections(template_id):
    source = (TEMPLATES / f"{template_id}.html").read_text(encoding="utf-8")
    assert '{% import "_blocks.html" as blocks with context %}' in source
    assert "blocks.sections(" in source
    # No section of its own: those are what drifted.
    assert "{% macro" not in source
    assert "experience_entries" not in source and "<table class=\"bullets\">" not in source


CONTENT = {
    "contact": {"name": "Jane Doe", "email": "j@x.com", "photo_url": "data:image/gif;base64,R0lGODlhAQABAAAAACw="},
    "objective": "Final-year student seeking a backend internship.",
    "experience": [{"title": "Intern", "company": "Acme", "start": "Jun 2025", "end": "Aug 2025", "bullets": ["Built it."]}],
    "projects": [{"name": "Ledger", "bullets": ["Wrote the sync engine."]}],
    "education": [{"degree": "B.Tech", "institution": "AU", "year": "2026"}],
    "skills": ["Python"],
    "coursework": ["Data Structures", "Operating Systems"],
}


@pytest.mark.parametrize("template_id", sorted(ALLOWED_TEMPLATES))
def test_every_section_is_editable_in_every_template(template_id, monkeypatch):
    from app.services import pdf as P
    monkeypatch.setattr(P, "_sanitize_resume_content", lambda c: (c, P.PHOTO_EMBEDDED))
    content = CONTENT if template_id in TEMPLATES_REQUIRING_PHOTO else {**CONTENT, "contact": {"name": "Jane Doe", "email": "j@x.com"}}
    fields = set(re.findall(r'data-field="([^"]+)"', render_resume_html(content, template_id)))
    for path in ("objective", "experience.0.title", "experience.0.bullets.0", "projects.0.name",
                 "projects.0.bullets.0", "education.0.degree", "coursework.0", "coursework.1"):
        assert path in fields, path


# ── The two sets ────────────────────────────────────────────────────────────

def _headings(html):
    return [h.strip() for h in re.findall(r"<h2>([^<]+)</h2>", html)]


STUDENT = {
    "contact": {"name": "Asha", "email": "a@x.com"},
    "objective": "Final-year student seeking a backend internship.",
    "experience": [{"title": "Software Engineering Intern", "company": "Acme", "start": "May 2026", "end": "Jul 2026", "bullets": ["Built it."]}],
    "projects": [{"name": "Ledger", "bullets": ["Wrote it."]}],
    "education": [{"degree": "B.Tech", "institution": "AU", "year": "2027", "gpa": "8.7/10"}],
    "skills": ["Python"], "coursework": ["DBMS"], "leadership": ["Club lead"], "awards": ["Finalist"],
}


@pytest.mark.parametrize("template_id", sorted(TEMPLATE_FILES))
def test_a_student_template_puts_education_first_and_heads_internships(template_id):
    from app.services.pdf import TEMPLATE_SETS
    assert TEMPLATE_SETS[template_id] == "student"
    heads = [h.lower() for h in _headings(render_resume_html(STUDENT, template_id))]
    assert heads[:7] == ["objective", "education", "internships", "projects",
                         heads[4], "coursework", "leadership"], heads
    assert heads[4] in ("skills", "technical skills")


def test_internships_only_when_every_role_is_one():
    mixed = {**STUDENT, "experience": STUDENT["experience"] + [{"title": "Engineer", "company": "B", "start": "2020", "end": "2021", "bullets": []}]}
    heads = [h.lower() for h in _headings(render_resume_html(mixed, "student_clean"))]
    assert "experience" in heads and "internships" not in heads


def test_the_professional_twin_keeps_its_own_order():
    heads = [h.lower() for h in _headings(render_resume_html(STUDENT, "ats_clean"))]
    assert heads.index("experience") < heads.index("education")
    assert "internships" not in heads


def test_a_resumes_own_order_still_wins():
    ordered = {**STUDENT, "section_order": ["skills", "summary_or_objective", "education"]}
    assert [h.lower() for h in _headings(render_resume_html(ordered, "student_clean"))] == ["skills", "objective", "education"]
