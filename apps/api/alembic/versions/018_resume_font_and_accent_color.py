"""add resumes.font_choice and resumes.accent_color

Revision ID: 018
Revises: 017
Create Date: 2026-09-05 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "018"
down_revision: Union[str, None] = "017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "resumes",
        sa.Column("font_choice", sa.String(20), nullable=False, server_default="sans"),
    )
    op.add_column(
        "resumes",
        # NULL = use the template's own default accent color (see
        # services/pdf.py TEMPLATE_DEFAULT_ACCENT), not "no accent" —
        # every template always renders with some accent color.
        sa.Column("accent_color", sa.String(7), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("resumes", "accent_color")
    op.drop_column("resumes", "font_choice")
