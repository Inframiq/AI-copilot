"""Two roles at the same company (promotion / internal transfer).

From 2026-08-25 these were grouped under one company header. Since
2026-11-01 each role is its own entry again, with its own title, company and
dates line: the ATS reference wants every job as one line of text, and the
grouped form left the earlier role several lines from its company in the
extracted text, so a parser could not tell where that role was held.

Requires system-level WeasyPrint libraries; skipped gracefully if
unavailable.
"""
from unittest.mock import patch

import pytest

weasyprint = pytest.importorskip("weasyprint")

from app.services.pdf import ALLOWED_TEMPLATES, TEMPLATES_REQUIRING_PHOTO, generate_pdf  # noqa: E402
from tests.images import ONE_PIXEL_PNG

# ats_sidebar/ats_professional refuse to render without a real, fetchable
# photo (see PhotoRequiredError in pdf.py) — attach one for any template
# that needs it.
TRUSTED_HOST = "https://test-project.supabase.co"


def _resume_for_template(template_id: str, base: dict, avatar_store) -> dict:
    if template_id not in TEMPLATES_REQUIRING_PHOTO:
        return base
    photo_url = f"{TRUSTED_HOST}/storage/v1/object/public/avatars/u/r.png"
    avatar_store.put(photo_url, ONE_PIXEL_PNG)
    return {**base, "contact": {**base["contact"], "photo_url": photo_url}}

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
def test_both_roles_and_all_their_bullets_survive_rendering(template_id, avatar_store):
    resume = _resume_for_template(template_id, RESUME_WITH_TWO_ROLES, avatar_store)
    with patch("app.services.pdf.settings") as mock_settings:
        mock_settings.supabase_url = TRUSTED_HOST
        pdf_bytes = generate_pdf(resume, template_id)
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
def test_every_role_prints_its_own_company_beside_its_title(template_id, avatar_store):
    resume = _resume_for_template(template_id, RESUME_WITH_TWO_ROLES, avatar_store)
    with patch("app.services.pdf.settings") as mock_settings:
        mock_settings.supabase_url = TRUSTED_HOST
        pdf_bytes = generate_pdf(resume, template_id)
    from io import BytesIO
    pdfminer_high_level = pytest.importorskip("pdfminer.high_level")
    text = pdfminer_high_level.extract_text(BytesIO(pdf_bytes)).replace(" ", " ")
    lines = [line.strip() for line in text.splitlines() if line.strip()]

    # One "Acme Corp" per Acme role, each within two lines of that role's
    # dates — found by its start date, which is unique to the role.
    assert text.count("Acme Corp") == 2
    for start in ("Jan 2023", "Jun 2020"):
        at = next(i for i, line in enumerate(lines) if start in line)
        window = lines[max(0, at - 2): at + 3]
        assert any("Acme Corp" in line for line in window), (start, window)
    assert text.count("Beta Industries") == 1
