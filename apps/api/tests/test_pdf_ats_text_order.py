"""Regression test for a WeasyPrint text-extraction-order bug found by
direct render+extract testing (2026-08-17): any mechanism that visually
right-aligns or right-pushes text — flex justify-content, float:right, and
even a plain table cell with a wider-than-content column — makes WeasyPrint
emit that text's PDF content stream out of DOM order. In practice this
dumped every job/education date range at the very end of ATS-extracted
text, disconnected from the role it belongs to, invisibly (the PDF renders
correctly on screen). The bug is content-length-dependent — it reproduces
with short titles/companies and not with long ones — so this test
deliberately uses SHORT content, which is exactly the case that would slip
past a spot-check with realistic-looking long sample data.

Requires pdfminer.six (dev-only) and system-level WeasyPrint libraries
(cairo, pango, gobject) — skipped gracefully if either is unavailable.
"""
import pytest

weasyprint = pytest.importorskip("weasyprint")
pdfminer_high_level = pytest.importorskip("pdfminer.high_level")

from io import BytesIO  # noqa: E402

from app.services.pdf import ALLOWED_TEMPLATES, generate_pdf  # noqa: E402

SHORT_RESUME = {
    "contact": {"name": "Jane Doe", "email": "jane@example.com", "phone": "555-0100", "location": "NYC"},
    "experience": [
        {"title": "Eng", "company": "Acme", "start": "Jan 2022", "end": None, "bullets": ["Did stuff."]},
        {"title": "Jr Eng", "company": "Beta", "start": "Jun 2019", "end": "Dec 2021", "bullets": ["Did more."]},
    ],
    "education": [{"degree": "B.S. CS", "institution": "State U", "year": "2019"}],
    "skills": ["Python"],
}


def _extract_flat_text(pdf_bytes: bytes) -> str:
    text = pdfminer_high_level.extract_text(BytesIO(pdf_bytes))
    return " ".join(line for line in text.split("\n") if line.strip())


@pytest.mark.parametrize("template_id", sorted(ALLOWED_TEMPLATES))
def test_experience_dates_stay_adjacent_to_their_role_in_extracted_text(template_id):
    pdf_bytes = generate_pdf(SHORT_RESUME, template_id)
    flat = _extract_flat_text(pdf_bytes)

    idx_acme, idx_jan = flat.find("Acme"), flat.find("Jan 2022")
    idx_beta, idx_jun = flat.find("Beta"), flat.find("Jun 2019")

    assert idx_acme != -1 and idx_jan != -1, f"{template_id}: missing expected text"
    assert idx_beta != -1 and idx_jun != -1, f"{template_id}: missing expected text"
    assert abs(idx_acme - idx_jan) < 120, (
        f"{template_id}: 'Jan 2022' landed far from 'Acme' in extracted text — "
        f"a date got scrambled out of order (positions {idx_acme} vs {idx_jan})"
    )
    assert abs(idx_beta - idx_jun) < 120, (
        f"{template_id}: 'Jun 2019' landed far from 'Beta' in extracted text — "
        f"a date got scrambled out of order (positions {idx_beta} vs {idx_jun})"
    )
