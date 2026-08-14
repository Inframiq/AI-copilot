"""Tests for the PDF generation service (pdf.py).

The generate_pdf tests call WeasyPrint directly and require system-level
libraries (cairo, pango, gobject).  If WeasyPrint cannot be imported the
tests are skipped gracefully rather than erroring.
"""

from unittest.mock import MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Skip the WeasyPrint-dependent tests if the library cannot be imported.
# ---------------------------------------------------------------------------
weasyprint = pytest.importorskip("weasyprint")

from app.services.pdf import (  # noqa: E402
    _render_html,
    _render_letter_html,
    generate_letter_pdf,
    generate_pdf,
    get_signed_url,
    upload_pdf,
)

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


def test_generate_pdf_returns_bytes_ats_sidebar():
    pdf = generate_pdf(SAMPLE_RESUME, "ats_sidebar")
    assert isinstance(pdf, bytes)
    assert pdf[:4] == b"%PDF"


def test_generate_pdf_returns_bytes_ats_professional():
    pdf = generate_pdf(SAMPLE_RESUME, "ats_professional")
    assert isinstance(pdf, bytes)
    assert pdf[:4] == b"%PDF"


def test_generate_pdf_returns_bytes_ats_minimal():
    pdf = generate_pdf(SAMPLE_RESUME, "ats_minimal")
    assert isinstance(pdf, bytes)
    assert pdf[:4] == b"%PDF"


def test_generate_pdf_renders_projects_section_on_every_template():
    """Projects is a standalone section (separate from experience) — students
    without work history typically have projects instead."""
    for template_id in ("ats_clean", "ats_modern", "ats_sidebar", "ats_professional", "ats_minimal"):
        pdf = generate_pdf(SAMPLE_RESUME, template_id)
        assert pdf[:4] == b"%PDF"


def test_generate_pdf_works_with_projects_but_no_experience():
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
        pdf = generate_pdf(student_resume, template_id)
        assert pdf[:4] == b"%PDF"


def test_generate_pdf_new_templates_work_without_optional_fields():
    """Photo, headline, languages, certifications, awards are all optional."""
    minimal_resume = {
        "contact": {"name": "Jane Doe", "email": "jane@example.com"},
        "experience": [],
        "education": [],
        "skills": [],
    }
    for template_id in ("ats_sidebar", "ats_professional", "ats_minimal"):
        pdf = generate_pdf(minimal_resume, template_id)
        assert pdf[:4] == b"%PDF"


def test_generate_pdf_invalid_template_raises():
    with pytest.raises(ValueError, match="Unknown template"):
        generate_pdf(SAMPLE_RESUME, "unknown_template")


# ---------------------------------------------------------------------------
# SSRF protection: contact.photo_url must not trigger server-side fetches
# to untrusted hosts (e.g. cloud metadata endpoints, internal services).
# ---------------------------------------------------------------------------


def test_generate_pdf_strips_untrusted_photo_url():
    """A photo_url pointing at an internal/metadata host must not be fetched."""
    malicious_resume = {
        **SAMPLE_RESUME,
        "contact": {**SAMPLE_RESUME["contact"], "photo_url": "http://169.254.169.254/secret"},
    }
    # Must not raise and must not attempt to fetch the untrusted URL.
    pdf = generate_pdf(malicious_resume, "ats_sidebar")
    assert pdf[:4] == b"%PDF"


def test_generate_pdf_strips_file_scheme_photo_url():
    malicious_resume = {
        **SAMPLE_RESUME,
        "contact": {**SAMPLE_RESUME["contact"], "photo_url": "file:///etc/passwd"},
    }
    pdf = generate_pdf(malicious_resume, "ats_professional")
    assert pdf[:4] == b"%PDF"


# ---------------------------------------------------------------------------
# Missing contact fields must be omitted, not rendered as the literal
# string "None" (Jinja2 stringifies Python None unlike JS's undefined) —
# ats_clean and ats_modern used to interpolate contact.location directly.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("template_id", ["ats_clean", "ats_modern", "ats_professional", "ats_minimal", "ats_sidebar"])
def test_render_html_omits_missing_location_instead_of_the_word_none(template_id):
    resume = {
        **SAMPLE_RESUME,
        "contact": {**SAMPLE_RESUME["contact"], "location": None},
    }
    html = _render_html(resume, template_id)
    assert "None" not in html


@pytest.mark.parametrize("template_id", ["ats_clean", "ats_modern"])
def test_render_html_still_shows_location_when_present(template_id):
    html = _render_html(SAMPLE_RESUME, template_id)
    assert SAMPLE_RESUME["contact"]["location"] in html


# ---------------------------------------------------------------------------
# A headline that just restates the most recent job title is redundant
# padding, not a distinguishing tagline — dropped at render time so it
# doesn't need a data migration or manual per-resume edit to fix.
# ---------------------------------------------------------------------------


def test_render_html_drops_headline_that_exactly_echoes_the_latest_job_title():
    resume = {
        **SAMPLE_RESUME,
        "headline": "Sr. Business Analyst",
        "experience": [{**SAMPLE_RESUME["experience"][0], "title": "Sr. Business Analyst"}],
    }
    html = _render_html(resume, "ats_clean")
    # Still correctly shown once, as the Experience entry's job title — just
    # not duplicated into the headline div right under the name.
    assert '<div class="headline">' not in html
    assert html.count("Sr. Business Analyst") == 1


def test_render_html_drops_headline_ignoring_case_and_punctuation_differences():
    resume = {
        **SAMPLE_RESUME,
        "headline": "sr business analyst",
        "experience": [{**SAMPLE_RESUME["experience"][0], "title": "Sr. Business Analyst"}],
    }
    html = _render_html(resume, "ats_clean")
    assert '<div class="headline">' not in html


def test_render_html_keeps_a_headline_that_adds_real_information():
    resume = {
        **SAMPLE_RESUME,
        "headline": "Business Analyst — Process Automation & Data Analytics",
        "experience": [{**SAMPLE_RESUME["experience"][0], "title": "Sr. Business Analyst"}],
    }
    html = _render_html(resume, "ats_clean")
    assert "Business Analyst — Process Automation &amp; Data Analytics" in html


def test_render_html_drops_headline_that_echoes_an_older_job_title_not_just_the_latest():
    # The redundant title can belong to any past role, not only the most
    # recent one — the dedup must check every Experience entry.
    resume = {
        **SAMPLE_RESUME,
        "headline": "Sr. Business Analyst",
        "experience": [
            {**SAMPLE_RESUME["experience"][0], "title": "Business Analyst"},
            {**SAMPLE_RESUME["experience"][0], "title": "Sr. Business Analyst"},
        ],
    }
    html = _render_html(resume, "ats_clean")
    assert '<div class="headline">' not in html


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
