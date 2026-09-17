"""add tailoring_sessions.reverted_bullets

Revision ID: 021
Revises: 020
Create Date: 2026-09-17 00:00:00.000000

Additive only — sessions completed before the fact-lock guard existed keep
NULL, which the frontend reads as "nothing was reverted" (the same thing it
showed before this column existed).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "021"
down_revision: Union[str, None] = "020"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tailoring_sessions", sa.Column("reverted_bullets", JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("tailoring_sessions", "reverted_bullets")
