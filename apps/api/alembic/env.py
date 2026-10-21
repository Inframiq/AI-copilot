import asyncio
import os
from logging.config import fileConfig
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine
from alembic import context
from app.core.config import settings
from app.db.session import Base
from app.db.tls import connect_args
from app.db import models  # noqa: F401 — registers all models with Base.metadata

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "db", "postgres"}
_WRITE_COMMANDS = {"upgrade", "downgrade", "stamp"}


def _refuse_hand_migrating_a_shared_database() -> None:
    """Changing a remote database's schema by hand from a dev machine got it
    ahead of the deployed code, and the API stopped booting. Remote schemas
    change on deploy (app.migrate) unless ALLOW_REMOTE_MIGRATION=1 is set."""
    opts = config.cmd_opts
    fn = getattr(opts, "cmd", (None,))[0] if opts is not None else None
    if getattr(fn, "__name__", None) not in _WRITE_COMMANDS:
        return
    if os.environ.get("KRIPAX_DEPLOY_MIGRATION") or os.environ.get("RENDER"):
        return
    if os.environ.get("ALLOW_REMOTE_MIGRATION") == "1":
        return
    host = make_url(settings.migration_url).host or ""
    if host in _LOCAL_HOSTS:
        return
    raise SystemExit(
        f"Refusing to {fn.__name__} the database at {host}: it is the one the "
        "deployed API uses. Push the commit with the migration; the deploy "
        "applies it. To do it by hand anyway, set ALLOW_REMOTE_MIGRATION=1."
    )


_refuse_hand_migrating_a_shared_database()


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode (no live DB connection needed)."""
    context.configure(
        url=settings.migration_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    """Run migrations in 'online' mode with an async engine."""
    connectable = create_async_engine(
        settings.migration_url, connect_args=connect_args(settings.migration_url)
    )
    async with connectable.connect() as connection:
        await connection.run_sync(
            lambda conn: context.configure(connection=conn, target_metadata=target_metadata)
        )
        async with connection.begin():
            await connection.run_sync(lambda _: context.run_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
