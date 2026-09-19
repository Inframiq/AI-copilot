"""Tests for the PDF generation service (pdf.py).

The generate_pdf tests call WeasyPrint directly and require system-level
libraries (cairo, pango, gobject).  If WeasyPrint cannot be imported the
tests are skipped gracefully rather than erroring.
"""

import re
from unittest.mock import MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Skip the WeasyPrint-dependent tests if the library cannot be imported.
# ---------------------------------------------------------------------------
weasyprint = pytest.importorskip("weasyprint")

from app.services.pdf import (  # noqa: E402
    UNDERFILL_PAGE_FILL_THRESHOLD,
    PhotoRequiredError,
    TEMPLATES_REQUIRING_PHOTO,
    _email_link,
    _phone_link,
    _render_html,
    _render_letter_html,
    _url_link,
    generate_letter_pdf,
    generate_pdf,
    generate_pdf_with_meta,
    get_signed_url,
    measure_pdf,
    upload_pdf,
)

# ---------------------------------------------------------------------------
# ats_sidebar/ats_professional now refuse to render at all without a real,
# successfully-fetched photo (see PhotoRequiredError) — their whole layout
# is built around the photo banner, so silently omitting it produced a
# resume that looked nothing like what the user picked. Tests that need one
# of these two templates to actually succeed use this helper to attach a
# trusted, mocked-fetchable photo_url; tests exercising the "no valid photo"
# path (absent/untrusted/fetch-failed) now assert PhotoRequiredError instead
# of a degraded-but-successful render.
# ---------------------------------------------------------------------------
TRUSTED_HOST = "https://test-project.supabase.co"


def _with_trusted_photo(resume: dict, httpx_mock, path: str = "/storage/v1/object/public/avatars/u/r.png") -> dict:
    photo_url = f"{TRUSTED_HOST}{path}"
    httpx_mock.add_response(
        url=photo_url, content=b"\x89PNG\r\n\x1a\nfake-png-bytes", headers={"content-type": "image/png"}
    )
    return {**resume, "contact": {**resume["contact"], "photo_url": photo_url}}


def _resume_for_template(template_id: str, base: dict, httpx_mock) -> dict:
    """base as-is for templates that don't require a photo; base + a
    trusted mocked photo for the two that do."""
    if template_id in TEMPLATES_REQUIRING_PHOTO:
        return _with_trusted_photo(base, httpx_mock)
    return base


@pytest.fixture
def trusted_settings():
    """Patches app.services.pdf.settings.supabase_url to TRUSTED_HOST so a
    _with_trusted_photo photo_url passes the host-allowlist check in
    _sanitize_resume_content."""
    with patch("app.services.pdf.settings") as mock_settings:
        mock_settings.supabase_url = TRUSTED_HOST
        yield mock_settings

SAMPLE_RESUME = {
    "contact": {
        "name": "Jane Doe",
        "email": "jane@example.com",
        "phone": "555-0100",
        "location": "NYC",
    },
    "headline": "Senior Software Engineer",
    "summary": "Backend engineer with 6 years building distributed systems.",
    "experience": [
        {
            "company": "Acme Corp",
            "title": "Engineer",
            "start": "2022",
            "end": "2024",
            "bullets": ["Built APIs", "Led team of 3"],
        }
    ],
    "projects": [
        {
            "name": "Campus Marketplace",
            "tech_stack": "React, Supabase",
            "link": "https://github.com/jane/campus-marketplace",
            "start": "2024-01",
            "end": "2024-05",
            "bullets": ["Built a full-stack listings app", "Reached 200 active users"],
        }
    ],
    "education": [
        {
            "institution": "MIT",
            "degree": "B.S. Computer Science",
            "year": "2018\u20132022",
        }
    ],
    "skills": ["Python", "FastAPI", "PostgreSQL"],
    "languages": [{"name": "English", "level": "Native"}, {"name": "Spanish", "level": "B2"}],
    "certifications": ["AWS Certified Solutions Architect"],
    "awards": ["Employee of the Year 2023"],
}


# ---------------------------------------------------------------------------
# generate_pdf tests
# ---------------------------------------------------------------------------


def test_generate_pdf_returns_bytes_ats_clean():
    pdf = generate_pdf(SAMPLE_RESUME, "ats_clean")
    assert isinstance(pdf, bytes)
    assert pdf[:4] == b"%PDF"


def test_generate_pdf_returns_bytes_ats_modern():
    pdf = generate_pdf(SAMPLE_RESUME, "ats_modern")
    assert isinstance(pdf, bytes)
    assert pdf[:4] == b"%PDF"


def test_generate_pdf_returns_bytes_ats_sidebar(httpx_mock, trusted_settings):
    resume = _with_trusted_photo(SAMPLE_RESUME, httpx_mock)
    pdf = generate_pdf(resume, "ats_sidebar")
    assert isinstance(pdf, bytes)
    assert pdf[:4] == b"%PDF"


def test_generate_pdf_returns_bytes_ats_professional(httpx_mock, trusted_settings):
    resume = _with_trusted_photo(SAMPLE_RESUME, httpx_mock)
    pdf = generate_pdf(resume, "ats_professional")
    assert isinstance(pdf, bytes)
    assert pdf[:4] == b"%PDF"


def test_generate_pdf_returns_bytes_ats_minimal():
    pdf = generate_pdf(SAMPLE_RESUME, "ats_minimal")
    assert isinstance(pdf, bytes)
    assert pdf[:4] == b"%PDF"


def test_generate_pdf_renders_projects_section_on_every_template(httpx_mock, trusted_settings):
    """Projects is a standalone section (separate from experience) — students
    without work history typically have projects instead."""
    for template_id in ("ats_clean", "ats_modern", "ats_sidebar", "ats_professional", "ats_minimal"):
        resume = _resume_for_template(template_id, SAMPLE_RESUME, httpx_mock)
        pdf = generate_pdf(resume, template_id)
        assert pdf[:4] == b"%PDF"


def test_generate_pdf_works_with_projects_but_no_experience(httpx_mock, trusted_settings):
    """The exact student scenario: no work experience, only projects."""
    student_resume = {
        "contact": {"name": "Alex Student", "email": "alex@example.com"},
        "experience": [],
        "projects": [
            {
                "name": "Hackathon Winner App",
                "tech_stack": "Python, Flask",
                "bullets": ["Built in 24 hours", "Won 1st place among 40 teams"],
            }
        ],
        "education": [{"institution": "State University", "degree": "B.S. CS", "year": "2026"}],
        "skills": ["Python", "Flask"],
    }
    for template_id in ("ats_clean", "ats_modern", "ats_sidebar", "ats_professional", "ats_minimal"):
        resume = _resume_for_template(template_id, student_resume, httpx_mock)
        pdf = generate_pdf(resume, template_id)
        assert pdf[:4] == b"%PDF"


def test_generate_pdf_new_templates_work_without_optional_fields(httpx_mock, trusted_settings):
    """Headline, languages, certifications, awards are all optional — photo
    is too for ats_minimal, but ats_sidebar/ats_professional require one
    (see the PhotoRequiredError tests below)."""
    minimal_resume = {
        "contact": {"name": "Jane Doe", "email": "jane@example.com"},
        "experience": [],
        "education": [],
        "skills": [],
    }
    for template_id in ("ats_sidebar", "ats_professional", "ats_minimal"):
        resume = _resume_for_template(template_id, minimal_resume, httpx_mock)
        pdf = generate_pdf(resume, template_id)
        assert pdf[:4] == b"%PDF"


def test_generate_pdf_raises_without_photo_for_sidebar_template():
    resume = {**SAMPLE_RESUME, "contact": {k: v for k, v in SAMPLE_RESUME["contact"].items() if k != "photo_url"}}
    with pytest.raises(PhotoRequiredError):
        generate_pdf(resume, "ats_sidebar")


def test_generate_pdf_raises_without_photo_for_professional_template():
    resume = {**SAMPLE_RESUME, "contact": {k: v for k, v in SAMPLE_RESUME["contact"].items() if k != "photo_url"}}
    with pytest.raises(PhotoRequiredError):
        generate_pdf(resume, "ats_professional")


TEMPLATE_DEFAULT_ACCENT_LOWER = {
    "ats_clean": "#111111",
    "ats_modern": "#5c6bc0",
    "ats_sidebar": "#4c6178",
    "ats_professional": "#1f5fbf",
    "ats_minimal": "#1a1a1a",
}


@pytest.mark.parametrize(
    "template_id", ["ats_clean", "ats_modern", "ats_sidebar", "ats_professional", "ats_minimal"]
)
def test_default_font_and_accent_preserve_original_look(template_id, httpx_mock, trusted_settings):
    """With no font_choice/accent_color override, every template must render
    with the exact hex it always used — a regression guard so introducing
    customization can't shift the look of an existing saved resume."""
    resume = _resume_for_template(template_id, SAMPLE_RESUME, httpx_mock)
    html = _render_html(resume, template_id)
    assert "Arial, Helvetica, sans-serif" in html
    assert TEMPLATE_DEFAULT_ACCENT_LOWER[template_id] in html.lower()


@pytest.mark.parametrize(
    "template_id", ["ats_clean", "ats_modern", "ats_sidebar", "ats_professional", "ats_minimal"]
)
def test_font_choice_overrides_body_font_stack(template_id, httpx_mock, trusted_settings):
    resume = _resume_for_template(template_id, SAMPLE_RESUME, httpx_mock)
    html = _render_html(resume, template_id, font_choice="serif")
    assert 'Georgia, "Times New Roman", serif' in html
    assert "Arial, Helvetica, sans-serif" not in html


@pytest.mark.parametrize(
    "template_id", ["ats_clean", "ats_modern", "ats_sidebar", "ats_professional", "ats_minimal"]
)
def test_accent_color_override_appears_instead_of_default(template_id, httpx_mock, trusted_settings):
    """Compares against the *default* render, not a literal hex absence —
    ats_minimal's own base text color happens to equal its default accent
    hex (#1a1a1a is both), so asserting the old hex is gone entirely would
    be wrong: it must still appear for unrelated body text."""
    resume = _resume_for_template(template_id, SAMPLE_RESUME, httpx_mock)
    default_html = _render_html(resume, template_id)
    default_count = default_html.lower().count(TEMPLATE_DEFAULT_ACCENT_LOWER[template_id])
    html = _render_html(resume, template_id, accent_color="#00aa55")
    assert "#00aa55" in html
    assert html.lower().count(TEMPLATE_DEFAULT_ACCENT_LOWER[template_id]) < default_count


def test_unknown_font_choice_falls_back_to_sans():
    html = _render_html(SAMPLE_RESUME, "ats_clean", font_choice="not-a-real-font")
    assert "Arial, Helvetica, sans-serif" in html


def test_generate_pdf_invalid_template_raises():
    with pytest.raises(ValueError, match="Unknown template"):
        generate_pdf(SAMPLE_RESUME, "unknown_template")


# ---------------------------------------------------------------------------
# Page-fit metadata: measure_pdf / generate_pdf_with_meta feed the "resume is
# shorter than a page" advisory shown after generation, tailoring, and in the
# Studio preview pane.
# ---------------------------------------------------------------------------

# Deliberately sparse — a name, one short role, one line of education. Renders
# well under a single page.
SHORT_RESUME = {
    "contact": {"name": "Sam Short", "email": "sam@example.com"},
    "experience": [
        {"company": "Acme", "title": "Intern", "start": "2023", "end": "2023", "bullets": ["Helped out"]}
    ],
    "education": [{"institution": "State U", "degree": "B.S. CS", "year": "2024"}],
    "skills": ["Python"],
}

# Deliberately overflowing — many roles, many bullets, a big skills block. Runs
# past one page on every template.
LONG_RESUME = {
    "contact": {
        "name": "Pat Long",
        "email": "pat@example.com",
        "phone": "555-0199",
        "location": "Boston, MA",
    },
    "summary": "Staff engineer with 12 years across platform, infra, and product teams. " * 3,
    "experience": [
        {
            "company": f"Company {i}",
            "title": "Senior Software Engineer",
            "start": f"20{10 + i}",
            "end": f"20{11 + i}",
            "bullets": [
                "Led a cross-functional team to deliver a major platform migration ahead of schedule",
                "Cut p99 API latency by 45% by redesigning the caching and connection-pool layers",
                "Mentored five engineers, three of whom were promoted within the year",
                "Owned the on-call rotation and drove a 60% reduction in paging volume",
                "Designed and shipped the multi-region failover strategy still in use today",
            ],
        }
        for i in range(6)
    ],
    "education": [
        {"institution": "MIT", "degree": "B.S. Computer Science", "year": "2006–2010"},
        {"institution": "Georgia Tech", "degree": "M.S. Computer Science", "year": "2011–2013"},
    ],
    "skills": {
        "Languages": ["Python", "Go", "Rust", "TypeScript", "Java", "C++"],
        "Infra": ["Kubernetes", "Terraform", "AWS", "GCP", "Kafka", "PostgreSQL"],
        "Practices": ["TDD", "CI/CD", "Observability", "Incident response", "Design review"],
    },
}


def test_measure_pdf_returns_page_fit_dict():
    meta = measure_pdf(SAMPLE_RESUME, "ats_clean")
    assert set(meta) == {"page_count", "page_fill", "underfilled"}
    assert meta["page_count"] >= 1
    assert 0.0 <= meta["page_fill"] <= 1.0
    assert isinstance(meta["underfilled"], bool)


def test_measure_pdf_flags_a_resume_shorter_than_a_page():
    meta = measure_pdf(SHORT_RESUME, "ats_clean")
    assert meta["page_count"] == 1
    assert meta["page_fill"] < UNDERFILL_PAGE_FILL_THRESHOLD
    assert meta["underfilled"] is True


def test_measure_pdf_does_not_flag_a_resume_that_overflows_one_page():
    meta = measure_pdf(LONG_RESUME, "ats_clean")
    assert meta["page_count"] > 1
    assert meta["underfilled"] is False


def test_generate_pdf_with_meta_returns_bytes_and_page_fit():
    pdf, meta = generate_pdf_with_meta(SHORT_RESUME, "ats_clean")
    assert pdf[:4] == b"%PDF"
    assert meta["underfilled"] is True

    pdf, meta = generate_pdf_with_meta(LONG_RESUME, "ats_clean")
    assert pdf[:4] == b"%PDF"
    assert meta["underfilled"] is False


# ---------------------------------------------------------------------------
# SSRF protection: contact.photo_url must not trigger server-side fetches
# to untrusted hosts (e.g. cloud metadata endpoints, internal services).
# ---------------------------------------------------------------------------


def test_generate_pdf_strips_untrusted_photo_url_and_refuses_to_render():
    """A photo_url pointing at an internal/metadata host must not be
    fetched — and since that leaves ats_sidebar with no real photo, it must
    now refuse to render (PhotoRequiredError) rather than silently produce
    a photo-less resume that doesn't match what the user picked."""
    malicious_resume = {
        **SAMPLE_RESUME,
        "contact": {**SAMPLE_RESUME["contact"], "photo_url": "http://169.254.169.254/secret"},
    }
    with pytest.raises(PhotoRequiredError):
        generate_pdf(malicious_resume, "ats_sidebar")


def test_generate_pdf_strips_file_scheme_photo_url_and_refuses_to_render():
    malicious_resume = {
        **SAMPLE_RESUME,
        "contact": {**SAMPLE_RESUME["contact"], "photo_url": "file:///etc/passwd"},
    }
    with pytest.raises(PhotoRequiredError):
        generate_pdf(malicious_resume, "ats_professional")


# ---------------------------------------------------------------------------
# Photo templates crop the image to a fixed box (object-fit: cover) instead
# of stretching it, and only emit the <img> when a trusted photo_url is set.
# ---------------------------------------------------------------------------


def test_sidebar_photo_template_crops_not_stretches(httpx_mock, trusted_settings):
    resume = _with_trusted_photo(SAMPLE_RESUME, httpx_mock)
    html = _render_html(resume, "ats_sidebar")
    assert "object-fit: cover" in html


def test_professional_photo_template_crops_not_stretches(httpx_mock, trusted_settings):
    resume = _with_trusted_photo(SAMPLE_RESUME, httpx_mock)
    html = _render_html(resume, "ats_professional")
    assert "object-fit: cover" in html


def test_sidebar_template_raises_when_photo_absent():
    resume = {
        **SAMPLE_RESUME,
        "contact": {k: v for k, v in SAMPLE_RESUME["contact"].items() if k != "photo_url"},
    }
    with pytest.raises(PhotoRequiredError):
        _render_html(resume, "ats_sidebar")


def test_sidebar_template_embeds_photo_when_trusted(httpx_mock, trusted_settings):
    """A trusted Supabase photo URL must be fetched and inlined as a data:
    URI — _blocked_url_fetcher rejects http/https at render time no matter
    how trusted the host is, so the raw URL can never reach the <img> tag."""
    resume = _with_trusted_photo(SAMPLE_RESUME, httpx_mock)
    photo_url = resume["contact"]["photo_url"]
    html = _render_html(resume, "ats_sidebar")
    assert 'class="photo"' in html
    assert "data:image/png;base64," in html
    assert photo_url not in html


def test_sidebar_template_raises_when_fetch_fails(httpx_mock, trusted_settings):
    """A trusted URL that 404s (deleted avatar, etc.) leaves no real photo
    to render — same as one never being set, so this now refuses to render
    rather than silently degrading."""
    photo_url = f"{TRUSTED_HOST}/storage/v1/object/public/avatars/u/r.png"
    httpx_mock.add_response(url=photo_url, status_code=404)
    resume = {
        **SAMPLE_RESUME,
        "contact": {**SAMPLE_RESUME["contact"], "photo_url": photo_url},
    }
    with pytest.raises(PhotoRequiredError):
        _render_html(resume, "ats_sidebar")


# ---------------------------------------------------------------------------
# Missing contact fields must be omitted, not rendered as the literal
# string "None" (Jinja2 stringifies Python None unlike JS's undefined) —
# ats_clean and ats_modern used to interpolate contact.location directly.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("template_id", ["ats_clean", "ats_modern", "ats_professional", "ats_minimal", "ats_sidebar"])
def test_render_html_omits_missing_location_instead_of_the_word_none(template_id, httpx_mock, trusted_settings):
    resume = {
        **SAMPLE_RESUME,
        "contact": {**SAMPLE_RESUME["contact"], "location": None},
    }
    resume = _resume_for_template(template_id, resume, httpx_mock)
    html = _render_html(resume, template_id)
    assert "None" not in html


@pytest.mark.parametrize("template_id", ["ats_clean", "ats_modern"])
def test_render_html_still_shows_location_when_present(template_id):
    html = _render_html(SAMPLE_RESUME, template_id)
    assert SAMPLE_RESUME["contact"]["location"] in html


# ---------------------------------------------------------------------------
# The headline slot under the name is gone entirely — every template used
# to render it, whatever content.headline held (a bare job title reads as
# redundant padding next to Experience; per-resume dedup heuristics kept
# missing real-world phrasing variants). Simplest correct fix: never render
# it, regardless of what's stored.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("template_id", ["ats_clean", "ats_modern", "ats_professional", "ats_minimal", "ats_sidebar"])
def test_render_html_never_renders_a_headline(template_id, httpx_mock, trusted_settings):
    resume = {**SAMPLE_RESUME, "headline": "Sr. Business Analyst"}
    resume = _resume_for_template(template_id, resume, httpx_mock)
    html = _render_html(resume, template_id)
    assert '<div class="headline">' not in html
    # SAMPLE_RESUME's headline text doesn't otherwise appear anywhere else
    # in this fixture (unlike the job-title case), so a plain absence check
    # is sufficient here.
    assert "Sr. Business Analyst" not in html


# ---------------------------------------------------------------------------
# .btxt used to hard-cap bullet text at max-height: 3.75em (exactly 3 lines
# at the DEFAULT line-height of 1.25) with overflow: hidden. Since
# line-height became a user-adjustable per-resume setting, any value above
# the default made that box too short for its own 3 lines, silently
# clipping the last line's tail — reported directly against a rendered PDF.
# Fix: bullets just wrap naturally, however many lines they need.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("template_id", ["ats_clean", "ats_modern", "ats_professional", "ats_minimal", "ats_sidebar"])
def test_render_html_bullets_have_no_height_clip_at_any_line_spacing(template_id, httpx_mock, trusted_settings):
    resume = _resume_for_template(template_id, SAMPLE_RESUME, httpx_mock)
    html = _render_html(resume, template_id, line_spacing=1.6)
    btxt_rule = re.search(r"\.btxt\s*\{[^}]*\}", html)
    assert btxt_rule is not None
    assert "max-height" not in btxt_rule.group()
    assert "overflow" not in btxt_rule.group()


def test_render_html_does_not_truncate_a_long_bullet_at_increased_line_spacing():
    long_bullet = (
        "Aligned cross-functional product development across 4 global streams (2300+ FTE), "
        "linking business objectives, operational requirements, and product capabilities "
        "through traceability from business objectives through implementation using modern "
        "product management and collaboration tools."
    )
    resume = {
        **SAMPLE_RESUME,
        "experience": [{**SAMPLE_RESUME["experience"][0], "bullets": [long_bullet]}],
    }
    html = _render_html(resume, "ats_clean", line_spacing=1.5)
    assert long_bullet in html


# ---------------------------------------------------------------------------
# upload_pdf tests (Supabase mocked)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_upload_pdf_returns_storage_path():
    mock_client = MagicMock()
    mock_client.storage.from_.return_value.upload.return_value = {}

    path = await upload_pdf(b"%PDF-test", "user-123", "resume-456", mock_client)

    assert path == "resumes/user-123/resume-456.pdf"
    mock_client.storage.from_.assert_called_with("resumes")
    mock_client.storage.from_.return_value.upload.assert_called_once_with(
        "resumes/user-123/resume-456.pdf",
        b"%PDF-test",
        {"content-type": "application/pdf", "upsert": "true"},
    )


@pytest.mark.asyncio
async def test_upload_pdf_path_format():
    """Storage path must follow the resumes/{user_id}/{resume_id}.pdf convention."""
    mock_client = MagicMock()
    mock_client.storage.from_.return_value.upload.return_value = {}

    user_id = "aabbccdd-1234-5678-abcd-ef0123456789"
    resume_id = "ffee1234-aaaa-bbbb-cccc-dddd00001111"
    path = await upload_pdf(b"%PDF", user_id, resume_id, mock_client)

    assert path.startswith("resumes/")
    assert path.endswith(".pdf")
    assert user_id in path
    assert resume_id in path


# ---------------------------------------------------------------------------
# get_signed_url tests (Supabase mocked)
# ---------------------------------------------------------------------------


def test_get_signed_url_returns_url():
    mock_client = MagicMock()
    mock_client.storage.from_.return_value.create_signed_url.return_value = {
        "signedURL": "https://storage.example.com/signed-token"
    }

    url = get_signed_url("resumes/user-123/resume-456.pdf", mock_client)

    assert url == "https://storage.example.com/signed-token"
    mock_client.storage.from_.assert_called_with("resumes")
    mock_client.storage.from_.return_value.create_signed_url.assert_called_once_with(
        "resumes/user-123/resume-456.pdf", 3600
    )


def test_get_signed_url_custom_expiry():
    mock_client = MagicMock()
    mock_client.storage.from_.return_value.create_signed_url.return_value = {
        "signedURL": "https://storage.example.com/short-token"
    }

    url = get_signed_url("resumes/u/r.pdf", mock_client, expires_in=300)

    mock_client.storage.from_.return_value.create_signed_url.assert_called_once_with(
        "resumes/u/r.pdf", 300
    )
    assert url == "https://storage.example.com/short-token"


# ---------------------------------------------------------------------------
# generate_letter_pdf tests
# ---------------------------------------------------------------------------


def test_generate_letter_pdf_returns_pdf_bytes():
    contact = {"name": "Jane Doe", "email": "jane@example.com", "phone": "555-1234"}
    body = "Dear Hiring Manager,\n\nI am excited to apply.\n\nSincerely,\nJane Doe"

    pdf_bytes = generate_letter_pdf(contact, "January 1, 2026", body)

    assert pdf_bytes.startswith(b"%PDF")


def test_generate_letter_pdf_escapes_body_text():
    contact = {"name": "Jane Doe", "email": "jane@example.com"}
    # A literal "<script>" in body text must never reach the rendered HTML
    # unescaped — Jinja's autoescape (already enabled on _jinja_env) handles
    # this, this test just confirms the letter template doesn't opt out of it.
    body = "Dear Hiring Manager,\n\n<script>alert(1)</script>\n\nSincerely,\nJane Doe"

    html = _render_letter_html(contact, "January 1, 2026", body)

    assert "<script>alert(1)</script>" not in html
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in html


def test_generate_letter_pdf_with_escaped_body_still_produces_pdf():
    """Happy-path sanity check that a body containing HTML-special characters
    still renders to a valid PDF end-to-end via generate_letter_pdf."""
    contact = {"name": "Jane Doe", "email": "jane@example.com"}
    body = "Dear Hiring Manager,\n\n<script>alert(1)</script>\n\nSincerely,\nJane Doe"

    pdf_bytes = generate_letter_pdf(contact, "January 1, 2026", body)

    assert pdf_bytes.startswith(b"%PDF")


def test_template_allowlists_stay_in_sync():
    """pdf.py's ALLOWED_TEMPLATES, the ResumeCreate/Update/PdfGenerateRequest
    schema's ValidTemplateId, and resumes.py's _VALID_TEMPLATES are three
    independent allowlists with no shared source of truth — ats_sidebar was
    once missing from the latter two, so the template rendered fine here but
    every API call to save or render it as a resume's template_id 422'd.
    This pins all three to the same set so that class of drift fails loudly."""
    from typing import get_args

    from app.routers.resumes import _VALID_TEMPLATES
    from app.services.pdf import ALLOWED_TEMPLATES
    from app.schemas.resume import ValidTemplateId

    assert set(get_args(ValidTemplateId)) == ALLOWED_TEMPLATES
    assert _VALID_TEMPLATES == ALLOWED_TEMPLATES


# ---------------------------------------------------------------------------
# Contact/project links: email/phone/LinkedIn/GitHub/website/project-link
# fields must render as actual clickable mailto:/tel:/https:// links, not
# plain text — previously every one of them was rendered as inert text.
# ---------------------------------------------------------------------------


def test_email_link_produces_mailto_anchor():
    assert _email_link("jane@example.com") == '<a href="mailto:jane@example.com">jane@example.com</a>'


def test_email_link_escapes_html_special_characters():
    html = _email_link('"><script>alert(1)</script>@example.com')
    assert "<script>" not in html
    assert "&lt;script&gt;" in html


def test_email_link_empty_renders_nothing():
    assert _email_link("") == ""
    assert _email_link(None) == ""


def test_phone_link_normalizes_digits_but_displays_original_formatting():
    html = _phone_link("(555) 123-4567")
    assert html == '<a href="tel:5551234567">(555) 123-4567</a>'


def test_phone_link_keeps_leading_plus_for_international_numbers():
    html = _phone_link("+1 555-123-4567")
    assert 'href="tel:+15551234567"' in html


def test_phone_link_falls_back_to_plain_text_when_nothing_dialable():
    """A phone field that's actually free text (e.g. "Available on request")
    must not produce a dangling tel: link with an empty number."""
    html = _phone_link("Available on request")
    assert "<a " not in html
    assert html == "Available on request"


def test_url_link_prepends_https_to_a_bare_domain():
    html = _url_link("linkedin.com/in/janedoe")
    assert html == '<a href="https://linkedin.com/in/janedoe">linkedin.com/in/janedoe</a>'


def test_url_link_preserves_an_already_full_url():
    html = _url_link("https://github.com/janedoe")
    assert html == '<a href="https://github.com/janedoe">https://github.com/janedoe</a>'


def test_url_link_rejects_unsafe_schemes_and_falls_back_to_plain_text():
    """A malicious/unexpected scheme pasted into a resume field must never
    reach the rendered href — it still displays as plain text (same as any
    other resume field), just never becomes a clickable link."""
    html = _url_link("javascript:alert(1)")
    assert "<a " not in html
    assert 'href="javascript:' not in html
    assert html == "javascript:alert(1)"


def test_url_link_empty_renders_nothing():
    assert _url_link("") == ""
    assert _url_link(None) == ""


@pytest.mark.parametrize(
    "template_id", ["ats_clean", "ats_modern", "ats_sidebar", "ats_professional", "ats_minimal"]
)
def test_contact_fields_render_as_real_links_in_every_template(template_id, httpx_mock, trusted_settings):
    resume = {
        **SAMPLE_RESUME,
        "contact": {
            **SAMPLE_RESUME["contact"],
            "linkedin": "linkedin.com/in/janedoe",
            "github": "github.com/janedoe",
            "website": "janedoe.dev",
        },
    }
    resume = _resume_for_template(template_id, resume, httpx_mock)
    html = _render_html(resume, template_id)
    assert 'href="mailto:jane@example.com"' in html
    assert 'href="tel:5550100"' in html
    assert 'href="https://linkedin.com/in/janedoe"' in html
    assert 'href="https://github.com/janedoe"' in html
    assert 'href="https://janedoe.dev"' in html


@pytest.mark.parametrize(
    "template_id", ["ats_clean", "ats_modern", "ats_sidebar", "ats_professional", "ats_minimal"]
)
def test_project_link_renders_as_a_real_link(template_id, httpx_mock, trusted_settings):
    resume = _resume_for_template(template_id, SAMPLE_RESUME, httpx_mock)
    html = _render_html(resume, template_id)
    assert 'href="https://github.com/jane/campus-marketplace"' in html


def test_cover_letter_contact_fields_render_as_real_links():
    contact = {"name": "Jane Doe", "email": "jane@example.com", "phone": "555-0100", "location": "NYC"}
    html = _render_letter_html(contact, "January 1, 2026", "Body text.")
    assert 'href="mailto:jane@example.com"' in html
    assert 'href="tel:5550100"' in html


# ---------------------------------------------------------------------------
# The render-time fetcher, on WeasyPrint's URLFetcher API (v70+). A plain
# function stopped working there: WeasyPrint reads `_fail_on_errors` off the
# fetcher and `weasyprint.urls.default_url_fetcher` no longer exists, so every
# photo template (whose photo is a data: URI) failed to render — Export PDF
# broke for ats_sidebar and ats_professional.
# ---------------------------------------------------------------------------


def test_render_fetcher_allows_data_uris_and_blocks_everything_else():
    pytest.importorskip("weasyprint")
    from app.services.pdf import _blocked_url_fetcher

    fetcher = _blocked_url_fetcher()
    resource = fetcher.fetch("data:text/plain;base64,aGk=")
    assert resource.read() == b"hi"
    resource.close()
    for url in ("http://169.254.169.254/secret", "https://example.com/x.png", "file:///etc/passwd"):
        with pytest.raises(ValueError):
            fetcher.fetch(url)


def test_each_render_gets_its_own_fetcher():
    """URLFetcher keeps per-request state between calls, so one instance
    shared across concurrent renders could mix them up."""
    pytest.importorskip("weasyprint")
    from app.services.pdf import _blocked_url_fetcher

    assert _blocked_url_fetcher() is not _blocked_url_fetcher()


def test_url_link_shows_its_display_text_but_opens_the_url():
    html = _url_link("linkedin.com/in/janedoe", "LinkedIn")
    assert 'href="https://linkedin.com/in/janedoe"' in html
    assert ">LinkedIn</a>" in html


def test_url_link_blank_display_text_shows_the_url():
    assert ">github.com/jane</a>" in _url_link("github.com/jane", "   ")


def test_url_link_with_a_path_is_marked_for_the_studio_editor():
    html = _url_link("github.com/jane", "My <GitHub>", "contact.github")
    assert 'data-link="contact.github"' in html
    assert 'data-link-url="github.com/jane"' in html
    # Display text is escaped in both the attribute and the visible text.
    assert 'data-link-text="My &lt;GitHub&gt;"' in html
    assert ">My &lt;GitHub&gt;</a>" in html


def test_url_link_marks_an_invalid_url_so_it_can_still_be_fixed():
    html = _url_link("javascript:alert(1)", None, "projects.0.link")
    assert "<a" not in html
    assert 'data-link="projects.0.link"' in html


@pytest.mark.parametrize(
    "template", ["ats_clean", "ats_modern", "ats_sidebar", "ats_professional", "ats_minimal"]
)
def test_templates_render_link_display_text_with_the_real_href(template, httpx_mock, trusted_settings):
    from app.services.pdf import render_resume_html

    content = {
        "contact": {
            "name": "Jane", "email": "j@x.com",
            "linkedin": "linkedin.com/in/jane", "linkedin_label": "LinkedIn",
            "website": "jane.dev", "website_label": "Portfolio",
        },
        "projects": [{"name": "P", "link": "github.com/jane/p", "link_label": "Source", "bullets": ["b"]}],
        "experience": [], "education": [], "skills": [],
    }
    html = render_resume_html(_resume_for_template(template, content, httpx_mock), template)
    assert 'href="https://linkedin.com/in/jane"' in html
    assert ">LinkedIn</a>" in html
    assert ">Portfolio</a>" in html
    assert ">Source</a>" in html
    assert 'data-link="projects.0.link"' in html
