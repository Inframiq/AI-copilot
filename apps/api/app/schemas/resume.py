import uuid
from datetime import datetime
from pydantic import BaseModel


class ResumeCreate(BaseModel):
    title: str
    content: dict = {}
    template_id: str = "ats_clean"


class ResumeUpdate(BaseModel):
    title: str | None = None
    content: dict | None = None
    template_id: str | None = None


class PdfGenerateRequest(BaseModel):
    template_id: str | None = None


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
