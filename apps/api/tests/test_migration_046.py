"""Migration 046 takes EXECUTE on public's trigger functions away from the
browser roles, and the triggers keep firing (test ATK-018)."""
import importlib.util
import pathlib

import pytest

MIG = pathlib.Path(__file__).parents[1] / "alembic/versions/046_trigger_functions_not_callable.py"


def _migration():
    spec = importlib.util.spec_from_file_location("m046", MIG)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_migration_046_chains_from_045():
    m = _migration()
    assert m.revision == "046"
    assert m.down_revision == "045"
    assert "__ACTION__" not in m.UPGRADE_SQL and "__ACTION__" not in m.DOWNGRADE_SQL


@pytest.fixture
async def supabase_like(pg_uri):
    """A browser table with an updated_at trigger, as 002_career_profile.sql
    makes it, and an ordinary function that must be left alone."""
    import asyncpg

    conn = await asyncpg.connect(pg_uri.replace("postgresql+asyncpg://", "postgresql://"))
    await conn.execute("""
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        END $$;
        DROP TABLE IF EXISTS public.m046_profiles;
        DROP FUNCTION IF EXISTS public.m046_touch(), public.m046_plain();
        CREATE TABLE public.m046_profiles (user_id int PRIMARY KEY, headline text, updated_at timestamptz);
        CREATE FUNCTION public.m046_touch() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN NEW.updated_at = now() + interval '1 day'; RETURN NEW; END $$;
        CREATE TRIGGER m046_touch BEFORE UPDATE ON public.m046_profiles FOR EACH ROW EXECUTE FUNCTION public.m046_touch();
        CREATE FUNCTION public.m046_plain() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
        GRANT EXECUTE ON FUNCTION public.m046_touch(), public.m046_plain() TO anon, authenticated;
        GRANT SELECT, UPDATE ON public.m046_profiles TO authenticated;
        INSERT INTO public.m046_profiles VALUES (1, 'before', NULL);
    """)
    yield conn
    await conn.execute("RESET ROLE")
    await conn.execute("DROP TABLE IF EXISTS public.m046_profiles; DROP FUNCTION IF EXISTS public.m046_touch(), public.m046_plain()")
    await conn.close()


async def _can_run(conn, role, fn):
    return await conn.fetchval("SELECT has_function_privilege($1, $2, 'EXECUTE')", role, fn)


async def test_upgrade_takes_execute_off_trigger_functions_only(supabase_like):
    conn = supabase_like
    await conn.execute(_migration().UPGRADE_SQL)

    for role in ("anon", "authenticated"):
        assert not await _can_run(conn, role, "public.m046_touch()"), f"{role} can still call the trigger function"
        assert await _can_run(conn, role, "public.m046_plain()"), "an ordinary function was touched"


async def test_the_trigger_still_fires_for_a_signed_in_update(supabase_like):
    conn = supabase_like
    await conn.execute(_migration().UPGRADE_SQL)

    await conn.execute("SET ROLE authenticated")
    await conn.execute("UPDATE public.m046_profiles SET headline = 'after' WHERE user_id = 1")
    await conn.execute("RESET ROLE")
    stamped = await conn.fetchval("SELECT updated_at > now() FROM public.m046_profiles WHERE user_id = 1")
    assert stamped, "the updated_at trigger did not run"


async def test_downgrade_gives_execute_back(supabase_like):
    conn = supabase_like
    m = _migration()
    await conn.execute(m.UPGRADE_SQL)
    await conn.execute(m.DOWNGRADE_SQL)
    for role in ("anon", "authenticated"):
        assert await _can_run(conn, role, "public.m046_touch()")
