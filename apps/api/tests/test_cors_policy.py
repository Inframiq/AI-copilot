"""CORS (test API-004): only the live site may read the API from a browser.

The web app sends a bearer token and no cookies, so a browser on any other
origin has nothing to borrow — but the allow-list is still exactly what the
site needs: one origin, the methods and headers lib/api-client.ts uses, no
credentials. Local development adds its own origins in CORS_EXTRA_ORIGINS.
"""
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app

SITE = "https://kripax.inframiq.com"


async def _preflight(origin: str, method: str = "POST", headers: str = "authorization,content-type"):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        return await c.options(
            "/resumes",
            headers={"origin": origin, "access-control-request-method": method,
                     "access-control-request-headers": headers},
        )


async def test_the_site_may_call_the_api_without_credentials():
    r = await _preflight(SITE)
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == SITE
    assert "access-control-allow-credentials" not in r.headers
    assert {h.strip().lower() for h in r.headers["access-control-allow-headers"].split(",")} >= {"authorization", "content-type"}


@pytest.mark.parametrize("method", ["GET", "POST", "PUT", "PATCH", "DELETE"])
async def test_every_method_the_site_uses_is_allowed(method):
    r = await _preflight(SITE, method)
    assert r.status_code == 200


@pytest.mark.parametrize("origin", [
    # Dev servers: any page served on these ports of a visitor's own machine
    # used to be trusted by production.
    "http://localhost:3000",
    "http://localhost:3001",
    # The retired domain only 308-redirects now; if its DNS were ever left
    # dangling, whoever claimed it would inherit the trust.
    "https://resumebuilder.inframiq.com",
    "http://kripax.inframiq.com",
    "https://kripax.inframiq.com.evil.example",
    "https://evil.example",
    "https://kripax-preview-inframiq.vercel.app",
    "null",
])
async def test_other_origins_are_refused(origin):
    r = await _preflight(origin)
    assert r.status_code == 400
    assert "access-control-allow-origin" not in r.headers
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        simple = await c.get("/health", headers={"origin": origin})
    assert "access-control-allow-origin" not in simple.headers


@pytest.mark.parametrize("header", ["x-custom-header", "cookie", "x-forwarded-for"])
async def test_headers_the_site_never_sends_are_refused(header):
    r = await _preflight(SITE, headers=f"authorization,{header}")
    assert r.status_code == 400
    assert header not in r.headers.get("access-control-allow-headers", "").lower()


async def test_methods_the_site_never_uses_are_refused():
    r = await _preflight(SITE, method="TRACE")
    assert r.status_code == 400
