import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Integer, Boolean, Text, ARRAY, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB, TIMESTAMP
from app.db.session import Base


def utcnow():
    return datetime.now(timezone.utc)


class Resume(Base):
    __tablename__ = "resumes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    template_id: Mapped[str] = mapped_column(String(50), nullable=False, default="ats_clean")
    # Stores path in Supabase Storage: resumes/{user_id}/{resume_id}.pdf — NOT a signed URL
    pdf_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow, onupdate=utcnow)

    sessions: Mapped[list["TailoringSession"]] = relationship(back_populates="resume", cascade="all, delete-orphan")


class JobDescription(Base):
    __tablename__ = "job_descriptions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    raw_text: Mapped[str] = mapped_column(Text, nullable=False)
    parsed: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # not_applied -> applied -> interview -> final_round -> offer -> accepted, or rejected at any point
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="not_applied")
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow)

    sessions: Mapped[list["TailoringSession"]] = relationship(back_populates="jd", cascade="all, delete-orphan")


class TailoringSession(Base):
    __tablename__ = "tailoring_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    resume_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("resumes.id", ondelete="CASCADE")
    )
    jd_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("job_descriptions.id", ondelete="CASCADE")
    )
    ats_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    matched_skills: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    missing_skills: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    tailored_content: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    humanize_level: Mapped[int] = mapped_column(Integer, default=50)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow)

    resume: Mapped["Resume"] = relationship(back_populates="sessions")
    jd: Mapped["JobDescription"] = relationship(back_populates="sessions")
    questions: Mapped[list["PrepQuestion"]] = relationship(back_populates="session", cascade="all, delete-orphan")


class PrepQuestion(Base):
    __tablename__ = "prep_questions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tailoring_sessions.id", ondelete="CASCADE"), index=True
    )
    topic: Mapped[str] = mapped_column(String(255), nullable=False)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    answer_framework: Mapped[str] = mapped_column(Text, nullable=False)
    is_gap_based: Mapped[bool] = mapped_column(Boolean, default=True)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False)
    practiced_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)

    session: Mapped["TailoringSession"] = relationship(back_populates="questions")


class LearningItem(Base):
    __tablename__ = "learning_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    skill: Mapped[str] = mapped_column(String(255), nullable=False)
    # Which JD this was flagged from, if any — informational only, JD may be deleted later.
    source_jd_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="not_started")
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow)


class ExternalContact(Base):
    """People tracked outside the platform (not Career Copilot users) —
    distinct from Networking's Profile/connection_requests, which is for
    in-platform users."""

    __tablename__ = "external_contacts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(255), nullable=False)
    company: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="new")
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    email: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    linkedin_url: Mapped[str] = mapped_column(Text, nullable=False, default="")
    last_contact: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow)
