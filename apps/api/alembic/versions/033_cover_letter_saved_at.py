"""add cover_letters.saved_at

Revision ID: 033
Revises: 032
Create Date: 2026-10-13 00:00:00.000000

A generated letter is a draft until the user saves it (saved_at set). Drafts
stay out of the Cover Letters list and the JD's letter. Letters that existed
before this were already treated as saved, so they keep that.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "033"
down_revision: Union[str, None] = "032"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("cover_letters", sa.Column("saved_at", sa.TIMESTAMP(timezone=True), nullable=True))
    op.execute("UPDATE cover_letters SET saved_at = created_at")


def downgrade() -> None:
    op.drop_column("cover_letters", "saved_at")
