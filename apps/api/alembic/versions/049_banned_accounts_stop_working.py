"""a token stops working once its account is banned or deleted

Revision ID: 049
Revises: 048
Create Date: 2026-10-26 00:00:00.000000

private.session_is_active (045, 048) asked only whether the token's session
still exists. Banning a user in Supabase sets auth.users.banned_until and
blocks new sign-ins and refreshes, but leaves the session row in place, so an
access token taken before the ban kept reading and writing that account's
data until it expired, up to an hour (test ATK-050). A soft-deleted user
(deleted_at) is the same.

Now the session also counts as ended while its user is banned or deleted.
The API and the browser's rules all go through this one function, so all of
them stop at once; a ban that is lifted lets the same session back in.

Same signature, so the grants and every rule that calls it stay as they are.
Skipped where the function doesn't exist (the local test database). Where
this login cannot read auth.users, the migration fails and the deploy keeps
the running version.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "049"
down_revision: Union[str, None] = "048"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

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
      SELECT 1 FROM auth.sessions s__USER_JOIN__
      WHERE s.id = sid AND (s.not_after IS NULL OR s.not_after > now())__USER_CHECK__
    );
  END
  $f$;
END $$;
"""

PRECHECK = """  IF NOT has_table_privilege('auth.users', 'SELECT') THEN
    RAISE EXCEPTION 'this login cannot read auth.users';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'auth' AND table_name = 'users'
        AND column_name IN ('banned_until', 'deleted_at')) <> 2 THEN
    RAISE EXCEPTION 'auth.users has no banned_until or deleted_at column';
  END IF;
"""
USER_JOIN = "\n      JOIN auth.users u ON u.id = s.user_id"
USER_CHECK = """
        AND (u.banned_until IS NULL OR u.banned_until <= now())
        AND u.deleted_at IS NULL"""

UPGRADE_SQL = (
    _DEFINE.replace("__PRECHECK__", PRECHECK)
    .replace("__USER_JOIN__", USER_JOIN)
    .replace("__USER_CHECK__", USER_CHECK)
)
# 048's function, as it was.
DOWNGRADE_SQL = (
    _DEFINE.replace("__PRECHECK__\n", "").replace("__USER_JOIN__", "").replace("__USER_CHECK__", "")
)


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
