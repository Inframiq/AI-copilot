"""a profile's phone changes at most once every 30 days

Revision ID: 059
Revises: 058
Create Date: 2026-11-20 00:00:00.000000

The phone is the third detail every résumé takes from the account (with the
name and email, migration 058 and apps/api services/account_contact). Fixed
outright it would trap someone who changes numbers; changeable at will it
would let one account print anyone's number. So it changes at most once in
30 days.

career_profiles.phone_changed_at records the last change.
private.profile_contact_is_fixed() (058) now also, on an update:
- a phone written another way (same digits) is no change;
- the first phone on a profile that never had one is free and starts no
  clock;
- any other change — a new number, or removing it — is refused within 30
  days of the last, with the date it can change again; otherwise it goes
  through and stamps phone_changed_at.
phone_changed_at is the trigger's alone: whatever a save sends for it is
replaced (NULL on insert, the old value or now() on update).

Refused rather than corrected, unlike the name: the Profile page shows the
phone fixed until the date, so only a page opened before this went live, or
a request sent by hand, meets the refusal — and silently keeping the old
number would look like a save that worked.

Support can change it inside the 30 days with
  SET LOCAL kripax.allow_phone_change = 'on'; UPDATE career_profiles ...
which the Data API cannot set.

Skipped where career_profiles doesn't exist (the local test database).
"""
from typing import Sequence, Union

from alembic import op

revision: str = "059"
down_revision: Union[str, None] = "058"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PHONE_RULE_DAYS = 30

_FUNCTION = r"""
  CREATE OR REPLACE FUNCTION private.profile_contact_is_fixed()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
  AS $f$
  DECLARE
    sign_in_email text;
    saved_name text;__PHONE_DECLARE__
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
__PHONE_RULE__
    RETURN NEW;
  END
  $f$;
  REVOKE ALL ON FUNCTION private.profile_contact_is_fixed() FROM PUBLIC;
"""

PHONE_DECLARE = """
    old_digits text;
    new_digits text;"""

PHONE_RULE = rf"""
    IF TG_OP = 'INSERT' THEN
      NEW.phone_changed_at := NULL;
    ELSE
      NEW.phone_changed_at := OLD.phone_changed_at;
      old_digits := regexp_replace(coalesce(OLD.contact ->> 'phone', ''), '\D', '', 'g');
      new_digits := regexp_replace(coalesce(NEW.contact ->> 'phone', ''), '\D', '', 'g');
      IF old_digits IS DISTINCT FROM new_digits
         AND NOT (old_digits = '' AND OLD.phone_changed_at IS NULL) THEN
        IF OLD.phone_changed_at IS NOT NULL
           AND OLD.phone_changed_at > now() - interval '{PHONE_RULE_DAYS} days'
           AND coalesce(current_setting('kripax.allow_phone_change', true), '') <> 'on' THEN
          RAISE EXCEPTION 'The phone number can be changed again on %.',
            to_char(OLD.phone_changed_at + interval '{PHONE_RULE_DAYS} days', 'FMDD Mon YYYY')
            USING ERRCODE = 'check_violation';
        END IF;
        NEW.phone_changed_at := now();
      END IF;
    END IF;
"""

UPGRADE_SQL = f"""
DO $$
BEGIN
  IF to_regclass('public.career_profiles') IS NULL THEN
    RETURN;
  END IF;
  ALTER TABLE public.career_profiles ADD COLUMN IF NOT EXISTS phone_changed_at timestamptz;
{_FUNCTION.replace("__PHONE_DECLARE__", PHONE_DECLARE).replace("__PHONE_RULE__", PHONE_RULE)}
END $$;
"""

# 058's function, as it was; the column goes.
DOWNGRADE_SQL = f"""
DO $$
BEGIN
  IF to_regclass('public.career_profiles') IS NULL THEN
    RETURN;
  END IF;
{_FUNCTION.replace("__PHONE_DECLARE__", "").replace("__PHONE_RULE__", "")}
  ALTER TABLE public.career_profiles DROP COLUMN IF EXISTS phone_changed_at;
END $$;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
