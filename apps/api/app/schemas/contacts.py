import uuid
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field

ContactStatus = Literal["new", "following-up", "connected"]


class ExternalContactIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    role: str = Field(min_length=1, max_length=255)
    company: str = Field(min_length=1, max_length=255)
    status: ContactStatus = "new"
    notes: str = Field(default="", max_length=5_000)
    email: str = Field(default="", max_length=255)
    linkedin_url: str = Field(default="", max_length=2_000)


class ExternalContactStatusUpdate(BaseModel):
    status: ContactStatus


class ExternalContactOut(BaseModel):
    id: uuid.UUID
    name: str
    role: str
    company: str
    status: str
    notes: str
    email: str
    linkedin_url: str
    last_contact: datetime
    created_at: datetime
    model_config = {"from_attributes": True}
