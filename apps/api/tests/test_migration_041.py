"""Migration 041 keeps a career profile's links on its owner's own résumé and
photo, against a real Postgres with the browser role Supabase signs users in as."""
import importlib.util
import pathlib
import uuid

import asyncpg
import pytest

MIG = pathlib.Path(__file__).parents[1] / "alembic/versions/041_profile_links_stay_own.py"
A = uuid.UUID("aaaaaaaa-0000-4000-8000-000000000001")
B = uuid.UUID("bbbbbbbb-0000-4000-8000-000000000002")
A_RESUME = uuid.UUID("aaaaaaaa-0000-4000-8000-0000000000a1")
B_RESUME = uuid.UUID("bbbbbbbb-0000-4000-8000-0000000000b1")
GONE = uuid.UUID("cccccccc-0000-4000-8000-0000000000c1")


def _migration():
    spec = importlib.util.spec_from_file_location("m041", MIG)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _sql(which):
    """The migration's SQL aimed at its own schema, so the tables it builds
    never collide with the app tables other tests share this database with."""
    return getattr(_migration(), which).replace("public.", "m041.")


def test_migration_041_chains_from_040():
    m = _migration()
    assert m.revision == "041"
    assert m.down_revision == "040"


@pytest.fixture
async def profiles(pg_uri):
    """A's profile pointing at B's résumé and B's photo, B's pointing at a
    résumé deleted long ago, and a browser role that can write career_profiles
    but cannot read resumes, as in production since migration 040."""
    conn = await asyncpg.connect(pg_uri.replace("postgresql+asyncpg://", "postgresql://"))
    await conn.execute("""
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        END $$;
        DROP SCHEMA IF EXISTS m041 CASCADE;
        CREATE SCHEMA m041;
        GRANT USAGE ON SCHEMA m041 TO authenticated;
        CREATE TABLE m041.resumes (id uuid PRIMARY KEY, user_id uuid NOT NULL);
        CREATE TABLE m041.career_profiles (user_id uuid PRIMARY KEY, master_resume_id uuid, photo_path text);
        GRANT SELECT, INSERT, UPDATE, DELETE ON m041.career_profiles TO authenticated;
    """)
    await conn.executemany("INSERT INTO m041.resumes VALUES ($1, $2)", [(A_RESUME, A), (B_RESUME, B)])
    await conn.executemany(
        "INSERT INTO m041.career_profiles VALUES ($1, $2, $3)",
        [(A, B_RESUME, f"{B}/profile.jpeg"), (B, GONE, f"{B}/profile.jpeg")],
    )
    yield conn
    await conn.execute("DROP SCHEMA IF EXISTS m041 CASCADE")
    await conn.close()


async def _as_browser(conn, sql, *args):
    async with conn.transaction():
        await conn.execute("SET LOCAL ROLE authenticated")
        await conn.execute(sql, *args)


async def test_upgrade_clears_links_to_another_users_records_only(profiles):
    conn = profiles
    await conn.execute(_sql("UPGRADE_SQL"))
    a = await conn.fetchrow("SELECT * FROM m041.career_profiles WHERE user_id = $1", A)
    b = await conn.fetchrow("SELECT * FROM m041.career_profiles WHERE user_id = $1", B)
    assert a["master_resume_id"] is None and a["photo_path"] is None
    # B's own photo stays, and so does B's link to a résumé deleted back then.
    assert b["photo_path"] == f"{B}/profile.jpeg"
    assert b["master_resume_id"] == GONE
    # ...and B can still save the profile with that old link unchanged.
    await _as_browser(conn, "UPDATE m041.career_profiles SET photo_path = photo_path WHERE user_id = $1", B)


async def test_the_browser_can_link_only_its_own_resume(profiles):
    conn = profiles
    await conn.execute(_sql("UPGRADE_SQL"))
    with pytest.raises(asyncpg.ForeignKeyViolationError):
        await _as_browser(conn, "UPDATE m041.career_profiles SET master_resume_id = $1 WHERE user_id = $2", B_RESUME, A)
    await _as_browser(conn, "UPDATE m041.career_profiles SET master_resume_id = $1 WHERE user_id = $2", A_RESUME, A)
    assert await conn.fetchval("SELECT master_resume_id FROM m041.career_profiles WHERE user_id = $1", A) == A_RESUME


async def test_deleting_the_resume_clears_the_link(profiles):
    conn = profiles
    await conn.execute(_sql("UPGRADE_SQL"))
    await conn.execute("UPDATE m041.career_profiles SET master_resume_id = $1 WHERE user_id = $2", A_RESUME, A)
    await conn.execute("DELETE FROM m041.resumes WHERE id = $1", A_RESUME)
    assert await conn.fetchval("SELECT master_resume_id FROM m041.career_profiles WHERE user_id = $1", A) is None


@pytest.mark.parametrize("path", [
    f"{B}/profile.jpeg",
    f"{A}/../{B}/profile.jpeg",
    f"{A}//profile.jpeg",
    f"{A}/./profile.jpeg",
    f"{A}",
    f"/{A}/profile.jpeg",
])
async def test_the_browser_cannot_point_its_photo_outside_its_folder(profiles, path):
    conn = profiles
    await conn.execute(_sql("UPGRADE_SQL"))
    with pytest.raises(asyncpg.CheckViolationError):
        await _as_browser(conn, "UPDATE m041.career_profiles SET photo_path = $1 WHERE user_id = $2", path, A)


async def test_the_browser_can_save_its_own_photo(profiles):
    conn = profiles
    await conn.execute(_sql("UPGRADE_SQL"))
    await _as_browser(conn, "UPDATE m041.career_profiles SET photo_path = $1 WHERE user_id = $2", f"{A}/profile.png", A)
    await _as_browser(conn, "UPDATE m041.career_profiles SET photo_path = NULL WHERE user_id = $1", A)


async def test_downgrade_removes_the_rules(profiles):
    conn = profiles
    await conn.execute(_sql("UPGRADE_SQL"))
    await conn.execute(_sql("DOWNGRADE_SQL"))
    await conn.execute("UPDATE m041.career_profiles SET master_resume_id = $1, photo_path = $2 WHERE user_id = $3",
                       B_RESUME, f"{B}/x.png", A)
