"""Migration 053 gives the career profile every résumé section, with the size
limits the browser can't get past, against a real Postgres with the browser
role Supabase signs users in as."""
import importlib.util
import json
import pathlib
import uuid

import asyncpg
import pytest

MIG = pathlib.Path(__file__).parents[1] / "alembic/versions/053_profile_holds_every_resume_section.py"
A = uuid.UUID("aaaaaaaa-0000-4000-8000-000000000053")
LISTS = ("awards", "achievements", "leadership", "volunteer", "interests")


def _migration():
    spec = importlib.util.spec_from_file_location("m053", MIG)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _sql(which):
    """Aimed at its own schema, clear of the tables other tests share."""
    return getattr(_migration(), which).replace("public.", "m053.")


def test_migration_053_chains_from_052():
    m = _migration()
    assert m.revision == "053"
    assert m.down_revision == "052"


@pytest.fixture
async def conn(pg_uri):
    """A profile saved before the migration, and the browser role that can
    write career_profiles, as in production."""
    c = await asyncpg.connect(pg_uri.replace("postgresql+asyncpg://", "postgresql://"))
    await c.execute("""
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        END $$;
        DROP SCHEMA IF EXISTS m053 CASCADE;
        CREATE SCHEMA m053;
        GRANT USAGE ON SCHEMA m053 TO authenticated;
        CREATE TABLE m053.career_profiles (user_id uuid PRIMARY KEY, headline text);
        GRANT SELECT, INSERT, UPDATE ON m053.career_profiles TO authenticated;
    """)
    await c.execute("INSERT INTO m053.career_profiles VALUES ($1, 'Engineer')", A)
    await c.execute(_sql("UPGRADE_SQL"))
    yield c
    await c.execute("DROP SCHEMA IF EXISTS m053 CASCADE")
    await c.close()


async def _save(conn, column, value):
    """Write one column as the browser does."""
    if not isinstance(value, str) or column not in ("summary", "objective"):
        value = json.dumps(value)
        cast = "::jsonb"
    else:
        cast = ""
    async with conn.transaction():
        await conn.execute("SET LOCAL ROLE authenticated")
        await conn.execute(f"UPDATE m053.career_profiles SET {column} = $1{cast} WHERE user_id = $2", value, A)


async def test_a_profile_saved_before_gets_empty_sections(conn):
    row = await conn.fetchrow("SELECT * FROM m053.career_profiles WHERE user_id = $1", A)
    assert row["headline"] == "Engineer"
    assert row["summary"] is None and row["objective"] is None
    for column in ("languages", *LISTS):
        assert json.loads(row[column]) == []


async def test_the_browser_can_save_every_section_at_its_limits(conn):
    await _save(conn, "summary", "s" * 1000)
    await _save(conn, "objective", "o" * 600)
    await _save(conn, "languages", [{"name": "n" * 100, "level": "l" * 100}] * 15)
    await _save(conn, "languages", [{"name": "Hindi", "level": None}, {"name": "Telugu"}])
    for column in LISTS:
        await _save(conn, column, ["x" * 300] * 20)
    # Multibyte text counts characters, not bytes.
    await _save(conn, "interests", ["é" * 300])
    await _save(conn, "summary", None)


@pytest.mark.parametrize("column, value", [
    ("summary", "s" * 1001),
    ("objective", "o" * 601),
])
async def test_text_past_its_limit_is_refused(conn, column, value):
    with pytest.raises(asyncpg.CheckViolationError):
        await _save(conn, column, value)


@pytest.mark.parametrize("column", LISTS)
@pytest.mark.parametrize("value", [
    ["x"] * 21,                 # too many items
    ["x" * 301],                # an item too long
    ["line one\n" + "x" * 300], # newlines count too
    [{"text": "an object"}],    # not a line
    [42],
    "not a list",
])
async def test_a_list_past_its_limits_is_refused(conn, column, value):
    with pytest.raises(asyncpg.CheckViolationError):
        await _save(conn, column, value)


@pytest.mark.parametrize("value", [
    [{"name": "Hindi", "level": "Native"}] * 16,
    [{"name": "n" * 101, "level": "Native"}],
    [{"name": "Hindi", "level": "l" * 101}],
    [{"level": "Native"}],
    [{"name": 7}],
    [{"name": "Hindi", "level": 3}],
    ["Hindi"],
    {"name": "Hindi"},
])
async def test_languages_past_their_limits_are_refused(conn, value):
    with pytest.raises(asyncpg.CheckViolationError):
        await _save(conn, "languages", value)


async def test_downgrade_removes_the_sections(conn):
    await conn.execute(_sql("DOWNGRADE_SQL"))
    columns = {r["column_name"] for r in await conn.fetch(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'm053' AND table_name = 'career_profiles'"
    )}
    assert columns == {"user_id", "headline"}
