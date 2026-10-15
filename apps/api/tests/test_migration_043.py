"""Migration 043 gives the API its own database login, kripax_api, that reads
and writes the app's tables and can do nothing else, against a real Postgres
with Supabase's roles."""
import importlib.util
import pathlib

import pytest

MIG = pathlib.Path(__file__).parents[1] / "alembic/versions/043_api_database_role.py"


def _migration():
    spec = importlib.util.spec_from_file_location("m043", MIG)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_migration_043_chains_from_042():
    m = _migration()
    assert m.revision == "043"
    assert m.down_revision == "042"


@pytest.fixture
async def supabase_like(pg_uri):
    """Supabase's browser role, an app table, a sequence, Alembic's table and a
    table in another schema standing in for auth.users."""
    import asyncpg

    conn = await asyncpg.connect(pg_uri.replace("postgresql+asyncpg://", "postgresql://"))
    await conn.execute("""
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN CREATE ROLE postgres; END IF;
        END $$;
        DROP TABLE IF EXISTS public.m043_app, public.m043_later, public.alembic_version;
        DROP SCHEMA IF EXISTS m043auth CASCADE;
        CREATE TABLE public.m043_app (id serial PRIMARY KEY, note text);
        CREATE TABLE public.alembic_version (version_num varchar(32) PRIMARY KEY);
        CREATE SCHEMA m043auth;
        CREATE TABLE m043auth.users (id uuid PRIMARY KEY);
    """)
    yield conn
    await conn.execute(_migration().DOWNGRADE_SQL)
    await conn.execute("""
        DROP TABLE IF EXISTS public.m043_app, public.m043_later, public.alembic_version;
        DROP SCHEMA IF EXISTS m043auth CASCADE;
    """)
    await conn.close()


async def _can(conn, table, privilege):
    return await conn.fetchval("SELECT has_table_privilege('kripax_api', $1, $2)", table, privilege)


async def test_the_api_role_reads_and_writes_app_tables_and_nothing_more(supabase_like):
    conn = supabase_like
    await conn.execute(_migration().UPGRADE_SQL)

    role = await conn.fetchrow("SELECT * FROM pg_roles WHERE rolname = 'kripax_api'")
    assert role["rolbypassrls"]
    assert not role["rolcanlogin"], "the password is set by hand, never in a migration"
    for power in ("rolsuper", "rolcreaterole", "rolcreatedb", "rolreplication"):
        assert not role[power], power
    assert await conn.fetchval("SELECT count(*) FROM pg_auth_members WHERE member = $1", role["oid"]) == 0

    for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE"):
        assert await _can(conn, "public.m043_app", privilege)
    for privilege in ("TRUNCATE", "TRIGGER", "REFERENCES"):
        assert not await _can(conn, "public.m043_app", privilege)
    assert await conn.fetchval("SELECT has_sequence_privilege('kripax_api', 'public.m043_app_id_seq', 'USAGE')")

    assert not await conn.fetchval("SELECT has_schema_privilege('kripax_api', 'public', 'CREATE')")
    for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE"):
        assert not await _can(conn, "public.alembic_version", privilege)
        assert not await _can(conn, "m043auth.users", privilege)


async def test_tables_later_migrations_create_are_usable_too(supabase_like):
    conn = supabase_like
    await conn.execute(_migration().UPGRADE_SQL)
    await conn.execute("GRANT CREATE ON SCHEMA public TO postgres; SET ROLE postgres")
    await conn.execute("CREATE TABLE public.m043_later (id int)")
    await conn.execute("RESET ROLE")

    assert await _can(conn, "public.m043_later", "INSERT")
    assert not await _can(conn, "public.m043_later", "TRUNCATE")


async def test_upgrade_twice_is_harmless_and_downgrade_removes_the_role(supabase_like):
    conn = supabase_like
    m = _migration()
    await conn.execute(m.UPGRADE_SQL)
    await conn.execute(m.UPGRADE_SQL)
    await conn.execute(m.DOWNGRADE_SQL)
    assert await conn.fetchval("SELECT count(*) FROM pg_roles WHERE rolname = 'kripax_api'") == 0


def test_migrations_sign_in_with_their_own_login_when_one_is_set():
    from app.core.config import settings

    assert settings.model_copy(update={"migration_database_url": ""}).migration_url == settings.database_url
    owner = "postgresql+asyncpg://postgres.ref:pw@pooler.example:5432/postgres"
    assert settings.model_copy(update={"migration_database_url": owner}).migration_url == owner

    root = pathlib.Path(__file__).parents[1]
    for name in ("app/migrate.py", "alembic/env.py"):
        src = (root / name).read_text(encoding="utf-8")
        assert "settings.migration_url" in src and "settings.database_url" not in src, name
