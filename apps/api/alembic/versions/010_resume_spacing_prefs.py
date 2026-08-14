"""add resumes.line_spacing and resumes.paragraph_spacing

Revision ID: 010
Revises: 009
Create Date: 2026-08-14 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "010"
down_revision: Union[str, None] = "009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "resumes",
        sa.Column("line_spacing", sa.Float, nullable=False, server_default="1.25"),
    )
    op.add_column(
        "resumes",
        sa.Column("paragraph_spacing", sa.Integer, nullable=False, server_default="12"),
    )


def downgrade() -> None:
    op.drop_column("resumes", "paragraph_spacing")
    op.drop_column("resumes", "line_spacing")
