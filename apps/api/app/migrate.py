"""Deploy-time migrations: `python -m app.migrate`, run before uvicorn.

`alembic upgrade head` exits non-zero when the database is at a revision this
code doesn't have, so a database migrated ahead of the deployed code (a
migration applied before its commit was pushed) kept the API from booting at
all. Here that case logs a warning and lets the API start: migrations are
additive, so older code runs on the newer schema. Any other migration failure
still stops the boot.
"""
from __future__ import annotations

import asyncio
import os
import pathlib
import sys

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from alembic.util.exc import CommandError
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import settings

# Lets alembic/env.py tell a deploy apart from someone migrating by hand.
DEPLOY_FLAG = "KRIPAX_DEPLOY_MIGRATION"

_INI = pathlib.Path(__file__).resolve().parents[1] / "alembic.ini"


async def _current_revision(url: str) -> str | None:
    engine = create_async_engine(url)
    try:
        async with engine.connect() as conn:
            return await conn.run_sync(
                lambda c: MigrationContext.configure(c).get_current_revision()
            )
    finally:
        await engine.dispose()


def unknown_revision(script: ScriptDirectory, current: str | None) -> bool:
    """True when the database is at a revision this code has no file for."""
    if current is None:
        return False
    try:
        return script.get_revision(current) is None
    except CommandError:
        return True


def main() -> int:
    cfg = Config(str(_INI))
    script = ScriptDirectory.from_config(cfg)
    current = asyncio.run(_current_revision(settings.migration_url))
    if unknown_revision(script, current):
        print(
            f"WARNING: the database is at revision {current!r}, which this code "
            f"doesn't have (latest here: {script.get_current_head()!r}). Skipping "
            "migrations and starting anyway; push the commit with that migration.",
            file=sys.stderr,
        )
        return 0
    os.environ[DEPLOY_FLAG] = "1"
    command.upgrade(cfg, "head")
    return 0


if __name__ == "__main__":
    sys.exit(main())
