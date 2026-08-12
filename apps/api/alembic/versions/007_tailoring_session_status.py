"""add status/company_keywords/suggested_skills to tailoring_sessions

Revision ID: 007
Revises: 006
Create Date: 2026-08-13 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tailoring_sessions",
        sa.Column("status", sa.String(20), nullable=False, server_default="completed"),
    )
    op.add_column(
        "tailoring_sessions",
        sa.Column(
            "company_keywords",
            postgresql.ARRAY(sa.String()),
            nullable=False,
            server_default="{}",
        ),
    )
    op.add_column(
        "tailoring_sessions",
        sa.Column(
            "suggested_skills",
            postgresql.ARRAY(sa.String()),
            nullable=False,
            server_default="{}",
        ),
    )


def downgrade() -> None:
    op.drop_column("tailoring_sessions", "suggested_skills")
    op.drop_column("tailoring_sessions", "company_keywords")
    op.drop_column("tailoring_sessions", "status")
