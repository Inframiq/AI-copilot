"""Migration 040 takes the browser roles' grants down to what the web app
uses, against a real Postgres set up the way Supabase ships it."""
import importlib.util
import pathlib

import pytest

MIG = pathlib.Path(__file__).parents[1] / "alembic/versions/040_tighten_browser_grants.py"


def _migration():
    spec = importlib.util.spec_from_file_location("m040", MIG)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_migration_040_chains_from_039():
    m = _migration()
    assert m.revision == "040"
    assert m.down_revision == "039"
    assert set(m.BROWSER_TABLES) == {"career_profiles", "profiles", "connection_requests"}
    assert "__BROWSER_TABLES__" not in m.UPGRADE_SQL


@pytest.fixture
async def supabase_like(pg_uri):
    """Supabase's browser roles holding every privilege, as they do by default,
    on one browser table, one API-only table and connection_requests with its
    status-only UPDATE."""
    import asyncpg

    conn = await asyncpg.connect(pg_uri.replace("postgresql+asyncpg://", "postgresql://"))
    await conn.execute("""
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        END $$;
        DROP TABLE IF EXISTS public.career_profiles, public.connection_requests, public.m040_api_only;
        CREATE TABLE public.career_profiles (user_id uuid PRIMARY KEY, headline text);
        CREATE TABLE public.connection_requests (id uuid PRIMARY KEY, from_user uuid, to_user uuid, status text);
        CREATE TABLE public.m040_api_only (id uuid PRIMARY KEY);
        GRANT ALL ON public.career_profiles, public.connection_requests, public.m040_api_only TO anon, authenticated;
        REVOKE UPDATE ON public.connection_requests FROM anon, authenticated;
        GRANT UPDATE (status) ON public.connection_requests TO authenticated;
    """)
    yield conn
    await conn.execute("DROP TABLE IF EXISTS public.career_profiles, public.connection_requests, public.m040_api_only")
    await conn.close()


async def _can(conn, role, table, privilege):
    return await conn.fetchval("SELECT has_table_privilege($1, $2, $3)", role, f"public.{table}", privilege)


async def test_upgrade_leaves_the_browser_only_what_the_app_uses(supabase_like):
    conn = supabase_like
    await conn.execute(_migration().UPGRADE_SQL)

    for table in ("career_profiles", "connection_requests", "m040_api_only"):
        for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"):
            assert not await _can(conn, "anon", table, privilege), f"anon still has {privilege} on {table}"

    for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE"):
        assert await _can(conn, "authenticated", "career_profiles", privilege)
    for privilege in ("TRUNCATE", "TRIGGER", "REFERENCES"):
        assert not await _can(conn, "authenticated", "career_profiles", privilege)

    # Connection requests: the recipient may still change the status, and only that.
    assert await conn.fetchval("SELECT has_column_privilege('authenticated', 'public.connection_requests', 'status', 'UPDATE')")
    assert not await conn.fetchval("SELECT has_column_privilege('authenticated', 'public.connection_requests', 'from_user', 'UPDATE')")
    assert not await _can(conn, "authenticated", "connection_requests", "TRUNCATE")

    for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"):
        assert not await _can(conn, "authenticated", "m040_api_only", privilege)


async def test_downgrade_restores_the_supabase_defaults(supabase_like):
    conn = supabase_like
    m = _migration()
    await conn.execute(m.UPGRADE_SQL)
    await conn.execute(m.DOWNGRADE_SQL)

    assert await _can(conn, "anon", "m040_api_only", "SELECT")
    assert await _can(conn, "authenticated", "m040_api_only", "TRUNCATE")
    assert await conn.fetchval("SELECT has_column_privilege('authenticated', 'public.connection_requests', 'status', 'UPDATE')")
    assert not await conn.fetchval("SELECT has_column_privilege('authenticated', 'public.connection_requests', 'from_user', 'UPDATE')")
