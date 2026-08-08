import uuid
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field

ValidTemplateId = Literal["ats_clean", "ats_modern", "ats_professional", "ats_minimal"]


class ResumeCreate(BaseModel):
    title: str = Field(max_length=255)
    content: dict = {}
    template_id: ValidTemplateId = "ats_clean"


class ResumeUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    content: dict | None = None
    template_id: ValidTemplateId | None = None


class PdfGenerateRequest(BaseModel):
    template_id: ValidTemplateId | None = None


class ResumeOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    title: str
    content: dict
    template_id: str
    pdf_url: str | None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}
