import uuid
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field, computed_field

JDStatus = Literal["not_applied", "applied", "interview", "final_round", "offer", "accepted", "rejected"]


class JDCreate(BaseModel):
    raw_text: str = Field(max_length=50_000)
    title: str | None = Field(default=None, max_length=255)


class JDStatusUpdate(BaseModel):
    status: JDStatus


class JDTitleUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=255)


class JDOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    title: str
    raw_text: str
    parsed: dict | None
    status: str
    created_at: datetime
    model_config = {"from_attributes": True}

    @computed_field
    @property
    def parsed_skills(self) -> list[str]:
        """Flattened required + nice_to_have skills, for callers that just want a list."""
        if not self.parsed:
            return []
        required = self.parsed.get("required") or []
        nice_to_have = self.parsed.get("nice_to_have") or []
        return [*required, *nice_to_have]
