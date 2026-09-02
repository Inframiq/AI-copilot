"""drop skill_question_bank table

Revision ID: 015
Revises: 014
Create Date: 2026-09-03 00:00:00.000000

The shared, cross-user question bank (added in 006) backed only the
Interview Center's pre-session "browse" view. Interview questions are now
produced exclusively by a real JD tailoring run (get_or_generate_prep_questions
/ _agent4_generate_interview_questions), so the bank, its feeder
(_fill_skill_bank) and its endpoint (GET /ai/questions/browse) are gone.

Irreversible in practice — downgrade recreates an empty table; the
accumulated cross-user rows are not restored.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "015"
down_revision: Union[str, None] = "014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index("ix_skill_question_bank_topic_created", table_name="skill_question_bank")
    op.drop_index("ix_skill_question_bank_skill", table_name="skill_question_bank")
    op.drop_table("skill_question_bank")


def downgrade() -> None:
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
