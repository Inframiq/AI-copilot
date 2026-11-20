"""Migration 058: a profile's name and email are fixed — the email is always
the sign-in email, and a saved name stays — against a real Postgres as the
browser role, which writes career_profiles itself in production."""
import importlib.util
import json
import pathlib
import re
import uuid

import asyncpg
import pytest

MIG = pathlib.Path(__file__).parents[1] / "alembic/versions/058_profile_name_and_email_are_fixed.py"
A = uuid.UUID("aaaaaaaa-0000-4000-8000-000000000058")
NAMELESS = uuid.UUID("bbbbbbbb-0000-4000-8000-000000000058")


def _migration():
    spec = importlib.util.spec_from_file_location("m058", MIG)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _sql(which):
    """Aimed at schemas of its own, clear of what other tests share."""
    sql = getattr(_migration(), which).replace("public.", "m058.").replace("auth.users", "m058_auth.users")
    return re.sub(r"\bprivate\b", "m058_private", sql)


def test_migration_058_chains_from_057():
    m = _migration()
    assert m.revision == "058"
    assert m.down_revision == "057"


def test_the_sql_has_no_colon_words_sqlalchemy_would_take_for_parameters():
    # alembic runs the string through text(): ":name" becomes a bind parameter.
    assert not re.search(r"(?<![:\w\\]):\w", _migration().UPGRADE_SQL)


@pytest.fixture
async def conn(pg_uri):
    """A signed in as asha@account.com; NAMELESS saved a profile with no
    name before names were asked for."""
    c = await asyncpg.connect(pg_uri.replace("postgresql+asyncpg://", "postgresql://"))
    await c.execute("""
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        END $$;
        DROP SCHEMA IF EXISTS m058 CASCADE;
        DROP SCHEMA IF EXISTS m058_private CASCADE;
        DROP SCHEMA IF EXISTS m058_auth CASCADE;
        CREATE SCHEMA m058;
        CREATE SCHEMA m058_auth;
        CREATE TABLE m058_auth.users (id uuid PRIMARY KEY, email text);
        GRANT USAGE ON SCHEMA m058 TO authenticated;
        CREATE TABLE m058.career_profiles (user_id uuid PRIMARY KEY, contact jsonb NOT NULL DEFAULT '{}', headline text);
        GRANT SELECT, INSERT, UPDATE ON m058.career_profiles TO authenticated;
    """)
    await c.execute("INSERT INTO m058_auth.users VALUES ($1, 'asha@account.com'), ($2, 'bo@account.com')", A, NAMELESS)
    await c.execute(
        "INSERT INTO m058.career_profiles VALUES ($1, $2::jsonb)",
        NAMELESS, json.dumps({"name": "", "email": "old@work.com"}),
    )
    await c.execute(_sql("UPGRADE_SQL"))
    yield c
    await c.execute("DROP SCHEMA IF EXISTS m058 CASCADE; DROP SCHEMA IF EXISTS m058_private CASCADE; DROP SCHEMA IF EXISTS m058_auth CASCADE")
    await c.close()


async def _as_browser(conn, sql, *args):
    async with conn.transaction():
        await conn.execute("SET LOCAL ROLE authenticated")
        await conn.execute(sql, *args)


async def _save_new(conn, contact):
    await _as_browser(conn, "INSERT INTO m058.career_profiles (user_id, contact) VALUES ($1, $2::jsonb)", A, json.dumps(contact))


async def _change(conn, user, contact):
    await _as_browser(conn, "UPDATE m058.career_profiles SET contact = $1::jsonb WHERE user_id = $2", json.dumps(contact), user)


async def _contact(conn, user):
    return json.loads(await conn.fetchval("SELECT contact FROM m058.career_profiles WHERE user_id = $1", user))


async def test_setting_up_saves_the_name_typed_and_the_sign_in_email(conn):
    await _save_new(conn, {"name": "Asha Rao", "email": "typed@else.com", "phone": "+91 98765 43210"})
    assert await _contact(conn, A) == {"name": "Asha Rao", "email": "asha@account.com", "phone": "+91 98765 43210"}


async def test_a_saved_name_stays_whatever_a_save_sends(conn):
    await _save_new(conn, {"name": "Asha Rao", "email": "asha@account.com"})
    await _change(conn, A, {"name": "Someone Else", "email": "asha@account.com", "location": "Pune"})
    await _change(conn, A, {"name": "", "email": "asha@account.com", "location": "Pune"})
    await _change(conn, A, {"email": "asha@account.com", "location": "Pune"})
    assert await _contact(conn, A) == {"name": "Asha Rao", "email": "asha@account.com", "location": "Pune"}


async def test_the_email_is_always_the_sign_in_email(conn):
    await _save_new(conn, {"name": "Asha Rao", "email": "asha@account.com"})
    await _change(conn, A, {"name": "Asha Rao", "email": "other@else.com"})
    assert (await _contact(conn, A))["email"] == "asha@account.com"
    await _change(conn, A, {"name": "Asha Rao"})
    assert (await _contact(conn, A))["email"] == "asha@account.com"


async def test_everything_else_in_the_save_still_lands(conn):
    await _save_new(conn, {"name": "Asha Rao", "email": "asha@account.com"})
    await _as_browser(conn, "UPDATE m058.career_profiles SET headline = 'Engineer', contact = $1::jsonb WHERE user_id = $2",
                      json.dumps({"name": "Changed", "phone": "+91 91234 56789"}), A)
    assert await conn.fetchval("SELECT headline FROM m058.career_profiles WHERE user_id = $1", A) == "Engineer"
    assert await _contact(conn, A) == {"name": "Asha Rao", "email": "asha@account.com", "phone": "+91 91234 56789"}


async def test_a_profile_saved_without_a_name_takes_one_once(conn):
    await _change(conn, NAMELESS, {"name": "Bo Chen", "email": "old@work.com"})
    assert await _contact(conn, NAMELESS) == {"name": "Bo Chen", "email": "bo@account.com"}
    await _change(conn, NAMELESS, {"name": "Bo C."})
    assert (await _contact(conn, NAMELESS))["name"] == "Bo Chen"


async def test_a_blank_name_counts_as_no_name(conn):
    await _change(conn, NAMELESS, {"name": "   "})
    await _change(conn, NAMELESS, {"name": "Bo Chen"})
    assert (await _contact(conn, NAMELESS))["name"] == "Bo Chen"


async def test_support_can_fix_a_name_for_one_transaction_only(conn):
    """The flag is SET LOCAL by hand in a database session — the Data API
    can't run SET — and ends with the transaction."""
    await _save_new(conn, {"name": "Asha Rao"})
    async with conn.transaction():
        await conn.execute("SET LOCAL kripax.allow_name_change = 'on'")
        await conn.execute("UPDATE m058.career_profiles SET contact = '{\"name\": \"Asha R. Rao\"}'::jsonb WHERE user_id = $1", A)
    assert (await _contact(conn, A))["name"] == "Asha R. Rao"
    await _change(conn, A, {"name": "Back Again"})
    assert (await _contact(conn, A))["name"] == "Asha R. Rao"


async def test_the_browser_cannot_call_the_trigger_function_itself(conn):
    assert not await conn.fetchval(
        "SELECT has_function_privilege('authenticated', 'm058_private.profile_contact_is_fixed()', 'EXECUTE')"
    )


async def test_downgrade_removes_the_lock(conn):
    await _save_new(conn, {"name": "Asha Rao"})
    await conn.execute(_sql("DOWNGRADE_SQL"))
    await _change(conn, A, {"name": "Anyone", "email": "any@where.com"})
    assert await _contact(conn, A) == {"name": "Anyone", "email": "any@where.com"}
