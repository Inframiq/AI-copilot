"""add prep_questions.source and prep_questions.basis (provenance)

Revision ID: 013
Revises: 012
Create Date: 2026-08-26 00:00:00.000000

Backfills existing rows from is_gap_based, which the new source column
supersedes: True -> "gap" (was skill-bank trivia), False -> "requirement"
(was the small JD-specific batch). Neither backfilled value is a perfect
match for the redesigned generator's categories (see tailoring.py's
InterviewQuestionData) — existing rows predate the "overlap" category
entirely — but it's an honest best-effort label, not a guess at content
that was never actually generated that way.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "013"
down_revision: Union[str, None] = "012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("prep_questions", sa.Column("source", sa.String(20), nullable=True))
    op.add_column("prep_questions", sa.Column("basis", sa.Text(), nullable=True))
    op.execute("UPDATE prep_questions SET source = CASE WHEN is_gap_based THEN 'gap' ELSE 'requirement' END")
    op.execute("UPDATE prep_questions SET basis = '' WHERE basis IS NULL")
    op.alter_column("prep_questions", "source", nullable=False, server_default="requirement")
    op.alter_column("prep_questions", "basis", nullable=False, server_default="")


def downgrade() -> None:
    op.drop_column("prep_questions", "basis")
    op.drop_column("prep_questions", "source")
