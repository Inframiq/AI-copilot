import uuid
from datetime import datetime
from pydantic import BaseModel, Field


class FeedbackIn(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: str | None = Field(default=None, max_length=4000)
    page: str | None = Field(default=None, max_length=255)


class FeedbackOut(BaseModel):
    id: uuid.UUID
    rating: int
    comment: str | None
    page: str | None
    created_at: datetime


class FeedbackAdminOut(FeedbackOut):
    user_id: uuid.UUID
