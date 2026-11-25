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


# ── A long upload read in parts: bounded calls, bounded work ──

def test_the_longest_upload_is_read_in_a_bounded_number_of_parts():
    # One credit must never buy an outsized number of model calls.
    from app.services.pdf_text import MAX_TEXT_CHARS
    from app.services.resume_parser import MAX_JOB_PARTS, _parts_to_read
    lines = ["Jane Doe", "Experience"]
    j = 0
    while sum(len(x) + 1 for x in lines) < MAX_TEXT_CHARS - 200:
        lines += [f"Engineer {j}", f"Company {j} | Jan 2001 - Dec 2002", "Built the thing and shipped it to customers on time."]
        lines += ["Ran the on-call rotation for the payments service."] * (1 + j % 7)
        j += 1
    parts = _parts_to_read("\n".join(lines))
    assert 1 < len(parts) <= MAX_JOB_PARTS + 1


def test_filing_left_out_lines_stays_fast_on_a_crafted_upload():
    import time
    from app.services.pdf_text import MAX_TEXT_CHARS
    from app.services.resume_parser import _points_left_out
    body = "\n".join(f"Education line number {i} with several words that nothing read" for i in range(2000))
    text = ("Education\n" + body)[:MAX_TEXT_CHARS]
    data = {"contact": {}, "experience": [], "education": [], "skills": [f"skill {i}" for i in range(500)],
            "achievements": [f"achievement number {i} words" for i in range(500)]}
    start = time.perf_counter()
    _points_left_out(text, data)
    assert time.perf_counter() - start < 2.0
