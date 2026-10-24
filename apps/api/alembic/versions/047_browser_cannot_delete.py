"""the browser keeps only the operations the web app performs

Revision ID: 047
Revises: 046
Create Date: 2026-10-24 00:00:00.000000

The web app reads, creates and updates its own career_profiles row, and reads,
uploads and replaces photos in its own avatars folder. It never deletes
either: account deletion runs in the API, which logs in as kripax_api and
removes photos with the service key. Yet a signed-in user held DELETE on
career_profiles (career_profiles_own is FOR ALL) and a rule to delete their
own photos, so a script running in their tab could wipe them (test ATK-019).

Now:
- authenticated loses DELETE on career_profiles. The row still goes when its
  auth.users row does: ON DELETE CASCADE runs as the table's owner.
- avatars_delete_own is dropped. Uploading with upsert replaces a photo
  through the insert, select and update rules, not delete.
- Sequences and functions postgres creates in public later get no browser
  grants by default, as 040 did for tables. Postgres still lets PUBLIC run a
  new function (that default is server-wide); 046 and test ATK-018 cover it.

storage.objects belongs to Supabase's storage admin: if this login may not
drop its policies, the rest still applies and a warning names what was left,
as in 045. Skipped where the Supabase roles don't exist (the local test
database).
"""
from typing import Sequence, Union

from alembic import op

revision: str = "047"
down_revision: Union[str, None] = "046"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# As 045 left the rule: the owner's folder, while the sign-in session lives.
AVATAR_DELETE_RULE = (
    "bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text"
    " AND (SELECT private.session_is_active(auth.jwt() ->> 'session_id'))"
)

UPGRADE_SQL = """
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RETURN;
  END IF;

  IF to_regclass('public.career_profiles') IS NOT NULL THEN
    REVOKE DELETE ON public.career_profiles FROM anon, authenticated;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
  END IF;

  BEGIN
    IF to_regclass('storage.objects') IS NOT NULL THEN
      DROP POLICY IF EXISTS "avatars_delete_own" ON storage.objects;
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE WARNING 'avatars_delete_own left in place: %', SQLERRM;
  END;
END $$;
"""

DOWNGRADE_SQL = """
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RETURN;
  END IF;

  IF to_regclass('public.career_profiles') IS NOT NULL THEN
    GRANT DELETE ON public.career_profiles TO authenticated;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated;
  END IF;

  BEGIN
    IF to_regclass('storage.objects') IS NOT NULL
       AND to_regprocedure('private.session_is_active(text)') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage'
                       AND tablename = 'objects' AND policyname = 'avatars_delete_own') THEN
      CREATE POLICY "avatars_delete_own" ON storage.objects
        FOR DELETE TO authenticated USING (__AVATAR_DELETE_RULE__);
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE WARNING 'avatars_delete_own not put back: %', SQLERRM;
  END;
END $$;
""".replace("__AVATAR_DELETE_RULE__", AVATAR_DELETE_RULE)


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
