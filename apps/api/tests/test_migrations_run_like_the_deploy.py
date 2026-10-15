"""Every migration, run the way the deploy runs them: Alembic over SQLAlchemy
and asyncpg, on a fresh database with Supabase's browser roles. Migration
tests that hand their SQL to asyncpg directly use its simple query protocol,
which takes several commands at once; the deploy prepares each op.execute,
which takes one. 042 shipped with two, and the deploy refused it."""
import asyncio
import pathlib

import pytest

SCRIPTS = pathlib.Path(__file__).parents[1] / "alembic"
DB = "kripax_migrations_check"


async def _admin(uri: str, sql: str) -> None:
    import asyncpg

    conn = await asyncpg.connect(uri)
    try:
        await conn.execute(sql)
    finally:
        await conn.close()


def test_alembic_upgrade_head_runs_on_a_fresh_database(pg_uri, monkeypatch):
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
    url = pg_uri.rsplit("/", 1)[0] + "/" + DB
    monkeypatch.setattr(settings, "migration_database_url", url)
    try:
        # No alembic.ini: its logging section would switch off the app's
        # loggers for every test after this one.
        cfg = Config()
        cfg.set_main_option("script_location", str(SCRIPTS))
        command.upgrade(cfg, "head")
    finally:
        # kripax_api is a cluster-wide role: leave the server as it was found.
        asyncio.run(_admin(server, f"DROP DATABASE IF EXISTS {DB} WITH (FORCE)"))
        asyncio.run(_admin(server, "DROP ROLE IF EXISTS kripax_api"))
