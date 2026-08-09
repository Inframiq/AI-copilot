"""Regression tests for resume_parser.py hardening:

1. DOCX zip-bomb protection (_check_docx_zip_safety).
2. ResumeCreate/ResumeUpdate.content size cap (schemas/resume.py).
"""
import io
import zipfile

import docx
import pytest
from pydantic import ValidationError

from app.services.resume_parser import extract_text_from_docx, _check_docx_zip_safety
from app.schemas.resume import ResumeCreate, ResumeUpdate, _MAX_CONTENT_JSON_BYTES


def _make_real_docx_bytes(text: str = "Hello world, this is a resume.") -> bytes:
    doc = docx.Document()
    doc.add_paragraph(text)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def _make_zip_bomb_bytes(uncompressed_size: int = 40 * 1024 * 1024) -> bytes:
    """A tiny zip whose single entry expands to `uncompressed_size` bytes."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # Highly compressible payload (all zeros) — compresses to a few KB
        # while decompressing to tens of MB, mimicking a docx zip bomb.
        zf.writestr("word/document.xml", b"0" * uncompressed_size)
    return buf.getvalue()


def test_real_docx_passes_zip_safety_check():
    data = _make_real_docx_bytes()
    # Should not raise
    _check_docx_zip_safety(data)


def test_real_docx_extracts_text():
    data = _make_real_docx_bytes("Jane Doe\nSenior Engineer")
    text = extract_text_from_docx(data)
    assert "Jane Doe" in text


def test_zip_bomb_docx_rejected_by_size_check():
    data = _make_zip_bomb_bytes(uncompressed_size=40 * 1024 * 1024)
    with pytest.raises(ValueError):
        _check_docx_zip_safety(data)


def test_zip_bomb_docx_rejected_by_extract_text():
    data = _make_zip_bomb_bytes(uncompressed_size=40 * 1024 * 1024)
    with pytest.raises(ValueError):
        extract_text_from_docx(data)


def test_corrupt_docx_rejected_cleanly():
    with pytest.raises(ValueError):
        extract_text_from_docx(b"not a zip file at all")


def test_high_ratio_small_docx_rejected():
    """Even a small total size should be rejected if the compression ratio is absurd."""
    # 2MB of zeros compresses to well under 20KB => ratio > 100
    data = _make_zip_bomb_bytes(uncompressed_size=2 * 1024 * 1024)
    with pytest.raises(ValueError):
        _check_docx_zip_safety(data)


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
