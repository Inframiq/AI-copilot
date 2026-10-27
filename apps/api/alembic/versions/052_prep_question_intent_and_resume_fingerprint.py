"""what each interview question tests, and which résumé it was written from

Revision ID: 052
Revises: 051
Create Date: 2026-10-27 00:00:00.000000

interviewer_intent: the model already wrote what each question tests, then it
was thrown away. Kept now and shown as "What they're testing".

resume_fingerprint: a hash of the saved résumé's content the set was written
from. The Studio keeps autosaving into the saved copy after Save to JD, so
the questions could go out of date with nothing to say so; comparing the
hash with the résumé as it is now does. Content only, so a template or
spacing change doesn't count as an edit.

Both null on existing sets: nothing to show, and "unknown" is never reported
as changed.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "052"
down_revision: Union[str, None] = "051"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("prep_questions", sa.Column("interviewer_intent", sa.Text(), nullable=True))
    op.add_column("prep_questions", sa.Column("resume_fingerprint", sa.String(64), nullable=True))


def downgrade() -> None:
    op.drop_column("prep_questions", "resume_fingerprint")
    op.drop_column("prep_questions", "interviewer_intent")
