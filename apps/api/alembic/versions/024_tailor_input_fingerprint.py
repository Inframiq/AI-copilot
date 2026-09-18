"""add tailoring_sessions.input_fingerprint

Revision ID: 024
Revises: 023
Create Date: 2026-09-19 00:00:00.000000

Additive, nullable and indexed. The tailoring model accepts no temperature or
seed, so tailoring the same résumé to the same JD twice produced different
wording. POST /ai/tailor now reuses a completed session whose inputs
fingerprint identically. Sessions from before this keep NULL and are never
reused.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "024"
down_revision: Union[str, None] = "023"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tailoring_sessions", sa.Column("input_fingerprint", sa.String(length=64), nullable=True))
    op.create_index(
        "ix_tailoring_sessions_input_fingerprint", "tailoring_sessions", ["input_fingerprint"]
    )


def downgrade() -> None:
    op.drop_index("ix_tailoring_sessions_input_fingerprint", table_name="tailoring_sessions")
    op.drop_column("tailoring_sessions", "input_fingerprint")
