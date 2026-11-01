"""Migration 057 gives the career profile a Coursework list, with the limits
the browser can't get past, against a real Postgres with the browser role."""
import importlib.util
import json
import pathlib
import uuid

import asyncpg
import pytest

MIG = pathlib.Path(__file__).parents[1] / "alembic/versions/057_profile_coursework.py"
A = uuid.UUID("aaaaaaaa-0000-4000-8000-000000000057")


def _migration():
    spec = importlib.util.spec_from_file_location("m057", MIG)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _sql(which):
    return getattr(_migration(), which).replace("public.", "m057.")


def test_migration_057_chains_from_056():
    m = _migration()
    assert m.revision == "057" and m.down_revision == "056"


@pytest.fixture
async def conn(pg_uri):
    c = await asyncpg.connect(pg_uri.replace("postgresql+asyncpg://", "postgresql://"))
    await c.execute("""
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        END $$;
        DROP SCHEMA IF EXISTS m057 CASCADE;
        CREATE SCHEMA m057;
        GRANT USAGE ON SCHEMA m057 TO authenticated;
        CREATE TABLE m057.career_profiles (user_id uuid PRIMARY KEY, headline text);
        GRANT SELECT, INSERT, UPDATE ON m057.career_profiles TO authenticated;
    """)
    await c.execute("INSERT INTO m057.career_profiles VALUES ($1, 'Student')", A)
    await c.execute(_sql("UPGRADE_SQL"))
    yield c
    await c.execute("DROP SCHEMA IF EXISTS m057 CASCADE")
    await c.close()


async def _save(conn, value):
    async with conn.transaction():
        await conn.execute("SET LOCAL ROLE authenticated")
        await conn.execute("UPDATE m057.career_profiles SET coursework = $1::jsonb WHERE user_id = $2", json.dumps(value), A)


async def test_a_profile_saved_before_gets_an_empty_list(conn):
    row = await conn.fetchrow("SELECT coursework FROM m057.career_profiles WHERE user_id = $1", A)
    assert json.loads(row["coursework"]) == []


async def test_the_browser_can_save_coursework_at_its_limits(conn):
    await _save(conn, ["x" * 300] * 20)
    await _save(conn, ["é" * 300])
    await _save(conn, ["Data Structures", "Operating Systems"])


@pytest.mark.parametrize("value", [["x"] * 21, ["x" * 301], [{"text": "x"}], [42], "Data Structures"])
async def test_coursework_past_its_limits_is_refused(conn, value):
    with pytest.raises(asyncpg.CheckViolationError):
        await _save(conn, value)


async def test_downgrade_removes_it(conn):
    await conn.execute(_sql("DOWNGRADE_SQL"))
    columns = {r["column_name"] for r in await conn.fetch(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'm057' AND table_name = 'career_profiles'"
    )}
    assert columns == {"user_id", "headline"}
