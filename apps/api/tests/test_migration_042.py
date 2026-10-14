"""Migration 042 drops Networking's Supabase tables, and its downgrade brings
them back as the browser had them, against a real Postgres with Supabase's
browser role and a stand-in auth schema."""
import importlib.util
import pathlib

import asyncpg
import pytest

MIG = pathlib.Path(__file__).parents[1] / "alembic/versions/042_drop_networking.py"


def _migration():
    spec = importlib.util.spec_from_file_location("m042", MIG)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _sql(which):
    """The migration's SQL aimed at its own schemas, so the tables it builds
    never collide with the app tables other tests share this database with."""
    return getattr(_migration(), which).replace("public.", "m042.").replace("auth.", "m042auth.")


def test_migration_042_chains_from_041():
    m = _migration()
    assert m.revision == "042"
    assert m.down_revision == "041"


@pytest.fixture
async def conn(pg_uri):
    conn = await asyncpg.connect(pg_uri.replace("postgresql+asyncpg://", "postgresql://"))
    await conn.execute("""
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        END $$;
        DROP SCHEMA IF EXISTS m042 CASCADE;
        DROP SCHEMA IF EXISTS m042auth CASCADE;
        CREATE SCHEMA m042;
        CREATE SCHEMA m042auth;
    """)
    yield conn
    await conn.execute("DROP SCHEMA IF EXISTS m042 CASCADE; DROP SCHEMA IF EXISTS m042auth CASCADE")
    await conn.close()


async def _exists(conn, table):
    return await conn.fetchval("SELECT to_regclass($1) IS NOT NULL", f"m042.{table}")


async def test_downgrade_is_skipped_without_supabase_auth(conn):
    await conn.execute(_sql("DOWNGRADE_SQL"))
    assert not await _exists(conn, "profiles")
    assert not await _exists(conn, "connection_requests")


async def test_upgrade_is_a_no_op_where_the_tables_never_existed(conn):
    await conn.execute(_sql("UPGRADE_SQL"))


async def test_downgrade_restores_the_tables_and_upgrade_drops_them(conn):
    await conn.execute("""
        CREATE TABLE m042auth.users (id uuid PRIMARY KEY);
        CREATE FUNCTION m042auth.uid() RETURNS uuid LANGUAGE sql STABLE
          AS $$ SELECT nullif(current_setting('m042.uid', true), '')::uuid $$;
    """)
    await conn.execute(_sql("DOWNGRADE_SQL"))

    assert await _exists(conn, "profiles")
    assert await _exists(conn, "connection_requests")
    policies = {r["policyname"] for r in await conn.fetch("SELECT policyname FROM pg_policies WHERE schemaname = 'm042'")}
    assert policies == {
        "profiles_select_authenticated", "profiles_insert_own", "profiles_update_own", "profiles_delete_own",
        "conn_select_participant", "conn_insert_sender", "conn_update_recipient", "conn_delete_sender",
    }
    # Connection requests: the recipient may change the status, and only that.
    assert await conn.fetchval("SELECT has_column_privilege('authenticated', 'm042.connection_requests', 'status', 'UPDATE')")
    assert not await conn.fetchval("SELECT has_column_privilege('authenticated', 'm042.connection_requests', 'from_user', 'UPDATE')")
    assert not await conn.fetchval("SELECT has_table_privilege('authenticated', 'm042.profiles', 'TRUNCATE')")

    await conn.execute(_sql("UPGRADE_SQL"))
    assert not await _exists(conn, "profiles")
    assert not await _exists(conn, "connection_requests")
