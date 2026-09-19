"""Findings from the security audit, pinned so they stay fixed."""
import time

import jwt as pyjwt
import pytest
from httpx import ASGITransport, AsyncClient
from starlette.requests import Request

from app.core.config import settings
from app.core.rate_limit import client_ip, limiter, rate_limit_key
from app.main import app

ADMIN = settings.admin_emails.split(",")[0]


def _token(email: str, providers: list[str], sub: str = "00000000-0000-0000-0000-000000000001") -> dict:
    payload = {
        "sub": sub,
        "email": email,
        "aud": "authenticated",
        "app_metadata": {"provider": providers[0] if providers else None, "providers": providers},
        "exp": int(time.time()) + 3600,
    }
    token = pyjwt.encode(payload, settings.supabase_jwt_secret, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def _request(headers: dict[str, str], peer: str = "10.0.0.1") -> Request:
    return Request({
        "type": "http",
        "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
        "client": (peer, 1234),
    })


@pytest.mark.asyncio
async def test_an_admin_email_signed_up_by_password_is_not_an_admin():
    # Email/password sign-up is reachable with the public key. An address
    # nobody has proven they own must not open the admin dashboard.
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/admin/users", headers=_token(ADMIN, ["email"]))
    assert r.status_code == 403


def test_signed_in_requests_are_limited_per_user_not_per_proxy():
    a = _request(_token("a@example.com", ["google"], sub="user-a"))
    b = _request(_token("b@example.com", ["google"], sub="user-b"))
    assert rate_limit_key(a) == "user:user-a"
    assert rate_limit_key(b) == "user:user-b"


def test_anonymous_requests_are_limited_by_the_visitors_ip_not_the_proxys():
    behind_proxy = _request({"x-forwarded-for": "203.0.113.7, 10.1.2.3"}, peer="10.1.2.3")
    assert client_ip(behind_proxy) == "203.0.113.7"
    assert rate_limit_key(behind_proxy) == "ip:203.0.113.7"
    assert client_ip(_request({}, peer="198.51.100.4")) == "198.51.100.4"


def test_a_garbage_token_falls_back_to_the_ip():
    assert rate_limit_key(_request({"authorization": "Bearer not-a-jwt"}, peer="198.51.100.4")) == "ip:198.51.100.4"


@pytest.mark.asyncio
async def test_a_huge_request_body_is_refused_before_it_is_read():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post(
            "/data-requests/deletion",
            content=b"x" * (13 * 1024 * 1024),
            headers={"content-type": "application/json"},
        )
    assert r.status_code == 413


@pytest.mark.asyncio
async def test_the_deletion_form_has_a_ceiling_no_header_can_dodge(monkeypatch):
    # Rotating X-Forwarded-For defeats the per-IP limit; the global cap holds.
    from unittest.mock import AsyncMock, MagicMock

    from app.db.session import get_db

    session = MagicMock()
    session.commit = AsyncMock()

    async def override():
        yield session

    app.dependency_overrides[get_db] = override
    limiter.reset()
    try:
        body = {"email": "a@example.com", "requester_type": "not_a_user"}
        codes = []
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            for i in range(101):
                r = await client.post(
                    "/data-requests/deletion", json=body, headers={"x-forwarded-for": f"198.51.100.{i % 250}"}
                )
                codes.append(r.status_code)
        assert codes[:100] == [202] * 100
        assert codes[100] == 429
    finally:
        limiter.reset()
        app.dependency_overrides.pop(get_db, None)
