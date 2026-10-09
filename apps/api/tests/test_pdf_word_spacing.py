"""Words in a résumé are set with ordinary spaces (2026-10-09).

Every template justified its bullets and summary, which stretches each
wrapped line to the full width by widening the gaps between its words. On
résumé-length lines carrying long tokens ("EfficientNet-B2", "6,000+",
"end-to-end") the stretch is large and uneven — users saw it as "extra spaces
between words", in the Studio and in the downloaded PDF alike. Hyphenation
would shrink the gaps but splits words across lines in the PDF text, which
breaks ATS keyword matching, so the text is left-aligned instead.

Renders real PDFs and measures the gaps between words with pdfminer, so this
checks what a reader (and a parser) gets, not just the CSS.
"""
import statistics
from io import BytesIO

import pytest

weasyprint = pytest.importorskip("weasyprint")
pdfminer_high_level = pytest.importorskip("pdfminer.high_level")
pdfminer_layout = pytest.importorskip("pdfminer.layout")

from app.services.pdf import ALLOWED_TEMPLATES, TEMPLATES_REQUIRING_PHOTO, generate_pdf  # noqa: E402

TRUSTED_HOST = "https://test-project.supabase.co"

# Long, unevenly sized words: lines that wrap with a lot of slack, which is
# exactly where justification opened wide gaps.
BULLETS = [
    "Built a 4-class oral lesion classification system using EfficientNet-B2 across 6,000+ "
    "medical images with preprocessing, augmentation, and dataset balancing.",
    "Engineered back-end services and APIs using software engineering to integrate internal "
    "back-end systems with Node.js and PostgreSQL.",
    "Optimized AI workflows using asynchronous execution and caching to enhance performance, "
    "integrating resume tailoring, skill-gap analysis, and interview preparation.",
    "Managed deployment of product updates and fixes for 5 production applications, owning "
    "end-to-end deployment across 2-3 products.",
]
RESUME = {
    "contact": {"name": "Jane Doe", "email": "jane@example.com", "location": "Austin, TX"},
    "summary": "Backend engineer who ships reliable distributed systems, with deep experience in "
               "payments infrastructure, observability, and incident response across regulated products.",
    "experience": [{"title": "Technical Head", "company": "Acme", "start": "2026", "end": None, "bullets": BULLETS}],
    "skills": ["Python", "Node.js"],
}


def _resume(template_id: str, avatar_store) -> dict:
    if template_id not in TEMPLATES_REQUIRING_PHOTO:
        return RESUME
    photo_url = f"{TRUSTED_HOST}/storage/v1/object/public/avatars/u/r.png"
    avatar_store.put(photo_url, b"\x89PNG\r\n\x1a\nfake-png-bytes")
    return {**RESUME, "contact": {**RESUME["contact"], "photo_url": photo_url}}


def _word_gaps(pdf_bytes: bytes) -> list[float]:
    """Gap between consecutive words, as a share of the font size, on every
    line of body text. (A paragraph's last line is never stretched, so it
    can only lower the maximum — no need to tell it apart; bullets sit in
    table cells, so each of their lines is its own box anyway.)"""
    gaps: list[float] = []
    for page in pdfminer_high_level.extract_pages(BytesIO(pdf_bytes)):
        for box in page:
            if not isinstance(box, pdfminer_layout.LTTextContainer):
                continue
            for line in [ln for ln in box if isinstance(ln, pdfminer_layout.LTTextLineHorizontal)]:
                chars = [c for c in line if isinstance(c, pdfminer_layout.LTChar)]
                words: list[list] = [[]]
                for c in chars:
                    if c.get_text().isspace():
                        words.append([])
                    else:
                        words[-1].append(c)
                words = [w for w in words if w]
                text = "".join(c.get_text() for c in chars)
                # Body text only: headings, contact and date lines carry
                # deliberate wide separators (" | ", " · ") and letter-spacing.
                if len(words) < 6 or text.isupper() or any(s in text for s in ("|", "·")):
                    continue
                for a, b in zip(words, words[1:]):
                    if "•" in (a[-1].get_text(), b[0].get_text()):
                        continue  # the bullet glyph sits in its own cell
                    size = statistics.median(c.size for c in a + b)
                    gaps.append((b[0].x0 - a[-1].x1) / size)
    return gaps


@pytest.mark.parametrize("template_id", sorted(ALLOWED_TEMPLATES))
def test_words_are_separated_by_ordinary_spaces(template_id, avatar_store):
    gaps = _word_gaps(generate_pdf(_resume(template_id, avatar_store), template_id))
    assert len(gaps) > 20, "expected wrapped body lines to measure"
    # An ordinary space here measures ~0.28× the font size, and every gap in
    # left-aligned text is that same width. Justified, slack lines stretched
    # gaps to 0.45–0.8×.
    assert max(gaps) < 0.38, (
        f"{template_id}: widest gap between words is {max(gaps):.2f}× the font size "
        f"(median {statistics.median(gaps):.2f}) — text is being stretched"
    )
