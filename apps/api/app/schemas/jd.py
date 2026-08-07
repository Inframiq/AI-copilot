import uuid
from datetime import datetime
from pydantic import BaseModel, computed_field


class JDCreate(BaseModel):
    raw_text: str
    title: str | None = None


class JDOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    title: str
    raw_text: str
    parsed: dict | None
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
