"""add original_file_path/original_file_name to resumes

Revision ID: 005
Revises: 004
Create Date: 2026-08-12 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("resumes", sa.Column("original_file_path", sa.Text(), nullable=True))
    op.add_column("resumes", sa.Column("original_file_name", sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column("resumes", "original_file_name")
    op.drop_column("resumes", "original_file_path")
