"""add skill_question_bank table

Revision ID: 006
Revises: 005
Create Date: 2026-08-13 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "skill_question_bank",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("skill", sa.String(200), nullable=False),
        sa.Column("topic", sa.String(20), nullable=False),
        sa.Column("question", sa.Text, nullable=False),
        sa.Column("answer_framework", sa.Text, nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False),
    )
    op.create_index("ix_skill_question_bank_skill", "skill_question_bank", ["skill"])
    op.create_index(
        "ix_skill_question_bank_topic_created",
        "skill_question_bank",
        ["topic", sa.text("created_at DESC")],
    )


def downgrade() -> None:
    op.drop_index("ix_skill_question_bank_topic_created", table_name="skill_question_bank")
    op.drop_index("ix_skill_question_bank_skill", table_name="skill_question_bank")
    op.drop_table("skill_question_bank")
