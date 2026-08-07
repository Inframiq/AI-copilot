"""initial schema

Revision ID: 001
Revises:
Create Date: 2026-08-06 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- resumes ---
    op.create_table(
        "resumes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("content", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
        sa.Column("template_id", sa.String(50), nullable=False, server_default="ats_clean"),
        sa.Column("pdf_url", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            postgresql.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_resumes_user_id", "resumes", ["user_id"])

    # --- job_descriptions ---
    op.create_table(
        "job_descriptions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("raw_text", sa.Text(), nullable=False),
        sa.Column("parsed", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_job_descriptions_user_id", "job_descriptions", ["user_id"])

    # --- tailoring_sessions ---
    op.create_table(
        "tailoring_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "resume_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("resumes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "jd_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("job_descriptions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("ats_score", sa.Integer(), nullable=True),
        sa.Column(
            "matched_skills",
            postgresql.ARRAY(sa.String()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column(
            "missing_skills",
            postgresql.ARRAY(sa.String()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("tailored_content", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("humanize_level", sa.Integer(), nullable=False, server_default="50"),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_tailoring_sessions_user_id", "tailoring_sessions", ["user_id"])

    # --- prep_questions ---
    op.create_table(
        "prep_questions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tailoring_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("topic", sa.String(255), nullable=False),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("answer_framework", sa.Text(), nullable=False),
        sa.Column("is_gap_based", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("order_index", sa.Integer(), nullable=False),
    )
    op.create_index("ix_prep_questions_session_id", "prep_questions", ["session_id"])


def downgrade() -> None:
    op.drop_table("prep_questions")
    op.drop_table("tailoring_sessions")
    op.drop_table("job_descriptions")
    op.drop_table("resumes")
