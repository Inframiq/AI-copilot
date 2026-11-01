"""the career profile holds Coursework

Revision ID: 057
Revises: 056
Create Date: 2026-11-01 00:00:00.000000

Coursework ("Data Structures", "Operating Systems") is one of the student
résumé's sections, and the profile had nowhere to keep it. A list of lines,
with the same limits as 053's other lists — 20 items of 300 characters,
each a string — since the browser writes career_profiles itself and these
are the only server-side limits.

Existing rows get an empty list. Skipped where career_profiles doesn't exist
(the local test database). One DO block: the deploy runs each op.execute as
one prepared statement.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "057"
down_revision: Union[str, None] = "056"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MAX_ITEMS = 20
MAX_ITEM_CHARS = 300


def _longer_than(chars: int) -> str:
    """A jsonpath regex for a string longer than `chars` (Postgres caps one
    repeat count at 255, so a longer run is spelled in pieces) — as 053."""
    n, pieces = chars + 1, []
    while n > 0:
        pieces.append(f".{{{min(n, 255)}}}")
        n -= 255
    return "^" + "".join(pieces)


UPGRADE_SQL = f"""
DO $$
BEGIN
  IF to_regclass('public.career_profiles') IS NULL THEN
    RETURN;
  END IF;
  ALTER TABLE public.career_profiles
    ADD COLUMN IF NOT EXISTS coursework jsonb NOT NULL DEFAULT '[]';
  ALTER TABLE public.career_profiles ADD CONSTRAINT career_profiles_coursework_limits CHECK (
    jsonb_typeof(coursework) = 'array'
    AND jsonb_array_length(coursework) <= {MAX_ITEMS}
    AND NOT jsonb_path_exists(coursework,
      '$[*] ? (@.type() != "string" || @ like_regex "{_longer_than(MAX_ITEM_CHARS)}" flag "s")'));
  NOTIFY pgrst, 'reload schema';
END $$;
"""

DOWNGRADE_SQL = """
DO $$
BEGIN
  IF to_regclass('public.career_profiles') IS NULL THEN
    RETURN;
  END IF;
  ALTER TABLE public.career_profiles DROP COLUMN IF EXISTS coursework;
  NOTIFY pgrst, 'reload schema';
END $$;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
