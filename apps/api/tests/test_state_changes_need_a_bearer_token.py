"""A cross-site page cannot make the API change anything for a signed-in user
(test ATK-027).

CSRF works by riding credentials the browser attaches by itself: cookies,
or HTTP auth. The API takes neither. It knows the caller only from the
Authorization: Bearer header, which the browser never adds on its own and
which only the site's own scripts can set, and its CORS answer allows the
site's origin alone, without credentials. These tests pin the three parts:
every route that changes data needs the token, the API never reads a cookie,
and CORS stays closed to other sites."""
import ast
import pathlib

import pytest
from fastapi.routing import APIRoute
from httpx import ASGITransport, AsyncClient

from app.core.security import get_current_user
from app.main import app
from tests.test_admin_routes_guarded import _calls, _flatten

APP_DIR = pathlib.Path(__file__).parents[1] / "app"

# Changes data without signing in, on purpose: the deletion-request form is
# for people who often can't sign in, and it acts for no one's account.
PUBLIC_WRITES = {("POST", "/data-requests/deletion")}

WRITES = [
    (method, path, route, deps)
    for path, route, deps in _flatten(app.routes)
    if isinstance(route, APIRoute)
    for method in sorted(route.methods & {"POST", "PUT", "PATCH", "DELETE"})
]


@pytest.mark.parametrize("entry", WRITES, ids=lambda e: f"{e[0]} {e[1]}")
def test_every_route_that_changes_data_needs_the_token(entry):
    method, path, route, deps = entry
    if (method, path) in PUBLIC_WRITES:
        return
    assert get_current_user in _calls(route.dependant) | set(deps), f"{method} {path} runs without a sign-in token"


def test_the_public_writes_still_exist():
    assert PUBLIC_WRITES <= {(m, p) for m, p, _, _ in WRITES}


def test_the_api_never_reads_a_cookie():
    found = []
    for path in APP_DIR.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            name = node.attr if isinstance(node, ast.Attribute) else node.id if isinstance(node, ast.Name) else None
            if name in {"cookies", "Cookie", "APIKeyCookie"}:
                found.append(f"{path.relative_to(APP_DIR)}:{node.lineno}")
    assert found == []


@pytest.mark.parametrize("origin", ["https://evil.example", "null", "https://kripax.inframiq.com.evil.example"])
async def test_cors_refuses_other_sites(origin):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.options("/feedback", headers={
            "Origin": origin, "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        })
    assert r.headers.get("access-control-allow-origin") is None
    assert r.headers.get("access-control-allow-credentials") is None


async def test_cors_lets_the_site_in_without_credentials():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.options("/feedback", headers={
            "Origin": "https://kripax.inframiq.com", "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        })
    assert r.headers.get("access-control-allow-origin") == "https://kripax.inframiq.com"
    assert r.headers.get("access-control-allow-credentials") is None


async def test_a_cross_site_form_post_is_refused():
    # What an attacker's page sends: a plain form post, cookies and all, no token.
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post("/feedback", data={"comment": "ATK-027"}, headers={
            "Origin": "https://evil.example", "Cookie": "sb-access-token=anything",
        })
    assert r.status_code in (401, 403)
