"""row security on every table, set by our migrations

Revision ID: 051
Revises: 050
Create Date: 2026-10-26 00:00:00.000000

Every table in public has row security on in production, but only because
Supabase's own event trigger (ensure_rls -> rls_auto_enable) turns it on for
each new table. None of our migrations did. The browser can't reach the
API's tables anyway (040 took its grants away), so that is one barrier where
there should be two, and a project rebuilt without that trigger would lose
it (test ATK-055, whose matrix runs without the trigger).

This turns row security on for every table in public that lacks it. A no-op
in production. New tables must turn it on themselves: tests/test_rls_matrix
fails the build for any that doesn't. Skipped where the browser roles don't
exist (the local test database). Downgrade leaves it on: turning it off is
never the safe direction.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "051"
down_revision: Union[str, None] = "050"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UPGRADE_SQL = """
DO $$
DECLARE
  t record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RETURN;
  END IF;
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
  END LOOP;
END $$;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    pass
