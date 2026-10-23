import os

# Tests never reach the live database, Supabase or OpenAI. apps/api/.env holds
# the production values, and a test that missed one of its fakes (the AI usage
# log opens its own session) wrote rows for a made-up user into production.
# Set before anything imports app.core.config; environment variables win over
# .env. The database address points at a port nothing listens on, so a missed
# fake fails the test instead of writing anywhere. Tests that need a real
# Postgres use the pg_uri fixture below.
os.environ.update({
    "DATABASE_URL": "postgresql+asyncpg://test:test@127.0.0.1:9/no_database_in_tests",
    "MIGRATION_DATABASE_URL": "",
    "SUPABASE_URL": "https://test-placeholder.supabase.co",
    "SUPABASE_ANON_KEY": "test-placeholder",
    "SUPABASE_SERVICE_ROLE_KEY": "test-placeholder",
    "SUPABASE_JWT_SECRET": "test-placeholder-secret-at-least-32-chars-long",
    "OPENAI_API_KEY": "test-placeholder",
    # Production's CORS allow-list, not a developer's localhost additions.
    "CORS_EXTRA_ORIGINS": "",
    "CORS_ORIGIN_REGEX": "",
})

import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app

@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
def avatar_store(monkeypatch):
    """Stands in for the private "avatars" bucket. put(photo_url, content)
    stores an object at the path that URL names; anything not put is
    missing, like a deleted photo."""
    from urllib.parse import urlparse

    from app.services import pdf

    objects: dict[str, bytes] = {}

    class Store:
        def put(self, photo_url: str, content: bytes) -> None:
            match = pdf._AVATAR_PATH.match(urlparse(photo_url).path)
            objects[match.group(1) if match else photo_url] = content

        downloads: list[str] = []

    store = Store()

    def download(path: str) -> bytes | None:
        store.downloads.append(path)
        return objects.get(path)

    monkeypatch.setattr(pdf, "_download_avatar", download)
    return store


# ── Credits ─────────────────────────────────────────────────────────────────

_ROUTERS_THAT_CHARGE = ("app.routers.ai", "app.routers.jd", "app.routers.cover_letters", "app.routers.resumes")


class Ledger:
    """In-memory stand-in for app.core.credits' spend/refund, patched into
    every router that charges (see the autouse fixture below). Behaves like
    the real thing — deducts, refuses with the same 402s, refunds up to the
    allotment, skips unpriced actions and the unlimited allowlist — so
    endpoint tests can check what an endpoint charged without scripting the
    database. The credit logic itself is tested against a real Postgres
    (test_credits.py, test_credits_concurrency.py)."""

    def __init__(self):
        from app.core.credits import PLAN_CREDITS
        self.default = PLAN_CREDITS["free"]
        self.balances: dict = {}
        self.allotments: dict = {}
        self.inactive: set = set()
        self.spent: list[str] = []
        self.refunded: list[str] = []

    def set(self, user_id, credits, *, allotment=None, active=True):
        import uuid
        uid = uuid.UUID(str(user_id))
        self.balances[uid] = credits
        self.allotments[uid] = allotment if allotment is not None else max(credits, self.default)
        (self.inactive.discard if active else self.inactive.add)(uid)

    def balance(self, user_id):
        import uuid
        return self.balances.get(uuid.UUID(str(user_id)), self.default)

    async def spend(self, db, user_id, action, email=None):
        from fastapi import HTTPException
        from app.core import credits
        cost = credits.CREDIT_COSTS.get(action, 0)
        if credits._exempt(action, cost, email):
            return None
        uid = user_id
        if uid in self.inactive:
            raise HTTPException(status_code=402, detail="Your subscription is not active.")
        have = self.balances.get(uid, self.default)
        if have < cost:
            raise credits._out_of_credits(action, cost, have)
        self.balances[uid] = have - cost
        self.allotments.setdefault(uid, self.default)
        self.spent.append(action)
        return None

    async def refund(self, db, user_id, action, email=None):
        from app.core import credits
        cost = credits.CREDIT_COSTS.get(action, 0)
        if credits._exempt(action, cost, email):
            return
        uid = user_id
        cap = self.allotments.get(uid, self.default)
        self.balances[uid] = min(self.balances.get(uid, self.default) + cost, cap)
        self.refunded.append(action)


@pytest.fixture(autouse=True)
def ledger(monkeypatch):
    import importlib
    book = Ledger()
    for name in _ROUTERS_THAT_CHARGE:
        mod = importlib.import_module(name)
        if hasattr(mod, "spend_credits"):
            monkeypatch.setattr(mod, "spend_credits", book.spend)
        if hasattr(mod, "refund_credits"):
            monkeypatch.setattr(mod, "refund_credits", book.refund)
    return book


@pytest.fixture(autouse=True)
def sessions_open(monkeypatch):
    """Every signed-in request asks the database whether the token's session
    still exists (app.core.security, test ATK-007); tests' made-up tokens
    have none. Treated as open here — test_signed_out_tokens.py runs the real
    check against a throwaway Postgres."""
    from app.core import security

    async def _open(session_id):
        return True

    monkeypatch.setattr(security, "_session_still_open", _open)
    security._session_cache.clear()


# ── A real Postgres, for tests that need one ────────────────────────────────

@pytest.fixture(scope="session")
def pg_uri():
    """A throwaway local PostgreSQL for the whole run (pgserver, dev-only).
    Tests that use it are skipped where pgserver isn't installed."""
    import tempfile
    pgserver = pytest.importorskip("pgserver")
    srv = pgserver.get_server(tempfile.mkdtemp(prefix="kripax-pg-"), cleanup_mode="stop")
    return srv.get_uri().replace("postgresql://", "postgresql+asyncpg://", 1)


@pytest.fixture
async def pg_session(pg_uri):
    """A sessionmaker on empty `subscriptions` and `free_grant_ledger` tables."""
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from app.db.models import FreeGrantLedger, Subscription

    engine = create_async_engine(pg_uri, pool_size=20, max_overflow=0)
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Subscription.__table__.create(c, checkfirst=True))
        await conn.run_sync(lambda c: FreeGrantLedger.__table__.create(c, checkfirst=True))
        await conn.execute(text("TRUNCATE subscriptions, free_grant_ledger"))
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture(autouse=True)
def no_ai_spend_ceiling(monkeypatch):
    """The daily OpenAI spend ceiling (app.core.ai_budget) reads the usage log
    from the database on the first model call of each 30s. Off for tests —
    test_ai_budget.py turns it on against a throwaway Postgres."""
    from app.core import ai_budget
    from app.core.config import settings
    monkeypatch.setattr(settings, "ai_daily_spend_limit_usd", 0.0)
    monkeypatch.setitem(ai_budget._cache, "day", None)
    monkeypatch.setitem(ai_budget._cache, "spent", 0.0)
    monkeypatch.setitem(ai_budget._cache, "read_at", 0.0)
