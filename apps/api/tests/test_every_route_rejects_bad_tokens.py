"""Every route that isn't public refuses a missing, expired or malformed
token the same way, with nothing but a 401 (test ATK-054).

test_state_changes_need_a_bearer_token covers the routes that change data;
this covers every route, reads included, and calls each one for real with
each kind of bad token, so a route added without get_current_user, or a
token check that falls back to some default user, fails the build."""
import base64
import json
import re
import time
import uuid

import jwt as pyjwt
import pytest
from fastapi.routing import APIRoute
from httpx import ASGITransport, AsyncClient

from app.core.config import settings
from app.core.security import get_current_user
from app.main import app
from tests.test_admin_routes_guarded import _calls, _flatten

# Open without signing in, on purpose: the health check, the public price
# list, and the deletion-request form for people who can't sign in.
PUBLIC = {("GET", "/health"), ("GET", "/plans"), ("POST", "/data-requests/deletion")}

ROUTES = [
    (method, path, route, deps)
    for path, route, deps in _flatten(app.routes)
    if isinstance(route, APIRoute)
    for method in sorted(route.methods - {"HEAD", "OPTIONS"})
]
PROTECTED = [(m, p) for m, p, _, _ in ROUTES if (m, p) not in PUBLIC]


def _b64(obj) -> str:
    return base64.urlsafe_b64encode(json.dumps(obj).encode()).rstrip(b"=").decode()


def _signed(**claims) -> str:
    payload = {"sub": str(uuid.uuid4()), "aud": "authenticated", "role": "authenticated",
               "exp": int(time.time()) + 3600, "session_id": str(uuid.uuid4()), **claims}
    return pyjwt.encode(payload, settings.supabase_jwt_secret, algorithm="HS256")


ADMIN = (settings.admin_emails.split(",")[0].strip() or "admin@example.com")
BAD = {
    "no header": None,
    "empty bearer": "Bearer ",
    "not a token": "Bearer not-a-token",
    "wrong scheme": "Basic " + base64.b64encode(b"admin:admin").decode(),
    "expired": "Bearer " + _signed(exp=int(time.time()) - 3600),
    "wrong audience": "Bearer " + _signed(aud="service_role"),
    "wrong signature": "Bearer " + pyjwt.encode(
        {"sub": str(uuid.uuid4()), "aud": "authenticated", "exp": int(time.time()) + 3600, "email": ADMIN},
        "not-the-real-secret-but-long-enough-for-hs256", algorithm="HS256"),
    "alg none, admin and service role": "Bearer " + _b64({"alg": "none", "typ": "JWT"}) + "." + _b64(
        {"sub": str(uuid.uuid4()), "aud": "authenticated", "role": "service_role", "email": ADMIN,
         "app_metadata": {"providers": ["google"]}, "exp": int(time.time()) + 3600}) + ".",
    "token cut short": "Bearer " + ".".join(_signed().split(".")[:2]),
}


def test_only_the_public_routes_run_without_the_token():
    open_routes = {
        (m, p) for m, p, route, deps in ROUTES
        if get_current_user not in _calls(route.dependant) | set(deps)
    }
    assert open_routes == PUBLIC


def test_the_scan_sees_the_routes():
    assert len(PROTECTED) >= 50


def _url(path: str) -> str:
    return re.sub(r"\{[^}]+\}", str(uuid.uuid4()), path)


@pytest.mark.parametrize("kind", list(BAD))
async def test_every_protected_route_refuses_a_bad_token_with_nothing_but_a_401(kind):
    header = BAD[kind]
    wrong = []
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        for method, path in PROTECTED:
            r = await c.request(method, _url(path), headers={"Authorization": header} if header else {})
            body = r.json() if r.headers.get("content-type", "").startswith("application/json") else r.text
            if r.status_code != 401 or body not in ({"detail": "Not authenticated"}, {"detail": "Invalid token"}, {"detail": "Token expired"}):
                wrong.append(f"{method} {path}: {r.status_code} {str(body)[:80]}")
    assert wrong == [], f"{kind}: " + "; ".join(wrong)
