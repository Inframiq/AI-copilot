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
    # Latest completed tailoring session's score for this JD — not a column
    # on JobDescription itself, populated separately in list_jds/get_jd.
    # Lives on the JD (not Resume, which has no ats_score column at all)
    # because match quality is a property of "this resume against this job",
    # and one resume can be tailored against many JDs with different scores.
    ats_score: int | None = None
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
