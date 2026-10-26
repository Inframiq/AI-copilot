"""Migration 050: a record's created_at and updated_at are the database's, not
whatever the browser sends (test ATK-051)."""
import datetime as dt
import importlib.util
import json
import pathlib
import uuid

import asyncpg
import pytest

MIG = pathlib.Path(__file__).parents[1] / "alembic/versions/050_database_sets_record_times.py"
DB = "kripax_m050"
USER_A = uuid.UUID("11111111-1111-1111-1111-111111111111")
USER_B = uuid.UUID("22222222-2222-2222-2222-222222222222")
FORGED = dt.datetime(2001, 1, 1, tzinfo=dt.timezone.utc)


def _migration():
    spec = importlib.util.spec_from_file_location("m050", MIG)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_migration_050_chains_from_049():
    m = _migration()
    assert m.revision == "050"
    assert m.down_revision == "049"


def _on_database(uri: str, name: str) -> str:
    """The same server, another database. Swaps only the path, which keeps a
    Linux socket address in ?host= intact."""
    from urllib.parse import urlsplit, urlunsplit

    return urlunsplit(urlsplit(uri)._replace(path="/" + name))


# The three browser tables as apps/web/supabase/migrations 001, 002 and 008
# left them, owned by the migration login, with 002's trigger.
SUPABASE_LIKE = """
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $$ SELECT nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO PUBLIC;

    SET ROLE m050_owner;
    CREATE TABLE public.career_profiles (
      user_id uuid PRIMARY KEY, headline text,
      created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
    ALTER TABLE public.career_profiles ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "career_profiles_own" ON public.career_profiles
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
    CREATE FUNCTION public.update_career_profile_timestamp() RETURNS trigger LANGUAGE plpgsql
      AS $f$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $f$;
    CREATE TRIGGER career_profiles_updated_at BEFORE UPDATE ON public.career_profiles
      FOR EACH ROW EXECUTE FUNCTION public.update_career_profile_timestamp();

    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY, full_name text,
      created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "profiles_own" ON public.profiles
      FOR ALL USING (id = auth.uid()) WITH CHECK (id = auth.uid());

    CREATE TABLE public.connection_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), from_user uuid, to_user uuid,
      status text DEFAULT 'pending', created_at timestamptz DEFAULT now());
    ALTER TABLE public.connection_requests ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "conn_own" ON public.connection_requests
      FOR ALL USING (from_user = auth.uid() OR to_user = auth.uid()) WITH CHECK (from_user = auth.uid());

    GRANT SELECT, INSERT, UPDATE ON public.career_profiles, public.profiles, public.connection_requests
      TO authenticated;
    RESET ROLE;
"""


@pytest.fixture
async def db(pg_uri):
    server = pg_uri.replace("postgresql+asyncpg://", "postgresql://")
    admin = await asyncpg.connect(server)
    await admin.execute(f"DROP DATABASE IF EXISTS {DB} WITH (FORCE)")
    await admin.execute(f"CREATE DATABASE {DB}")
    await admin.execute("""
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'm050_owner') THEN CREATE ROLE m050_owner NOLOGIN; END IF;
        END $$;
    """)
    conn = await asyncpg.connect(_on_database(server, DB))
    await conn.execute(f"GRANT CREATE ON DATABASE {DB} TO m050_owner; GRANT CREATE ON SCHEMA public TO m050_owner")
    await conn.execute(SUPABASE_LIKE)
    await conn.execute("SET ROLE m050_owner")  # the deploy's migration login
    yield conn
    await conn.close()
    await admin.execute(f"DROP DATABASE {DB} WITH (FORCE)")
    await admin.execute("DROP ROLE IF EXISTS m050_owner")
    await admin.close()


async def _as_browser(conn, sql, *args, user=USER_A):
    """One statement as the Data API runs it for a signed-in user, in its own
    transaction, so now() is the time of that request."""
    async with conn.transaction():
        await conn.execute("SET LOCAL ROLE authenticated")
        await conn.execute("SELECT set_config('request.jwt.claims', $1, true)", json.dumps({"sub": str(user)}))
        return await conn.fetch(sql, *args)


def _recent(t: dt.datetime) -> bool:
    return abs(dt.datetime.now(dt.timezone.utc) - t) < dt.timedelta(minutes=5)


INSERT_PROFILE = """INSERT INTO public.career_profiles (user_id, headline, created_at, updated_at)
                    VALUES ($1, 'mine', $2, $2) RETURNING created_at, updated_at"""
FORGE_PROFILE = """UPDATE public.career_profiles SET created_at = $1, updated_at = $1
                   RETURNING created_at, updated_at"""
UPSERT_PROFILE = """INSERT INTO public.career_profiles (user_id, headline, created_at, updated_at)
                    VALUES ($1, 'again', $2, $2)
                    ON CONFLICT (user_id) DO UPDATE SET headline = EXCLUDED.headline,
                      created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at
                    RETURNING created_at, updated_at"""


async def test_before_050_the_browser_could_store_any_created_at(db):
    [row] = await _as_browser(db, INSERT_PROFILE, USER_A, FORGED)
    assert row["created_at"] == FORGED and row["updated_at"] == FORGED
    [row] = await _as_browser(db, FORGE_PROFILE, FORGED)
    assert row["created_at"] == FORGED


async def test_after_050_a_new_row_gets_the_database_time(db):
    await db.execute(_migration().UPGRADE_SQL)
    [row] = await _as_browser(db, INSERT_PROFILE, USER_A, FORGED)
    assert _recent(row["created_at"]) and _recent(row["updated_at"])


async def test_after_050_a_changed_row_keeps_its_created_at(db):
    await db.execute(_migration().UPGRADE_SQL)
    [first] = await _as_browser(db, INSERT_PROFILE, USER_A, FORGED)
    [row] = await _as_browser(db, FORGE_PROFILE, FORGED)
    assert row["created_at"] == first["created_at"]
    assert _recent(row["updated_at"]) and row["updated_at"] >= first["updated_at"]
    [row] = await _as_browser(db, UPSERT_PROFILE, USER_A, FORGED)  # the web app's upsert
    assert row["created_at"] == first["created_at"] and _recent(row["updated_at"])
    stored = await db.fetchrow("SELECT headline, created_at FROM public.career_profiles")
    assert stored["headline"] == "again" and stored["created_at"] == first["created_at"]


async def test_after_050_the_networking_tables_too(db):
    await db.execute(_migration().UPGRADE_SQL)
    [p] = await _as_browser(db, """INSERT INTO public.profiles (id, created_at, updated_at) VALUES ($1, $2, $2)
                                   RETURNING created_at, updated_at""", USER_A, FORGED)
    assert _recent(p["created_at"]) and _recent(p["updated_at"])
    [p2] = await _as_browser(db, "UPDATE public.profiles SET created_at = $1 RETURNING created_at", FORGED)
    assert p2["created_at"] == p["created_at"]

    # No updated_at column here: only created_at is set.
    [c] = await _as_browser(db, """INSERT INTO public.connection_requests (from_user, to_user, created_at)
                                   VALUES ($1, $2, $3) RETURNING id, created_at""", USER_A, USER_B, FORGED)
    assert _recent(c["created_at"])
    [c2] = await _as_browser(db, "UPDATE public.connection_requests SET created_at = $1, status = 'x' RETURNING created_at, status", FORGED)
    assert c2["created_at"] == c["created_at"] and c2["status"] == "x"


async def test_after_050_ownership_rules_still_apply(db):
    await db.execute(_migration().UPGRADE_SQL)
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        await _as_browser(db, INSERT_PROFILE, USER_B, FORGED)


async def test_the_function_is_not_callable_and_runs_only_as_a_trigger(db):
    await db.execute(_migration().UPGRADE_SQL)
    fn = "private.server_sets_times()"
    for role in ("authenticated", "anon"):
        assert not await db.fetchval("SELECT has_function_privilege($1, $2, 'EXECUTE')", role, fn)
    triggers = await db.fetch("""SELECT c.relname, t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
                                 WHERE NOT t.tgisinternal ORDER BY 1, 2""")
    assert [(r["relname"], r["tgname"]) for r in triggers] == [
        ("career_profiles", "server_sets_times"),
        ("connection_requests", "server_sets_times"),
        ("profiles", "server_sets_times"),
    ]


async def test_a_table_that_does_not_exist_is_skipped(db):
    await db.execute("DROP TABLE public.profiles, public.connection_requests")
    await db.execute(_migration().UPGRADE_SQL)
    [row] = await _as_browser(db, INSERT_PROFILE, USER_A, FORGED)
    assert _recent(row["created_at"])


async def test_a_rerun_changes_nothing_and_downgrade_restores_002s_trigger(db):
    m = _migration()
    await db.execute(m.UPGRADE_SQL)
    await db.execute(m.UPGRADE_SQL)
    await db.execute(m.DOWNGRADE_SQL)
    assert await db.fetchval("SELECT to_regprocedure('private.server_sets_times()')") is None
    names = await db.fetch("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal")
    assert [r["tgname"] for r in names] == ["career_profiles_updated_at"]
    [row] = await _as_browser(db, INSERT_PROFILE, USER_A, FORGED)
    assert row["created_at"] == FORGED  # back to how it was
