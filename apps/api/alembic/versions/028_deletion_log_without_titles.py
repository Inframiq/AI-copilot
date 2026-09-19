"""blank the titles kept in resume_deletion_log

Revision ID: 028
Revises: 027
Create Date: 2026-09-19 00:00:00.000000

The log outlives the resume it describes, and a résumé title is often the
user's own name ("Jane Doe Resume"). The Privacy Policy says deleting a
résumé removes it; keeping its title contradicted that. New rows are
written without one, and this clears the ones already there. The ids and
timestamp still answer "who deleted what, and when".
"""
from typing import Sequence, Union

from alembic import op

revision: str = "028"
down_revision: Union[str, None] = "027"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("UPDATE resume_deletion_log SET title = '' WHERE title <> ''")


def downgrade() -> None:
    # The titles are gone by design; there is nothing to restore.
    pass
