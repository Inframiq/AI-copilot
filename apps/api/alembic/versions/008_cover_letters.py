"""add cover_letters table

Revision ID: 008
Revises: 007
Create Date: 2026-08-13 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "008"
down_revision: Union[str, None] = "007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "cover_letters",
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
        sa.Column(
            "tailoring_session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tailoring_sessions.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("content", sa.Text, nullable=True),
        sa.Column("humanize_level", sa.Integer, nullable=False, server_default="50"),
        sa.Column("pdf_url", sa.Text, nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False),
    )
    op.create_index("ix_cover_letters_user_id", "cover_letters", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_cover_letters_user_id", table_name="cover_letters")
    op.drop_table("cover_letters")
