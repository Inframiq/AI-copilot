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

# Imported so pytest can see them as fixtures here; the photo templates
# need the same trusted-host + mocked-fetch setup test_pdf.py uses.
from tests.test_pdf import trusted_settings, _with_trusted_photo  # noqa: F401

CONTENT = {
    "contact": {"name": "Jane Doe", "email": "jane@example.com"},
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


# The photo templates refuse to render without a trusted, successfully-fetched
# photo, which needs test_pdf.py's httpx_mock machinery. They get their own
# test below rather than dragging that into every case. Both lists are derived
# from the allowlist, so a newly added template is covered by this contract
# the day it lands rather than whenever someone remembers to add it here.
from app.services.pdf import ALLOWED_TEMPLATES, TEMPLATES_REQUIRING_PHOTO  # noqa: E402

TEMPLATES = sorted(ALLOWED_TEMPLATES - TEMPLATES_REQUIRING_PHOTO)
PHOTO_TEMPLATES = sorted(TEMPLATES_REQUIRING_PHOTO)


def _html(template_id="ats_clean"):
    return render_resume_html(CONTENT, template_id)


@pytest.mark.parametrize("template_id", TEMPLATES)
def test_the_summary_is_addressable(template_id):
    assert 'data-field="summary"' in _html(template_id)


@pytest.mark.parametrize("template_id", TEMPLATES)
def test_each_experience_bullet_is_addressable(template_id):
    html = _html(template_id)
    assert 'data-field="experience.0.bullets.0"' in html
    assert 'data-field="experience.2.bullets.0"' in html


@pytest.mark.parametrize("template_id", TEMPLATES)
def test_a_grouped_role_uses_its_original_index_not_its_group_position(template_id):
    # Acme's second role is experience[1]. Inside its group it sits at
    # position 1 too, but Globex's only role is experience[2] — which a
    # group-relative index would have called 0.
    html = _html(template_id)
    assert 'data-field="experience.1.bullets.0"' in html
    assert 'data-field="experience.2.bullets.0"' in html


@pytest.mark.parametrize("template_id", TEMPLATES)
def test_job_titles_are_addressable(template_id):
    assert 'data-field="experience.2.title"' in _html(template_id)


@pytest.mark.parametrize("template_id", TEMPLATES)
def test_education_is_addressable(template_id):
    html = _html(template_id)
    assert 'data-field="education.0.institution"' in html
    assert 'data-field="education.0.degree"' in html


@pytest.mark.parametrize("template_id", TEMPLATES)
def test_every_data_field_uses_the_dot_path_format(template_id):
    # Guards against a stray "experience[0]" creeping in, which field-path.ts
    # would silently decline to resolve.
    for path in re.findall(r'data-field="([^"]+)"', _html(template_id)):
        assert re.fullmatch(r"[A-Za-z_]+(\.[A-Za-z_0-9]+)*", path), path


@pytest.mark.parametrize("template_id", TEMPLATES)
def test_annotating_does_not_change_the_rendered_text(template_id):
    text = re.sub(r"<[^>]+>", " ", _html(template_id))
    assert "Built the thing." in text
    assert "State University" in text
    # Not the name: ats_minimal renders it through | upper.
    assert "Backend engineer." in text


@pytest.mark.parametrize("template_id", PHOTO_TEMPLATES)
def test_the_photo_templates_are_addressable_too(template_id, httpx_mock, trusted_settings):
    """Same annotation, but these two need a real photo to render at all."""
    html = render_resume_html(_with_trusted_photo(CONTENT, httpx_mock), template_id)
    assert 'data-field="summary"' in html
    assert 'data-field="experience.2.bullets.0"' in html
