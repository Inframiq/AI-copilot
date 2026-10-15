"""a database login for the API that can only read and write the app's tables

Revision ID: 043
Revises: 042
Create Date: 2026-10-15 00:00:00.000000

The API signed in as postgres, the database owner, for every request: it
could create and drop tables, make and change logins, switch to Supabase's
other roles and read sign-in accounts and sessions, none of which serving a
request needs (test DB-001).

kripax_api is the API's login from now on:
- SELECT, INSERT, UPDATE, DELETE on every table in public, and the sequences
  behind them. No TRUNCATE, no schema changes, owns nothing, and nothing in
  auth, storage or any other schema.
- Tables later migrations create get the same grants (postgres creates them).
- BYPASSRLS: the API serves every user and checks ownership in its own code,
  as it did as postgres. Row security stays on as the browser's barrier.
- No role memberships, no CREATEROLE, CREATEDB or REPLICATION.

The role is created without a login. Its password is set once in the Supabase
SQL editor (a secret has no place in git), then DATABASE_URL moves to it and
MIGRATION_DATABASE_URL keeps postgres for app.migrate.

Skipped where the Supabase roles don't exist (the local test database).
"""
from typing import Sequence, Union

from alembic import op

revision: str = "043"
down_revision: Union[str, None] = "042"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UPGRADE_SQL = """
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kripax_api') THEN
    CREATE ROLE kripax_api NOLOGIN;
  END IF;
  ALTER ROLE kripax_api NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT BYPASSRLS;

  GRANT USAGE ON SCHEMA public TO kripax_api;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO kripax_api;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kripax_api;
  -- Alembic's bookkeeping belongs to the migration login alone.
  IF to_regclass('public.alembic_version') IS NOT NULL THEN
    REVOKE ALL ON public.alembic_version FROM kripax_api;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kripax_api;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO kripax_api;
  END IF;
END $$;
"""

DOWNGRADE_SQL = """
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kripax_api') THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
      REVOKE ALL ON TABLES FROM kripax_api;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
      REVOKE ALL ON SEQUENCES FROM kripax_api;
  END IF;
  REVOKE ALL ON ALL TABLES IN SCHEMA public FROM kripax_api;
  REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM kripax_api;
  REVOKE ALL ON SCHEMA public FROM kripax_api;
  DROP ROLE kripax_api;
END $$;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
