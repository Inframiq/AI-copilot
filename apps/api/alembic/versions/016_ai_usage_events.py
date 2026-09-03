"""add ai_usage_events ledger

Revision ID: 016
Revises: 015
Create Date: 2026-09-03 00:00:00.000000

Append-only per-LLM-call usage ledger. Written by app.core.usage; read for
per-user cost analytics. The POST /ai/tailor quota check counts
tailoring_sessions directly (not this table), so this is purely additive
and safe to deploy ahead of any wiring that fills it.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "016"
down_revision: Union[str, None] = "015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "ai_usage_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("action", sa.String(40), nullable=False),
        sa.Column("call_name", sa.String(60), nullable=False),
        sa.Column("model", sa.String(80), nullable=False, server_default=""),
        sa.Column("model_tier", sa.String(20), nullable=False, server_default=""),
        sa.Column("input_tokens", sa.Integer, nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.Integer, nullable=False, server_default="0"),
        sa.Column("reasoning_tokens", sa.Integer, nullable=False, server_default="0"),
        sa.Column("total_tokens", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False),
    )
    op.create_index("ix_ai_usage_events_user_id", "ai_usage_events", ["user_id"])
    op.create_index("ix_ai_usage_events_created_at", "ai_usage_events", ["created_at"])
    op.create_index(
        "ix_ai_usage_events_user_action_created",
        "ai_usage_events",
        ["user_id", "action", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_ai_usage_events_user_action_created", table_name="ai_usage_events")
    op.drop_index("ix_ai_usage_events_created_at", table_name="ai_usage_events")
    op.drop_index("ix_ai_usage_events_user_id", table_name="ai_usage_events")
    op.drop_table("ai_usage_events")
