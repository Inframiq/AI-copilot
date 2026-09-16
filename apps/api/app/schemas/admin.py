import uuid
from datetime import datetime
from typing import Literal
from pydantic import BaseModel


class AdminUserOut(BaseModel):
    id: uuid.UUID
    email: str | None
    created_at: datetime | None
    last_sign_in_at: datetime | None
    plan: str
    status: str
    credits_remaining: int
    credits_allotment: int
    current_period_end: datetime | None


class PlanUpdateIn(BaseModel):
    plan: Literal["free", "premium"]
