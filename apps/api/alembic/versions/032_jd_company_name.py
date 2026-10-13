"""add job_descriptions.company_name

Revision ID: 032
Revises: 031
Create Date: 2026-10-13 00:00:00.000000

The target company a user saved for a JD, so tailoring against it again
doesn't mean typing the company again. See JobDescription.company_name.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "032"
down_revision: Union[str, None] = "031"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("job_descriptions", sa.Column("company_name", sa.String(200), nullable=True))


def downgrade() -> None:
    op.drop_column("job_descriptions", "company_name")
