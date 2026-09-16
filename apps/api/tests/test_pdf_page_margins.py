"""Regression test: every page — not just page 1 — keeps a real top margin.

ats_sidebar used to set `@page { margin: 0 }` and fake the page-1 margin with
manual padding on its `.header` / `.body` wrappers. On any resume long enough
to spill onto a second page, that page's content rendered flush against the
paper's top edge (the padding only lived on the first-page wrappers). Every
template now uses `@page { margin: 0.5in }` with `body { margin: 0 }`, so the
whitespace is uniform across pages.

Requires pdfminer.six (dev-only) and system-level WeasyPrint libraries;
skipped gracefully if either is unavailable.
"""
from unittest.mock import patch

import pytest

weasyprint = pytest.importorskip("weasyprint")
pdfminer_high_level = pytest.importorskip("pdfminer.high_level")
pdfminer_layout = pytest.importorskip("pdfminer.layout")

from io import BytesIO  # noqa: E402

from app.services.pdf import ALLOWED_TEMPLATES, TEMPLATES_REQUIRING_PHOTO, generate_pdf  # noqa: E402

# ats_sidebar/ats_professional refuse to render without a real, fetchable
# photo (see PhotoRequiredError in pdf.py) — attach one for any template
# that needs it.
TRUSTED_HOST = "https://test-project.supabase.co"


def _resume_for_template(template_id: str, base: dict, httpx_mock) -> dict:
    if template_id not in TEMPLATES_REQUIRING_PHOTO:
        return base
    photo_url = f"{TRUSTED_HOST}/storage/v1/object/public/avatars/u/r.png"
    httpx_mock.add_response(
        url=photo_url, content=b"\x89PNG\r\n\x1a\nfake-png-bytes", headers={"content-type": "image/png"}
    )
    return {**base, "contact": {**base["contact"], "photo_url": photo_url}}

# Deliberately long — enough bullets that every template wraps onto page 2.
LONG_RESUME = {
    "contact": {"name": "Jane Doe", "email": "jane@example.com", "phone": "555-0100", "location": "NYC"},
    "summary": "Backend engineer with a long-enough summary line to take real vertical space. " * 3,
    "experience": [
        {
            "title": f"Software Engineer {i}", "company": f"Company {i}", "start": "2020", "end": "2021",
            "bullets": [
                f"Delivered initiative {i}.{j} end to end, coordinating across several teams to ship it."
                for j in range(4)
            ],
        }
        for i in range(8)
    ],
    "education": [{"degree": "B.S. Computer Science", "institution": "State University", "year": "2019"}],
    "skills": ["Python", "Go", "Rust", "AWS", "Kubernetes"],
}

# The page CSS is 0.5in (36pt); allow slack for line box ascent / rounding.
MIN_TOP_MARGIN_PT = 24


@pytest.mark.parametrize("template_id", sorted(ALLOWED_TEMPLATES))
def test_every_page_has_a_top_margin(template_id, httpx_mock):
    resume = _resume_for_template(template_id, LONG_RESUME, httpx_mock)
    with patch("app.services.pdf.settings") as mock_settings:
        mock_settings.supabase_url = TRUSTED_HOST
        pdf_bytes = generate_pdf(resume, template_id)
    pages = list(pdfminer_high_level.extract_pages(BytesIO(pdf_bytes)))
    assert len(pages) >= 2, f"{template_id}: fixture didn't overflow to a second page"

    for page_no, page in enumerate(pages, start=1):
        top_y = max(
            (el.y1 for el in page if isinstance(el, pdfminer_layout.LTTextContainer)),
            default=None,
        )
        assert top_y is not None, f"{template_id} page {page_no}: no text found"
        gap = page.height - top_y
        assert gap >= MIN_TOP_MARGIN_PT, (
            f"{template_id} page {page_no}: top text sits only {gap:.1f}pt from the "
            f"page edge — content is rendering flush to the top (expected >= {MIN_TOP_MARGIN_PT}pt)"
        )
