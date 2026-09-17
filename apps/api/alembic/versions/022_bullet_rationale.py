"""add tailoring_sessions.bullet_rationale

Revision ID: 022
Revises: 021
Create Date: 2026-09-17 00:00:00.000000

Additive only — sessions tailored before this column existed keep NULL, which
the frontend reads as "no rationale available" and simply renders no
explanation line, exactly as it did before.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "022"
down_revision: Union[str, None] = "021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tailoring_sessions", sa.Column("bullet_rationale", JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("tailoring_sessions", "bullet_rationale")
