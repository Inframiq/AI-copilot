"""trigger functions in public are not callable by the browser roles

Revision ID: 046
Revises: 045
Create Date: 2026-10-24 00:00:00.000000

Postgres grants EXECUTE on every new function to PUBLIC, so the browser roles
could call update_career_profile_timestamp() (apps/web/supabase/migrations/002)
through the public API. Harmless: a trigger function refuses to run outside a
trigger. But nothing needs to call it (test ATK-018's policy review flagged
it), the same as rls_auto_enable in 040.

Covers every trigger function in public, including ones added later by a
re-run. Revoking EXECUTE does not stop a trigger: Postgres checks it when the
trigger is created, not each time it fires. Skipped where the Supabase roles
don't exist (the local test database).
"""
from typing import Sequence, Union

from alembic import op

revision: str = "046"
down_revision: Union[str, None] = "045"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_FOR_EACH_TRIGGER_FUNCTION = """
DO $$
DECLARE
  f record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RETURN;
  END IF;
  FOR f IN
    SELECT p.oid::regprocedure AS fn
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prorettype = 'trigger'::regtype
  LOOP
    EXECUTE format('__ACTION__', f.fn);
  END LOOP;
END $$;
"""

UPGRADE_SQL = _FOR_EACH_TRIGGER_FUNCTION.replace(
    "__ACTION__", "REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated"
)
DOWNGRADE_SQL = _FOR_EACH_TRIGGER_FUNCTION.replace(
    "__ACTION__", "GRANT EXECUTE ON FUNCTION %s TO PUBLIC, anon, authenticated"
)


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
