import uuid
from datetime import datetime
from pydantic import BaseModel, Field


class TailorRequest(BaseModel):
    resume_id: uuid.UUID
    jd_id: uuid.UUID
    humanize_level: int = Field(default=50, ge=0, le=100)
    company_name: str | None = Field(default=None, max_length=200)


class AnalyzeRequest(BaseModel):
    resume_id: uuid.UUID
    jd_id: uuid.UUID
    company_name: str | None = Field(default=None, max_length=200)


class AnalyzeOut(BaseModel):
    ats_score: int
    matched_skills: list[str]
    missing_skills: list[str]
    company_keywords: list[str] = []


class PrepQuestionOut(BaseModel):
    id: uuid.UUID
    session_id: uuid.UUID
    topic: str
    question: str
    answer_framework: str
    is_gap_based: bool
    order_index: int
    practiced_at: datetime | None = None
    model_config = {"from_attributes": True}


class LearningItemIn(BaseModel):
    skill: str = Field(min_length=1, max_length=255)
    source_jd_title: str | None = Field(default=None, max_length=255)


class LearningItemOut(BaseModel):
    id: uuid.UUID
    skill: str
    source_jd_title: str | None
    status: str
    created_at: datetime
    model_config = {"from_attributes": True}


class TailorOut(BaseModel):
    session_id: uuid.UUID
    ats_score: int
    matched_skills: list[str]
    missing_skills: list[str]
    tailored_content: dict
    questions: list[PrepQuestionOut]
    company_keywords: list[str] = []
