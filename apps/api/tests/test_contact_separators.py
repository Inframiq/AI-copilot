"""A contact line that wraps never leaves a separator at a line's end.

Seen live (2026-11-02): "bharathkundrapu@gmail.com | +91 90107 50127 |
Hyderabad, India |" with the LinkedIn address on the next line. Each template
marks its separators (pdf._contact_sep), joined to the item before them so a
wrap only falls after one; _render_document hides the one left at a line's
end. Read back with both extractors, every template, at the style edges.
"""
import io
import re
from pathlib import Path
from unittest.mock import patch

import pytest

pytest.importorskip("weasyprint")
pdfminer_high_level = pytest.importorskip("pdfminer.high_level")

from pypdf import PdfReader  # noqa: E402

from app.services import pdf as P  # noqa: E402

# Long enough to wrap in every template, sidebar columns included.
CONTACT = {
    "name": "Bharath Kundrapu", "email": "bharathkundrapu@gmail.com", "phone": "+91 90107 50127",
    "location": "Hyderabad, Telangana, India", "linkedin": "linkedin.com/in/kundrapu-bharath-3b7a61115",
    "github": "github.com/bharathkundrapu", "website": "bharathkundrapu.dev",
}
CONTENT = {"contact": CONTACT, "summary": "Business analyst.", "skills": ["SQL"],
           "experience": [{"title": "Analyst", "company": "Acme", "start": "Jan 2022", "end": "Present",
                           "bullets": ["Built 3 dashboards."]}]}
EDGES = {
    "default": {},
    "large": {"body_size_delta": 1, "heading_size_delta": 1},
    "serif-letter": {"font_choice": "classic_serif", "page_size": "Letter"},
    "lato": {"font_choice": "modern_sans"},
}
SEPARATORS = "|·•/"


def _render(template_id: str, **kwargs) -> bytes:
    status = P.PHOTO_UNAVAILABLE if template_id in P.TEMPLATES_REQUIRING_PHOTO else P.PHOTO_NONE
    with patch.object(P, "_sanitize_resume_content", lambda c: (c, status)):
        return P.generate_pdf(CONTENT, template_id, **kwargs)


def _contact_lines(text: str) -> list[str]:
    """The extracted lines that carry a contact value."""
    values = [v for k, v in CONTACT.items() if k != "name"]
    return [line.strip() for line in text.splitlines()
            if line.strip() and any(v[:12] in line for v in values)]


@pytest.mark.parametrize("edge", sorted(EDGES))
@pytest.mark.parametrize("template_id", sorted(P.ALLOWED_TEMPLATES))
def test_no_contact_line_ends_or_starts_with_a_separator(template_id, edge):
    pdf = _render(template_id, **EDGES[edge])
    for name, text in (
        ("pypdf", "\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(pdf)).pages)),
        ("pdfminer", pdfminer_high_level.extract_text(io.BytesIO(pdf))),
    ):
        lines = _contact_lines(text)
        assert lines, f"{name}: no contact line found\n{text}"
        for line in lines:
            bare = line.replace(" ", " ").strip()
            assert bare[-1] not in SEPARATORS, f"{name}: ends with a separator: {line!r}"
            assert bare[0] not in SEPARATORS, f"{name}: starts with a separator: {line!r}"
        # Every value still comes out: hiding a separator hides nothing else.
        flat = re.sub(r"\s+", "", text)
        for key in ("email", "phone", "location", "github"):
            assert re.sub(r"\s+", "", CONTACT[key]) in flat, f"{name}: {key} missing"


def test_a_line_that_fits_keeps_every_separator():
    short = {**CONTENT, "contact": {"name": "Asha Rao", "email": "a@x.com", "phone": "+91 98765 43210"}}
    with patch.object(P, "_sanitize_resume_content", lambda c: (c, P.PHOTO_NONE)):
        document = P._render_document(short, "ats_clean")
    assert P._line_end_separators(document) == set()


def test_the_separator_span_is_joined_to_the_item_before_it():
    out = str(P._contact_sep(" &nbsp;·&nbsp; ", 3))
    assert out == '<span class="contact-sep" data-contact-sep="3">  ·  </span>'
    assert str(P._contact_sep(" | ", 2)) == '<span class="contact-sep" data-contact-sep="2"> | </span>'
    # A template constant only, but escaped all the same.
    assert "&lt;b&gt;" in str(P._contact_sep("<b>", 1))


def test_every_template_marks_its_contact_separators():
    """A template that joins contact items with a bare string would bring
    the dangling separator back."""
    for path in sorted(Path(P.TEMPLATES_DIR).glob("*.html")):
        source = path.read_text(encoding="utf-8")
        if 'class="contact-item"' not in source:
            continue
        assert "contact_sep(loop.index)" in source, path.name
        assert not re.search(r"\{% if not loop\.first %\}[^{]", source), path.name
