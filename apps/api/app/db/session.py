from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from app.core.config import settings
from app.db.tls import connect_args

# hide_parameters: a database error's message otherwise carries every value
# the query sent (résumé text, emails, titles) into the error log (test DB-005).
engine = create_async_engine(
    settings.database_url,
    echo=False,
    pool_pre_ping=True,
    hide_parameters=True,
    connect_args=connect_args(settings.database_url),
)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session


async def read_from_one_snapshot(db: AsyncSession) -> None:
    """Makes every query that follows, until the next commit, read the same
    snapshot of the database (REPEATABLE READ). A read that takes several
    queries — a JD's runs, then their questions, then the follow-ups — would
    otherwise see each one as of its own moment, so a set replaced in another
    tab between them showed a mix of the two. Postgres never shows another
    session's uncommitted changes either way; this only stops a read from
    straddling someone else's commit. Read-only use: a read-only transaction
    at this level is never refused for a conflict.

    Call before the first query of the transaction. A stand-in session (the
    unit tests' mocks) has no transaction to set and is left as it is."""
    if isinstance(db, AsyncSession) and not db.in_transaction():
        await db.connection(execution_options={"isolation_level": "REPEATABLE READ"})
