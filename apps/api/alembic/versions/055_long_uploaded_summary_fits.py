"""an uploaded résumé's long summary fits the profile whole

Revision ID: 055
Revises: 054
Create Date: 2026-10-30 00:00:00.000000

The forms aim a summary at 80 words and an objective at 50, but text that
came from an uploaded résumé is never cut to fit: the user is shown the
count and trims it themselves. A 330-word summary is about 2,300
characters, and 053's 1,000-character limit cut it off mid-sentence on the
next profile save. The limits become 4,000 (summary) and 2,000
(objective) — still a bound on what the browser can write, well past any
real résumé's.

Skipped where career_profiles doesn't exist (the local test database).
"""
from typing import Sequence, Union

from alembic import op

revision: str = "055"
down_revision: Union[str, None] = "054"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MAX_SUMMARY_CHARS = 4000
MAX_OBJECTIVE_CHARS = 2000
# 053's, for the downgrade.
OLD_SUMMARY_CHARS = 1000
OLD_OBJECTIVE_CHARS = 600


def _limits_sql(summary: int, objective: int) -> str:
    # Text longer than a lower limit (a downgrade) is cut to fit first, as
    # 053's forms would have; going up, nothing is that long.
    return f"""
DO $$
BEGIN
  IF to_regclass('public.career_profiles') IS NULL THEN
    RETURN;
  END IF;
  UPDATE public.career_profiles SET summary = left(summary, {summary}) WHERE char_length(summary) > {summary};
  UPDATE public.career_profiles SET objective = left(objective, {objective}) WHERE char_length(objective) > {objective};
  ALTER TABLE public.career_profiles
    DROP CONSTRAINT IF EXISTS career_profiles_summary_limit,
    DROP CONSTRAINT IF EXISTS career_profiles_objective_limit;
  ALTER TABLE public.career_profiles ADD CONSTRAINT career_profiles_summary_limit
    CHECK (summary IS NULL OR char_length(summary) <= {summary});
  ALTER TABLE public.career_profiles ADD CONSTRAINT career_profiles_objective_limit
    CHECK (objective IS NULL OR char_length(objective) <= {objective});
END $$;
"""


def upgrade() -> None:
    op.execute(_limits_sql(MAX_SUMMARY_CHARS, MAX_OBJECTIVE_CHARS))


def downgrade() -> None:
    op.execute(_limits_sql(OLD_SUMMARY_CHARS, OLD_OBJECTIVE_CHARS))
