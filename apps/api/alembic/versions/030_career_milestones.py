"""add career_milestones

Revision ID: 030
Revises: 029
Create Date: 2026-10-11 00:00:00.000000

Milestones the user adds on Career Path ("Add milestone"), next to the ones
the page works out from activity. See CareerMilestone.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "030"
down_revision: Union[str, None] = "029"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "career_milestones",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("done", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_career_milestones_user_id", "career_milestones", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_career_milestones_user_id", table_name="career_milestones")
    op.drop_table("career_milestones")
