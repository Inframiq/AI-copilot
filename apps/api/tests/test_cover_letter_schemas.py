import uuid
import pytest
from pydantic import ValidationError
from app.schemas.cover_letter import (
    CoverLetterGenerateRequest,
    CoverLetterUpdate,
)


def test_generate_request_defaults():
    req = CoverLetterGenerateRequest(resume_id=uuid.uuid4(), jd_id=uuid.uuid4())
    assert req.humanize_level == 50
    assert req.tailoring_session_id is None
    assert req.company_name is None


def test_generate_request_rejects_out_of_range_humanize_level():
    with pytest.raises(ValidationError):
        CoverLetterGenerateRequest(resume_id=uuid.uuid4(), jd_id=uuid.uuid4(), humanize_level=150)


def test_update_caps_content_length():
    with pytest.raises(ValidationError):
        CoverLetterUpdate(content="x" * 20001)
