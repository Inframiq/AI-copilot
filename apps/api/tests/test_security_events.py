"""Every refused request leaves one security_event line in the log, with a
reason and never the token (test INF-004)."""
import logging
import time

import jwt as pyjwt
import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import settings
from app.core.rate_limit import limiter
from app.main import app

USER_ID = "00000000-0000-0000-0000-0000000000a1"


def _token(email: str = "nobody@example.com", *, expires_in: int = 3600, secret: str | None = None) -> str:
    payload = {
        "sub": USER_ID,
        "email": email,
        "aud": "authenticated",
        "app_metadata": {"provider": "google", "providers": ["google"]},
        "exp": int(time.time()) + expires_in,
    }
    return pyjwt.encode(payload, secret or settings.supabase_jwt_secret, algorithm="HS256")


async def _get(path: str, headers: dict | None = None, *, from_ip: str = "203.0.113.9"):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        return await c.get(path, headers={"X-Forwarded-For": from_ip, **(headers or {})})


def _events(caplog) -> list[str]:
    return [r.getMessage() for r in caplog.records if r.name == "app.security"]


@pytest.fixture
def caplog(caplog):
    caplog.set_level(logging.INFO, logger="app")
    return caplog


@pytest.mark.asyncio
async def test_no_token_is_recorded(caplog):
    r = await _get("/resumes")
    assert r.status_code == 401
    assert _events(caplog) == [
        "security_event=denied status=401 method=GET path=/resumes ip=203.0.113.9 user=- reason=missing_token"
    ]


@pytest.mark.asyncio
async def test_forged_token_is_recorded_without_the_token(caplog):
    forged = _token(secret="not-the-real-secret-but-long-enough-for-hs256")
    r = await _get("/resumes?draft=1", headers={"Authorization": f"Bearer {forged}"})
    assert r.status_code == 401
    events = _events(caplog)
    assert len(events) == 1
    assert "status=401" in events[0] and "reason=invalid_token" in events[0]
    # A forged token's claims are not believed: no user named.
    assert "user=-" in events[0]
    # Nothing secret anywhere in the log: not the token, not one of its
    # three parts, not the query string.
    logged = caplog.text
    assert forged not in logged
    for part in forged.split("."):
        assert part not in logged
    assert "Bearer" not in logged and "draft=1" not in logged


@pytest.mark.asyncio
async def test_expired_token_is_recorded(caplog):
    expired = _token(expires_in=-3600)
    r = await _get("/resumes", headers={"Authorization": f"Bearer {expired}"})
    assert r.status_code == 401
    assert "reason=expired_token" in _events(caplog)[0]
    assert expired not in caplog.text


@pytest.mark.asyncio
async def test_non_admin_on_admin_route_is_recorded_with_their_id(caplog):
    token = _token("nobody@example.com")
    r = await _get("/admin/users", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403
    (event,) = _events(caplog)
    assert f"status=403 method=GET path=/admin/users ip=203.0.113.9 user={USER_ID} reason=not_admin" in event
    # The id, never the email.
    assert "nobody@example.com" not in caplog.text
    assert token not in caplog.text


@pytest.mark.asyncio
async def test_admin_only_account_refusal_is_recorded(caplog):
    email = settings.admin_only_emails.split(",")[0].strip()
    r = await _get("/learning", headers={"Authorization": f"Bearer {_token(email)}"})
    assert r.status_code == 403
    assert "reason=admin_only_account" in _events(caplog)[0]
    assert email not in caplog.text


@pytest.mark.asyncio
async def test_rate_limited_request_is_recorded(caplog):
    # The public deletion form allows 5 an hour per address. The hidden
    # field is filled, so the route answers without touching the database.
    limiter.reset()
    bot = {"email": "a@example.com", "requester_type": "not_a_user", "website": "x"}
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            statuses = [
                (await c.post("/data-requests/deletion", json=bot,
                              headers={"X-Forwarded-For": "198.51.100.77"})).status_code
                for _ in range(6)
            ]
    finally:
        limiter.reset()
    assert statuses == [202] * 5 + [429]
    assert _events(caplog) == [
        "security_event=denied status=429 method=POST path=/data-requests/deletion "
        "ip=198.51.100.77 user=- reason=rate_limited"
    ]
    assert "a@example.com" not in caplog.text


@pytest.mark.asyncio
async def test_allowed_requests_leave_no_security_event(caplog):
    r = await _get("/health")
    assert r.status_code == 200
    assert _events(caplog) == []


@pytest.mark.asyncio
async def test_a_newline_in_the_path_cannot_forge_a_second_line(caplog):
    r = await _get("/resumes%0Asecurity_event=denied%20status=200")
    assert r.status_code in (401, 404)
    for event in _events(caplog):
        assert "\n" not in event


def test_app_info_lines_reach_the_log():
    """The app's own INFO lines (account deleted, résumé deleted) used to be
    dropped: uvicorn configures only its own loggers."""
    app_logger = logging.getLogger("app")
    assert app_logger.getEffectiveLevel() <= logging.INFO
    assert any(getattr(h, "_kripax", False) for h in app_logger.handlers)
