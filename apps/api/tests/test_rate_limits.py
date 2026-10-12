"""Rate limits (security review M6).

Per-user limits stop one account; the site-wide AI cap stops many — a swarm
of accounts can't saturate the OpenAI quota and stall the site for everyone.
"""
import ast
import time
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import jwt as pyjwt
import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import settings
from app.core.rate_limit import limiter
from app.db.session import get_db
from app.main import app

ROUTERS = Path(__file__).resolve().parents[1] / "app" / "routers"


def _token(sub: str) -> dict:
    payload = {"sub": sub, "email": f"{sub[:8]}@t.com", "aud": "authenticated",
               "app_metadata": {"provider": "google"}, "exp": int(time.time()) + 3600}
    return {"Authorization": f"Bearer {pyjwt.encode(payload, settings.supabase_jwt_secret, algorithm='HS256')}"}


@pytest.fixture
def nothing_found():
    """A database where every lookup comes back empty: requests pass the
    limiters, then stop at a 404 inside the route — no model, no charge."""
    session = MagicMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = None
    session.execute = AsyncMock(return_value=result)

    async def db():
        yield session

    app.dependency_overrides[get_db] = db
    limiter.reset()
    yield
    app.dependency_overrides.pop(get_db, None)
    limiter.reset()


def _routes_that_start_ai_work():
    """(file, function, decorators) for every route whose body spends credits
    or gets an AI provider."""
    for path in sorted(ROUTERS.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in tree.body:
            if not isinstance(node, ast.AsyncFunctionDef):
                continue
            is_route = any(
                isinstance(d, ast.Call) and isinstance(d.func, ast.Attribute)
                and isinstance(d.func.value, ast.Name) and d.func.value.id == "router"
                for d in node.decorator_list
            )
            body = ast.unparse(node)
            if is_route and ("spend_credits(" in body or "get_ai_provider(" in body):
                names = {d.id for d in node.decorator_list if isinstance(d, ast.Name)}
                yield path.name, node.name, names


def test_every_route_that_starts_ai_work_has_the_site_wide_cap():
    routes = list(_routes_that_start_ai_work())
    assert len(routes) >= 8  # analyze, tailor, rewrite, notes, cover letter, questions, generate, upload
    missing = [f"{f}:{fn}" for f, fn, names in routes if "ai_global_limit" not in names]
    assert not missing, f"AI routes without @ai_global_limit: {missing}"


async def test_the_cap_holds_across_different_users(monkeypatch, nothing_found, ledger):
    monkeypatch.setattr(settings, "ai_global_requests_per_minute", 3)
    body = {"resume_id": str(uuid.uuid4()), "jd_id": str(uuid.uuid4())}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        # Four different accounts, one request each: no per-user limit is near.
        codes = [
            (await c.post("/ai/tailor", json=body, headers=_token(str(uuid.uuid4())))).status_code
            for _ in range(4)
        ]
        refused = await c.post("/ai/tailor", json=body, headers=_token(str(uuid.uuid4())))
    assert codes[:3] == [404, 404, 404]
    assert codes[3] == 429
    assert refused.status_code == 429
    # In `detail`, where the web app reads errors, with no "Rate limit
    # exceeded:" prefix — and when to come back.
    assert refused.json() == {
        "detail": "AI features are busy right now. Try again in a minute — you weren't charged."
    }
    assert refused.headers["retry-after"] == "60"
    assert ledger.spent == []  # refused before anything was charged


async def test_an_ordinary_limit_says_to_wait(nothing_found):
    # Before: {"error": "Rate limit exceeded: 10 per 1 minute"}, which the
    # app couldn't read — every limit showed as a bare "Request failed".
    body = {"resume_id": str(uuid.uuid4()), "jd_id": str(uuid.uuid4())}
    headers = _token(str(uuid.uuid4()))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        for _ in range(10):
            await c.post("/ai/tailor", json=body, headers=headers)
        r = await c.post("/ai/tailor", json=body, headers=headers)
    assert r.status_code == 429
    assert r.json() == {"detail": "Too many requests — wait a minute and try again."}
    assert r.headers["retry-after"] == "60"


async def test_one_bucket_for_every_ai_route(monkeypatch, nothing_found):
    # Shared across routes, not per route: hammering a different AI action
    # doesn't get a fresh allowance.
    monkeypatch.setattr(settings, "ai_global_requests_per_minute", 2)
    tailor = {"resume_id": str(uuid.uuid4()), "jd_id": str(uuid.uuid4())}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        await c.post("/ai/tailor", json=tailor, headers=_token(str(uuid.uuid4())))
        await c.post("/ai/tailor", json=tailor, headers=_token(str(uuid.uuid4())))
        r = await c.post(f"/jd/{uuid.uuid4()}/prep-questions", headers=_token(str(uuid.uuid4())))
    assert r.status_code == 429


async def test_scoring_in_the_review_is_not_capped_at_60(nothing_found):
    # project-score had two stacked limits (60 and 120 a minute); both
    # applied, so the review's live score stopped at 60 despite the 120.
    body = {"session_id": str(uuid.uuid4())}
    headers = _token(str(uuid.uuid4()))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        codes = [(await c.post("/ai/project-score", json=body, headers=headers)).status_code for _ in range(61)]
    assert 429 not in codes


def test_counters_live_where_the_settings_say():
    # memory:// today; a shared store (redis://…) before running more than
    # one instance — see Settings.rate_limit_storage_uri.
    assert settings.rate_limit_storage_uri == "memory://"
    assert type(limiter._storage).__name__ == "MemoryStorage"
