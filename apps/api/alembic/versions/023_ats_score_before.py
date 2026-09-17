"""add tailoring_sessions.ats_score_before

Revision ID: 023
Revises: 022
Create Date: 2026-09-18 00:00:00.000000

Additive and nullable. The pipeline always computed this (it logs
"ats %d -> %d") but only ever returned the after-score, so the review screen
could show a bare number and never the lift it represents. Sessions tailored
before this column existed keep NULL, and the UI falls back to showing the
after-score alone, exactly as it did.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "023"
down_revision: Union[str, None] = "022"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tailoring_sessions", sa.Column("ats_score_before", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("tailoring_sessions", "ats_score_before")
