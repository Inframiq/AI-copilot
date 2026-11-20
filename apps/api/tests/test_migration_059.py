"""Migration 059: a profile's phone changes at most once in 30 days — against
a real Postgres as the browser role, on top of 058's name and email rule."""
import importlib.util
import json
import pathlib
import re
import uuid
from datetime import datetime, timedelta, timezone

import asyncpg
import pytest

VERSIONS = pathlib.Path(__file__).parents[1] / "alembic/versions"
A = uuid.UUID("aaaaaaaa-0000-4000-8000-000000000059")


def _migration(name):
    spec = importlib.util.spec_from_file_location(name, VERSIONS / name)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


M058 = _migration("058_profile_name_and_email_are_fixed.py")
M059 = _migration("059_profile_phone_changes_rarely.py")


def _aimed(sql):
    sql = sql.replace("public.", "m059.").replace("auth.users", "m059_auth.users")
    return re.sub(r"\bprivate\b", "m059_private", sql)


def test_migration_059_chains_from_058():
    assert (M059.revision, M059.down_revision) == ("059", "058")


def test_the_sql_has_no_colon_words_sqlalchemy_would_take_for_parameters():
    for sql in (M059.UPGRADE_SQL, M059.DOWNGRADE_SQL):
        assert not re.search(r"(?<![:\w\\]):\w", sql)


def test_the_downgrade_puts_back_058s_function_exactly():
    body = lambda sql: re.sub(r"\s+", " ", sql[sql.index("CREATE OR REPLACE"):sql.index("$f$;") + 4])
    assert body(M059.DOWNGRADE_SQL) == body(M058.UPGRADE_SQL)


@pytest.fixture
async def conn(pg_uri):
    c = await asyncpg.connect(pg_uri.replace("postgresql+asyncpg://", "postgresql://"))
    await c.execute("""
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        END $$;
        DROP SCHEMA IF EXISTS m059 CASCADE;
        DROP SCHEMA IF EXISTS m059_private CASCADE;
        DROP SCHEMA IF EXISTS m059_auth CASCADE;
        CREATE SCHEMA m059;
        CREATE SCHEMA m059_auth;
        CREATE TABLE m059_auth.users (id uuid PRIMARY KEY, email text);
        GRANT USAGE ON SCHEMA m059 TO authenticated;
        CREATE TABLE m059.career_profiles (user_id uuid PRIMARY KEY, contact jsonb NOT NULL DEFAULT '{}', headline text);
        GRANT SELECT, INSERT, UPDATE ON m059.career_profiles TO authenticated;
    """)
    await c.execute("INSERT INTO m059_auth.users VALUES ($1, 'asha@account.com')", A)
    await c.execute(_aimed(M058.UPGRADE_SQL))
    await c.execute(_aimed(M059.UPGRADE_SQL))
    yield c
    await c.execute("DROP SCHEMA IF EXISTS m059 CASCADE; DROP SCHEMA IF EXISTS m059_private CASCADE; DROP SCHEMA IF EXISTS m059_auth CASCADE")
    await c.close()


async def _as_browser(conn, sql, *args):
    async with conn.transaction():
        await conn.execute("SET LOCAL ROLE authenticated")
        await conn.execute(sql, *args)


async def _save_new(conn, phone=None):
    contact = {"name": "Asha Rao", **({"phone": phone} if phone is not None else {})}
    await _as_browser(conn, "INSERT INTO m059.career_profiles (user_id, contact) VALUES ($1, $2::jsonb)", A, json.dumps(contact))


async def _phone(conn, phone):
    contact = {"name": "Asha Rao", **({"phone": phone} if phone is not None else {})}
    await _as_browser(conn, "UPDATE m059.career_profiles SET contact = $1::jsonb WHERE user_id = $2", json.dumps(contact), A)


async def _row(conn):
    r = await conn.fetchrow("SELECT contact, phone_changed_at FROM m059.career_profiles WHERE user_id = $1", A)
    return json.loads(r["contact"]).get("phone"), r["phone_changed_at"]


async def _age_last_change(conn, days):
    """As if the last change was `days` ago. The trigger guards the column
    against every save, so this one goes around it."""
    async with conn.transaction():
        await conn.execute("SET LOCAL session_replication_role = replica")
        await conn.execute("UPDATE m059.career_profiles SET phone_changed_at = now() - make_interval(days => $1) WHERE user_id = $2", days, A)


async def test_the_first_phone_is_free_and_starts_no_clock(conn):
    await _save_new(conn)
    await _phone(conn, "+91 98765 43210")
    assert await _row(conn) == ("+91 98765 43210", None)


async def test_a_phone_set_up_with_the_profile_starts_no_clock(conn):
    await _save_new(conn, "+91 98765 43210")
    assert (await _row(conn))[1] is None


async def test_a_change_goes_through_then_waits_30_days(conn):
    await _save_new(conn, "+91 98765 43210")
    await _phone(conn, "+91 91234 56789")
    phone, at = await _row(conn)
    assert phone == "+91 91234 56789" and at is not None
    with pytest.raises(asyncpg.CheckViolationError, match=r"can be changed again on \d{1,2} \w{3} \d{4}\."):
        await _phone(conn, "+91 90000 00000")
    with pytest.raises(asyncpg.CheckViolationError):
        await _phone(conn, None)  # removing it is a change too
    assert (await _row(conn))[0] == "+91 91234 56789"


async def test_after_30_days_it_can_change_again(conn):
    await _save_new(conn, "+91 98765 43210")
    await _phone(conn, "+91 91234 56789")
    await _age_last_change(conn, 29)
    with pytest.raises(asyncpg.CheckViolationError):
        await _phone(conn, "+91 90000 00000")
    await _age_last_change(conn, 31)
    await _phone(conn, "+91 90000 00000")
    phone, at = await _row(conn)
    assert phone == "+91 90000 00000" and at > datetime.now(timezone.utc) - timedelta(minutes=5)


async def test_removing_it_then_adding_one_is_two_changes(conn):
    await _save_new(conn, "+91 98765 43210")
    await _phone(conn, None)
    with pytest.raises(asyncpg.CheckViolationError):
        await _phone(conn, "+91 90000 00000")


async def test_the_same_number_written_another_way_is_no_change(conn):
    await _save_new(conn, "+91 98765 43210")
    await _phone(conn, "+91 91234 56789")
    await _phone(conn, "(+91)-9123456789")
    assert (await _row(conn))[0] == "(+91)-9123456789"


async def test_other_saves_go_through_while_the_phone_waits(conn):
    await _save_new(conn, "+91 98765 43210")
    await _phone(conn, "+91 91234 56789")
    await _as_browser(conn, "UPDATE m059.career_profiles SET headline = 'Engineer' WHERE user_id = $1", A)
    assert await conn.fetchval("SELECT headline FROM m059.career_profiles WHERE user_id = $1", A) == "Engineer"


async def test_a_save_cannot_set_the_clock_itself(conn):
    await _save_new(conn, "+91 98765 43210")
    await _phone(conn, "+91 91234 56789")
    stamped = (await _row(conn))[1]
    await _as_browser(conn, "UPDATE m059.career_profiles SET phone_changed_at = NULL WHERE user_id = $1", A)
    assert (await _row(conn))[1] == stamped
    with pytest.raises(asyncpg.CheckViolationError):
        await _phone(conn, "+91 90000 00000")
    await conn.execute("DELETE FROM m059.career_profiles")
    await _as_browser(conn, "INSERT INTO m059.career_profiles (user_id, contact, phone_changed_at) VALUES ($1, '{}', now())", A)
    assert (await _row(conn))[1] is None


async def test_support_can_change_it_for_one_transaction(conn):
    await _save_new(conn, "+91 98765 43210")
    await _phone(conn, "+91 91234 56789")
    async with conn.transaction():
        await conn.execute("SET LOCAL kripax.allow_phone_change = 'on'")
        await conn.execute("""UPDATE m059.career_profiles SET contact = '{"phone": "+91 90000 00000"}' WHERE user_id = $1""", A)
    with pytest.raises(asyncpg.CheckViolationError):
        await _phone(conn, "+91 95555 55555")


async def test_058s_rules_still_hold(conn):
    await _save_new(conn, "+91 98765 43210")
    await _as_browser(conn, """UPDATE m059.career_profiles SET contact = '{"name": "Other", "email": "x@y.com", "phone": "+91 98765 43210"}' WHERE user_id = $1""", A)
    contact = json.loads(await conn.fetchval("SELECT contact FROM m059.career_profiles WHERE user_id = $1", A))
    assert contact == {"name": "Asha Rao", "email": "asha@account.com", "phone": "+91 98765 43210"}


async def test_downgrade_removes_the_rule_and_the_column(conn):
    await _save_new(conn, "+91 98765 43210")
    await _phone(conn, "+91 91234 56789")
    await conn.execute(_aimed(M059.DOWNGRADE_SQL))
    await _phone(conn, "+91 90000 00000")
    assert not await conn.fetchval(
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'm059' AND column_name = 'phone_changed_at')"
    )


def test_the_web_app_counts_the_same_days():
    """The Profile page says when the phone can change again; the database
    decides. The two numbers must agree."""
    import re as _re
    web = (pathlib.Path(__file__).parents[2] / "web/lib/contact-lock.ts").read_text("utf8")
    assert int(_re.search(r"PHONE_CHANGE_DAYS = (\d+);", web).group(1)) == M059.PHONE_RULE_DAYS
