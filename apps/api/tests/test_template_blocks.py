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

from app.services.pdf import ALLOWED_TEMPLATES, TEMPLATES_REQUIRING_PHOTO, render_resume_html

TEMPLATES = Path(__file__).resolve().parents[1] / "templates"


@pytest.mark.parametrize("template_id", sorted(ALLOWED_TEMPLATES))
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
