"""add tailoring_sessions.score_verdicts

Revision ID: 025
Revises: 024
Create Date: 2026-09-19 00:00:00.000000

Additive and nullable. The review's live score re-scored the user's choices
against the ORIGINAL résumé's semantic verdicts, so a kept rewrite's credit
for covering a JD responsibility never counted and the number barely moved
as rewrites were ticked. Sessions now store the before and after verdicts.
Older sessions keep NULL and score as they did.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "025"
down_revision: Union[str, None] = "024"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tailoring_sessions", sa.Column("score_verdicts", JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("tailoring_sessions", "score_verdicts")
