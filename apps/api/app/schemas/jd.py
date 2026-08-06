import uuid
from datetime import datetime
from pydantic import BaseModel


class JDCreate(BaseModel):
    raw_text: str


class JDOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    raw_text: str
    parsed: dict | None
    created_at: datetime
    model_config = {"from_attributes": True}
