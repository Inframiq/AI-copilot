"""number cover letters that share a name within one job

Revision ID: 035
Revises: 034
Create Date: 2026-10-13 00:00:00.000000

034 named every existing letter after its JD, so a job with several letters
had several identical names. Within each user's job, the oldest keeps the
plain name and the rest become "… (2)", "… (3)" in the order written.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "035"
down_revision: Union[str, None] = "034"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE cover_letters AS cl
        SET title = LEFT(cl.title, 245) || ' (' || ranked.n || ')'
        FROM (
            SELECT id, ROW_NUMBER() OVER (
                PARTITION BY user_id, jd_id, title ORDER BY created_at, id
            ) AS n
            FROM cover_letters
            WHERE saved_at IS NOT NULL AND title IS NOT NULL
        ) AS ranked
        WHERE cl.id = ranked.id AND ranked.n > 1
        """
    )


def downgrade() -> None:
    # The numbers are names now; nothing to undo safely.
    pass
