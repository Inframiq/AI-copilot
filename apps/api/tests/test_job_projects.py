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


# ── Phase 3: tailoring rewrites a role's projects' points too ────────────────

def test_project_points_get_their_own_ids_in_resume_order():
    from app.services.tailoring import _bullet_text, _collect_all_bullets, _index_bullets, _with_bullet

    content = {**CONTENT, "projects": [{"name": "Side app", "bullets": ["Built it."]}]}
    indexed, paths = _index_bullets(content)
    ids = [b["bullet_id"] for b in indexed["experience"][0]["bullets"]] + [
        b["bullet_id"] for p in indexed["experience"][0]["projects"] for b in p["bullets"]
    ] + [b["bullet_id"] for b in indexed["projects"][0]["bullets"]]
    assert ids == ["exp0_b0", "exp0_p0_b0", "exp0_p0_b1", "exp0_p1_b0", "exp0_p2_b0", "proj0_b0"]
    assert paths["exp0_p0_b1"] == "experience[0].projects[0].bullets[1]"
    assert _bullet_text(content, "exp0_p0_b1") == "Cut settlement time by 30%."
    assert _with_bullet(content, "exp0_p1_b0", "X")["experience"][0]["projects"][1]["bullets"] == ["X"]
    assert _collect_all_bullets(content)[1:3] == PROJECTS[0]["bullets"]
    # A key that doesn't resolve reads as nothing, and changes nothing.
    for bad in ("exp0_p9_b0", "exp0_p0_b9", "proj0_p0_b0", "exp1_b0", "nonsense"):
        assert _bullet_text(content, bad) is None
        assert _with_bullet(content, bad, "X") == content


def test_a_project_points_rewrite_is_guarded_and_patched_back_in_place():
    from app.services.tailoring import RewrittenBullet, WriterOutput, _apply_writer_output, _guard_writer_output, _index_bullets

    indexed, _ = _index_bullets(CONTENT)
    writer = WriterOutput(rewritten_bullets=[
        RewrittenBullet(bullet_id="exp0_p0_b0", rewritten_text="Led the payments module, coordinating 12 developers."),
        # Invents a number the original never had: kept, but flagged.
        RewrittenBullet(bullet_id="exp0_p1_b0", rewritten_text="Built the order-tracking API serving 5M requests a day."),
    ], updated_skills=[])
    guarded, flagged = _guard_writer_output(indexed, writer)
    assert [f["bullet_id"] for f in flagged] == ["exp0_p1_b0"]
    out = _apply_writer_output(indexed, guarded)
    projects = out["experience"][0]["projects"]
    assert projects[0]["bullets"] == ["Led the payments module, coordinating 12 developers.", "Cut settlement time by 30%."]
    # Nothing else about a project changes, and nothing moves between them.
    assert {k: v for k, v in projects[0].items() if k != "bullets"} == {k: v for k, v in PROJECTS[0].items() if k != "bullets"}
    assert projects[2]["bullets"] == ["Fixed the nightly batch."]
    assert out["experience"][0]["bullets"] == ["Mentored six new joiners."]


def test_the_prompts_say_how_to_treat_projects_inside_a_role():
    from app.services.tailoring import _AGENT2_SYSTEM, _build_agent3_system

    assert "PROJECTS INSIDE A ROLE" in _AGENT2_SYSTEM
    assert "never plan a change to a project's client" in " ".join(_AGENT2_SYSTEM.split())
    assert "14. PROJECT BULLETS" in _build_agent3_system(50)
