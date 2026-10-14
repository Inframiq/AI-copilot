"""tighten what the browser roles are granted

Revision ID: 040
Revises: 039
Create Date: 2026-10-14 00:00:00.000000

Supabase grants its browser roles (anon, authenticated) every privilege on
every table in public, so RLS was the only thing between a browser and the
data. TRUNCATE in that grant ignores RLS entirely. Nothing in the public API
can issue it, but nothing should hold it either (security review L1,
confirmed by test RLS-016).

Now:
- anon holds nothing on any table: no page reads or writes tables signed out.
- authenticated keeps plain read/write on the three tables the browser uses
  directly (career_profiles, profiles, connection_requests; connection
  requests keep their status-only UPDATE from the Supabase SQL in
  apps/web/supabase/migrations/008), and loses TRUNCATE, TRIGGER and
  REFERENCES there.
- authenticated holds nothing on every other table: only the API reads and
  writes them, and it connects as postgres.
- Tables created later get no browser grants by default; a new table the
  browser must reach needs an explicit GRANT next to its RLS policies.
- rls_auto_enable (the event trigger that turns RLS on for new tables) can
  no longer be called through the public API. Harmless before (it can only
  turn RLS on), but nothing needs to call it.

RLS stays on everywhere as the second layer. Skipped where the Supabase
roles don't exist (the local test database).
"""
from typing import Sequence, Union

from alembic import op

revision: str = "040"
down_revision: Union[str, None] = "039"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# The tables the web app reads and writes straight from the browser.
BROWSER_TABLES = ("career_profiles", "profiles", "connection_requests")

UPGRADE_SQL = """
DO $$
DECLARE
  t record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RETURN;
  END IF;

  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t.tablename);
    IF t.tablename IN (__BROWSER_TABLES__) THEN
      EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.%I FROM authenticated', t.tablename);
    ELSE
      EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t.tablename);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
  END IF;

  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
  END IF;
END $$;
""".replace("__BROWSER_TABLES__", ", ".join(f"'{t}'" for t in BROWSER_TABLES))

DOWNGRADE_SQL = """
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RETURN;
  END IF;

  GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
  IF to_regclass('public.connection_requests') IS NOT NULL THEN
    REVOKE UPDATE ON public.connection_requests FROM anon, authenticated;
    GRANT UPDATE (status) ON public.connection_requests TO authenticated;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
  END IF;

  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO PUBLIC, anon, authenticated;
  END IF;
END $$;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
