"""Editable regions in the rendered document carry the field they came from.

The Studio edits the rendered HTML in place, so each editable text node has to
say which part of resume_content produced it. Attributes only — WeasyPrint
ignores unknown ones, so the PDF must be unaffected.

Experience paths use the role's original index, not its position inside a
company group: templates iterate experience_groups, which merges adjacent
roles at the same employer.
"""
import html as htmllib
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
# photo, which needs the avatar_store fixture (conftest.py). They get their own
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


# ---------------------------------------------------------------------------
# experience.location: optional, so every template has to render it when it is
# there and leave no orphaned separator behind when it is not. Both branches of
# the experience macro are covered — a standalone role, and two roles at one
# employer, where the company becomes a header and the location belongs on the
# role's own line instead.
# ---------------------------------------------------------------------------

LOCATED = {
    **CONTENT,
    "experience": [
        {"company": "Solo Co", "title": "Lead", "location": "London, UK",
         "start": "2022", "end": "Present", "bullets": ["Did a thing."]},
        {"company": "Grouped Inc", "title": "Senior", "location": "Berlin, DE",
         "start": "2020", "end": "2022", "bullets": ["Did another."]},
        {"company": "Grouped Inc", "title": "Junior", "location": "Remote",
         "start": "2018", "end": "2020", "bullets": ["Did a third."]},
    ],
}
UNLOCATED = {
    **LOCATED,
    "experience": [
        {k: v for k, v in job.items() if k != "location"}
        for job in LOCATED["experience"]
    ],
}


def _visible_text(markup: str) -> str:
    """Tags stripped and entities decoded — the templates write the separator
    as &middot;, which a tag-strip alone leaves as the literal seven
    characters rather than the character a reader sees."""
    return htmllib.unescape(re.sub(r"<[^>]+>", " ", markup))


@pytest.mark.parametrize("template_id", TEMPLATES)
def test_every_template_prints_the_role_location(template_id):
    html = render_resume_html(LOCATED, template_id)
    text = _visible_text(html)
    for place in ("London, UK", "Berlin, DE", "Remote"):
        assert place in text, f"{template_id} dropped {place!r}"


@pytest.mark.parametrize("template_id", TEMPLATES)
def test_the_location_is_editable_including_on_a_grouped_role(template_id):
    """A grouped role (promotion at one employer) renders the company once as
    a header, so its location has to hang off the role line — the index has to
    be the role's own, not the group's."""
    html = render_resume_html(LOCATED, template_id)
    paths = set(re.findall(r'data-field="(experience\.\d+\.location)"', html))
    assert paths == {
        "experience.0.location",
        "experience.1.location",
        "experience.2.location",
    }, f"{template_id}: {sorted(paths)}"


@pytest.mark.parametrize("template_id", TEMPLATES)
def test_a_role_without_a_location_leaves_no_separator_behind(template_id):
    """The separator sits outside the conditional, so omitting the location
    has to omit the separator with it.

    Counted rather than asserted absent: some templates use a middot as their
    own contact/meta separator, so "no middot anywhere" would fail them for
    punctuation that has nothing to do with this. Three located roles must add
    exactly three separators.
    """
    located = _visible_text(render_resume_html(LOCATED, template_id))
    bare = _visible_text(render_resume_html(UNLOCATED, template_id))
    assert located.count("·") - bare.count("·") == 3, (
        f"{template_id}: {bare.count(chr(0xb7))} separators without a location, "
        f"{located.count(chr(0xb7))} with three"
    )
    assert "None" not in bare


@pytest.mark.parametrize("template_id", TEMPLATES)
def test_the_separator_is_not_part_of_the_editable_location(template_id):
    """Inside the span, the Studio would hand back a field beginning with a
    middot and save the punctuation as part of the location."""
    html = render_resume_html(LOCATED, template_id)
    for value in re.findall(r'data-field="experience\.\d+\.location"[^>]*>([^<]*)<', html):
        assert "·" not in value
        assert value == value.strip()


@pytest.mark.parametrize("template_id", PHOTO_TEMPLATES)
def test_the_photo_templates_print_the_location_too(template_id, avatar_store, trusted_settings):
    html = render_resume_html(_with_trusted_photo(LOCATED, avatar_store), template_id)
    assert "London, UK" in _visible_text(html)
    assert 'data-field="experience.2.location"' in html


@pytest.mark.parametrize("template_id", PHOTO_TEMPLATES)
def test_the_photo_templates_are_addressable_too(template_id, avatar_store, trusted_settings):
    """Same annotation, but these two need a real photo to render at all."""
    html = render_resume_html(_with_trusted_photo(CONTENT, avatar_store), template_id)
    assert 'data-field="summary"' in html
    assert 'data-field="experience.2.bullets.0"' in html
