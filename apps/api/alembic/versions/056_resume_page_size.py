"""add resumes.page_size

Revision ID: 056
Revises: 055
Create Date: 2026-11-01 00:00:00.000000

The paper a résumé renders on: "A4" (India, Europe) or "Letter" (US
applications), as the ATS reference asks. Every résumé so far rendered on
WeasyPrint's default A4, so that is what existing rows get — none changes.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "056"
down_revision: Union[str, None] = "055"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "resumes",
        sa.Column("page_size", sa.String(10), nullable=False, server_default="A4"),
    )
    op.create_check_constraint(
        "resumes_page_size_known", "resumes", "page_size IN ('A4', 'Letter')"
    )


def downgrade() -> None:
    op.drop_constraint("resumes_page_size_known", "resumes", type_="check")
    op.drop_column("resumes", "page_size")
