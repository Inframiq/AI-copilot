"""a profile's LinkedIn and GitHub links are profile links

Revision ID: 054
Revises: 053
Create Date: 2026-10-29 00:00:00.000000

The web app saves these two links in one standard form —
linkedin.com/in/<name> and github.com/<username> — and refuses anything
else. The browser writes career_profiles itself, so the database refuses
it too: private.profile_links_are_profile_links() runs before every insert
and update, and a link that is new or changed must be empty or in the
standard form. Structure only; whether the profile exists isn't checked
(LinkedIn refuses automated lookups).

A link saved before this and left as it is still saves, so a profile with
an old, untidy link isn't stuck: changing anything else keeps working, and
the Profile page shows the link as needing a fix. A trigger can tell
"unchanged" from "new"; a CHECK constraint can't, and would refuse every
save of such a profile.

The web app is stricter about LinkedIn names (letters, digits and
hyphens); here a name is 3–100 characters with no slash, ?, #, % or
space. packages/types/social-link-cases.json holds the examples both are
tested against.

Lives in private, which the Data API doesn't serve, and nobody may call it
(see 050). Skipped where career_profiles doesn't exist (the local test
database).
"""
from typing import Sequence, Union

from alembic import op

revision: str = "054"
down_revision: Union[str, None] = "053"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# \s, not [:space:]: alembic runs this through SQLAlchemy's text(), which
# would read ":space" as a bind parameter.
LINKEDIN_PATTERN = r"^linkedin\.com/in/[^/?#%\s]{3,100}$"
GITHUB_PATTERN = r"^github\.com/[A-Za-z0-9]+(-[A-Za-z0-9]+)*$"
GITHUB_MAX_NAME = 39

UPGRADE_SQL = rf"""
DO $$
BEGIN
  IF to_regclass('public.career_profiles') IS NULL THEN
    RETURN;
  END IF;

  CREATE SCHEMA IF NOT EXISTS private;
  REVOKE ALL ON SCHEMA private FROM PUBLIC;

  CREATE OR REPLACE FUNCTION private.profile_links_are_profile_links()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $f$
  DECLARE
    li text := nullif(NEW.contact ->> 'linkedin', '');
    gh text := nullif(NEW.contact ->> 'github', '');
  BEGIN
    IF li IS NOT NULL
       AND (TG_OP = 'INSERT' OR li IS DISTINCT FROM OLD.contact ->> 'linkedin')
       AND li !~ '{LINKEDIN_PATTERN}' THEN
      RAISE EXCEPTION 'LinkedIn link must look like linkedin.com/in/your-name'
        USING ERRCODE = 'check_violation';
    END IF;
    IF gh IS NOT NULL
       AND (TG_OP = 'INSERT' OR gh IS DISTINCT FROM OLD.contact ->> 'github')
       AND (gh !~ '{GITHUB_PATTERN}' OR char_length(gh) > {len("github.com/") + GITHUB_MAX_NAME}) THEN
      RAISE EXCEPTION 'GitHub link must look like github.com/your-username'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END
  $f$;
  REVOKE ALL ON FUNCTION private.profile_links_are_profile_links() FROM PUBLIC;

  DROP TRIGGER IF EXISTS profile_links_are_profile_links ON public.career_profiles;
  CREATE TRIGGER profile_links_are_profile_links
    BEFORE INSERT OR UPDATE ON public.career_profiles
    FOR EACH ROW EXECUTE FUNCTION private.profile_links_are_profile_links();
END $$;
"""

DOWNGRADE_SQL = """
DO $$
BEGIN
  IF to_regclass('public.career_profiles') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS profile_links_are_profile_links ON public.career_profiles;
  END IF;
  DROP FUNCTION IF EXISTS private.profile_links_are_profile_links();
END $$;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
