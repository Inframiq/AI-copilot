"""add status to job_descriptions, add external_contacts table

Revision ID: 004
Revises: 003
Create Date: 2026-08-08 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "job_descriptions",
        sa.Column("status", sa.String(20), nullable=False, server_default="applied"),
    )
    op.alter_column("job_descriptions", "status", server_default=None)

    op.create_table(
        "external_contacts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("role", sa.String(255), nullable=False),
        sa.Column("company", sa.String(255), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="new"),
        sa.Column("notes", sa.Text, nullable=False, server_default=""),
        sa.Column("email", sa.String(255), nullable=False, server_default=""),
        sa.Column("linkedin_url", sa.Text, nullable=False, server_default=""),
        sa.Column("last_contact", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False),
    )
    op.create_index("ix_external_contacts_user_id", "external_contacts", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_external_contacts_user_id", table_name="external_contacts")
    op.drop_table("external_contacts")
    op.drop_column("job_descriptions", "status")
