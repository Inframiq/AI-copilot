"""add cover_letters.title

Revision ID: 034
Revises: 033
Create Date: 2026-10-13 00:00:00.000000

A letter's name, after its JD ("Cover letter — Platform Engineer, Stripe");
the user can rename it. Letters that existed before this are named the same
way from their JD.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "034"
down_revision: Union[str, None] = "033"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("cover_letters", sa.Column("title", sa.String(255), nullable=True))
    op.execute(
        """
        UPDATE cover_letters AS cl
        SET title = LEFT(
            'Cover letter — ' || jd.title || COALESCE(', ' || NULLIF(jd.company_name, ''), ''),
            255
        )
        FROM job_descriptions AS jd
        WHERE cl.jd_id = jd.id
        """
    )


def downgrade() -> None:
    op.drop_column("cover_letters", "title")
