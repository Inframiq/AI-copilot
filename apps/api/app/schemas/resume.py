import json
import uuid
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field, field_validator

ValidTemplateId = Literal["ats_clean", "ats_modern", "ats_professional", "ats_minimal"]

# resume.content is forwarded verbatim into "pro"-tier LLM prompts during
# /ai/tailor (see services/tailoring.py rewrite_bullets / generate_prep_questions).
# Without a cap here, a user could bypass the 100k-char text cap that the
# parse-upload path enforces and hand-craft an oversized content blob via
# POST/PATCH /resumes, inflating per-call LLM token cost arbitrarily.
_MAX_CONTENT_JSON_BYTES = 200_000


def _validate_content_size(value: dict | None) -> dict | None:
    if value is None:
        return value
    size = len(json.dumps(value))
    if size > _MAX_CONTENT_JSON_BYTES:
        raise ValueError(f"content exceeds the maximum allowed size of {_MAX_CONTENT_JSON_BYTES} bytes")
    return value


class ResumeCreate(BaseModel):
    title: str = Field(max_length=255)
    content: dict = {}
    template_id: ValidTemplateId = "ats_clean"

    _check_content_size = field_validator("content")(_validate_content_size)


class ResumeUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    content: dict | None = None
    template_id: ValidTemplateId | None = None

    _check_content_size = field_validator("content")(_validate_content_size)


class PdfGenerateRequest(BaseModel):
    template_id: ValidTemplateId | None = None
    # Optional content override for rendering an unsaved preview (e.g. AI
    # tailoring results the user hasn't accepted yet) without persisting it
    # to the resume row.
    content: dict | None = None

    _check_content_size = field_validator("content")(_validate_content_size)


class ResumeOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    title: str
    content: dict
    template_id: str
    pdf_url: str | None
    # Presence (not the raw storage path) is what the frontend needs — it
    # decides whether Preview can show the untouched original vs. falling
    # back to the template-rendered content. The signed URL comes from the
    # dedicated /resumes/{id}/original endpoint, same pattern as pdf_url.
    original_file_name: str | None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class OriginalFileOut(BaseModel):
    signed_url: str
    file_name: str | None
