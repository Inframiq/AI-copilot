import uuid
from datetime import datetime
from pydantic import BaseModel


class TailorRequest(BaseModel):
    resume_id: uuid.UUID
    jd_id: uuid.UUID
    humanize_level: int = 50  # 0-100


class PrepQuestionOut(BaseModel):
    id: uuid.UUID
    session_id: uuid.UUID
    topic: str
    question: str
    answer_framework: str
    is_gap_based: bool
    order_index: int
    model_config = {"from_attributes": True}


class TailorOut(BaseModel):
    session_id: uuid.UUID
    ats_score: int
    matched_skills: list[str]
    missing_skills: list[str]
    tailored_content: dict
    questions: list[PrepQuestionOut]
