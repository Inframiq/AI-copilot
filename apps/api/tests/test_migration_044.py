"""Migration 044 removes rows whose account no longer exists and links every
user_id to auth.users with ON DELETE CASCADE, run as a Supabase-like owner
(no superuser) on a database of its own."""
import importlib.util
import pathlib
import uuid

import pytest

MIG = pathlib.Path(__file__).parents[1] / "alembic/versions/044_user_rows_follow_the_account.py"
GONE = uuid.UUID("aaaaaaaa-0000-4000-8000-000000000044")


def _migration():
    spec = importlib.util.spec_from_file_location("m044", MIG)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _on_database(uri: str, name: str) -> str:
    from urllib.parse import urlsplit, urlunsplit

    return urlunsplit(urlsplit(uri)._replace(path="/" + name))


def test_migration_044_chains_from_043():
    m = _migration()
    assert m.revision == "044"
    assert m.down_revision == "043"
    assert "__TABLES__" not in m.UPGRADE_SQL


def test_every_table_with_a_user_id_is_linked_to_the_account():
    """A new table whose rows belong to a user needs the same link: add it to
    a migration like 044 and to this list."""
    from app.db.models import Base

    with_user = {t.name for t in Base.metadata.sorted_tables if "user_id" in t.c}
    assert with_user == set(_migration().TABLES)


@pytest.fixture
async def supabase_like(pg_uri):
    import asyncpg

    server = pg_uri.replace("postgresql+asyncpg://", "postgresql://")
    admin = await asyncpg.connect(server)
    await admin.execute("DROP DATABASE IF EXISTS m044 WITH (FORCE)")
    await admin.execute("CREATE DATABASE m044")
    conn = await asyncpg.connect(_on_database(server, "m044"))
    await conn.execute("""
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'm044_owner') THEN CREATE ROLE m044_owner NOLOGIN CREATEROLE BYPASSRLS; END IF;
        END $$;
        CREATE SCHEMA auth;
        CREATE TABLE auth.users (id uuid PRIMARY KEY);
        GRANT USAGE ON SCHEMA auth TO m044_owner;
        GRANT SELECT, REFERENCES ON auth.users TO m044_owner;
        GRANT CREATE ON SCHEMA public TO m044_owner;
    """)
    await conn.execute("SET ROLE m044_owner")
    for t in _migration().TABLES:
        await conn.execute(f"CREATE TABLE public.{t} (id serial PRIMARY KEY, user_id uuid NOT NULL)")
    yield conn
    await conn.close()
    await admin.execute("DROP DATABASE m044 WITH (FORCE)")
    await admin.execute("DROP ROLE m044_owner")
    await admin.close()


async def test_rows_of_missing_accounts_go_and_every_user_id_is_linked(supabase_like):
    conn = supabase_like
    kept = uuid.uuid4()
    await conn.execute("RESET ROLE")
    await conn.execute("INSERT INTO auth.users VALUES ($1)", kept)
    await conn.execute("SET ROLE m044_owner")
    for t in ("resumes", "job_descriptions", "ai_usage_events"):
        await conn.execute(f"INSERT INTO public.{t} (user_id) VALUES ($1), ($2)", kept, GONE)

    await conn.execute(_migration().UPGRADE_SQL)

    for t in ("resumes", "job_descriptions", "ai_usage_events"):
        users = {r["user_id"] for r in await conn.fetch(f"SELECT user_id FROM public.{t}")}
        assert users == {kept}, t
    for t in _migration().TABLES:
        assert await conn.fetchval(
            "SELECT confdeltype FROM pg_constraint WHERE conname = $1", f"{t}_user_id_fkey"
        ) in ("c", b"c"), f"{t} has no ON DELETE CASCADE link to auth.users"

    import asyncpg

    with pytest.raises(asyncpg.ForeignKeyViolationError):
        await conn.execute("INSERT INTO public.resumes (user_id) VALUES ($1)", GONE)

    # Deleting the account takes its rows with it.
    await conn.execute("RESET ROLE")
    await conn.execute("DELETE FROM auth.users WHERE id = $1", kept)
    assert await conn.fetchval("SELECT count(*) FROM public.resumes") == 0


async def test_upgrade_twice_is_harmless_and_downgrade_drops_the_links(supabase_like):
    conn = supabase_like
    m = _migration()
    await conn.execute(m.UPGRADE_SQL)
    await conn.execute(m.UPGRADE_SQL)
    await conn.execute(m.DOWNGRADE_SQL)
    assert await conn.fetchval("SELECT count(*) FROM pg_constraint WHERE conname LIKE '%_user_id_fkey'") == 0
