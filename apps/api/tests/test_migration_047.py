"""Migration 047 leaves the browser only what the web app does: no deleting
the profile row or photos, and no browser grants on sequences or functions
made later (test ATK-019)."""
import importlib.util
import json
import pathlib
import uuid

import asyncpg
import pytest

MIG = pathlib.Path(__file__).parents[1] / "alembic/versions/047_browser_cannot_delete.py"
DB = "kripax_m047"
USER_A = uuid.UUID("11111111-1111-1111-1111-111111111111")


def _migration():
    spec = importlib.util.spec_from_file_location("m047", MIG)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_migration_047_chains_from_046():
    m = _migration()
    assert m.revision == "047"
    assert m.down_revision == "046"
    assert "__AVATAR_DELETE_RULE__" not in m.DOWNGRADE_SQL
    assert "session_is_active" in m.AVATAR_DELETE_RULE


def _on_database(uri: str, name: str) -> str:
    """The same server, another database (default privileges are per database,
    so they stay out of the other tests' way). Swaps only the path, which keeps
    a Linux socket address in ?host= intact."""
    from urllib.parse import urlsplit, urlunsplit

    return urlunsplit(urlsplit(uri)._replace(path="/" + name))


# As 002, 006 and 045 left things, with Supabase's defaults on public.
SUPABASE_LIKE = """
    CREATE SCHEMA auth AUTHORIZATION m047_auth_admin;
    SET ROLE m047_auth_admin;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE
      AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $$ SELECT nullif(auth.jwt() ->> 'sub', '')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO PUBLIC;
    GRANT REFERENCES ON auth.users TO m047_owner;
    RESET ROLE;

    CREATE SCHEMA private;
    CREATE FUNCTION private.session_is_active(session_id text) RETURNS boolean LANGUAGE sql STABLE
      AS $$ SELECT true $$;
    GRANT USAGE ON SCHEMA private TO authenticated;

    CREATE SCHEMA storage AUTHORIZATION __STORAGE_OWNER__;
    SET ROLE __STORAGE_OWNER__;
    CREATE TABLE storage.objects (bucket_id text, name text, metadata jsonb, PRIMARY KEY (bucket_id, name));
    CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE
      AS $$ SELECT string_to_array(name, '/') $$;
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "avatars_select_own" ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
    CREATE POLICY "avatars_insert_own" ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
    CREATE POLICY "avatars_update_own" ON storage.objects FOR UPDATE TO authenticated
      USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text)
      WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
    CREATE POLICY "avatars_delete_own" ON storage.objects FOR DELETE TO authenticated
      USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
    GRANT USAGE ON SCHEMA storage TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
    RESET ROLE;

    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated;

    SET ROLE m047_owner;
    CREATE TABLE public.career_profiles (
      user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, headline text);
    ALTER TABLE public.career_profiles ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "career_profiles_own" ON public.career_profiles
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.career_profiles TO authenticated;
    RESET ROLE;
"""


@pytest.fixture
async def database(pg_uri):
    """Yields a function that builds the database with storage owned by the
    given role, connected as postgres (the deploy's migration login)."""
    server = pg_uri.replace("postgresql+asyncpg://", "postgresql://")
    admin = await asyncpg.connect(server)
    conns = []

    async def build(storage_owner: str = "postgres"):
        await admin.execute(f"DROP DATABASE IF EXISTS {DB} WITH (FORCE)")
        await admin.execute(f"CREATE DATABASE {DB}")
        await admin.execute("""
            DO $$ BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
              IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
              IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'm047_owner') THEN CREATE ROLE m047_owner NOLOGIN; END IF;
              IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'm047_auth_admin') THEN CREATE ROLE m047_auth_admin NOLOGIN; END IF;
              IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'm047_storage_admin') THEN CREATE ROLE m047_storage_admin NOLOGIN; END IF;
            END $$;
        """)
        conn = await asyncpg.connect(_on_database(server, DB))
        conns.append(conn)
        await conn.execute("GRANT CREATE ON SCHEMA public TO m047_owner")
        await conn.execute(SUPABASE_LIKE.replace("__STORAGE_OWNER__", storage_owner))
        # The deploy's login owns the app's tables (Supabase's postgres made them).
        await conn.execute("ALTER TABLE public.career_profiles OWNER TO postgres")
        await conn.execute("INSERT INTO auth.users VALUES ($1)", USER_A)
        await conn.execute("INSERT INTO public.career_profiles VALUES ($1, 'mine')", USER_A)
        await conn.execute("INSERT INTO storage.objects VALUES ('avatars', $1, '{}')", f"{USER_A}/profile.png")
        return conn

    yield build
    for conn in conns:
        await conn.close()
    await admin.execute(f"DROP DATABASE IF EXISTS {DB} WITH (FORCE)")
    for role in ("m047_owner", "m047_auth_admin", "m047_storage_admin"):
        await admin.execute(f"DROP ROLE IF EXISTS {role}")
    await admin.close()


async def _as_browser(conn, sql, *args):
    """One statement as Supabase's Data API runs it for User A's token."""
    async with conn.transaction():
        await conn.execute("SET LOCAL ROLE authenticated")
        await conn.execute("SELECT set_config('request.jwt.claims', $1, true)",
                           json.dumps({"sub": str(USER_A), "role": "authenticated", "session_id": "s"}))
        return await conn.execute(sql, *args)


async def _avatar_policies(conn):
    return {r["policyname"] for r in await conn.fetch(
        "SELECT policyname FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'")}


async def test_before_the_fix_the_browser_can_delete_its_profile_and_photo(database):
    conn = await database()
    assert await _as_browser(conn, "DELETE FROM public.career_profiles") == "DELETE 1"
    assert await _as_browser(conn, "DELETE FROM storage.objects") == "DELETE 1"


async def test_after_the_fix_the_browser_cannot_delete_either(database):
    conn = await database()
    await conn.execute(_migration().UPGRADE_SQL)

    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        await _as_browser(conn, "DELETE FROM public.career_profiles")
    assert await _as_browser(conn, "DELETE FROM storage.objects") == "DELETE 0"
    assert await conn.fetchval("SELECT count(*) FROM public.career_profiles") == 1
    assert await conn.fetchval("SELECT count(*) FROM storage.objects") == 1
    assert await _avatar_policies(conn) == {"avatars_select_own", "avatars_insert_own", "avatars_update_own"}


async def test_what_the_app_does_still_works(database):
    conn = await database()
    await conn.execute(_migration().UPGRADE_SQL)

    # The profile page's upsert, and an upload with upsert replacing the photo.
    assert await _as_browser(conn, """
        INSERT INTO public.career_profiles (user_id, headline) VALUES ($1, 'saved')
        ON CONFLICT (user_id) DO UPDATE SET headline = excluded.headline""", USER_A) == "INSERT 0 1"
    assert await _as_browser(conn, """
        INSERT INTO storage.objects VALUES ('avatars', $1, '{"v": 2}')
        ON CONFLICT (bucket_id, name) DO UPDATE SET metadata = excluded.metadata""", f"{USER_A}/profile.png") == "INSERT 0 1"
    assert await conn.fetchval("SELECT headline FROM public.career_profiles") == "saved"
    assert await conn.fetchval("SELECT metadata ->> 'v' FROM storage.objects") == "2"


async def test_the_profile_still_goes_with_the_account(database):
    conn = await database()
    await conn.execute(_migration().UPGRADE_SQL)

    # Supabase's auth admin, which holds nothing on career_profiles, deletes the user.
    async with conn.transaction():
        await conn.execute("SET LOCAL ROLE m047_auth_admin")
        await conn.execute("DELETE FROM auth.users WHERE id = $1", USER_A)
    assert await conn.fetchval("SELECT count(*) FROM public.career_profiles") == 0


async def test_sequences_and_functions_made_later_get_no_browser_grants(database):
    conn = await database()
    await conn.execute(_migration().UPGRADE_SQL)

    await conn.execute("CREATE SEQUENCE public.m047_later_seq")
    await conn.execute("CREATE FUNCTION public.m047_later_fn() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$")
    for role in ("anon", "authenticated"):
        assert not await conn.fetchval("SELECT has_sequence_privilege($1, 'public.m047_later_seq', 'USAGE')", role)
    granted = await conn.fetchval("""
        SELECT count(*) FROM pg_default_acl d, aclexplode(d.defaclacl) a
        WHERE a.grantee IN ('anon'::regrole, 'authenticated'::regrole)""")
    assert granted == 0


async def test_storage_owned_by_its_own_admin_is_left_with_a_warning(database):
    conn = await database("m047_storage_admin")
    # As on Supabase: the migration login is not the storage admin.
    await conn.execute("ALTER TABLE public.career_profiles OWNER TO m047_owner")
    await conn.execute("GRANT postgres TO m047_owner")
    await conn.execute("SET ROLE m047_owner")
    warnings = []
    conn.add_log_listener(lambda _c, msg: warnings.append(msg.message))
    await conn.execute(_migration().UPGRADE_SQL)
    await conn.execute("RESET ROLE")
    await conn.execute("REVOKE postgres FROM m047_owner")

    assert any("avatars_delete_own left in place" in w for w in warnings)
    assert "avatars_delete_own" in await _avatar_policies(conn)
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        await _as_browser(conn, "DELETE FROM public.career_profiles")


async def test_downgrade_puts_everything_back(database):
    conn = await database()
    m = _migration()
    await conn.execute(m.UPGRADE_SQL)
    await conn.execute(m.DOWNGRADE_SQL)

    assert await _as_browser(conn, "DELETE FROM public.career_profiles") == "DELETE 1"
    assert "avatars_delete_own" in await _avatar_policies(conn)
    rule = await conn.fetchval("SELECT qual FROM pg_policies WHERE policyname = 'avatars_delete_own'")
    assert "session_is_active" in rule
    assert await _as_browser(conn, "DELETE FROM storage.objects") == "DELETE 1"
    await conn.execute("CREATE SEQUENCE public.m047_back_seq")
    assert await conn.fetchval("SELECT has_sequence_privilege('authenticated', 'public.m047_back_seq', 'USAGE')")
