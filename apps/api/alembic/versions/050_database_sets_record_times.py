"""the database sets created_at and updated_at on the browser's tables

Revision ID: 050
Revises: 049
Create Date: 2026-10-26 00:00:00.000000

The browser writes three tables straight through the Data API:
career_profiles, and the networking tables profiles and connection_requests.
Their rules check whose row it is, not which columns are written, and the
only trigger (002) reset updated_at on an update. So a signed-in user could
store any created_at, on a new row or an old one, and any updated_at on a new
row (test ATK-051). Nothing reads them as proof of anything yet, but a
record's times should be the database's, the same as its owner.

private.server_sets_times() now runs before every insert and update on those
tables: a new row gets now() for both; a changed row keeps its created_at and
gets now() for updated_at. Whatever the request sent is overwritten. It
touches only the columns a table has (connection_requests has no updated_at).
It lives in private, which the Data API doesn't serve, and nobody may call it
directly; a trigger doesn't need EXECUTE to fire.

The old career_profiles_updated_at trigger did half of this, so it is
replaced. Tables that don't exist are skipped, and so is the whole migration
where the browser roles don't (the local test database). If this login may
not add triggers to a table, the migration fails and the deploy keeps the
running version.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "050"
down_revision: Union[str, None] = "049"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = ("career_profiles", "profiles", "connection_requests")
_IN_TABLES = ", ".join(f"'{t}'" for t in TABLES)

UPGRADE_SQL = f"""
DO $$
DECLARE
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RETURN;
  END IF;

  CREATE SCHEMA IF NOT EXISTS private;
  REVOKE ALL ON SCHEMA private FROM PUBLIC;

  -- jsonb_populate_record sets only the keys the row type has, so one
  -- function serves tables with and without updated_at.
  CREATE OR REPLACE FUNCTION private.server_sets_times()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
  AS $f$
  BEGIN
    IF TG_OP = 'INSERT' THEN
      NEW := jsonb_populate_record(NEW, jsonb_build_object('created_at', now(), 'updated_at', now()));
    ELSE
      NEW := jsonb_populate_record(NEW, jsonb_build_object(
        'created_at', to_jsonb(OLD) -> 'created_at', 'updated_at', now()));
    END IF;
    RETURN NEW;
  END
  $f$;
  REVOKE ALL ON FUNCTION private.server_sets_times() FROM PUBLIC;

  FOR t IN SELECT tablename FROM pg_tables
           WHERE schemaname = 'public' AND tablename IN ({_IN_TABLES}) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS server_sets_times ON public.%I', t);
    EXECUTE format('CREATE TRIGGER server_sets_times BEFORE INSERT OR UPDATE ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION private.server_sets_times()', t);
  END LOOP;

  IF to_regclass('public.career_profiles') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS career_profiles_updated_at ON public.career_profiles;
  END IF;
END $$;
"""

DOWNGRADE_SQL = f"""
DO $$
DECLARE
  t text;
BEGIN
  IF to_regprocedure('private.server_sets_times()') IS NULL THEN
    RETURN;
  END IF;
  FOR t IN SELECT tablename FROM pg_tables
           WHERE schemaname = 'public' AND tablename IN ({_IN_TABLES}) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS server_sets_times ON public.%I', t);
  END LOOP;
  IF to_regclass('public.career_profiles') IS NOT NULL
     AND to_regprocedure('public.update_career_profile_timestamp()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS career_profiles_updated_at ON public.career_profiles;
    CREATE TRIGGER career_profiles_updated_at BEFORE UPDATE ON public.career_profiles
      FOR EACH ROW EXECUTE FUNCTION public.update_career_profile_timestamp();
  END IF;
  DROP FUNCTION private.server_sets_times();
END $$;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
