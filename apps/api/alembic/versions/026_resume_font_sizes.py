"""add resumes.heading_size_delta / body_size_delta

Revision ID: 026
Revises: 025
Create Date: 2026-09-19 00:00:00.000000

Points added to the font sizes each template declares, for headings and for
body content independently. Zero is "standard" — the templates' own numbers,
already inside the 10-12pt band résumé guidance asks for — so every existing
résumé keeps exactly the layout it has.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "026"
down_revision: Union[str, None] = "025"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    for column in ("heading_size_delta", "body_size_delta"):
        op.add_column(
            "resumes",
            sa.Column(column, sa.Integer(), nullable=False, server_default="0"),
        )


def downgrade() -> None:
    for column in ("body_size_delta", "heading_size_delta"):
        op.drop_column("resumes", column)
