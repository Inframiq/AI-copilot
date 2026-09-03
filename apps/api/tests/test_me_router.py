"""GET /me/subscription."""
import time
import uuid
import jwt as pyjwt
import pytest
from unittest.mock import AsyncMock, MagicMock
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.core.config import settings
from app.db.session import get_db
from app.db.models import Subscription

TEST_USER_ID = "00000000-0000-0000-0000-000000000001"


def auth():
    payload = {"sub": TEST_USER_ID, "email": "t@t.com", "aud": "authenticated",
               "exp": int(time.time()) + 3600}
    return {"Authorization": f"Bearer {pyjwt.encode(payload, settings.supabase_jwt_secret, algorithm='HS256')}"}


def _db(sub):
    s = MagicMock()
    res = MagicMock(); res.scalar_one_or_none.return_value = sub
    s.execute = AsyncMock(return_value=res)
    s.add = MagicMock()
    s.flush = AsyncMock()
    s.commit = AsyncMock()

    async def _override():
        yield s

    return _override, s


@pytest.mark.asyncio
async def test_returns_existing_subscription_shape():
    sub = Subscription(id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID), plan="premium",
                       status="active", credits_remaining=137, credits_allotment=600,
                       current_period_end=None)
    override, _ = _db(sub)
    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            r = await c.get("/me/subscription", headers=auth())
        assert r.status_code == 200
        body = r.json()
        assert body["plan"] == "premium"
        assert body["credits_remaining"] == 137
        assert body["costs"]["tailor"] == 10
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_creates_free_subscription_on_first_call():
    override, s = _db(None)
    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            r = await c.get("/me/subscription", headers=auth())
        assert r.status_code == 200
        body = r.json()
        assert body["plan"] == "free"
        assert body["credits_remaining"] == 50
        assert body["renews"] is False
        s.add.assert_called_once()
        s.commit.assert_awaited()
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_requires_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/me/subscription")
    assert r.status_code == 401
