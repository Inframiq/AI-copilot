"""add tailoring_sessions.ats_fixes and .bullet_importance

Revision ID: 014
Revises: 013
Create Date: 2026-08-30 00:00:00.000000

Additive only — existing completed sessions keep NULL and the frontend
falls back to the legacy missing/suggested-skills rendering for them.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "014"
down_revision: Union[str, None] = "013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tailoring_sessions", sa.Column("ats_fixes", JSONB(), nullable=True))
    op.add_column("tailoring_sessions", sa.Column("bullet_importance", JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("tailoring_sessions", "bullet_importance")
    op.drop_column("tailoring_sessions", "ats_fixes")
