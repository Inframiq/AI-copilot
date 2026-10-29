import uuid
from datetime import datetime
from pydantic import BaseModel, Field, field_validator

from app.services.plain_text import plain_text


def _plain(value):
    """Keyboard text only (services/plain_text.py)."""
    return plain_text(value) if isinstance(value, str) else value


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
    # Null while the letter is an unsaved draft.
    saved_at: datetime | None = None
    title: str | None = None
    model_config = {"from_attributes": True}

    # Letters saved before plain_text existed open in the editor clean, as
    # the next save will store them.
    _plain_text = field_validator("content", "title")(_plain)


class CoverLetterUpdate(BaseModel):
    content: str = Field(max_length=20000)
    # A new name; omitted or blank keeps the current one.
    title: str | None = Field(default=None, max_length=255)
    # The saved_at this editor loaded or last saved. When the letter has been
    # saved since (another tab or device), the save is refused with 409
    # letter_changed instead of overwriting it. Omitted: saved regardless.
    expected_saved_at: datetime | None = None

    _plain_text = field_validator("content", "title")(_plain)


class CoverLetterPdfRequest(BaseModel):
    # The text on screen, rendered as is and stored nowhere: downloading a
    # draft must not save it. Omitted, the stored letter is rendered.
    content: str | None = Field(default=None, max_length=20000)
