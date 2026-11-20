"""an account is signed in on at most two devices at a time

Revision ID: 060
Revises: 059
Create Date: 2026-11-20 00:00:00.000000

An account is one person's. Shared, one login runs on many devices at once.
Now only the account's two newest sign-ins count: signing in on a third
device ends the oldest. Every sign-in is a session in auth.sessions (a
refresh keeps the same one), so "newest" is the session's created_at.

private.session_is_active (045, 048, 049) is the one check the API and the
browser's rules (career_profiles, the avatars bucket) all go through, so a
session pushed out stops everywhere at once, within the API's few-second
cache. The web app then signs that device out and says why. The session row
stays in auth.sessions — Supabase owns it — and counts again only if the
newer sign-ins end first (signing out ends them all).

Same signature, so the grants and every rule that calls it stay as they are.
Skipped where the function doesn't exist (the local test database). Where
auth.sessions has no created_at, the migration fails and the deploy keeps
the running version.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "060"
down_revision: Union[str, None] = "059"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

DEVICES = 2

_DEFINE = """
DO $$
BEGIN
  IF to_regprocedure('private.session_is_active(text)') IS NULL THEN
    RETURN;
  END IF;
__PRECHECK__
  CREATE OR REPLACE FUNCTION private.session_is_active(session_id text)
  RETURNS boolean
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = ''
  AS $f$
  DECLARE
    sid uuid;
  BEGIN
    BEGIN
      sid := session_id::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN false;
    END;
    IF current_setting('role', true) IN ('authenticated', 'anon')
       AND sid::text IS DISTINCT FROM lower(auth.jwt() ->> 'session_id') THEN
      RETURN false;
    END IF;
    RETURN sid IS NOT NULL AND EXISTS (
      SELECT 1 FROM auth.sessions s
      JOIN auth.users u ON u.id = s.user_id
      WHERE s.id = sid AND (s.not_after IS NULL OR s.not_after > now())
        AND (u.banned_until IS NULL OR u.banned_until <= now())
        AND u.deleted_at IS NULL__NEWEST__
    );
  END
  $f$;
END $$;
"""

PRECHECK = """  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'auth' AND table_name = 'sessions'
                   AND column_name = 'created_at') THEN
    RAISE EXCEPTION 'auth.sessions has no created_at column';
  END IF;
"""

NEWEST = f"""
        AND s.id IN (
          SELECT n.id FROM auth.sessions n
          WHERE n.user_id = s.user_id AND (n.not_after IS NULL OR n.not_after > now())
          ORDER BY n.created_at DESC NULLS LAST, n.id DESC
          LIMIT {DEVICES}
        )"""

UPGRADE_SQL = _DEFINE.replace("__PRECHECK__", PRECHECK).replace("__NEWEST__", NEWEST)
# 049's function, as it was.
DOWNGRADE_SQL = _DEFINE.replace("__PRECHECK__\n", "").replace("__NEWEST__", "")


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
