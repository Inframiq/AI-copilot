"""A copied access token stops working once its sign-in session ends (test
ATK-007). The token's signature and expiry still check out after sign-out,
so the API asks the database whether the session behind it still exists, and
the browser's direct paths (career_profiles, the avatars bucket) ask the same
in their RLS policies (migration 045)."""
import importlib.util
import pathlib
import time
import uuid

import asyncpg
import jwt as pyjwt
import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from starlette.requests import Request

from app.core import security

# Taken before conftest's autouse fixture swaps in an always-open check.
REAL_SESSION_STILL_OPEN = security._session_still_open

MIG = pathlib.Path(__file__).parents[1] / "alembic/versions/045_signed_out_tokens_stop_working.py"
DB = "m045"


def _migration():
    spec = importlib.util.spec_from_file_location("m045", MIG)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_migration_045_chains_from_044():
    m = _migration()
    assert m.revision == "045"
    assert m.down_revision == "044"


# ── The API's check ─────────────────────────────────────────────────────────

def _token(session_id: str | None = "s-1") -> HTTPAuthorizationCredentials:
    payload = {"sub": "user-a", "aud": "authenticated", "exp": int(time.time()) + 3600}
    if session_id is not None:
        payload["session_id"] = session_id
    token = pyjwt.encode(payload, security.settings.supabase_jwt_secret, algorithm="HS256")
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


def _request() -> Request:
    return Request({"type": "http", "method": "GET", "path": "/resumes", "headers": [], "client": ("203.0.113.9", 1)})


@pytest.fixture
def sessions(monkeypatch):
    """The real check, over a stand-in for the database's answer."""
    live: set[str] = set()
    asked: list[str] = []

    async def _is_active(session_id):
        asked.append(session_id)
        return session_id in live

    monkeypatch.setattr(security, "_session_still_open", REAL_SESSION_STILL_OPEN)
    monkeypatch.setattr(security, "_session_is_active", _is_active)
    return live, asked


async def test_a_token_whose_session_is_open_is_accepted(sessions):
    live, _ = sessions
    live.add("s-1")
    payload = await security.get_current_user(_request(), _token("s-1"))
    assert payload["sub"] == "user-a"


async def test_a_token_whose_session_ended_is_refused_like_a_forged_one(sessions):
    request = _request()
    with pytest.raises(HTTPException) as e:
        await security.get_current_user(request, _token("s-1"))
    assert e.value.status_code == 401
    assert e.value.detail == "Invalid token"
    assert request.state.denial_reason == "ended_session"
    assert request.state.denial_user == "user-a"


async def test_a_token_naming_no_session_is_refused_without_asking(sessions):
    _, asked = sessions
    with pytest.raises(HTTPException) as e:
        await security.get_current_user(_request(), _token(None))
    assert e.value.status_code == 401
    assert asked == []


async def test_sign_out_is_honoured_within_seconds(sessions, monkeypatch):
    live, asked = sessions
    live.add("s-1")
    clock = [1000.0]
    monkeypatch.setattr(security.time, "monotonic", lambda: clock[0])

    await security.get_current_user(_request(), _token("s-1"))
    await security.get_current_user(_request(), _token("s-1"))
    assert asked == ["s-1"], "a burst of requests asks once"

    live.discard("s-1")  # the owner signs out
    clock[0] += security._SESSION_LIVE_TTL + 0.1
    with pytest.raises(HTTPException):
        await security.get_current_user(_request(), _token("s-1"))


async def test_an_ended_session_is_asked_about_once_a_minute(sessions, monkeypatch):
    _, asked = sessions
    clock = [1000.0]
    monkeypatch.setattr(security.time, "monotonic", lambda: clock[0])
    for _ in range(3):
        clock[0] += 10
        with pytest.raises(HTTPException):
            await security.get_current_user(_request(), _token("s-gone"))
    assert asked == ["s-gone"], "a replayed dead token doesn't reach the database each time"


async def test_a_lifted_ban_lets_the_same_session_back_in_within_a_minute(sessions, monkeypatch):
    live, _ = sessions
    clock = [1000.0]
    monkeypatch.setattr(security.time, "monotonic", lambda: clock[0])
    with pytest.raises(HTTPException):
        await security.get_current_user(_request(), _token("s-1"))  # banned
    live.add("s-1")  # the ban is lifted; the session was never deleted
    clock[0] += security._SESSION_ENDED_TTL + 0.1
    assert (await security.get_current_user(_request(), _token("s-1")))["sub"] == "user-a"


# ── The database side (migration 045) ───────────────────────────────────────

def _on_database(uri: str, name: str) -> str:
    """The same server, another database. Swaps only the path: on Linux the
    server is a socket named in ?host=/tmp/..., so cutting at the last "/"
    would cut that instead."""
    from urllib.parse import urlsplit, urlunsplit

    return urlunsplit(urlsplit(uri)._replace(path="/" + name))


USER_A = uuid.UUID("11111111-1111-1111-1111-111111111111")
SESSION_A = uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")

# What 002 and 006 created, as the deploy finds them.
SUPABASE_LIKE = """
    CREATE SCHEMA auth AUTHORIZATION m045_auth_admin;
    SET ROLE m045_auth_admin;
    CREATE TABLE auth.sessions (id uuid PRIMARY KEY, user_id uuid NOT NULL, not_after timestamptz);
    CREATE TABLE auth.users (id uuid PRIMARY KEY, banned_until timestamptz, deleted_at timestamptz);
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE
      AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $$ SELECT nullif(auth.jwt() ->> 'sub', '')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO m045_owner, m045_storage_admin, authenticated;
    GRANT SELECT ON auth.sessions, auth.users TO m045_owner;  -- as Supabase's postgres reads them
    RESET ROLE;

    CREATE SCHEMA storage AUTHORIZATION __STORAGE_OWNER__;
    SET ROLE __STORAGE_OWNER__;
    CREATE TABLE storage.objects (id serial PRIMARY KEY, bucket_id text, name text);
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
    GRANT USAGE ON SCHEMA storage TO authenticated, m045_owner;
    GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
    GRANT USAGE ON SEQUENCE storage.objects_id_seq TO authenticated;
    RESET ROLE;

    SET ROLE m045_owner;
    CREATE TABLE public.career_profiles (user_id uuid PRIMARY KEY, headline text);
    ALTER TABLE public.career_profiles ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "career_profiles_own" ON public.career_profiles
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.career_profiles TO authenticated;
    RESET ROLE;
"""


async def _database(pg_uri: str, storage_owner: str):
    server = pg_uri.replace("postgresql+asyncpg://", "postgresql://")
    admin = await asyncpg.connect(server)
    await admin.execute(f"DROP DATABASE IF EXISTS {DB} WITH (FORCE)")
    await admin.execute(f"CREATE DATABASE {DB}")
    await admin.execute("""
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kripax_api') THEN CREATE ROLE kripax_api NOLOGIN NOINHERIT BYPASSRLS; END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'm045_owner') THEN CREATE ROLE m045_owner NOLOGIN CREATEROLE BYPASSRLS; END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'm045_auth_admin') THEN CREATE ROLE m045_auth_admin NOLOGIN; END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'm045_storage_admin') THEN CREATE ROLE m045_storage_admin NOLOGIN; END IF;
        END $$;
    """)
    conn = await asyncpg.connect(_on_database(server, DB))
    await conn.execute(f"GRANT CREATE ON DATABASE {DB} TO m045_owner; GRANT CREATE ON SCHEMA public TO m045_owner")
    await conn.execute(SUPABASE_LIKE.replace("__STORAGE_OWNER__", storage_owner))
    await conn.execute("SET ROLE m045_owner")  # the deploy's migration login
    return admin, conn


async def _drop(admin, conn):
    await conn.close()
    await admin.execute(f"DROP DATABASE {DB} WITH (FORCE)")
    for role in ("m045_owner", "m045_auth_admin", "m045_storage_admin"):
        await admin.execute(f"DROP ROLE IF EXISTS {role}")
    await admin.close()


@pytest.fixture
async def supabase_like(pg_uri):
    """Storage owned by the migration login, as it was when 006 ran."""
    admin, conn = await _database(pg_uri, "m045_owner")
    yield conn
    await _drop(admin, conn)


@pytest.fixture
async def storage_not_ours(pg_uri):
    """Storage owned by its own admin role, which the migration login is not."""
    admin, conn = await _database(pg_uri, "m045_storage_admin")
    yield conn
    await _drop(admin, conn)


async def _as_browser(conn, sql, *args, session_id=SESSION_A, user=USER_A):
    """Run one statement as Supabase's Data API does for a signed-in token."""
    claims = {"sub": str(user), "role": "authenticated"}
    if session_id is not None:
        claims["session_id"] = str(session_id)
    async with conn.transaction():
        await conn.execute("SET LOCAL ROLE authenticated")
        await conn.execute("SELECT set_config('request.jwt.claims', $1, true)", __import__("json").dumps(claims))
        return await conn.fetch(sql, *args)


async def _seed(conn):
    async with conn.transaction():
        await conn.execute("RESET ROLE")
        await conn.execute("INSERT INTO auth.users (id) VALUES ($1)", USER_A)
        await conn.execute("INSERT INTO auth.sessions VALUES ($1, $2, NULL)", SESSION_A, USER_A)
        await conn.execute("INSERT INTO public.career_profiles VALUES ($1, 'mine')", USER_A)
        await conn.execute("INSERT INTO storage.objects (bucket_id, name) VALUES ('avatars', $1)", f"{USER_A}/profile.png")
        await conn.execute("SET ROLE m045_owner")


async def _end_session(conn):
    async with conn.transaction():
        await conn.execute("RESET ROLE")
        await conn.execute("DELETE FROM auth.sessions WHERE id = $1", SESSION_A)
        await conn.execute("SET ROLE m045_owner")


async def test_before_the_fix_a_signed_out_token_still_reads_the_profile(supabase_like):
    conn = supabase_like
    await _seed(conn)
    await _end_session(conn)
    rows = await _as_browser(conn, "SELECT headline FROM public.career_profiles")
    assert [r["headline"] for r in rows] == ["mine"]


async def test_after_sign_out_the_token_reads_and_writes_nothing(supabase_like):
    conn = supabase_like
    await conn.execute(_migration().UPGRADE_SQL)
    await _seed(conn)

    assert len(await _as_browser(conn, "SELECT * FROM public.career_profiles")) == 1
    assert len(await _as_browser(conn, "SELECT * FROM storage.objects")) == 1

    await _end_session(conn)
    assert await _as_browser(conn, "SELECT * FROM public.career_profiles") == []
    assert await _as_browser(conn, "SELECT * FROM storage.objects") == []
    assert await _as_browser(conn, "UPDATE public.career_profiles SET headline = 'theirs' RETURNING 1") == []
    assert await _as_browser(conn, "DELETE FROM storage.objects RETURNING 1") == []
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        await _as_browser(conn, "INSERT INTO storage.objects (bucket_id, name) VALUES ('avatars', $1)", f"{USER_A}/new.png")


@pytest.mark.parametrize("session_id", [None, "", "not-a-uuid", str(uuid.uuid4())])
async def test_a_token_with_no_known_session_sees_nothing(supabase_like, session_id):
    conn = supabase_like
    await conn.execute(_migration().UPGRADE_SQL)
    await _seed(conn)
    assert await _as_browser(conn, "SELECT * FROM public.career_profiles", session_id=session_id) == []


async def test_a_session_past_its_not_after_has_ended(supabase_like):
    conn = supabase_like
    await conn.execute(_migration().UPGRADE_SQL)
    await _seed(conn)
    async with conn.transaction():
        await conn.execute("RESET ROLE")
        await conn.execute("UPDATE auth.sessions SET not_after = now() - interval '1 minute'")
    assert not await conn.fetchval("SELECT private.session_is_active($1)", str(SESSION_A))


async def test_only_the_check_is_shared_never_the_sessions(supabase_like):
    conn = supabase_like
    await conn.execute(_migration().UPGRADE_SQL)
    await _seed(conn)
    fn = "private.session_is_active(text)"
    assert await conn.fetchval("SELECT has_function_privilege('kripax_api', $1, 'EXECUTE')", fn)
    assert await conn.fetchval("SELECT has_function_privilege('authenticated', $1, 'EXECUTE')", fn)
    assert not await conn.fetchval("SELECT has_function_privilege('anon', $1, 'EXECUTE')", fn)
    assert not await conn.fetchval("SELECT has_table_privilege('authenticated', 'auth.sessions', 'SELECT')")
    assert not await conn.fetchval("SELECT has_table_privilege('kripax_api', 'auth.sessions', 'SELECT')")
    async with conn.transaction():
        await conn.execute("SET LOCAL ROLE kripax_api")
        assert await conn.fetchval("SELECT private.session_is_active($1)", str(SESSION_A))


async def test_the_api_query_matches_the_function(supabase_like, pg_uri, monkeypatch):
    from sqlalchemy.ext.asyncio import create_async_engine
    from app.db import session as db_session

    conn = supabase_like
    await conn.execute(_migration().UPGRADE_SQL)
    await _seed(conn)
    engine = create_async_engine(_on_database(pg_uri, DB))
    monkeypatch.setattr(db_session, "engine", engine)
    try:
        assert await security._session_is_active(str(SESSION_A)) is True
        await _end_session(conn)
        assert await security._session_is_active(str(SESSION_A)) is False
    finally:
        await engine.dispose()


async def test_storage_it_may_not_change_is_left_and_the_rest_still_applies(storage_not_ours):
    conn = storage_not_ours
    await conn.execute(_migration().UPGRADE_SQL)
    await _seed(conn)
    await _end_session(conn)
    assert await _as_browser(conn, "SELECT * FROM public.career_profiles") == []
    qual = await conn.fetchval("SELECT qual FROM pg_policies WHERE policyname = 'avatars_select_own'")
    assert "session_is_active" not in qual


async def test_a_login_that_cannot_read_sessions_stops_the_deploy(supabase_like):
    conn = supabase_like
    async with conn.transaction():
        await conn.execute("RESET ROLE")
        await conn.execute("REVOKE SELECT ON auth.sessions FROM m045_owner")
        await conn.execute("SET ROLE m045_owner")
    with pytest.raises(asyncpg.RaiseError, match="cannot read auth.sessions"):
        await conn.execute(_migration().UPGRADE_SQL)


async def test_downgrade_puts_the_policies_back(supabase_like):
    conn = supabase_like
    before = await conn.fetch("SELECT policyname, qual, with_check FROM pg_policies ORDER BY policyname")
    await conn.execute(_migration().UPGRADE_SQL)
    await conn.execute(_migration().UPGRADE_SQL)  # a re-run changes nothing
    after = await conn.fetch("SELECT policyname, qual, with_check FROM pg_policies ORDER BY policyname")
    assert all("session_is_active" in (r["qual"] or r["with_check"]) for r in after)
    await conn.execute(_migration().DOWNGRADE_SQL)
    assert await conn.fetch("SELECT policyname, qual, with_check FROM pg_policies ORDER BY policyname") == before
    assert await conn.fetchval("SELECT to_regnamespace('private')") is None


# ── Migration 048: a browser asks only about its own sign-in ────────────────

MIG_048 = pathlib.Path(__file__).parents[1] / "alembic/versions/048_session_check_only_your_own.py"
SESSION_B = uuid.UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")


def _migration_048():
    spec = importlib.util.spec_from_file_location("m048", MIG_048)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_migration_048_chains_from_047():
    m = _migration_048()
    assert m.revision == "048"
    assert m.down_revision == "047"
    assert "__CALLER_CHECK__" not in m.UPGRADE_SQL + m.DOWNGRADE_SQL
    assert m.CALLER_CHECK in m.UPGRADE_SQL and m.CALLER_CHECK not in m.DOWNGRADE_SQL


async def _with_b_signed_in(conn):
    await conn.execute(_migration().UPGRADE_SQL)
    await _seed(conn)
    async with conn.transaction():
        await conn.execute("RESET ROLE")
        user_b = uuid.uuid4()
        await conn.execute("INSERT INTO auth.users (id) VALUES ($1)", user_b)
        await conn.execute("INSERT INTO auth.sessions VALUES ($1, $2, NULL)", SESSION_B, user_b)
        await conn.execute("SET ROLE m045_owner")


async def _asks(conn, session_id):
    rows = await _as_browser(conn, "SELECT private.session_is_active($1) AS live", str(session_id))
    return rows[0]["live"]


async def test_before_048_a_signed_in_user_could_ask_about_another_session(supabase_like):
    conn = supabase_like
    await _with_b_signed_in(conn)
    assert await _asks(conn, SESSION_B) is True


async def test_after_048_a_signed_in_user_learns_only_about_their_own(supabase_like):
    conn = supabase_like
    await _with_b_signed_in(conn)
    await conn.execute(_migration_048().UPGRADE_SQL)

    assert await _asks(conn, SESSION_A) is True
    assert await _asks(conn, SESSION_B) is False
    assert await _asks(conn, str(SESSION_A).upper()) is True
    # The rules, which pass the caller's own session, still let A in.
    assert len(await _as_browser(conn, "SELECT * FROM public.career_profiles")) == 1
    assert len(await _as_browser(conn, "SELECT * FROM storage.objects")) == 1


async def test_after_048_the_api_login_still_asks_about_any_session(supabase_like):
    conn = supabase_like
    await _with_b_signed_in(conn)
    await conn.execute(_migration_048().UPGRADE_SQL)
    async with conn.transaction():
        await conn.execute("SET LOCAL ROLE kripax_api")
        assert await conn.fetchval("SELECT private.session_is_active($1)", str(SESSION_B)) is True
        assert await conn.fetchval("SELECT private.session_is_active($1)", str(SESSION_A)) is True


async def test_048_keeps_the_grants_and_the_downgrade_restores_045(supabase_like):
    conn = supabase_like
    await _with_b_signed_in(conn)
    m = _migration_048()
    await conn.execute(m.UPGRADE_SQL)
    fn = "private.session_is_active(text)"
    assert await conn.fetchval("SELECT has_function_privilege('authenticated', $1, 'EXECUTE')", fn)
    assert not await conn.fetchval("SELECT has_function_privilege('anon', $1, 'EXECUTE')", fn)
    config = await conn.fetchval("SELECT proconfig FROM pg_proc WHERE oid = $1::regprocedure", fn)
    assert config == ['search_path=""']
    await conn.execute(m.DOWNGRADE_SQL)
    assert await _asks(conn, SESSION_B) is True


# ── Migration 049: a banned or deleted account's token stops working ────────

MIG_049 = pathlib.Path(__file__).parents[1] / "alembic/versions/049_banned_accounts_stop_working.py"


def _migration_049():
    spec = importlib.util.spec_from_file_location("m049", MIG_049)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_migration_049_chains_from_048_and_keeps_its_caller_check():
    m = _migration_049()
    assert m.revision == "049"
    assert m.down_revision == "048"
    assert "__" not in m.UPGRADE_SQL + m.DOWNGRADE_SQL
    assert _migration_048().CALLER_CHECK in m.UPGRADE_SQL
    # Downgrading puts back exactly 048's function.
    assert m.DOWNGRADE_SQL.split() == _migration_048().UPGRADE_SQL.split()


async def _up_to_049(conn):
    await conn.execute(_migration().UPGRADE_SQL)
    await conn.execute(_migration_048().UPGRADE_SQL)
    await _seed(conn)


async def _set_user(conn, sql):
    async with conn.transaction():
        await conn.execute("RESET ROLE")
        await conn.execute(sql, USER_A)
        await conn.execute("SET ROLE m045_owner")


BAN = "UPDATE auth.users SET banned_until = now() + interval '100 years' WHERE id = $1"


async def test_before_049_a_banned_account_keeps_reading_its_profile(supabase_like):
    conn = supabase_like
    await _up_to_049(conn)
    await _set_user(conn, BAN)
    assert len(await _as_browser(conn, "SELECT * FROM public.career_profiles")) == 1


@pytest.mark.parametrize("change", [
    BAN,
    "UPDATE auth.users SET deleted_at = now() WHERE id = $1",
    "DELETE FROM auth.users WHERE id = $1",
])
async def test_after_049_a_banned_or_deleted_account_reads_and_writes_nothing(supabase_like, change):
    conn = supabase_like
    await _up_to_049(conn)
    await conn.execute(_migration_049().UPGRADE_SQL)
    assert len(await _as_browser(conn, "SELECT * FROM public.career_profiles")) == 1

    await _set_user(conn, change)
    assert await _as_browser(conn, "SELECT * FROM public.career_profiles") == []
    assert await _as_browser(conn, "SELECT * FROM storage.objects") == []
    assert await _as_browser(conn, "UPDATE public.career_profiles SET headline = 'x' RETURNING 1") == []
    async with conn.transaction():
        await conn.execute("SET LOCAL ROLE kripax_api")
        assert await conn.fetchval("SELECT private.session_is_active($1)", str(SESSION_A)) is False


async def test_after_049_a_ban_that_ran_out_or_was_lifted_lets_the_session_back(supabase_like):
    conn = supabase_like
    await _up_to_049(conn)
    await conn.execute(_migration_049().UPGRADE_SQL)
    await _set_user(conn, "UPDATE auth.users SET banned_until = now() - interval '1 minute' WHERE id = $1")
    assert len(await _as_browser(conn, "SELECT * FROM public.career_profiles")) == 1
    await _set_user(conn, "UPDATE auth.users SET banned_until = NULL WHERE id = $1")
    assert len(await _as_browser(conn, "SELECT * FROM public.career_profiles")) == 1


async def test_after_049_the_browser_still_asks_only_about_its_own_session(supabase_like):
    conn = supabase_like
    await _with_b_signed_in(conn)
    await conn.execute(_migration_048().UPGRADE_SQL)
    await conn.execute(_migration_049().UPGRADE_SQL)
    assert await _asks(conn, SESSION_A) is True
    assert await _asks(conn, SESSION_B) is False
    fn = "private.session_is_active(text)"
    assert await conn.fetchval("SELECT has_function_privilege('authenticated', $1, 'EXECUTE')", fn)
    assert not await conn.fetchval("SELECT has_function_privilege('anon', $1, 'EXECUTE')", fn)


async def test_a_login_that_cannot_read_users_stops_the_049_deploy(supabase_like):
    conn = supabase_like
    await _up_to_049(conn)
    async with conn.transaction():
        await conn.execute("RESET ROLE")
        await conn.execute("REVOKE SELECT ON auth.users FROM m045_owner")
        await conn.execute("SET ROLE m045_owner")
    with pytest.raises(asyncpg.RaiseError, match="cannot read auth.users"):
        await conn.execute(_migration_049().UPGRADE_SQL)
    # The running check is left as it was.
    assert len(await _as_browser(conn, "SELECT * FROM public.career_profiles")) == 1


async def test_049_downgrade_lets_a_banned_account_back_in(supabase_like):
    conn = supabase_like
    await _up_to_049(conn)
    m = _migration_049()
    await conn.execute(m.UPGRADE_SQL)
    await conn.execute(m.UPGRADE_SQL)  # a re-run changes nothing
    await _set_user(conn, BAN)
    assert await _as_browser(conn, "SELECT * FROM public.career_profiles") == []
    await conn.execute(m.DOWNGRADE_SQL)
    assert len(await _as_browser(conn, "SELECT * FROM public.career_profiles")) == 1
