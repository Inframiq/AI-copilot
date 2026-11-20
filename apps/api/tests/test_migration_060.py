"""Migration 060: an account is signed in on at most two devices at a time —
the two newest sessions count, through the one check the API and the
browser's rules share (private.session_is_active)."""
import importlib.util
import json
import pathlib
import re
import uuid
from datetime import datetime, timedelta, timezone

import asyncpg
import pytest

VERSIONS = pathlib.Path(__file__).parents[1] / "alembic/versions"
DB = "m060"
USER_A = uuid.UUID("11111111-1111-1111-1111-111111110060")
USER_B = uuid.UUID("22222222-2222-2222-2222-222222220060")


def _migration(name):
    spec = importlib.util.spec_from_file_location(name.split("_")[0], VERSIONS / name)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


M045 = _migration("045_signed_out_tokens_stop_working.py")
M048 = _migration("048_session_check_only_your_own.py")
M049 = _migration("049_banned_accounts_stop_working.py")
M060 = _migration("060_two_devices_at_a_time.py")


def test_migration_060_chains_from_059():
    assert (M060.revision, M060.down_revision) == ("060", "059")


def test_the_sql_has_no_colon_words_sqlalchemy_would_take_for_parameters():
    for sql in (M060.UPGRADE_SQL, M060.DOWNGRADE_SQL):
        assert not re.search(r"(?<![:\w\\]):\w", sql)


def test_the_downgrade_puts_back_049s_function_exactly():
    body = lambda sql: re.sub(r"\s+", " ", sql[sql.index("CREATE OR REPLACE"):sql.index("$f$;") + 4])
    assert body(M060.DOWNGRADE_SQL) == body(M049.UPGRADE_SQL)


def _on_database(uri: str, name: str) -> str:
    from urllib.parse import urlsplit, urlunsplit

    return urlunsplit(urlsplit(uri)._replace(path="/" + name))


@pytest.fixture
async def conn(pg_uri):
    """auth as Supabase has it (sessions with created_at), career_profiles
    behind the session check, and 045 → 048 → 049 → 060 applied."""
    server = pg_uri.replace("postgresql+asyncpg://", "postgresql://")
    admin = await asyncpg.connect(server)
    await admin.execute(f"DROP DATABASE IF EXISTS {DB} WITH (FORCE)")
    await admin.execute(f"CREATE DATABASE {DB}")
    await admin.execute("""
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kripax_api') THEN CREATE ROLE kripax_api NOLOGIN NOINHERIT BYPASSRLS; END IF;
        END $$;
    """)
    c = await asyncpg.connect(_on_database(server, DB))
    await c.execute("""
        CREATE SCHEMA auth;
        CREATE TABLE auth.sessions (id uuid PRIMARY KEY, user_id uuid NOT NULL, not_after timestamptz,
                                    created_at timestamptz NOT NULL DEFAULT now());
        CREATE TABLE auth.users (id uuid PRIMARY KEY, banned_until timestamptz, deleted_at timestamptz);
        CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE
          AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
        CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
          AS $$ SELECT nullif(auth.jwt() ->> 'sub', '')::uuid $$;
        GRANT USAGE ON SCHEMA auth TO authenticated;
        CREATE TABLE public.career_profiles (user_id uuid PRIMARY KEY, headline text);
        ALTER TABLE public.career_profiles ENABLE ROW LEVEL SECURITY;
        CREATE POLICY "career_profiles_own" ON public.career_profiles
          FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
        GRANT SELECT, INSERT, UPDATE ON public.career_profiles TO authenticated;
    """)
    for m in (M045, M048, M049, M060):
        await c.execute(m.UPGRADE_SQL)
    await c.execute("INSERT INTO auth.users (id) VALUES ($1), ($2)", USER_A, USER_B)
    await c.execute("INSERT INTO public.career_profiles VALUES ($1, 'a'), ($2, 'b')", USER_A, USER_B)
    yield c
    await c.close()
    await admin.execute(f"DROP DATABASE {DB} WITH (FORCE)")
    await admin.close()


T0 = datetime(2026, 11, 20, 9, 0, tzinfo=timezone.utc)


async def _sign_in(conn, user=USER_A, minutes=0, not_after=None):
    sid = uuid.uuid4()
    await conn.execute("INSERT INTO auth.sessions VALUES ($1, $2, $3, $4)", sid, user, not_after, T0 + timedelta(minutes=minutes))
    return sid


async def _active(conn, sid):
    return await conn.fetchval("SELECT private.session_is_active($1)", str(sid))


async def _browser_reads(conn, sid, user=USER_A):
    claims = {"sub": str(user), "role": "authenticated", "session_id": str(sid)}
    async with conn.transaction():
        await conn.execute("SET LOCAL ROLE authenticated")
        await conn.execute("SELECT set_config('request.jwt.claims', $1, true)", json.dumps(claims))
        return [r["headline"] for r in await conn.fetch("SELECT headline FROM public.career_profiles")]


async def test_two_devices_are_fine(conn):
    phone, laptop = await _sign_in(conn, minutes=1), await _sign_in(conn, minutes=2)
    assert await _active(conn, phone) and await _active(conn, laptop)


async def test_a_third_sign_in_ends_the_oldest(conn):
    first, second, third = (await _sign_in(conn, minutes=1), await _sign_in(conn, minutes=2), await _sign_in(conn, minutes=3))
    assert not await _active(conn, first)
    assert await _active(conn, second) and await _active(conn, third)
    # The browser's own path stops too, not only the API.
    assert await _browser_reads(conn, first) == []
    assert await _browser_reads(conn, third) == ["a"]


async def test_signing_in_again_on_the_first_device_ends_the_next_oldest(conn):
    first, second, third = (await _sign_in(conn, minutes=1), await _sign_in(conn, minutes=2), await _sign_in(conn, minutes=3))
    again = await _sign_in(conn, minutes=4)
    assert [await _active(conn, s) for s in (first, second, third, again)] == [False, False, True, True]


async def test_sessions_that_ended_dont_take_a_place(conn):
    old = await _sign_in(conn, minutes=1)
    await _sign_in(conn, minutes=2, not_after=T0)  # time-boxed, long over
    await _sign_in(conn, minutes=3)
    assert await _active(conn, old)


async def test_each_account_counts_its_own(conn):
    a1 = await _sign_in(conn, USER_A, minutes=1)
    for m in (2, 3, 4):
        await _sign_in(conn, USER_B, minutes=m)
    assert await _active(conn, a1)


async def test_a_banned_account_still_stops(conn):
    sid = await _sign_in(conn, minutes=1)
    await conn.execute("UPDATE auth.users SET banned_until = now() + interval '1 day' WHERE id = $1", USER_A)
    assert not await _active(conn, sid)


async def test_the_migration_refuses_an_auth_sessions_without_created_at(conn):
    await conn.execute("ALTER TABLE auth.sessions DROP COLUMN created_at")
    with pytest.raises(asyncpg.RaiseError, match="no created_at"):
        await conn.execute(M060.UPGRADE_SQL)


async def test_downgrade_lets_every_device_back(conn):
    first = await _sign_in(conn, minutes=1)
    await _sign_in(conn, minutes=2)
    await _sign_in(conn, minutes=3)
    await conn.execute(M060.DOWNGRADE_SQL)
    assert await _active(conn, first)


def test_the_web_app_says_the_same_number():
    """The sign-in page tells a pushed-out device how many are allowed."""
    web = (pathlib.Path(__file__).parents[2] / "web/lib/devices.ts").read_text("utf8")
    assert int(re.search(r"DEVICES_AT_A_TIME = (\d+);", web).group(1)) == M060.DEVICES
