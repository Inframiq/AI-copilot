"""Heading and body text size, as three steps either side of the default.

The templates hardcoded every size. "Standard" is those numbers unchanged —
they are already inside the 10–12pt band résumé guidance asks for — and the
two other steps move a point either way.

Headings and content scale independently: shrinking the body to win back a
page should not shrink the section labels with it.
"""
import re
import pytest

import app.services.pdf as pdf_service
from app.services.pdf import render_resume_html, ALLOWED_TEMPLATES


@pytest.fixture(autouse=True)
def _keep_the_photo(monkeypatch):
    """The photo templates refuse to render without one, and the sanitiser
    only keeps a photo it can fetch from storage. Neither is what these tests
    are about."""
    monkeypatch.setattr(
        pdf_service, "_sanitize_resume_content", lambda c: (c, pdf_service.PHOTO_EMBEDDED)
    )

CONTENT = {
    "contact": {"name": "Jane Doe", "email": "j@x.com", "phone": "+1 555",
                "location": "Austin", "photo_url": "data:image/gif;base64,R0lGODlhAQABAAAAACw="},
    "summary": "Analyst.",
    "experience": [{"title": "Engineer", "company": "Acme", "start": "2023", "end": "Present",
                    "bullets": ["Shipped things."]}],
    "education": [{"degree": "BS", "institution": "UT", "year": "2022"}],
    "skills": ["Python"],
    "languages": [{"name": "English", "level": "Fluent"}],
}


def sizes(html: str) -> set[float]:
    body = html.split("</style>")[0]
    return {float(m) for m in re.findall(r"font-size:\s*([\d.]+)pt", body)}


@pytest.mark.parametrize("template", sorted(ALLOWED_TEMPLATES))
def test_the_default_renders_the_templates_own_sizes(template):
    """Standard must be a no-op, or every existing résumé reflows."""
    assert sizes(render_resume_html(CONTENT, template)) == sizes(
        render_resume_html(CONTENT, template, heading_size_delta=0, body_size_delta=0)
    )


def test_larger_body_text_moves_the_body_up_a_point():
    html = render_resume_html(CONTENT, "ats_clean", body_size_delta=1)
    assert "font-size: 12pt" in html  # body 11 -> 12, the top of the band
    assert "font-size: 11pt" in html  # metadata 10 -> 11


def test_smaller_body_text_moves_it_down_a_point():
    html = render_resume_html(CONTENT, "ats_clean", body_size_delta=-1)
    assert "font-size: 10pt" in html  # body 11 -> 10, the bottom of the band
    assert "font-size: 9pt" not in html  # and no further


def test_the_body_step_leaves_the_headings_where_they_are():
    html = render_resume_html(CONTENT, "ats_clean", body_size_delta=1)
    assert "font-size: 16pt" in html  # the name, untouched
    assert "font-size: 13pt" in html  # the section heading, untouched


def test_the_heading_step_leaves_the_body_where_it_is():
    html = render_resume_html(CONTENT, "ats_clean", heading_size_delta=-1)
    assert "font-size: 15pt" in html  # name 16 -> 15
    assert "font-size: 11pt" in html  # body untouched


@pytest.mark.parametrize("template", sorted(ALLOWED_TEMPLATES))
def test_every_template_scales_both_ways(template):
    for heading, body in ((1, 1), (-1, -1), (1, -1), (-1, 1)):
        html = render_resume_html(CONTENT, template,
                                  heading_size_delta=heading, body_size_delta=body)
        # No size left unresolved, and nothing collapsed to zero or negative.
        assert "{{" not in html
        assert all(s > 0 for s in sizes(html))


@pytest.mark.parametrize("template", sorted(ALLOWED_TEMPLATES))
def test_a_step_moves_every_size_it_owns(template):
    """Catches a size the parameterisation missed."""
    standard = sorted(sizes(render_resume_html(CONTENT, template)))
    bigger = sorted(sizes(render_resume_html(CONTENT, template,
                                             heading_size_delta=1, body_size_delta=1)))
    assert len(standard) == len(bigger)
    assert all(b - s == 1 for s, b in zip(standard, bigger))


# ── The export must agree with the preview ──────────────────────────────────


def test_a_bigger_body_fills_more_of_the_page():
    """The whole point of the Studio is that it shows what exports.

    The PDF path took the résumé's spacing and font but not its sizes, so a
    document previewed at the larger step would have exported at standard.
    """
    from app.services.pdf import _page_meta, _render_document

    long_enough = {**CONTENT, "experience": [
        {"title": "Engineer", "company": "Acme", "start": "2023", "end": "Now",
         "bullets": [f"Shipped thing number {i} across several teams." for i in range(12)]}
    ]}
    standard = _page_meta(_render_document(long_enough, "ats_clean"))["page_fill"]
    bigger = _page_meta(_render_document(long_enough, "ats_clean", body_size_delta=1))["page_fill"]
    smaller = _page_meta(_render_document(long_enough, "ats_clean", body_size_delta=-1))["page_fill"]
    assert smaller < standard < bigger


def test_generate_pdf_accepts_the_sizes():
    from app.services.pdf import generate_pdf

    pdf = generate_pdf(CONTENT, "ats_clean", heading_size_delta=1, body_size_delta=-1)
    assert pdf.startswith(b"%PDF")


# ── A floor under the small step ────────────────────────────────────────────


@pytest.mark.parametrize("template", sorted(ALLOWED_TEMPLATES))
def test_nothing_shrinks_below_ten_point(template):
    """Ten is the floor résumé guidance is consistent about."""
    html = render_resume_html(CONTENT, template,
                              heading_size_delta=-1, body_size_delta=-1)
    assert min(sizes(html)) >= 10


@pytest.mark.parametrize("template", sorted(ALLOWED_TEMPLATES))
def test_the_floor_does_not_touch_standard(template):
    assert min(sizes(render_resume_html(CONTENT, template))) >= 10


def test_text_already_at_the_floor_stays_put_rather_than_going_under():
    # The contact line is 10pt at standard: the smallest thing on the page.
    small = render_resume_html(CONTENT, "ats_minimal", body_size_delta=-1)
    assert "font-size: 10pt" in small
    assert "font-size: 9pt" not in small


def test_the_body_still_steps_down_where_there_is_room():
    """The floor must not flatten the whole step into a no-op."""
    standard = sizes(render_resume_html(CONTENT, "ats_clean"))
    small = sizes(render_resume_html(CONTENT, "ats_clean", body_size_delta=-1))
    assert small != standard


def test_large_has_no_ceiling_to_trip_over():
    html = render_resume_html(CONTENT, "ats_clean", heading_size_delta=1, body_size_delta=1)
    assert "font-size: 17pt" in html  # name 16 -> 17


# ── The researched standards, pinned ────────────────────────────────────────
# Résumé guidance is consistent on these: body text 10–12pt with 11 the safest
# default and 10 the floor; section headings two to three points above body;
# the name 16–20pt. Sizes drift one template at a time, so each is asserted
# against the rule rather than against a number someone can quietly edit.


def _rule_size(html: str, selector: str) -> float:
    """The size on a rule, matched at the start of its line.

    Anchored: the templates carry comments that mention "body", and an
    unanchored search skipped past them into whatever rule came next.
    """
    css = html.split("</style>")[0]
    m = re.search(
        r"^\s*" + re.escape(selector) + r"\s*\{[^}]*font-size:\s*([\d.]+)pt",
        css, re.M,
    )
    assert m, f"no font-size on {selector!r}"
    return float(m.group(1))


def _body_pt(html: str) -> float:
    return _rule_size(html, "body")


def _heading_pt(html: str) -> float:
    for selector in ("h2", ".section-label"):
        try:
            return _rule_size(html, selector)
        except AssertionError:
            continue
    raise AssertionError("no section heading rule")


@pytest.mark.parametrize("template", sorted(ALLOWED_TEMPLATES))
@pytest.mark.parametrize("step,expected", [(-1, 10), (0, 11), (1, 12)])
def test_body_text_spans_the_recommended_band(template, step, expected):
    """Small, Standard and Large land on 10, 11 and 12 — the band itself."""
    assert _body_pt(render_resume_html(CONTENT, template, body_size_delta=step)) == expected


@pytest.mark.parametrize("template", sorted(ALLOWED_TEMPLATES))
def test_section_headings_clear_the_body_by_at_least_two_points(template):
    html = render_resume_html(CONTENT, template)
    assert _heading_pt(html) - _body_pt(html) >= 2


@pytest.mark.parametrize("template", sorted(ALLOWED_TEMPLATES))
def test_the_name_is_within_the_recommended_range(template):
    assert 16 <= max(sizes(render_resume_html(CONTENT, template))) <= 20


@pytest.mark.parametrize("template", sorted(ALLOWED_TEMPLATES))
@pytest.mark.parametrize("step", [-1, 0, 1])
def test_no_text_anywhere_falls_below_the_floor(template, step):
    html = render_resume_html(CONTENT, template,
                              heading_size_delta=step, body_size_delta=step)
    assert min(sizes(html)) >= 10
