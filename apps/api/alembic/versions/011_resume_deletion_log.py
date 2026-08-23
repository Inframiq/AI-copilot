"""add resume_deletion_log audit table

Revision ID: 011
Revises: 010
Create Date: 2026-08-23 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "011"
down_revision: Union[str, None] = "010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "resume_deletion_log",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        # Not a foreign key — the whole point is this row survives after the
        # resume it describes is gone.
        sa.Column("resume_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        # Whether career_profiles.master_resume_id pointed at this resume at
        # the moment it was deleted — the exact condition that caused the
        # 2026-08-23 "my resume disappeared" incident, so this is answerable
        # directly from the log instead of cross-referencing timestamps.
        sa.Column("was_master_resume", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_resume_deletion_log_user_id", "resume_deletion_log", ["user_id"])
    op.create_index("ix_resume_deletion_log_resume_id", "resume_deletion_log", ["resume_id"])


def downgrade() -> None:
    op.drop_table("resume_deletion_log")
