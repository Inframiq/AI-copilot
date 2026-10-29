"""Migration 054: a profile's LinkedIn and GitHub links are profile links —
new or changed ones, against a real Postgres as the browser role. The
examples are the ones the web app's form is tested against."""
import importlib.util
import json
import pathlib
import re
import uuid

import asyncpg
import pytest

MIG = pathlib.Path(__file__).parents[1] / "alembic/versions/054_profile_links_are_profile_links.py"
CASES = json.loads((pathlib.Path(__file__).parents[3] / "packages/types/social-link-cases.json").read_text("utf8"))
A = uuid.UUID("aaaaaaaa-0000-4000-8000-000000000054")
OLD = uuid.UUID("bbbbbbbb-0000-4000-8000-000000000054")


def _migration():
    spec = importlib.util.spec_from_file_location("m054", MIG)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _sql(which):
    """Aimed at schemas of its own, clear of what other tests share."""
    sql = getattr(_migration(), which).replace("public.", "m054.")
    return re.sub(r"\bprivate\b", "m054_private", sql)


def test_migration_054_chains_from_053():
    m = _migration()
    assert m.revision == "054"
    assert m.down_revision == "053"


def test_the_sql_has_no_colon_words_sqlalchemy_would_take_for_parameters():
    # alembic runs the string through text(): ":name" becomes a bind parameter.
    assert not re.search(r"(?<![:\w\\]):\w", _migration().UPGRADE_SQL)


@pytest.fixture
async def conn(pg_uri):
    """B saved an untidy link before the migration; the browser role can
    write career_profiles, as in production."""
    c = await asyncpg.connect(pg_uri.replace("postgresql+asyncpg://", "postgresql://"))
    await c.execute("""
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        END $$;
        DROP SCHEMA IF EXISTS m054 CASCADE;
        DROP SCHEMA IF EXISTS m054_private CASCADE;
        CREATE SCHEMA m054;
        GRANT USAGE ON SCHEMA m054 TO authenticated;
        CREATE TABLE m054.career_profiles (user_id uuid PRIMARY KEY, contact jsonb NOT NULL DEFAULT '{}', headline text);
        GRANT SELECT, INSERT, UPDATE ON m054.career_profiles TO authenticated;
    """)
    await c.execute(
        "INSERT INTO m054.career_profiles VALUES ($1, $2::jsonb)",
        OLD, json.dumps({"linkedin": "https://www.linkedin.com/in/old-link/", "github": "github.com/old/repo"}),
    )
    await c.execute(_sql("UPGRADE_SQL"))
    yield c
    await c.execute("DROP SCHEMA IF EXISTS m054 CASCADE; DROP SCHEMA IF EXISTS m054_private CASCADE")
    await c.close()


async def _as_browser(conn, sql, *args):
    async with conn.transaction():
        await conn.execute("SET LOCAL ROLE authenticated")
        await conn.execute(sql, *args)


async def _save_new(conn, contact):
    await _as_browser(conn, "INSERT INTO m054.career_profiles (user_id, contact) VALUES ($1, $2::jsonb)", A, json.dumps(contact))


async def _change(conn, user, contact):
    await _as_browser(conn, "UPDATE m054.career_profiles SET contact = $1::jsonb WHERE user_id = $2", json.dumps(contact), user)


STANDARD = [(f, saved) for f in ("linkedin", "github") for _typed, saved in CASES[f]["tidy"]]
UNTIDY = [(f, typed) for f in ("linkedin", "github") for typed, saved in CASES[f]["tidy"] if typed != saved]
REFUSED = [(f, typed) for f in ("linkedin", "github") for typed in CASES[f]["refused"]]


@pytest.mark.parametrize("field, link", STANDARD)
async def test_a_link_in_the_standard_form_saves(conn, field, link):
    await _save_new(conn, {"name": "Asha", field: link})


@pytest.mark.parametrize("field, link", REFUSED + UNTIDY)
async def test_anything_else_is_refused(conn, field, link):
    """Not a profile link — and a profile link not yet tidied, which the
    web app always tidies before saving."""
    with pytest.raises(asyncpg.CheckViolationError):
        await _save_new(conn, {"name": "Asha", field: link})


async def test_an_empty_or_missing_link_saves(conn):
    await _save_new(conn, {"name": "Asha", "linkedin": "", "github": ""})
    await _change(conn, A, {"name": "Asha"})


async def test_a_github_name_one_past_39_characters_is_refused(conn):
    await _save_new(conn, {"github": "github.com/" + "a" * 39})
    with pytest.raises(asyncpg.CheckViolationError):
        await _change(conn, A, {"github": "github.com/" + "a" * 40})


async def test_an_old_untidy_link_left_as_it_is_still_saves(conn):
    await _as_browser(conn, "UPDATE m054.career_profiles SET headline = 'Engineer' WHERE user_id = $1", OLD)
    old = json.loads(await conn.fetchval("SELECT contact FROM m054.career_profiles WHERE user_id = $1", OLD))
    await _change(conn, OLD, {**old, "name": "Bo"})


async def test_changing_an_old_link_needs_the_standard_form(conn):
    with pytest.raises(asyncpg.CheckViolationError):
        await _change(conn, OLD, {"linkedin": "https://www.linkedin.com/in/new-link/", "github": "github.com/old/repo"})
    await _change(conn, OLD, {"linkedin": "linkedin.com/in/new-link", "github": "github.com/old"})


async def test_the_error_says_what_a_link_should_look_like(conn):
    with pytest.raises(asyncpg.CheckViolationError, match="linkedin.com/in/your-name"):
        await _save_new(conn, {"linkedin": "linkedin.com/company/acme"})


async def test_the_browser_cannot_call_the_check_itself(conn):
    assert not await conn.fetchval(
        "SELECT has_function_privilege('authenticated', 'm054_private.profile_links_are_profile_links()', 'EXECUTE')"
    )


async def test_downgrade_removes_the_check(conn):
    await conn.execute(_sql("DOWNGRADE_SQL"))
    await _save_new(conn, {"linkedin": "anything at all"})
