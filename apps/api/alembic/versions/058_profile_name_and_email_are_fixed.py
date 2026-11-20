"""a profile's name and email are fixed

Revision ID: 058
Revises: 057
Create Date: 2026-11-20 00:00:00.000000

The name is set when the profile is set up, and the email is the account's
sign-in email; neither changes after that. The web app shows both as fixed,
but the browser writes career_profiles itself, so the database holds the
line: private.profile_contact_is_fixed() runs before every insert and update
and

- puts the sign-in email (auth.users) in contact.email, whatever was sent —
  a row saved before this with another email takes the sign-in one on its
  next save;
- on an update, keeps the saved name when there is one. A profile with no
  name yet (made before names were asked for) takes one once.

It corrects rather than refuses: a save from a page opened before this went
live still saves everything else.

Support can fix a mistyped name in one transaction:
  SET LOCAL kripax.allow_name_change = 'on'; UPDATE career_profiles ...
The Data API cannot set that, so a user cannot.

SECURITY DEFINER to read auth.users, which the browser role can't. Lives in
private, which the Data API doesn't serve, and nobody may call it (see 050).
Skipped where career_profiles doesn't exist (the local test database).
"""
from typing import Sequence, Union

from alembic import op

revision: str = "058"
down_revision: Union[str, None] = "057"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UPGRADE_SQL = """
DO $$
BEGIN
  IF to_regclass('public.career_profiles') IS NULL THEN
    RETURN;
  END IF;

  CREATE SCHEMA IF NOT EXISTS private;
  REVOKE ALL ON SCHEMA private FROM PUBLIC;

  CREATE OR REPLACE FUNCTION private.profile_contact_is_fixed()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
  AS $f$
  DECLARE
    sign_in_email text;
    saved_name text;
  BEGIN
    NEW.contact := coalesce(NEW.contact, '{}'::jsonb);

    SELECT u.email INTO sign_in_email FROM auth.users u WHERE u.id = NEW.user_id;
    IF nullif(sign_in_email, '') IS NOT NULL THEN
      NEW.contact := jsonb_set(NEW.contact, '{email}', to_jsonb(sign_in_email));
    END IF;

    IF TG_OP = 'UPDATE'
       AND coalesce(current_setting('kripax.allow_name_change', true), '') <> 'on' THEN
      saved_name := nullif(btrim(OLD.contact ->> 'name'), '');
      IF saved_name IS NOT NULL THEN
        NEW.contact := jsonb_set(NEW.contact, '{name}', OLD.contact -> 'name');
      END IF;
    END IF;

    RETURN NEW;
  END
  $f$;
  REVOKE ALL ON FUNCTION private.profile_contact_is_fixed() FROM PUBLIC;

  DROP TRIGGER IF EXISTS profile_contact_is_fixed ON public.career_profiles;
  CREATE TRIGGER profile_contact_is_fixed
    BEFORE INSERT OR UPDATE ON public.career_profiles
    FOR EACH ROW EXECUTE FUNCTION private.profile_contact_is_fixed();
END $$;
"""

DOWNGRADE_SQL = """
DO $$
BEGIN
  IF to_regclass('public.career_profiles') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS profile_contact_is_fixed ON public.career_profiles;
  END IF;
  DROP FUNCTION IF EXISTS private.profile_contact_is_fixed();
END $$;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
