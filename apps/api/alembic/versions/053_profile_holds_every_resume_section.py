"""the career profile holds every résumé section

Revision ID: 053
Revises: 052
Create Date: 2026-10-29 00:00:00.000000

A résumé has Summary, Objective, Languages, Awards, Achievements, Leadership
and Volunteer sections (and now Interests); the profile had no place for any
of them, so an uploaded résumé's went into Miscellaneous as loose points and
a résumé started from the profile began without them. Each is a profile
column now:

- summary, objective: text, NULL when not written.
- languages: [{name, level}], level a string or null.
- awards, achievements, leadership, volunteer, interests: lists of lines.

The browser writes career_profiles itself, so these limits are the only
server-side ones (the form keeps to them too):

- summary 1,000 characters, objective 600 (the forms stop at 80 and 50
  words, as the résumé Builder does);
- languages 15 entries, name and level 100 characters each;
- every other list 20 items of 300 characters, each item a string.

Existing rows get empty sections; nothing already in Miscellaneous moves.
Skipped where career_profiles doesn't exist (the local test database).
"""
from typing import Sequence, Union

from alembic import op

revision: str = "053"
down_revision: Union[str, None] = "052"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

LIST_COLUMNS = ("awards", "achievements", "leadership", "volunteer", "interests")
MAX_ITEMS = 20
MAX_ITEM_CHARS = 300
MAX_LANGUAGES = 15
MAX_LANGUAGE_CHARS = 100
MAX_SUMMARY_CHARS = 1000
MAX_OBJECTIVE_CHARS = 600


def _longer_than(chars: int) -> str:
    """A jsonpath regex for a string longer than `chars`. Postgres caps one
    repeat count at 255, so a longer run is spelled in pieces."""
    n, pieces = chars + 1, []
    while n > 0:
        pieces.append(f".{{{min(n, 255)}}}")
        n -= 255
    return "^" + "".join(pieces)


def _list_check(column: str) -> str:
    # An item that isn't a string, or runs past the limit, is refused. A
    # regex counting characters is the only length test jsonpath has.
    return f"""
  ALTER TABLE public.career_profiles ADD CONSTRAINT career_profiles_{column}_limits CHECK (
    jsonb_typeof({column}) = 'array'
    AND jsonb_array_length({column}) <= {MAX_ITEMS}
    AND NOT jsonb_path_exists({column},
      '$[*] ? (@.type() != "string" || @ like_regex "{_longer_than(MAX_ITEM_CHARS)}" flag "s")'));"""


_LANGUAGES_CHECK = f"""
  ALTER TABLE public.career_profiles ADD CONSTRAINT career_profiles_languages_limits CHECK (
    jsonb_typeof(languages) = 'array'
    AND jsonb_array_length(languages) <= {MAX_LANGUAGES}
    AND NOT jsonb_path_exists(languages,
      '$[*] ? (@.type() != "object"
               || !exists(@.name) || @.name.type() != "string"
               || @.name like_regex "{_longer_than(MAX_LANGUAGE_CHARS)}" flag "s"
               || (exists(@.level) && @.level.type() != "string" && @.level.type() != "null")
               || @.level like_regex "{_longer_than(MAX_LANGUAGE_CHARS)}" flag "s")'));"""

_ADD_LISTS = ",\n".join(f"    ADD COLUMN IF NOT EXISTS {c} jsonb NOT NULL DEFAULT '[]'" for c in LIST_COLUMNS)
_DROP_LISTS = ",\n".join(f"    DROP COLUMN IF EXISTS {c}" for c in LIST_COLUMNS)

UPGRADE_SQL = f"""
DO $$
BEGIN
  IF to_regclass('public.career_profiles') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE public.career_profiles
    ADD COLUMN IF NOT EXISTS summary text,
    ADD COLUMN IF NOT EXISTS objective text,
    ADD COLUMN IF NOT EXISTS languages jsonb NOT NULL DEFAULT '[]',
{_ADD_LISTS};

  ALTER TABLE public.career_profiles ADD CONSTRAINT career_profiles_summary_limit
    CHECK (summary IS NULL OR char_length(summary) <= {MAX_SUMMARY_CHARS});
  ALTER TABLE public.career_profiles ADD CONSTRAINT career_profiles_objective_limit
    CHECK (objective IS NULL OR char_length(objective) <= {MAX_OBJECTIVE_CHARS});
{_LANGUAGES_CHECK}
{"".join(_list_check(c) for c in LIST_COLUMNS)}

  -- The browser reaches the table through PostgREST, which has to see the
  -- new columns before a save that names them can work.
  NOTIFY pgrst, 'reload schema';
END $$;
"""

DOWNGRADE_SQL = f"""
DO $$
BEGIN
  IF to_regclass('public.career_profiles') IS NULL THEN
    RETURN;
  END IF;
  ALTER TABLE public.career_profiles
    DROP COLUMN IF EXISTS summary,
    DROP COLUMN IF EXISTS objective,
    DROP COLUMN IF EXISTS languages,
{_DROP_LISTS};
  NOTIFY pgrst, 'reload schema';
END $$;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
