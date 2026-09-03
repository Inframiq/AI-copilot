import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Integer, Boolean, Text, ARRAY, ForeignKey, Float
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
    # PDF rendering preferences — see services/pdf.py generate_pdf. Same
    # persist-on-change pattern as template_id (set via POST /{id}/pdf).
    line_spacing: Mapped[float] = mapped_column(Float, nullable=False, default=1.25)
    paragraph_spacing: Mapped[int] = mapped_column(Integer, nullable=False, default=12)
    # Stores path in Supabase Storage: resumes/{user_id}/{resume_id}.pdf — NOT a signed URL
    pdf_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Untouched original file the user uploaded (PDF only), stored at
    # resumes/{user_id}/{resume_id}/original.pdf — NOT a signed URL. Null for
    # resumes built from scratch in Studio (no upload). This is the "master
    # copy" Preview shows verbatim — never the AI-parsed/templated version.
    original_file_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    original_file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow, onupdate=utcnow)

    # No delete cascade here deliberately — a tailoring session's own
    # tailored_content/ats_score/prep-questions are a self-contained
    # snapshot that doesn't need this resume (the input it was originally
    # run against) to still exist. TailoringSession.resume_id is nullable
    # with ON DELETE SET NULL at the DB level (see migration 012); without
    # removing this cascade, SQLAlchemy would still delete every session
    # tied to this resume on `db.delete(resume)` regardless of that DB
    # constraint, silently wiping a JD's saved tailoring/interview-prep
    # work as collateral damage of deleting an unrelated draft resume —
    # exactly what happened before this was caught.
    sessions: Mapped[list["TailoringSession"]] = relationship(back_populates="resume")


class ResumeDeletionLog(Base):
    """Server-side audit trail for resume deletions — written by
    DELETE /resumes/{id} (routers/resumes.py) right before the Resume row
    itself is removed, so there's a durable record of who deleted what and
    when even after the resume is gone. resume_id is deliberately NOT a
    foreign key (the whole point is this row outlives the resume it
    describes)."""

    __tablename__ = "resume_deletion_log"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    resume_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    # Whether career_profiles.master_resume_id pointed at this resume at the
    # moment of deletion — the exact condition behind the 2026-08-23 "my
    # resume disappeared" incident, answerable directly from this log now.
    was_master_resume: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    deleted_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow)


class JobDescription(Base):
    __tablename__ = "job_descriptions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    raw_text: Mapped[str] = mapped_column(Text, nullable=False)
    parsed: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # not_applied -> applied -> interview -> final_round -> offer -> accepted, or rejected at any point
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="not_applied")
    # The resume the user explicitly saved (Studio's "Save tailored resume")
    # for this JD, distinct from TailoringSession.resume_id (the resume
    # tailoring was RUN against, i.e. the input). Null until the user saves
    # one; a later save-as-new for the same JD overwrites the resume this
    # points at rather than creating another row — see create_resume in
    # routers/resumes.py. SET NULL (not CASCADE) so deleting that resume
    # doesn't take the JD down with it.
    tailored_resume_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("resumes.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow)

    sessions: Mapped[list["TailoringSession"]] = relationship(back_populates="jd", cascade="all, delete-orphan")


class TailoringSession(Base):
    __tablename__ = "tailoring_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    # Nullable + SET NULL (not CASCADE) — see the comment on Resume.sessions.
    # This is the resume tailoring was RUN against (the input), distinct
    # from JobDescription.tailored_resume_id (what the user explicitly
    # chose to save/keep for this JD).
    resume_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("resumes.id", ondelete="SET NULL"), nullable=True
    )
    jd_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("job_descriptions.id", ondelete="CASCADE")
    )
    ats_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    matched_skills: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    missing_skills: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    tailored_content: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    humanize_level: Mapped[int] = mapped_column(Integer, default=50)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    company_keywords: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    suggested_skills: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    ats_fixes: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    bullet_importance: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow)

    resume: Mapped["Resume | None"] = relationship(back_populates="sessions")
    jd: Mapped["JobDescription"] = relationship(back_populates="sessions")
    questions: Mapped[list["PrepQuestion"]] = relationship(back_populates="session", cascade="all, delete-orphan")


class CoverLetter(Base):
    __tablename__ = "cover_letters"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    # Nullable + SET NULL (not CASCADE) — a cover letter's own `content` is a
    # self-contained snapshot that doesn't need the resume it was generated
    # from to still exist. See the comment on Resume.sessions for why this
    # matters: deleting a draft resume must not silently wipe every cover
    # letter ever written from it. (Only PDF export's contact-info lookup
    # degrades gracefully to blank if this is null — regenerating a letter
    # from scratch still needs a real resume, checked at the router level.)
    resume_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("resumes.id", ondelete="SET NULL"), nullable=True
    )
    jd_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("job_descriptions.id", ondelete="CASCADE")
    )
    # Nullable — set when generated from an existing tailoring session (reuses
    # its tailored content); null for a standalone resume+JD generation. When
    # the linked session is deleted, the letter goes with it (CASCADE),
    # mirroring how PrepQuestion cascades off TailoringSession.
    tailoring_session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tailoring_sessions.id", ondelete="CASCADE"), nullable=True
    )
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    humanize_level: Mapped[int] = mapped_column(Integer, default=50)
    pdf_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow)


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
    # "requirement" (seeded from a JD core_responsibilities entry) |
    # "overlap" (seeded from a matched_skill + real resume evidence) |
    # "gap" (seeded from a missing_skill, reframed to bridge from a related
    # skill the candidate does have — never raw trivia on the gap itself).
    # See tailoring.py's InterviewQuestionData / _agent4_generate_interview_questions.
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="requirement")
    # Short, human-readable grounding — the specific responsibility/skill
    # this question was generated from (e.g. "Owns checkout flow
    # reliability" or "Kubernetes (matched)") — surfaced to the user so a
    # personalized question visibly IS personalized, not just claimed to be.
    basis: Mapped[str] = mapped_column(Text, nullable=False, default="")
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


class Subscription(Base):
    """One row per user — their plan, credit balance, and (for paid plans)
    billing cycle. Credits are spent by app.core.credits.spend_credits at the
    top of metered endpoints (tailor / cover letter / bullet rewrite)."""

    __tablename__ = "subscriptions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, unique=True, index=True)
    plan: Mapped[str] = mapped_column(String(20), nullable=False, default="free")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    credits_remaining: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    credits_allotment: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    current_period_start: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow)
    # NULL = a one-time grant that never refills (the free plan). When set,
    # it's the end of the current monthly cycle: on/after it, credits refill
    # to credits_allotment and this advances by 30 days. Paid plans set it.
    current_period_end: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    # Populated by the payment webhook (not built yet — billing lands with GST).
    provider: Mapped[str | None] = mapped_column(String(20), nullable=True)
    provider_subscription_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow, onupdate=utcnow)


class AiUsageEvent(Base):
    """Append-only ledger — one row per LLM API call, written from the
    provider via app.core.usage.record_ai_usage(). Powers per-user cost
    analytics and the POST /ai/tailor quota check. No foreign keys on
    purpose: it must outlive the session / resume / JD it describes."""

    __tablename__ = "ai_usage_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    # The user-facing action this call was part of: "tailor" | "analyze" |
    # "rewrite_bullet" | "cover_letter" | "parse_resume" | "create_jd" | "prep_questions"
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    call_name: Mapped[str] = mapped_column(String(60), nullable=False)  # e.g. "agent2_semantic_map"
    model: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    model_tier: Mapped[str] = mapped_column(String(20), nullable=False, default="")
    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reasoning_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow, index=True)


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
