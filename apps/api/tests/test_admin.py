import time
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch
import jwt as pyjwt
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.core.config import settings
from app.db.session import get_db
from app.db.models import Subscription

TEST_USER_ID = "00000000-0000-0000-0000-000000000001"
OTHER_USER_ID = "00000000-0000-0000-0000-000000000002"


def admin_auth():
    payload = {
        "sub": TEST_USER_ID,
        "email": settings.admin_emails.split(",")[0],
        "aud": "authenticated",
        "app_metadata": {"provider": "google", "providers": ["google"]},
        "exp": int(time.time()) + 3600,
    }
    return {"Authorization": f"Bearer {pyjwt.encode(payload, settings.supabase_jwt_secret, algorithm='HS256')}"}


def non_admin_auth():
    payload = {
        "sub": TEST_USER_ID,
        "email": "nobody@example.com",
        "aud": "authenticated",
        "app_metadata": {"provider": "google", "providers": ["google"]},
        "exp": int(time.time()) + 3600,
    }
    return {"Authorization": f"Bearer {pyjwt.encode(payload, settings.supabase_jwt_secret, algorithm='HS256')}"}


def make_mock_db(sub=None):
    mock_session = MagicMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = sub
    scalars = MagicMock()
    scalars.all.return_value = [sub] if sub else []
    result.scalars.return_value = scalars
    mock_session.execute = AsyncMock(return_value=result)
    mock_session.add = MagicMock()
    mock_session.flush = AsyncMock()
    mock_session.commit = AsyncMock()

    async def _override():
        yield mock_session

    return _override, mock_session


def make_fake_auth_user(uid=OTHER_USER_ID, email="user@example.com", name=None):
    u = MagicMock()
    u.id = uid
    u.email = email
    u.user_metadata = {"full_name": name} if name else {}
    u.created_at = datetime.now(timezone.utc)
    u.last_sign_in_at = datetime.now(timezone.utc)
    return u


@pytest.mark.asyncio
async def test_list_users_forbidden_for_non_admin():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/admin/users", headers=non_admin_auth())
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_list_users_merges_auth_and_subscription():
    sub = Subscription(
        id=uuid.uuid4(), user_id=uuid.UUID(OTHER_USER_ID), plan="premium",
        status="active", credits_remaining=400, credits_allotment=600,
        current_period_end=None,
    )
    override, _ = make_mock_db(sub)
    app.dependency_overrides[get_db] = override
    fake_sb = MagicMock()
    fake_sb.auth.admin.list_users.side_effect = [[make_fake_auth_user(name="Jane Doe")], []]
    try:
        with patch("app.core.supabase_admin.get_supabase_admin", return_value=fake_sb):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                r = await c.get("/admin/users", headers=admin_auth())
        assert r.status_code == 200
        body = r.json()
        assert len(body) == 1
        assert body[0]["plan"] == "premium"
        assert body[0]["credits_remaining"] == 400
        assert body[0]["name"] == "Jane Doe"
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_list_users_defaults_to_free_without_subscription_row():
    override, _ = make_mock_db(None)
    app.dependency_overrides[get_db] = override
    fake_sb = MagicMock()
    fake_sb.auth.admin.list_users.side_effect = [[make_fake_auth_user()], []]
    try:
        with patch("app.core.supabase_admin.get_supabase_admin", return_value=fake_sb):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                r = await c.get("/admin/users", headers=admin_auth())
        assert r.status_code == 200
        body = r.json()
        assert body[0]["plan"] == "free"
        assert body[0]["credits_remaining"] == 50
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_update_user_plan_forbidden_for_non_admin():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.patch(
            f"/admin/users/{OTHER_USER_ID}/plan", json={"plan": "premium"}, headers=non_admin_auth()
        )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_update_user_plan_to_premium_grants_full_allotment():
    sub = Subscription(
        id=uuid.uuid4(), user_id=uuid.UUID(OTHER_USER_ID), plan="free",
        status="active", credits_remaining=3, credits_allotment=50,
        current_period_end=None,
    )
    override, s = make_mock_db(sub)
    app.dependency_overrides[get_db] = override
    fake_sb = MagicMock()
    fake_sb.auth.admin.get_user_by_id.return_value.user = make_fake_auth_user()
    try:
        with patch("app.routers.admin.get_supabase_admin", return_value=fake_sb):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                r = await c.patch(
                    f"/admin/users/{OTHER_USER_ID}/plan", json={"plan": "premium"}, headers=admin_auth()
                )
        assert r.status_code == 200
        body = r.json()
        assert body["plan"] == "premium"
        assert body["credits_remaining"] == 600
        assert body["current_period_end"] is not None
        s.commit.assert_awaited()
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_refresh_credits_resets_to_allotment():
    sub = Subscription(
        id=uuid.uuid4(), user_id=uuid.UUID(OTHER_USER_ID), plan="premium",
        status="active", credits_remaining=12, credits_allotment=600,
        current_period_end=None,
    )
    override, s = make_mock_db(sub)
    app.dependency_overrides[get_db] = override
    fake_sb = MagicMock()
    fake_sb.auth.admin.get_user_by_id.return_value.user = make_fake_auth_user()
    try:
        with patch("app.routers.admin.get_supabase_admin", return_value=fake_sb):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                r = await c.post(f"/admin/users/{OTHER_USER_ID}/credits/refresh", headers=admin_auth())
        assert r.status_code == 200
        assert r.json()["credits_remaining"] == 600
        s.commit.assert_awaited()
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_refresh_credits_forbidden_for_non_admin():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post(f"/admin/users/{OTHER_USER_ID}/credits/refresh", headers=non_admin_auth())
    assert r.status_code == 403
