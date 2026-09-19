"""settings.ADMIN_ONLY_EMAILS accounts get no normal app access — only the
admin dashboard and GET /feedback (the dashboard's own review list)."""
import time
from unittest.mock import AsyncMock, MagicMock
import jwt as pyjwt
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.core.config import settings
from app.db.session import get_db

ADMIN_ONLY_EMAILS = [e.strip() for e in settings.admin_only_emails.split(",")]
ADMIN_ONLY_EMAIL = ADMIN_ONLY_EMAILS[0]
NORMAL_USER_EMAIL = "nobody@example.com"


def auth_header(email: str):
    payload = {
        "sub": "00000000-0000-0000-0000-000000000001",
        "email": email,
        "aud": "authenticated",
        "app_metadata": {"provider": "google", "providers": ["google"]},
        "exp": int(time.time()) + 3600,
    }
    return {"Authorization": f"Bearer {pyjwt.encode(payload, settings.supabase_jwt_secret, algorithm='HS256')}"}


@pytest.mark.asyncio
async def test_admin_only_account_blocked_from_normal_route():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/learning", headers=auth_header(ADMIN_ONLY_EMAIL))
    assert r.status_code == 403
    assert r.json()["detail"] == "This account is admin-only."


@pytest.mark.asyncio
async def test_admin_only_account_blocked_from_submitting_feedback():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post("/feedback", json={"rating": 5}, headers=auth_header(ADMIN_ONLY_EMAIL))
    assert r.status_code == 403
    assert r.json()["detail"] == "This account is admin-only."


@pytest.mark.asyncio
async def test_admin_only_account_can_reach_health_and_docs():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        health = await c.get("/health", headers=auth_header(ADMIN_ONLY_EMAIL))
        docs = await c.get("/docs", headers=auth_header(ADMIN_ONLY_EMAIL))
    assert health.status_code == 200
    # Not refused by the admin-only rule (403). The docs themselves exist
    # only when ENABLE_API_DOCS is on.
    assert docs.status_code == (200 if settings.enable_api_docs else 404)


@pytest.mark.asyncio
async def test_both_admin_only_emails_are_blocked_from_normal_routes():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        for email in ADMIN_ONLY_EMAILS:
            r = await c.get("/learning", headers=auth_header(email))
            assert r.status_code == 403, f"{email} should be admin-only"


@pytest.mark.asyncio
async def test_non_admin_account_keeps_normal_access():
    mock_session = MagicMock()
    mock_scalars = MagicMock()
    mock_scalars.all.return_value = []
    mock_result = MagicMock()
    mock_result.scalars.return_value = mock_scalars
    mock_session.execute = AsyncMock(return_value=mock_result)

    async def _override():
        yield mock_session

    app.dependency_overrides[get_db] = _override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            r = await c.get("/learning", headers=auth_header(NORMAL_USER_EMAIL))
        assert r.status_code == 200
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_no_token_requests_unaffected():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/health")
    assert r.status_code == 200
