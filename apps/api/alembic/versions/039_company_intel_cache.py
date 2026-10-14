"""add company_intel_cache

Revision ID: 039
Revises: 038
Create Date: 2026-10-13 00:00:00.000000

Agent 0 now researches a company on the live web (about 10-13 cents and
15-19 seconds a lookup). Its result is kept per company name, so a company
is looked up once a month, not on every analyze and tailor.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "039"
down_revision: Union[str, None] = "038"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "company_intel_cache",
        sa.Column("company_key", sa.String(200), primary_key=True),
        sa.Column("intel", postgresql.JSONB(), nullable=False),
        sa.Column("fetched_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("company_intel_cache")
