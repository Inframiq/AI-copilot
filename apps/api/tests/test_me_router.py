"""GET /me/subscription and DELETE /me."""
import time
import uuid
import jwt as pyjwt
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
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


# ── DELETE /me ───────────────────────────────────────────────────────────────


def _delete_db():
    s = MagicMock()
    res = MagicMock()
    res.all.return_value = []
    s.execute = AsyncMock(return_value=res)
    s.commit = AsyncMock()

    async def _override():
        yield s

    return _override, s


@pytest.mark.asyncio
async def test_delete_account_wipes_data_and_removes_auth_user():
    override, s = _delete_db()
    app.dependency_overrides[get_db] = override
    fake_sb = MagicMock()
    try:
        with patch("app.routers.me._supabase", return_value=fake_sb):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                r = await c.request("DELETE", "/me", headers=auth())
        assert r.status_code == 204
        fake_sb.auth.admin.delete_user.assert_called_once_with(TEST_USER_ID)
        s.commit.assert_awaited()
        # One bulk delete per owned table, plus the raw career_profiles delete.
        assert s.execute.await_count >= 10
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_delete_account_surfaces_auth_failure_without_wiping():
    override, s = _delete_db()
    app.dependency_overrides[get_db] = override
    fake_sb = MagicMock()
    fake_sb.auth.admin.delete_user.side_effect = RuntimeError("supabase down")
    try:
        with patch("app.routers.me._supabase", return_value=fake_sb):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                r = await c.request("DELETE", "/me", headers=auth())
        assert r.status_code == 502
        s.commit.assert_not_awaited()
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_delete_account_requires_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.request("DELETE", "/me")
    assert r.status_code == 401
