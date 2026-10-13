"""add free_grant_ledger

Revision ID: 036
Revises: 035
Create Date: 2026-10-13 00:00:00.000000

Deleting an account and signing up again with the same email used to grant
the free credits a second time. On deletion we now keep a keyed one-way
fingerprint of the email (never the email itself) with the free credits that
were left, for 12 months, so a new account with that email resumes that
balance instead of a fresh grant.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "036"
down_revision: Union[str, None] = "035"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "free_grant_ledger",
        sa.Column("email_fingerprint", sa.String(64), primary_key=True),
        sa.Column("credits_remaining", sa.Integer(), nullable=False),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("free_grant_ledger")
