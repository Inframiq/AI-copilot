"""Editable regions in the rendered document carry the field they came from.

The Studio edits the rendered HTML in place, so each editable text node has to
say which part of resume_content produced it. Attributes only — WeasyPrint
ignores unknown ones, so the PDF must be unaffected.

Experience paths use the role's original index, not its position inside a
company group: templates iterate experience_groups, which merges adjacent
roles at the same employer.
"""
import re
import pytest
from app.services.pdf import render_resume_html

CONTENT = {
    "contact": {"name": "Jane Doe", "email": "jane@example.com", "photo_url": None},
    "summary": "Backend engineer.",
    "experience": [
        {"company": "Acme", "title": "Engineer", "start": "2019", "end": "2021",
         "bullets": ["Built the thing."]},
        {"company": "Acme", "title": "Senior Engineer", "start": "2021", "end": "2023",
         "bullets": ["Led the other thing."]},
        {"company": "Globex", "title": "Lead", "start": "2023", "end": "Present",
         "bullets": ["Ran the third thing."]},
    ],
    "education": [{"institution": "State University", "degree": "BS", "year": "2019"}],
    "skills": ["Python"],
}


def _html():
    return render_resume_html(CONTENT, "ats_clean")


def test_the_summary_is_addressable():
    assert 'data-field="summary"' in _html()


def test_each_experience_bullet_is_addressable():
    html = _html()
    assert 'data-field="experience.0.bullets.0"' in html
    assert 'data-field="experience.2.bullets.0"' in html


def test_a_grouped_role_uses_its_original_index_not_its_group_position():
    # Acme's second role is experience[1]. Inside its group it sits at
    # position 1 too, but Globex's only role is experience[2] — which a
    # group-relative index would have called 0.
    html = _html()
    assert 'data-field="experience.1.bullets.0"' in html
    assert 'data-field="experience.2.bullets.0"' in html


def test_job_titles_are_addressable():
    assert 'data-field="experience.2.title"' in _html()


def test_education_is_addressable():
    html = _html()
    assert 'data-field="education.0.institution"' in html
    assert 'data-field="education.0.degree"' in html


def test_every_data_field_uses_the_dot_path_format():
    # Guards against a stray "experience[0]" creeping in, which field-path.ts
    # would silently decline to resolve.
    for path in re.findall(r'data-field="([^"]+)"', _html()):
        assert re.fullmatch(r"[A-Za-z_]+(\.[A-Za-z_0-9]+)*", path), path


def test_annotating_does_not_change_the_rendered_text():
    text = re.sub(r"<[^>]+>", " ", _html())
    assert "Built the thing." in text
    assert "Jane Doe" in text
    assert "State University" in text
