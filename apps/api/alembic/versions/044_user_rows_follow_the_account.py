"""a user's rows belong to a real account and go when it does

Revision ID: 044
Revises: 043
Create Date: 2026-10-15 00:00:00.000000

Every user_id in the API's tables named an account only by convention: the
database never checked it. Test DB-003 found 43 rows for 9 accounts that no
longer exist: test accounts deleted from the Supabase dashboard in August,
which removes the account but not its data, and two made-up test users that
local test runs wrote into production (fixed in tests/conftest.py).

Now, for each table in TABLES:
- rows whose account no longer exists are deleted (personal data with no
  owner; account deletion would have removed them);
- user_id is a foreign key to auth.users with ON DELETE CASCADE, so deleting
  an account anywhere (the app, the Supabase dashboard) removes its rows, and
  no row can be saved for an account that doesn't exist.

Rows in tables that hang off these (prep questions, follow-ups) go through
their own existing cascades. career_profiles has had this link since its SQL
setup. Files in Storage can't be removed from SQL; the leftover résumé files
are removed through Storage.

Skipped where auth.users doesn't exist (the local test database).
"""
from typing import Sequence, Union

from alembic import op

revision: str = "044"
down_revision: Union[str, None] = "043"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Every table whose rows belong to a user (tests/test_migration_044.py keeps
# this in step with the models).
TABLES = (
    "ai_usage_events",
    "cover_letters",
    "feedback",
    "job_descriptions",
    "learning_items",
    "policy_acceptances",
    "resume_deletion_log",
    "resumes",
    "subscriptions",
    "tailoring_sessions",
)

UPGRADE_SQL = """
DO $$
DECLARE
  t text;
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    RETURN;
  END IF;

  FOREACH t IN ARRAY ARRAY[__TABLES__] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format(
      'DELETE FROM public.%I x WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.user_id)', t);
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = ('public.' || t)::regclass AND conname = t || '_user_id_fkey') THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE',
        t, t || '_user_id_fkey');
    END IF;
  END LOOP;
END $$;
""".replace("__TABLES__", ", ".join(f"'{t}'" for t in TABLES))

DOWNGRADE_SQL = """
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[__TABLES__] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t || '_user_id_fkey');
    END IF;
  END LOOP;
END $$;
""".replace("__TABLES__", ", ".join(f"'{t}'" for t in TABLES))


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
