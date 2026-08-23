"""Regression tests for line_spacing/paragraph_spacing actually affecting
layout (2026-08-24). Previously line_spacing only changed `body {
line-height }` (wrapped-line height within one bullet) and paragraph_spacing
only changed the bottom margin of a bullet list — nothing tied the gap
*between* individual bullets, between distinct experience/education entries,
or above section headers to either slider, so those stayed fixed no matter
where the sliders were set. ats_sidebar didn't use either setting at all.

These tests render real PDFs at a "tight" and a "loose" spacing setting and
measure actual Y-coordinates via pdfminer's layout analysis (not just text
order, which test_pdf_ats_text_order.py already covers) to confirm the
relevant gaps actually change, not just that the sliders are wired to
*some* CSS property.

Requires pdfminer.six (dev-only) and system-level WeasyPrint libraries;
skipped gracefully if either is unavailable.
"""
import pytest

weasyprint = pytest.importorskip("weasyprint")
pdfminer_high_level = pytest.importorskip("pdfminer.high_level")
pdfminer_layout = pytest.importorskip("pdfminer.layout")

from io import BytesIO  # noqa: E402

from app.services.pdf import ALLOWED_TEMPLATES, generate_pdf  # noqa: E402

TIGHT = {"line_spacing": 1.0, "paragraph_spacing": 0}
LOOSE = {"line_spacing": 1.6, "paragraph_spacing": 24}

RESUME = {
    "contact": {"name": "Jane Doe", "email": "jane@example.com", "phone": "555-123-4567", "location": "Austin, TX"},
    "summary": "Senior backend engineer with a track record of shipping reliable distributed systems.",
    "experience": [
        {
            "title": "Senior Software Engineer", "company": "Acme Corp", "start": "Jan 2022", "end": None,
            "bullets": [
                "Architected a payments pipeline handling 2M transactions per day.",
                "Reduced infra costs by 30% through right-sizing Kubernetes workloads.",
            ],
        },
        {
            "title": "Software Engineer", "company": "Beta Industries", "start": "Jun 2019", "end": "Dec 2021",
            "bullets": ["Built a real-time analytics dashboard used by 500 internal users."],
        },
    ],
    "education": [
        {"degree": "B.S. Computer Science", "institution": "State University", "year": "2019"},
        {"degree": "M.S. Data Science", "institution": "Other University", "year": "2021"},
    ],
    "skills": ["Python", "Kubernetes", "AWS", "PostgreSQL"],
}


def _line_positions(pdf_bytes: bytes) -> list[tuple[str, float]]:
    """(text, vertical-center) for every text line, across all pages."""
    positions = []
    for page_layout in pdfminer_high_level.extract_pages(BytesIO(pdf_bytes)):
        for element in page_layout:
            if isinstance(element, pdfminer_layout.LTTextContainer):
                for line in element:
                    if isinstance(line, pdfminer_layout.LTTextLineHorizontal):
                        text = line.get_text().strip()
                        if text:
                            positions.append((text, (line.y0 + line.y1) / 2))
    return positions


def _find_y(positions: list[tuple[str, float]], needle: str) -> float:
    for text, y in positions:
        if needle in text:
            return y
    raise AssertionError(f"{needle!r} not found in rendered PDF text")


@pytest.mark.parametrize("template_id", sorted(ALLOWED_TEMPLATES))
def test_line_spacing_widens_the_gap_between_bullets(template_id):
    tight_positions = _line_positions(generate_pdf(RESUME, template_id, **TIGHT))
    loose_positions = _line_positions(generate_pdf(RESUME, template_id, **LOOSE))

    def bullet_gap(positions):
        y1 = _find_y(positions, "Architected a payments")
        y2 = _find_y(positions, "Reduced infra costs")
        return abs(y1 - y2)

    assert bullet_gap(loose_positions) > bullet_gap(tight_positions), (
        f"{template_id}: gap between two bullets in the same role didn't widen with line_spacing"
    )


@pytest.mark.parametrize("template_id", sorted(ALLOWED_TEMPLATES))
def test_paragraph_spacing_widens_the_gap_between_experience_entries(template_id):
    tight_positions = _line_positions(generate_pdf(RESUME, template_id, **TIGHT))
    loose_positions = _line_positions(generate_pdf(RESUME, template_id, **LOOSE))

    def entry_gap(positions):
        y1 = _find_y(positions, "Architected a payments")
        y2 = _find_y(positions, "Beta Industries")
        return abs(y1 - y2)

    assert entry_gap(loose_positions) > entry_gap(tight_positions), (
        f"{template_id}: gap between two experience entries didn't widen with paragraph_spacing"
    )


@pytest.mark.parametrize("template_id", sorted(ALLOWED_TEMPLATES))
def test_paragraph_spacing_widens_the_gap_between_education_entries(template_id):
    tight_positions = _line_positions(generate_pdf(RESUME, template_id, **TIGHT))
    loose_positions = _line_positions(generate_pdf(RESUME, template_id, **LOOSE))

    def edu_gap(positions):
        y1 = _find_y(positions, "State University")
        y2 = _find_y(positions, "Other University")
        return abs(y1 - y2)

    assert edu_gap(loose_positions) > edu_gap(tight_positions), (
        f"{template_id}: gap between two education entries didn't widen with paragraph_spacing "
        "(this is the entry type with no bullets table to borrow spacing from)"
    )
