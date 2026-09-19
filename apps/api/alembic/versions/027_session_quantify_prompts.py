"""add tailoring_sessions.quantify_prompts

Revision ID: 027
Revises: 026
Create Date: 2026-09-19 00:00:00.000000

{bullet_id: question} — for each tailored bullet that still carries no
number, a question asking the candidate for one ("How many people used these
tools each week?"). The review shows them so the user can quantify the résumé
with real figures; the writer is never allowed to invent one. Nullable: older
sessions simply have no questions.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "027"
down_revision: Union[str, None] = "026"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tailoring_sessions",
        sa.Column("quantify_prompts", postgresql.JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("tailoring_sessions", "quantify_prompts")
