"""a token stops working the moment its sign-in session ends

Revision ID: 045
Revises: 044
Create Date: 2026-10-23 00:00:00.000000

A Supabase access token is a signed JWT that is good until it expires (an
hour). Signing out deletes the session and its refresh token, but the access
token itself still checked out: the API and the database rules checked only
the signature and the expiry. A copied token kept reading and writing that
account's data for up to an hour after the owner signed out (test ATK-007).

Every token names its session (the session_id claim). Now:
- private.session_is_active(session_id) says whether that session still
  exists in auth.sessions and has not passed its not_after. It answers yes or
  no and nothing more: SECURITY DEFINER, so neither the browser's role nor
  the API's login needs to read auth.sessions itself, and it lives in a schema
  the Data API doesn't serve, so it cannot be called over /rest/v1/rpc.
- The API calls it for every signed-in request (app.core.security).
- The browser's two direct paths, career_profiles and the avatars bucket,
  require it in their RLS policies, beside the ownership check.

Skipped where auth.sessions doesn't exist (the local test database). Where it
exists but this login cannot read it, the migration fails and the deploy
keeps the running version: a function that cannot see sessions would sign
everyone out.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "045"
down_revision: Union[str, None] = "044"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# The condition every browser policy adds. A scalar subquery, so Postgres
# runs it once per statement rather than once per row.
LIVE_SESSION = "(SELECT private.session_is_active(auth.jwt() ->> 'session_id'))"

CAREER_OWN = "auth.uid() = user_id"
AVATAR_OWN = "bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text"

UPGRADE_SQL = """
DO $$
BEGIN
  IF to_regclass('auth.sessions') IS NULL THEN
    RETURN;
  END IF;
  IF NOT has_table_privilege('auth.sessions', 'SELECT') THEN
    RAISE EXCEPTION 'this login cannot read auth.sessions';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'auth' AND table_name = 'sessions'
                   AND column_name = 'not_after') THEN
    RAISE EXCEPTION 'auth.sessions has no not_after column';
  END IF;

  CREATE SCHEMA IF NOT EXISTS private;
  REVOKE ALL ON SCHEMA private FROM PUBLIC;

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
    RETURN sid IS NOT NULL AND EXISTS (
      SELECT 1 FROM auth.sessions s
      WHERE s.id = sid AND (s.not_after IS NULL OR s.not_after > now())
    );
  END
  $f$;

  REVOKE ALL ON FUNCTION private.session_is_active(text) FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT USAGE ON SCHEMA private TO authenticated;
    GRANT EXECUTE ON FUNCTION private.session_is_active(text) TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kripax_api') THEN
    GRANT USAGE ON SCHEMA private TO kripax_api;
    GRANT EXECUTE ON FUNCTION private.session_is_active(text) TO kripax_api;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
             AND tablename = 'career_profiles' AND policyname = 'career_profiles_own') THEN
    ALTER POLICY "career_profiles_own" ON public.career_profiles
      USING (__CAREER_OWN__ AND __LIVE__)
      WITH CHECK (__CAREER_OWN__ AND __LIVE__);
  END IF;

  -- storage.objects belongs to Supabase's storage admin. If this login may
  -- not change its policies, the API and career_profiles still get the
  -- check; the warning names what was left (ATK-007's SQL check shows it).
  BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'avatars_select_own') THEN
      ALTER POLICY "avatars_select_own" ON storage.objects
        USING (__AVATAR_OWN__ AND __LIVE__);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'avatars_insert_own') THEN
      ALTER POLICY "avatars_insert_own" ON storage.objects
        WITH CHECK (__AVATAR_OWN__ AND __LIVE__);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'avatars_update_own') THEN
      ALTER POLICY "avatars_update_own" ON storage.objects
        USING (__AVATAR_OWN__ AND __LIVE__)
        WITH CHECK (__AVATAR_OWN__ AND __LIVE__);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'avatars_delete_own') THEN
      ALTER POLICY "avatars_delete_own" ON storage.objects
        USING (__AVATAR_OWN__ AND __LIVE__);
    END IF;
  END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE WARNING 'avatars policies left without the session check: %', SQLERRM;
  END;
END $$;
"""

DOWNGRADE_SQL = """
DO $$
BEGIN
  IF to_regprocedure('private.session_is_active(text)') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
             AND tablename = 'career_profiles' AND policyname = 'career_profiles_own') THEN
    ALTER POLICY "career_profiles_own" ON public.career_profiles
      USING (__CAREER_OWN__) WITH CHECK (__CAREER_OWN__);
  END IF;

  BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'avatars_select_own') THEN
      ALTER POLICY "avatars_select_own" ON storage.objects USING (__AVATAR_OWN__);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'avatars_insert_own') THEN
      ALTER POLICY "avatars_insert_own" ON storage.objects WITH CHECK (__AVATAR_OWN__);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'avatars_update_own') THEN
      ALTER POLICY "avatars_update_own" ON storage.objects USING (__AVATAR_OWN__) WITH CHECK (__AVATAR_OWN__);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'avatars_delete_own') THEN
      ALTER POLICY "avatars_delete_own" ON storage.objects USING (__AVATAR_OWN__);
    END IF;
  END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE WARNING 'avatars policies not changed back: %', SQLERRM;
  END;

  DROP FUNCTION private.session_is_active(text);
  DROP SCHEMA IF EXISTS private;
END $$;
"""


def _fill(sql: str) -> str:
    return (
        sql.replace("__CAREER_OWN__", CAREER_OWN)
        .replace("__AVATAR_OWN__", AVATAR_OWN)
        .replace("__LIVE__", LIVE_SESSION)
    )


UPGRADE_SQL = _fill(UPGRADE_SQL)
DOWNGRADE_SQL = _fill(DOWNGRADE_SQL)


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
