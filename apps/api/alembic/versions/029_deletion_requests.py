"""add deletion_requests

Revision ID: 029
Revises: 028
Create Date: 2026-09-19 00:00:00.000000

Requests to delete personal data from people who can't use the in-app
Delete account button: former users who lost access, and people who were
never users but whose details someone entered. See DeletionRequest.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "029"
down_revision: Union[str, None] = "028"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "deletion_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("name", sa.String(255), nullable=True),
        sa.Column("requester_type", sa.String(20), nullable=False),
        sa.Column("details", sa.Text(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="open"),
        sa.Column("resolution_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now()),
        sa.Column("resolved_at", sa.TIMESTAMP(timezone=True), nullable=True),
    )
    op.create_index("ix_deletion_requests_email", "deletion_requests", ["email"])
    op.create_index("ix_deletion_requests_status", "deletion_requests", ["status"])
    op.create_index("ix_deletion_requests_created_at", "deletion_requests", ["created_at"])


def downgrade() -> None:
    op.drop_table("deletion_requests")
