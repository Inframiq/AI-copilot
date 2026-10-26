"""What the browser's roles can do to every table, checked on every build
(test ATK-055).

The database is built the way production was: Supabase's auth and storage
schemas and default grants, the website's SQL files (apps/web/supabase/
migrations), then every Alembic migration, run as the deploy runs them. Then
anon, User A and User B each try SELECT, INSERT, UPDATE and DELETE on every
table in public and on storage, and each outcome is compared with what it
should be. A migration that opens a table, loosens a rule or adds a table
without row security changes an outcome, and the build fails.

The self-checks at the end plant such mistakes and require the matrix to
catch each one."""
import asyncio
import json
import pathlib
import uuid

import asyncpg
import pytest

API = pathlib.Path(__file__).parents[1]
WEB_SQL = API.parents[0] / "web" / "supabase" / "migrations"
DB = "kripax_rls_matrix"
A = uuid.UUID("aaaaaaaa-0000-4000-8000-000000000001")
B = uuid.UUID("bbbbbbbb-0000-4000-8000-000000000002")
SESSION = {A: uuid.UUID("aaaaaaaa-5555-4000-8000-000000000001"), B: uuid.UUID("bbbbbbbb-5555-4000-8000-000000000002")}
LABEL = {str(A): "A", str(B): "B"}

# The one table the browser writes to; every other table in public is the
# API's alone.
BROWSER_TABLES = {"career_profiles"}

# Supabase as a new project has it, before any of ours: auth, storage, the
# browser roles and the default grants that hand them every new table.
SUPABASE = """
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, banned_until timestamptz, deleted_at timestamptz);
CREATE TABLE auth.sessions (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  not_after timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz, refreshed_at timestamp);
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE
  AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt() ->> 'sub', '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT auth.jwt() ->> 'role' $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;

CREATE SCHEMA storage;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean DEFAULT false,
  file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets,
  name text, owner uuid, metadata jsonb, created_at timestamptz DEFAULT now());
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE
  AS $$ SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO anon, authenticated;
GRANT ALL ON storage.objects, storage.buckets TO anon, authenticated;
INSERT INTO storage.buckets (id, name) VALUES ('avatars', 'avatars'), ('resumes', 'resumes');

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
"""


def _on_database(uri: str, name: str) -> str:
    from urllib.parse import urlsplit, urlunsplit

    return urlunsplit(urlsplit(uri)._replace(path="/" + name))


async def _admin(uri: str, sql: str) -> None:
    conn = await asyncpg.connect(uri)
    try:
        await conn.execute(sql)
    finally:
        await conn.close()


async def _seed(uri: str) -> None:
    conn = await asyncpg.connect(uri)
    try:
        for user in (A, B):
            await conn.execute("INSERT INTO auth.users (id, email) VALUES ($1, $2)", user, f"{LABEL[str(user)]}@example.com")
            await conn.execute("INSERT INTO auth.sessions (id, user_id) VALUES ($1, $2)", SESSION[user], user)
            await conn.execute("INSERT INTO public.career_profiles (user_id, headline) VALUES ($1, 'mine')", user)
            await conn.execute("INSERT INTO storage.objects (bucket_id, name) VALUES ('avatars', $1)", f"{user}/profile.png")
            await conn.execute("INSERT INTO storage.objects (bucket_id, name) VALUES ('resumes', $1)", f"resumes/{user}/r.pdf")
    finally:
        await conn.close()


@pytest.fixture(scope="module")
def db_uri(pg_uri):
    """One database for the module, built like production. Tests undo
    whatever they do, so they can share it."""
    from alembic import command
    from alembic.config import Config
    from app.core.config import settings

    server = pg_uri.replace("postgresql+asyncpg://", "postgresql://")
    asyncio.run(_admin(server, f"DROP DATABASE IF EXISTS {DB} WITH (FORCE)"))
    asyncio.run(_admin(server, f"CREATE DATABASE {DB}"))
    asyncio.run(_admin(server, """
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        END $$;
    """))
    plain = _on_database(server, DB)
    asyncio.run(_admin(plain, SUPABASE))
    for sql in sorted(WEB_SQL.glob("*.sql")):
        # Supabase ships pgcrypto and this throwaway server doesn't; the only
        # use, gen_random_uuid(), is built into Postgres 13 and later.
        text = sql.read_text(encoding="utf-8").replace('CREATE EXTENSION IF NOT EXISTS "pgcrypto";', "")
        asyncio.run(_admin(plain, text))

    before = settings.migration_database_url
    settings.migration_database_url = _on_database(pg_uri, DB)
    try:
        cfg = Config()  # no alembic.ini: its logging section would mute the app's loggers
        cfg.set_main_option("script_location", str(API / "alembic"))
        command.upgrade(cfg, "head")
    finally:
        settings.migration_database_url = before
    asyncio.run(_seed(plain))
    yield plain
    asyncio.run(_admin(server, f"DROP DATABASE IF EXISTS {DB} WITH (FORCE)"))
    try:  # cluster-wide; another test's database may still hold grants to it
        asyncio.run(_admin(server, "DROP ROLE IF EXISTS kripax_api"))
    except asyncpg.DependentObjectsStillReferencedError:
        pass


@pytest.fixture
async def conn(db_uri):
    c = await asyncpg.connect(db_uri)
    yield c
    await c.close()


def _labels(rows) -> list[str]:
    out = []
    for r in rows:
        text = str(r[0])
        out.append(next((LABEL[k] for k in LABEL if k in text), text))
    return sorted(out)


async def attempt(conn, who: str, sql: str, *, setup: str | None = None):
    """One statement as the Data API runs it for `who`, undone afterwards.
    Returns "denied" or the owners of the rows it saw or changed."""
    tr = conn.transaction()
    await tr.start()
    try:
        if setup:
            await conn.execute(setup)
        if who == "anon":
            claims = {"role": "anon"}
        else:
            user = A if who.startswith("A") else B
            claims = {"sub": str(user), "role": "authenticated", "session_id": str(SESSION[user])}
        await conn.execute("SELECT set_config('request.jwt.claims', $1, true)", json.dumps(claims))
        await conn.execute(f"SET LOCAL ROLE {'anon' if who == 'anon' else 'authenticated'}")
        return _labels(await conn.fetch(sql))
    except asyncpg.InsufficientPrivilegeError:
        return "denied"
    finally:
        await tr.rollback()


CP = "public.career_profiles"
OBJ = "storage.objects"
# (who, what, statement, expected). Expected is "denied" or whose rows the
# statement could see or touch.
BROWSER_CASES = [
    # Signed out: nothing at all.
    ("anon", "read profiles", f"SELECT user_id FROM {CP}", "denied"),
    ("anon", "add a profile", f"INSERT INTO {CP} (user_id) VALUES ('{A}') RETURNING user_id", "denied"),
    ("anon", "change profiles", f"UPDATE {CP} SET headline = 'x' RETURNING user_id", "denied"),
    ("anon", "delete profiles", f"DELETE FROM {CP} RETURNING user_id", "denied"),
    ("anon", "read files", f"SELECT name FROM {OBJ}", []),
    ("anon", "add a photo", f"INSERT INTO {OBJ} (bucket_id, name) VALUES ('avatars', '{A}/x.png') RETURNING name", "denied"),
    ("anon", "change files", f"UPDATE {OBJ} SET metadata = '{{}}' RETURNING name", []),
    ("anon", "delete files", f"DELETE FROM {OBJ} RETURNING name", []),
    # User A: their own profile and photo, nothing of B's, never a delete.
    ("A", "read profiles", f"SELECT user_id FROM {CP}", ["A"]),
    ("A", "save own profile (the app's upsert)",
     f"INSERT INTO {CP} (user_id, headline) VALUES ('{A}', 'x') ON CONFLICT (user_id) DO UPDATE SET headline = EXCLUDED.headline RETURNING user_id", ["A"]),
    ("A", "add a profile for B", f"INSERT INTO {CP} (user_id) VALUES ('{B}') RETURNING user_id", "denied"),
    ("A", "change every profile", f"UPDATE {CP} SET headline = 'x' RETURNING user_id", ["A"]),
    ("A", "change B's profile", f"UPDATE {CP} SET headline = 'x' WHERE user_id = '{B}' RETURNING user_id", []),
    ("A", "hand own profile to B", f"UPDATE {CP} SET user_id = '{B}' WHERE user_id = '{A}' RETURNING user_id", "denied"),
    ("A", "delete own profile", f"DELETE FROM {CP} WHERE user_id = '{A}' RETURNING user_id", "denied"),
    ("A", "read files", f"SELECT name FROM {OBJ}", ["A"]),
    ("A", "add own photo", f"INSERT INTO {OBJ} (bucket_id, name) VALUES ('avatars', '{A}/new.png') RETURNING name", ["A"]),
    ("A", "add a photo in B's folder", f"INSERT INTO {OBJ} (bucket_id, name) VALUES ('avatars', '{B}/x.png') RETURNING name", "denied"),
    ("A", "add a file to the exports bucket", f"INSERT INTO {OBJ} (bucket_id, name) VALUES ('resumes', 'resumes/{A}/x.pdf') RETURNING name", "denied"),
    ("A", "change every file", f"UPDATE {OBJ} SET metadata = '{{}}' RETURNING name", ["A"]),
    ("A", "delete every file", f"DELETE FROM {OBJ} RETURNING name", []),
    # User B sees only B's.
    ("B", "read profiles", f"SELECT user_id FROM {CP}", ["B"]),
    ("B", "read files", f"SELECT name FROM {OBJ}", ["B"]),
]
AFTER_SIGN_OUT = f"DELETE FROM auth.sessions WHERE id = '{SESSION[A]}'"
AFTER_BAN = f"UPDATE auth.users SET banned_until = now() + interval '1 day' WHERE id = '{A}'"
ENDED_CASES = [
    (setup, what, sql)
    for setup in (AFTER_SIGN_OUT, AFTER_BAN)
    for what, sql in (("read profiles", f"SELECT user_id FROM {CP}"), ("read files", f"SELECT name FROM {OBJ}"),
                      ("change own profile", f"UPDATE {CP} SET headline = 'x' RETURNING user_id"))
]


async def api_only_tables(conn) -> list[str]:
    rows = await conn.fetch("""
        SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm') ORDER BY 1""")
    return [r["relname"] for r in rows if r["relname"] not in BROWSER_TABLES]


async def matrix(conn) -> list[str]:
    """Every outcome that isn't what it should be."""
    wrong = []
    for who, what, sql, expected in BROWSER_CASES:
        got = await attempt(conn, who, sql)
        if got != expected:
            wrong.append(f"{who}: {what}: got {got}, expected {expected}")
    for setup, what, sql in ENDED_CASES:
        got = await attempt(conn, "A", sql, setup=setup)
        if got not in ([], "denied"):
            wrong.append(f"A after {'sign-out' if setup == AFTER_SIGN_OUT else 'ban'}: {what}: got {got}")
    for table in await api_only_tables(conn):
        col = await conn.fetchval("""SELECT attname FROM pg_attribute WHERE attrelid = $1::regclass
                                     AND attnum > 0 AND NOT attisdropped ORDER BY attnum LIMIT 1""", f"public.{table}")
        t = f'public."{table}"'
        for who in ("anon", "A"):
            for op, sql in (("read", f"SELECT {col} FROM {t}"), ("add", f"INSERT INTO {t} DEFAULT VALUES RETURNING {col}"),
                            ("change", f'UPDATE {t} SET "{col}" = "{col}" RETURNING {col}'), ("delete", f"DELETE FROM {t} RETURNING {col}")):
                got = await attempt(conn, who, sql)
                if got != "denied":
                    wrong.append(f"{who}: {op} {table}: got {got}, expected denied")
    no_rls = await conn.fetch("""
        SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity ORDER BY 1""")
    wrong += [f"{r['relname']}: row security is off" for r in no_rls]
    return wrong


# ── The matrix on the schema as it ships ────────────────────────────────────

async def test_the_build_matches_production(conn):
    """The run above really is production's shape: the networking tables
    the website's SQL made were dropped (042) and the API's tables exist."""
    tables = set(await api_only_tables(conn))
    assert {"resumes", "job_descriptions", "subscriptions"} <= tables
    assert not {"profiles", "connection_requests"} & tables
    assert await conn.fetchval("SELECT version_num FROM alembic_version") is not None


async def test_every_browser_outcome_is_as_it_should_be(conn):
    wrong = await matrix(conn)
    assert wrong == [], "; ".join(wrong)


async def test_the_matrix_covers_every_table(conn):
    assert len(await api_only_tables(conn)) >= 15


# ── Self-checks: a planted regression must fail the matrix ──────────────────

async def _with(conn, sql: str) -> list[str]:
    tr = conn.transaction()
    await tr.start()
    try:
        await conn.execute(sql)
        return await matrix(conn)
    finally:
        await tr.rollback()


async def test_a_rule_that_lets_everyone_read_profiles_is_caught(conn):
    wrong = await _with(conn, f"CREATE POLICY leak ON {CP} FOR SELECT TO authenticated USING (true)")
    assert any("A: read profiles" in w for w in wrong)


async def test_an_api_table_opened_to_the_browser_is_caught(conn):
    wrong = await _with(conn, "GRANT SELECT ON public.resumes TO authenticated; ALTER TABLE public.resumes DISABLE ROW LEVEL SECURITY")
    assert any("read resumes" in w for w in wrong) and any("resumes: row security is off" in w for w in wrong)


async def test_a_new_table_without_row_security_is_caught(conn):
    wrong = await _with(conn, "CREATE TABLE public.planted_new_table (id int); GRANT SELECT ON public.planted_new_table TO anon")
    assert "planted_new_table: row security is off" in wrong
    assert any("anon: read planted_new_table" in w for w in wrong)


async def test_a_photo_rule_without_the_folder_check_is_caught(conn):
    wrong = await _with(conn, f"""DROP POLICY avatars_select_own ON {OBJ};
        CREATE POLICY avatars_select_own ON {OBJ} FOR SELECT TO authenticated USING (bucket_id = 'avatars')""")
    assert any("A: read files" in w for w in wrong)


async def test_a_rule_that_forgets_the_session_check_is_caught(conn):
    wrong = await _with(conn, f"ALTER POLICY career_profiles_own ON {CP} USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)")
    assert any("after sign-out" in w for w in wrong)
