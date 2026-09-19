import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class DeletionRequestIn(BaseModel):
    # A plain shape check, not EmailStr: that needs email-validator, which
    # isn't a dependency. We reply to the address before acting anyway.
    email: str = Field(max_length=255, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    name: str | None = Field(default=None, max_length=255)
    requester_type: Literal["account_holder", "not_a_user"]
    details: str | None = Field(default=None, max_length=2000)
    # A field real people never see or fill. Bots fill every field.
    website: str | None = Field(default=None, max_length=255)


class DeletionRequestAdminOut(BaseModel):
    id: uuid.UUID
    email: str
    name: str | None
    requester_type: str
    details: str | None
    status: str
    resolution_note: str | None
    created_at: datetime
    resolved_at: datetime | None
    # Whether an account with this email exists right now — the first thing
    # to know when deciding what to delete.
    has_account: bool


class DeletionRequestUpdate(BaseModel):
    status: Literal["open", "completed", "declined"]
    resolution_note: str | None = Field(default=None, max_length=2000)
