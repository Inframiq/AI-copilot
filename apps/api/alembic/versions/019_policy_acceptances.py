"""add policy_acceptances (Terms/Privacy consent record)

Revision ID: 019
Revises: 018
Create Date: 2026-09-13 00:00:00.000000

One row per user: the Terms of Service / Privacy Policy version they most
recently agreed to and when. Upserted by POST /me/policy-acceptance right
after Google sign-in completes — see (auth)/callback/route.ts — since the
consent checkbox on the login/register page is otherwise lost across the
OAuth redirect. Exists so acceptance is provable evidence, not just a UI
checkbox that leaves no trace.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "019"
down_revision: Union[str, None] = "018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "policy_acceptances",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("terms_version", sa.String(20), nullable=False),
        sa.Column("privacy_version", sa.String(20), nullable=False),
        sa.Column("accepted_at", sa.TIMESTAMP(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("policy_acceptances")
