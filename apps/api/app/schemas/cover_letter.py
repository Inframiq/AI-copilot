import uuid
from datetime import datetime
from pydantic import BaseModel, Field


class CoverLetterGenerateRequest(BaseModel):
    resume_id: uuid.UUID
    jd_id: uuid.UUID
    # Set to reuse an existing tailoring session's tailored resume content
    # instead of the resume's saved (untailored) content. Omit for a
    # standalone letter generated straight from the resume as saved.
    tailoring_session_id: uuid.UUID | None = None
    humanize_level: int = Field(default=50, ge=0, le=100)
    company_name: str | None = Field(default=None, max_length=200)


class CoverLetterStartOut(BaseModel):
    cover_letter_id: uuid.UUID
    status: str


class CoverLetterOut(BaseModel):
    id: uuid.UUID
    # Null once the resume this was generated from has since been deleted —
    # the letter's own `content` survives regardless (see models.py).
    resume_id: uuid.UUID | None
    jd_id: uuid.UUID
    tailoring_session_id: uuid.UUID | None
    content: str | None
    humanize_level: int
    pdf_url: str | None
    status: str
    created_at: datetime
    model_config = {"from_attributes": True}


class CoverLetterUpdate(BaseModel):
    content: str = Field(max_length=20000)
