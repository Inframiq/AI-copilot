from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from app.core.config import settings

# hide_parameters: a database error's message otherwise carries every value
# the query sent (résumé text, emails, titles) into the error log (test DB-005).
engine = create_async_engine(settings.database_url, echo=False, pool_pre_ping=True, hide_parameters=True)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session
