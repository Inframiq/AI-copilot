"""Migration 055 lets an uploaded résumé's long summary fit the profile whole,
still bounded, against a real Postgres with the browser role Supabase signs
users in as."""
import importlib.util
import pathlib
import uuid

import asyncpg
import pytest

VERSIONS = pathlib.Path(__file__).parents[1] / "alembic/versions"
A = uuid.UUID("aaaaaaaa-0000-4000-8000-000000000055")


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, VERSIONS / f"{name}.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


M053 = _load("053_profile_holds_every_resume_section")
M055 = _load("055_long_uploaded_summary_fits")


def _in_own_schema(sql: str) -> str:
    return sql.replace("public.", "m055.")


def test_migration_055_chains_from_054():
    assert (M055.revision, M055.down_revision) == ("055", "054")


@pytest.fixture
async def conn(pg_uri):
    c = await asyncpg.connect(pg_uri.replace("postgresql+asyncpg://", "postgresql://"))
    await c.execute("""
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        END $$;
        DROP SCHEMA IF EXISTS m055 CASCADE;
        CREATE SCHEMA m055;
        GRANT USAGE ON SCHEMA m055 TO authenticated;
        CREATE TABLE m055.career_profiles (user_id uuid PRIMARY KEY, headline text);
        GRANT SELECT, INSERT, UPDATE ON m055.career_profiles TO authenticated;
    """)
    await c.execute("INSERT INTO m055.career_profiles VALUES ($1, 'Engineer')", A)
    await c.execute(_in_own_schema(M053.UPGRADE_SQL))
    await c.execute(_in_own_schema(M055._limits_sql(M055.MAX_SUMMARY_CHARS, M055.MAX_OBJECTIVE_CHARS)))
    yield c
    await c.execute("DROP SCHEMA IF EXISTS m055 CASCADE")
    await c.close()


async def _save(conn, column, value):
    async with conn.transaction():
        await conn.execute("SET LOCAL ROLE authenticated")
        await conn.execute(f"UPDATE m055.career_profiles SET {column} = $1 WHERE user_id = $2", value, A)


async def test_a_long_uploaded_summary_saves_whole(conn):
    # testResume's summary: 16 points, about 2,300 characters.
    await _save(conn, "summary", "s" * 4000)
    await _save(conn, "objective", "o" * 2000)


@pytest.mark.parametrize("column, value", [("summary", "s" * 4001), ("objective", "o" * 2001)])
async def test_it_is_still_bounded(conn, column, value):
    with pytest.raises(asyncpg.CheckViolationError):
        await _save(conn, column, value)


async def test_going_back_cuts_longer_text_to_the_old_limits(conn):
    await _save(conn, "summary", "s" * 3000)
    await conn.execute(_in_own_schema(M055._limits_sql(M055.OLD_SUMMARY_CHARS, M055.OLD_OBJECTIVE_CHARS)))
    row = await conn.fetchrow("SELECT summary FROM m055.career_profiles WHERE user_id = $1", A)
    assert len(row["summary"]) == 1000
    with pytest.raises(asyncpg.CheckViolationError):
        await _save(conn, "summary", "s" * 1001)
