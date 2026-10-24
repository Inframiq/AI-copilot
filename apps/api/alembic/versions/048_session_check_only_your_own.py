"""a browser request may ask session_is_active only about its own sign-in

Revision ID: 048
Revises: 047
Create Date: 2026-10-24 00:00:00.000000

private.session_is_active (045) runs as its owner and answered yes or no for
any session id. The rules only ever pass the caller's own session, and the
Data API doesn't serve the private schema, so no browser could ask about
someone else's. But a function that runs with its owner's rights should check
who is calling, not rely on where it is called from (test ATK-024).

Now, when the caller is a browser role (the Data API and Storage switch to
authenticated for a signed-in request), a session other than the one in the
caller's own token is answered false. The API's login, kripax_api, still asks
about any session: it checks each request's token itself.

Same signature, so the grants and every rule that calls it stay as they are.
Skipped where the function doesn't exist (the local test database).
"""
from typing import Sequence, Union

from alembic import op

revision: str = "048"
down_revision: Union[str, None] = "047"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_DEFINE = """
DO $$
BEGIN
  IF to_regprocedure('private.session_is_active(text)') IS NULL THEN
    RETURN;
  END IF;

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
__CALLER_CHECK__
    RETURN sid IS NOT NULL AND EXISTS (
      SELECT 1 FROM auth.sessions s
      WHERE s.id = sid AND (s.not_after IS NULL OR s.not_after > now())
    );
  END
  $f$;
END $$;
"""

# current_setting('role') is the role the request switched to; running as the
# owner changes current_user, not this.
CALLER_CHECK = """    IF current_setting('role', true) IN ('authenticated', 'anon')
       AND sid::text IS DISTINCT FROM lower(auth.jwt() ->> 'session_id') THEN
      RETURN false;
    END IF;"""

UPGRADE_SQL = _DEFINE.replace("__CALLER_CHECK__", CALLER_CHECK)
DOWNGRADE_SQL = _DEFINE.replace("__CALLER_CHECK__\n", "")


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
