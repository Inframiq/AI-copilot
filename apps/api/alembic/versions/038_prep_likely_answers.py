"""likely answers and follow-up chains for interview questions

Revision ID: 038
Revises: 037
Create Date: 2026-10-14 00:00:00.000000

Each interview question gets a tailored likely answer (written with the set),
and a chain of follow-ups: the interviewer's next question is shown, and its
likely answer is written on request, adding the next follow-up.

Existing sets keep their answer framework. The follow-up it names
("Likely follow-up: ...") becomes the first step of the question's chain, so
older questions get the chain too.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "038"
down_revision: Union[str, None] = "037"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("prep_questions", sa.Column("likely_answer", sa.Text(), nullable=True))
    op.create_table(
        "prep_followups",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "question_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("prep_questions.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("answer", sa.Text(), nullable=True),
        sa.Column("claimed_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("question_id", "position", name="uq_prep_followups_question_position"),
    )
    op.create_index("ix_prep_followups_question_id", "prep_followups", ["question_id"])
    op.execute(
        """
        INSERT INTO prep_followups (id, question_id, position, question)
        SELECT gen_random_uuid(), id, 1,
               btrim(split_part(answer_framework, 'Likely follow-up:', 2))
        FROM prep_questions
        WHERE answer_framework LIKE '%Likely follow-up:%'
          AND btrim(split_part(answer_framework, 'Likely follow-up:', 2)) <> ''
        """
    )


def downgrade() -> None:
    op.drop_index("ix_prep_followups_question_id", table_name="prep_followups")
    op.drop_table("prep_followups")
    op.drop_column("prep_questions", "likely_answer")
