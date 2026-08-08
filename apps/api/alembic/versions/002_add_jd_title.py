"""add title to job_descriptions

Revision ID: 002
Revises: 001
Create Date: 2026-08-08 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "job_descriptions",
        sa.Column("title", sa.String(255), nullable=False, server_default="Untitled JD"),
    )
    op.alter_column("job_descriptions", "title", server_default=None)


def downgrade() -> None:
    op.drop_column("job_descriptions", "title")
