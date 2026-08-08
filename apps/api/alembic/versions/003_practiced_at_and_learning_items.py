"""add practiced_at to prep_questions, add learning_items table

Revision ID: 003
Revises: 002
Create Date: 2026-08-08 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "prep_questions",
        sa.Column("practiced_at", sa.TIMESTAMP(timezone=True), nullable=True),
    )

    op.create_table(
        "learning_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("skill", sa.String(255), nullable=False),
        sa.Column("source_jd_title", sa.String(255), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="not_started"),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False),
    )
    op.create_index("ix_learning_items_user_id", "learning_items", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_learning_items_user_id", table_name="learning_items")
    op.drop_table("learning_items")
    op.drop_column("prep_questions", "practiced_at")
