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


@pytest.mark.asyncio
async def test_admin_only_refusal_is_readable_by_the_web_app():
    """The 403 carries CORS and the security headers like every other answer.
    Without them the browser hid it and reported "Failed to fetch" (API-002)."""
    origin = "https://kripax.inframiq.com"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/resumes", headers={**auth_header(ADMIN_ONLY_EMAIL), "Origin": origin})
    assert r.status_code == 403
    assert r.headers.get("access-control-allow-origin") == origin
    assert r.headers.get("x-frame-options") == "DENY"
    assert r.headers.get("x-content-type-options") == "nosniff"


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["/health", "/plans", "/resumes", "/no-such-route"])
async def test_every_answer_carries_the_security_headers(path):
    """Test WEB-001: success, refusal and not-found alike."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get(path)
    assert r.headers.get("x-content-type-options") == "nosniff"
    assert r.headers.get("x-frame-options") == "DENY"
    assert r.headers.get("referrer-policy") == "no-referrer"
    assert r.headers.get("content-security-policy") == "default-src 'none'; frame-ancestors 'none'"
    assert r.headers.get("strict-transport-security") == "max-age=63072000"
    assert r.headers.get("permissions-policy") == "camera=(), microphone=(), geolocation=(), usb=(), browsing-topics=()"
    assert r.headers.get("cross-origin-opener-policy") == "same-origin"
    # Test ATK-049: no browser or proxy keeps a copy of any answer.
    assert r.headers.get("cache-control") == "no-store"
