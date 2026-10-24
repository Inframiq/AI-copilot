"""Regression tests for resume_parser.py hardening: the ResumeCreate/ResumeUpdate
content size cap (schemas/resume.py). The DOCX reader and its zip-bomb guard are
gone: uploads are PDF-only, and tests/test_no_docx_reader.py keeps it that way.
"""
import pytest
from pydantic import ValidationError

from app.schemas.resume import ResumeCreate, ResumeUpdate, _MAX_CONTENT_JSON_BYTES


# ── ResumeCreate/ResumeUpdate content size cap ───────────────────────────────


def test_resume_create_accepts_normal_content():
    resume = ResumeCreate(title="My Resume", content={"contact": {"name": "Test"}})
    assert resume.content["contact"]["name"] == "Test"


def test_resume_create_rejects_oversized_content():
    huge_content = {"blob": "x" * (_MAX_CONTENT_JSON_BYTES + 1000)}
    with pytest.raises(ValidationError):
        ResumeCreate(title="My Resume", content=huge_content)


def test_resume_update_rejects_oversized_content():
    huge_content = {"blob": "x" * (_MAX_CONTENT_JSON_BYTES + 1000)}
    with pytest.raises(ValidationError):
        ResumeUpdate(content=huge_content)


def test_resume_update_allows_none_content():
    update = ResumeUpdate(title="New title")
    assert update.content is None
