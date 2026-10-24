"""Every admin route is behind require_admin, and nothing a caller sends can
stand in for it (test ATK-012).

Admin is decided only by the signed token: its email on the server's
allowlist, and Google in app_metadata.providers, which only the server can
write. Role fields in the body, query or headers, and the user-editable
user_metadata, carry no weight."""
import time
import uuid
from unittest.mock import MagicMock

import jwt as pyjwt
import pytest
from fastapi.routing import APIRoute
from httpx import ASGITransport, AsyncClient

from app.core.config import settings
from app.core.security import require_admin
from app.db.session import get_db
from app.main import app


def _flatten(routes, prefix="", include_deps=()):
    """(path as called, route, dependencies added at include time). FastAPI
    0.140 keeps each included router wrapped, with its include prefix and
    dependencies on the wrapper."""
    for r in routes:
        if isinstance(r, APIRoute):
            yield prefix + r.path, r, include_deps
        elif hasattr(r, "original_router"):
            ctx = r.include_context
            yield from _flatten(r.original_router.routes, prefix + (ctx.prefix or ""),
                                include_deps + tuple(d.dependency for d in ctx.dependencies))


def _calls(dependant) -> set:
    found = set()
    for dep in dependant.dependencies:
        found.add(dep.call)
        found |= _calls(dep)
    return found


def _method(route: APIRoute) -> str:
    return sorted(route.methods)[0]


ADMIN_ROUTES = [
    (path, route, deps) for path, route, deps in _flatten(app.routes)
    if path.startswith("/admin") or (path == "/feedback" and "GET" in route.methods)
]
_ids = lambda r: f"{_method(r[1])} {r[0]}"  # noqa: E731


def test_the_admin_routes_are_the_ones_the_dashboard_uses():
    # A new admin route lands in this list automatically and must pass the
    # guard check below; this list only makes the change visible.
    assert sorted((_method(route), path) for path, route, _ in ADMIN_ROUTES) == [
        ("GET", "/admin/deletion-requests"),
        ("GET", "/admin/users"),
        ("GET", "/feedback"),
        ("PATCH", "/admin/deletion-requests/{request_id}"),
        ("PATCH", "/admin/users/{user_id}/plan"),
        ("POST", "/admin/users/{user_id}/credits/refresh"),
    ]


@pytest.mark.parametrize("entry", ADMIN_ROUTES, ids=_ids)
def test_every_admin_route_depends_on_require_admin(entry):
    _, route, include_deps = entry
    assert require_admin in _calls(route.dependant) | set(include_deps)


def _token(email: str, *, providers=("google",), **extra) -> str:
    payload = {
        "sub": str(uuid.uuid4()),
        "email": email,
        "aud": "authenticated",
        "role": "authenticated",
        "app_metadata": {"provider": providers[0] if providers else None, "providers": list(providers)},
        "exp": int(time.time()) + 3600,
        **extra,
    }
    return pyjwt.encode(payload, settings.supabase_jwt_secret, algorithm="HS256")


ROLE_FIELDS_HEADERS = {"X-Role": "admin", "X-Admin": "true", "X-User-Role": "admin"}
ROLE_FIELDS_QUERY = {"role": "admin", "is_admin": "true", "admin": "1"}
ROLE_FIELDS_BODY = {"role": "admin", "is_admin": True, "admin": True, "permissions": ["admin"]}
BODIES = {"/admin/users/{user_id}/plan": {"plan": "premium"}, "/admin/deletion-requests/{request_id}": {"status": "completed"}}


async def _call(entry, token: str, *, tamper: bool) -> int:
    template, route, _ = entry
    path = template.replace("{user_id}", str(uuid.uuid4())).replace("{request_id}", str(uuid.uuid4()))
    method = _method(route)
    body = dict(BODIES.get(template, {}))
    headers = {"Authorization": f"Bearer {token}"}
    params = None
    if tamper:
        headers |= ROLE_FIELDS_HEADERS
        params = ROLE_FIELDS_QUERY
        body |= ROLE_FIELDS_BODY

    async def no_database():
        yield MagicMock()  # never reached: the guard answers first

    app.dependency_overrides[get_db] = no_database
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.request(method, path, headers=headers, params=params,
                                     json=body if method in ("PATCH", "POST") else None)
        return r.status_code
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
@pytest.mark.parametrize("entry", ADMIN_ROUTES, ids=_ids)
@pytest.mark.parametrize("tamper", [False, True], ids=["plain", "with role fields"])
async def test_a_normal_account_is_refused_with_or_without_role_fields(entry, tamper):
    token = _token("normal.user@example.com", user_metadata={"role": "admin", "is_admin": True})
    assert await _call(entry, token, tamper=tamper) == 403


@pytest.mark.asyncio
@pytest.mark.parametrize("entry", ADMIN_ROUTES, ids=_ids)
async def test_an_admin_address_never_proven_through_google_is_refused(entry):
    token = _token(settings.admin_emails.split(",")[0], providers=("email",))
    assert await _call(entry, token, tamper=True) == 403
