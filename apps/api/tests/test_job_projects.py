"""Projects inside an experience entry, as every template prints them.

Each project gets one compact line — client (or the project's name when
there's no client) · domain · role — its dates, and its points, under the
role's own points. Only the parts a project has are printed; name and
technologies otherwise stay in the profile. A role with no projects renders
exactly as it did before projects existed.
"""
import html as htmllib
import re

import pytest
from app.services.pdf import ALLOWED_TEMPLATES, TEMPLATES_REQUIRING_PHOTO, generate_pdf, render_resume_html

from tests.test_pdf import trusted_settings, _with_trusted_photo  # noqa: F401

TEMPLATES = sorted(ALLOWED_TEMPLATES - TEMPLATES_REQUIRING_PHOTO)
PHOTO_TEMPLATES = sorted(TEMPLATES_REQUIRING_PHOTO)

ROLE = {
    "company": "Infosys", "title": "Senior Systems Engineer", "start": "Jun 2019", "end": "Present",
    "bullets": ["Mentored six new joiners."],
}
PROJECTS = [
    {   # A services-company engagement: every part.
        "client": "Barclays", "name": "Payments Hub", "domain": "Banking", "role": "Module Lead",
        "start": "Jan 2022", "end": "", "tech_stack": "Java, Spring Boot, Kafka",
        "bullets": ["Led the payments module for 12 developers.", "Cut settlement time by 30%."],
    },
    {   # No client or domain: the name leads.
        "name": "Order Tracker", "role": "Developer", "start": "Jun 2019", "end": "Dec 2021",
        "bullets": ["Built the order-tracking API."],
    },
    {   # Nothing but points.
        "bullets": ["Fixed the nightly batch."],
    },
]
CONTENT = {
    "contact": {"name": "Asha Rao", "email": "asha@example.com"},
    "experience": [{**ROLE, "projects": PROJECTS}],
    "education": [], "skills": [],
}


def _text(markup: str) -> str:
    body = re.sub(r"<style.*?</style>", " ", markup, flags=re.S)
    return " ".join(htmllib.unescape(re.sub(r"<[^>]+>", " ", body)).split())


def _check(markup: str) -> None:
    text = _text(markup)
    # One line per project from the parts it has, client first.
    assert re.search(r"Barclays · Banking · Module Lead \| Jan 2022 – Present", text)
    assert re.search(r"Order Tracker · Developer \| Jun 2019 – Dec 2021", text)
    # The name is the line's head only when there's no client; technologies never print.
    assert "Payments Hub" not in text
    assert "Kafka" not in text
    for point in ("Led the payments module", "Cut settlement time", "Built the order-tracking API", "Fixed the nightly batch"):
        assert point in text
    # The role's own points come first, then its projects in their order.
    assert text.index("Mentored six new joiners") < text.index("Barclays") < text.index("Order Tracker") < text.index("Fixed the nightly batch")
    # Every part is editable in place, addressed inside its role.
    for path in (
        "experience.0.projects.0.client", "experience.0.projects.0.domain", "experience.0.projects.0.role",
        "experience.0.projects.0.start", "experience.0.projects.0.end", "experience.0.projects.0.bullets.1",
        "experience.0.projects.1.name", "experience.0.projects.2.bullets.0",
    ):
        assert f'data-field="{path}"' in markup, path


@pytest.mark.parametrize("template_id", TEMPLATES)
def test_every_template_prints_a_roles_projects(template_id):
    _check(render_resume_html(CONTENT, template_id))


@pytest.mark.parametrize("template_id", PHOTO_TEMPLATES)
def test_the_photo_templates_print_them_too(template_id, avatar_store, trusted_settings):
    _check(render_resume_html(_with_trusted_photo(CONTENT, avatar_store), template_id))


@pytest.mark.parametrize("template_id", TEMPLATES)
def test_a_role_without_projects_renders_as_before(template_id):
    plain = {**CONTENT, "experience": [ROLE]}
    empty = {**CONTENT, "experience": [{**ROLE, "projects": []}]}
    assert render_resume_html(plain, template_id) == render_resume_html(empty, template_id)
    assert "job-project" not in render_resume_html(plain, template_id)


def test_projects_follow_their_role_when_roles_at_one_company_are_grouped():
    promoted = {**CONTENT, "experience": [
        {**ROLE, "title": "Technology Lead", "start": "Jan 2023", "projects": [PROJECTS[0]]},
        {**ROLE, "title": "Senior Systems Engineer", "start": "Jun 2019", "end": "Dec 2022", "projects": [PROJECTS[1]]},
    ]}
    markup = render_resume_html(promoted, "ats_clean")
    text = _text(markup)
    assert text.count("Infosys") == 1  # one company header for both roles
    assert text.index("Technology Lead") < text.index("Barclays") < text.index("Senior Systems Engineer") < text.index("Order Tracker")
    assert 'data-field="experience.1.projects.0.name"' in markup


def test_a_resume_with_projects_still_makes_a_pdf():
    assert generate_pdf(CONTENT, "ats_clean")[:4] == b"%PDF"


# ── Until tailoring knows about them, it carries them through untouched ──────

def test_tailoring_carries_a_roles_projects_through_unchanged():
    from app.services.tailoring import RewrittenBullet, WriterOutput, _apply_writer_output, _index_bullets

    indexed, _ = _index_bullets(CONTENT)
    writer = WriterOutput(
        rewritten_bullets=[RewrittenBullet(bullet_id="exp0_b0", rewritten_text="Mentored six new joiners to independence.")],
        updated_skills=[],
    )
    out = _apply_writer_output(indexed, writer)
    assert out["experience"][0]["bullets"] == ["Mentored six new joiners to independence."]
    assert out["experience"][0]["projects"] == PROJECTS
