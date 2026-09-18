"""Guards on the parse prompt's worked examples.

A schema example is the strongest instruction in a prompt: the model fills in
obvious placeholders but *keeps* an example that reads like a real answer.
"English / Native" shipped on résumés that never mentioned a language,
because the schema said so.
"""
import re

from app.services.resume_parser import PARSE_SYSTEM


def test_the_language_example_is_not_a_plausible_answer():
    # A concrete, believable pair here gets copied through verbatim.
    assert '"name": "English"' not in PARSE_SYSTEM
    assert '"level": "Native"' not in PARSE_SYSTEM


def test_languages_are_only_taken_from_the_resume():
    assert re.search(r"languages.{0,400}never infer", PARSE_SYSTEM, re.I | re.S)


def test_an_unstated_level_stays_null():
    assert re.search(r"level.{0,200}null", PARSE_SYSTEM, re.I | re.S)


def test_the_no_invention_rule_still_covers_gpa():
    # The rule that already existed; this test exists so the edit above does
    # not quietly remove it.
    assert "never invent a value" in PARSE_SYSTEM


# ── A language whose level we were not told ─────────────────────────────────

import pytest

from app.services.pdf import render_resume_html

_CONTENT = {
    "contact": {"name": "A", "photo_url": None},
    "summary": "S",
    "experience": [],
    "education": [],
    "skills": ["Python"],
    "languages": [{"name": "Telugu", "level": None}],
}


@pytest.mark.parametrize("template", ["ats_clean", "ats_modern", "ats_minimal"])
def test_an_unknown_level_renders_nothing_at_all(template):
    """Not "(None)", not "()" — the level simply is not there to show.

    Jinja prints None as the word "None", so an unguarded {{ l.level }} puts
    "Telugu (None)" on a résumé.
    """
    html = render_resume_html(_CONTENT, template)
    assert "Telugu" in html
    assert "None" not in html
    assert "()" not in html.replace(" ", "")


def test_an_unknown_level_draws_no_proficiency_bar(monkeypatch):
    # The sidebar maps a level onto a bar width and falls back to 60%. Drawing
    # a bar for a level nobody stated invents the claim in picture form.
    import app.services.pdf as pdf

    monkeypatch.setattr(pdf, "_sanitize_resume_content", lambda c: c)
    content = {**_CONTENT, "contact": {"name": "A", "photo_url": "data:image/gif;base64,R0lGODlhAQABAAAAACw="}}
    html = pdf.render_resume_html(content, "ats_sidebar")
    # The class name also appears in the <style> block, so look at the body.
    body = re.sub(r"(?s)<style.*?</style>", "", html)
    assert "Telugu" in body
    assert "lang-bar-fill" not in body
