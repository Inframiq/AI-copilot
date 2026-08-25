"""Regression tests for grouped rendering of multiple roles at the same
company (promotion / internal transfer) — 2026-08-25. Before this, a
candidate with two roles at one employer rendered as two fully separate
entries, each repeating the full company name, rather than the
conventional "one company header, roles nested underneath" resume format.

Requires system-level WeasyPrint libraries; skipped gracefully if
unavailable.
"""
import pytest

weasyprint = pytest.importorskip("weasyprint")

from app.services.pdf import ALLOWED_TEMPLATES, generate_pdf  # noqa: E402

RESUME_WITH_TWO_ROLES = {
    "contact": {"name": "Jane Doe", "email": "jane@example.com"},
    "experience": [
        {
            "title": "Senior Software Engineer", "company": "Acme Corp", "start": "Jan 2023", "end": None,
            "bullets": ["Architected a payments pipeline handling 2M transactions per day."],
        },
        {
            "title": "Software Engineer", "company": "Acme Corp", "start": "Jun 2020", "end": "Dec 2022",
            "bullets": ["Built the initial version of the checkout service."],
        },
        {
            "title": "Backend Intern", "company": "Beta Industries", "start": "Jun 2019", "end": "Aug 2019",
            "bullets": ["Built a real-time analytics dashboard used by 500 internal users."],
        },
    ],
    "education": [],
    "skills": ["Python"],
}


@pytest.mark.parametrize("template_id", sorted(ALLOWED_TEMPLATES))
def test_both_roles_and_all_their_bullets_survive_rendering(template_id):
    pdf_bytes = generate_pdf(RESUME_WITH_TWO_ROLES, template_id)
    from io import BytesIO
    pdfminer_high_level = pytest.importorskip("pdfminer.high_level")
    # &nbsp; (U+00A0) is used as the date-separator spacer in several
    # templates' markup — normalize to a plain space before substring checks.
    text = pdfminer_high_level.extract_text(BytesIO(pdf_bytes)).replace("\xa0", " ")

    # Both role titles present.
    assert "Senior Software Engineer" in text
    assert "Software Engineer" in text
    # Both roles' distinct bullets present — proves neither role's content
    # was lost or overwritten by the other (the exact bug this guards
    # against: company-only keying elsewhere in the app misattributing or
    # deleting one role's data).
    assert "Architected a payments pipeline" in text
    assert "Built the initial version of the checkout service" in text
    # The unrelated single-role company is untouched.
    assert "Backend Intern" in text
    assert "Built a real-time analytics dashboard" in text


@pytest.mark.parametrize("template_id", sorted(ALLOWED_TEMPLATES))
def test_company_name_renders_once_not_once_per_role(template_id):
    pdf_bytes = generate_pdf(RESUME_WITH_TWO_ROLES, template_id)
    from io import BytesIO
    pdfminer_high_level = pytest.importorskip("pdfminer.high_level")
    # &nbsp; (U+00A0) is used as the date-separator spacer in several
    # templates' markup — normalize to a plain space before substring checks.
    text = pdfminer_high_level.extract_text(BytesIO(pdf_bytes)).replace("\xa0", " ")

    # "Acme Corp" has 2 roles grouped under one header — must appear once,
    # not repeated for every role (the pre-fix behavior).
    assert text.count("Acme Corp") == 1
    # "Beta Industries" has only 1 role — always rendered once regardless.
    assert text.count("Beta Industries") == 1
