"""add subscriptions (credit balance per user)

Revision ID: 017
Revises: 016
Create Date: 2026-09-03 00:00:00.000000

One row per user: plan, credit balance, billing cycle. Credits are spent by
app.core.credits.spend_credits at the top of metered endpoints. Rows are
created lazily on first metered call / first GET /me/subscription, so this
migration only creates the empty table — no backfill.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "017"
down_revision: Union[str, None] = "016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "subscriptions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("plan", sa.String(20), nullable=False, server_default="free"),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("credits_remaining", sa.Integer, nullable=False, server_default="0"),
        sa.Column("credits_allotment", sa.Integer, nullable=False, server_default="0"),
        sa.Column("current_period_start", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("current_period_end", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("provider", sa.String(20), nullable=True),
        sa.Column("provider_subscription_id", sa.String(255), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False),
    )
    op.create_index("ix_subscriptions_user_id", "subscriptions", ["user_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_subscriptions_user_id", table_name="subscriptions")
    op.drop_table("subscriptions")
