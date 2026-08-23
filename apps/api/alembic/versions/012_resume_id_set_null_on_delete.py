"""tailoring_sessions/cover_letters.resume_id: CASCADE -> SET NULL

Revision ID: 012
Revises: 011
Create Date: 2026-08-24 00:00:00.000000

Deleting the resume a tailoring session or cover letter was originally run
against used to cascade-delete the session/letter itself (and, via
TailoringSession's own cascade, every linked PrepQuestion) — silently
wiping a JD's saved tailoring/interview-prep/cover-letter work as pure
collateral damage of removing an unrelated draft resume. tailored_content
and cover letter content are already self-contained snapshots that don't
need the original resume row to still exist, so only the "which resume
this was run against" reference needs to go away, not the row itself —
matching the SET NULL pattern already used correctly for
job_descriptions.tailored_resume_id.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "012"
down_revision: Union[str, None] = "011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("tailoring_sessions", "resume_id", nullable=True)
    op.drop_constraint("tailoring_sessions_resume_id_fkey", "tailoring_sessions", type_="foreignkey")
    op.create_foreign_key(
        "tailoring_sessions_resume_id_fkey", "tailoring_sessions", "resumes",
        ["resume_id"], ["id"], ondelete="SET NULL",
    )

    op.alter_column("cover_letters", "resume_id", nullable=True)
    op.drop_constraint("cover_letters_resume_id_fkey", "cover_letters", type_="foreignkey")
    op.create_foreign_key(
        "cover_letters_resume_id_fkey", "cover_letters", "resumes",
        ["resume_id"], ["id"], ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("cover_letters_resume_id_fkey", "cover_letters", type_="foreignkey")
    op.create_foreign_key(
        "cover_letters_resume_id_fkey", "cover_letters", "resumes",
        ["resume_id"], ["id"], ondelete="CASCADE",
    )
    op.alter_column("cover_letters", "resume_id", nullable=False)

    op.drop_constraint("tailoring_sessions_resume_id_fkey", "tailoring_sessions", type_="foreignkey")
    op.create_foreign_key(
        "tailoring_sessions_resume_id_fkey", "tailoring_sessions", "resumes",
        ["resume_id"], ["id"], ondelete="CASCADE",
    )
    op.alter_column("tailoring_sessions", "resume_id", nullable=False)
