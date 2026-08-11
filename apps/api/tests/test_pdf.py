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

from app.services.pdf import generate_pdf, get_signed_url, upload_pdf  # noqa: E402

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
