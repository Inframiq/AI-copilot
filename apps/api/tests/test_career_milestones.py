"""Career Path's user-added milestones (/career/milestones)."""
import time
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import jwt as pyjwt
import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import settings
from app.db.models import CareerMilestone
from app.db.session import get_db
from app.main import app

TEST_USER_ID = "00000000-0000-0000-0000-000000000001"


def auth():
    payload = {"sub": TEST_USER_ID, "email": "t@t.com", "aud": "authenticated", "exp": int(time.time()) + 3600}
    return {"Authorization": f"Bearer {pyjwt.encode(payload, settings.supabase_jwt_secret, algorithm='HS256')}"}


def mock_db():
    s = MagicMock()
    s.execute = AsyncMock()
    s.commit = AsyncMock()
    s.add = MagicMock()
    s.delete = AsyncMock()

    async def refresh(o):
        o.id = o.id or uuid.uuid4()
        o.created_at = o.created_at or datetime.now(timezone.utc)
        if o.done is None:
            o.done = False

    s.refresh = AsyncMock(side_effect=refresh)

    async def override():
        yield s

    return override, s


def milestone(**kw):
    fields = dict(
        id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID), title="Get AWS certified",
        description=None, done=False, created_at=datetime.now(timezone.utc),
    )
    return CareerMilestone(**{**fields, **kw})


def found(m):
    r = MagicMock()
    r.scalar_one_or_none.return_value = m
    return r


def counted(n):
    r = MagicMock()
    r.scalar_one.return_value = n
    return r


async def call(method, path, db_override, **kw):
    app.dependency_overrides[get_db] = db_override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            return await c.request(method, path, headers=auth(), **kw)
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_add_trims_and_stores_the_milestone():
    override, db = mock_db()
    db.execute.return_value = counted(0)
    r = await call("POST", "/career/milestones", override,
                   json={"title": "  Get AWS certified  ", "description": "   "})
    assert r.status_code == 201
    body = r.json()
    assert body["title"] == "Get AWS certified"
    assert body["description"] is None
    assert body["done"] is False
    added = db.add.call_args.args[0]
    assert added.user_id == uuid.UUID(TEST_USER_ID)


@pytest.mark.asyncio
async def test_add_refuses_a_blank_title():
    override, db = mock_db()
    r = await call("POST", "/career/milestones", override, json={"title": "   "})
    assert r.status_code == 422
    db.add.assert_not_called()


@pytest.mark.asyncio
async def test_add_stops_at_the_cap():
    from app.routers.career import MAX_MILESTONES
    override, db = mock_db()
    db.execute.return_value = counted(MAX_MILESTONES)
    r = await call("POST", "/career/milestones", override, json={"title": "One more"})
    assert r.status_code == 409
    db.add.assert_not_called()


@pytest.mark.asyncio
async def test_patch_marks_done_without_touching_the_rest():
    override, db = mock_db()
    m = milestone(description="Associate level")
    db.execute.return_value = found(m)
    r = await call("PATCH", f"/career/milestones/{m.id}", override, json={"done": True})
    assert r.status_code == 200
    assert r.json()["done"] is True
    assert m.title == "Get AWS certified" and m.description == "Associate level"


@pytest.mark.asyncio
async def test_patch_can_clear_the_description():
    override, db = mock_db()
    m = milestone(description="Associate level")
    db.execute.return_value = found(m)
    r = await call("PATCH", f"/career/milestones/{m.id}", override, json={"description": None})
    assert r.status_code == 200
    assert m.description is None


@pytest.mark.asyncio
async def test_someone_elses_milestone_is_not_found():
    override, db = mock_db()
    db.execute.return_value = found(None)  # the query is scoped to the caller
    r = await call("PATCH", f"/career/milestones/{uuid.uuid4()}", override, json={"done": True})
    assert r.status_code == 404
    r = await call("DELETE", f"/career/milestones/{uuid.uuid4()}", override)
    assert r.status_code == 404
    db.delete.assert_not_awaited()


@pytest.mark.asyncio
async def test_delete_removes_it():
    override, db = mock_db()
    m = milestone()
    db.execute.return_value = found(m)
    r = await call("DELETE", f"/career/milestones/{m.id}", override)
    assert r.status_code == 204
    db.delete.assert_awaited_once_with(m)


def test_account_deletion_wipes_milestones():
    import inspect
    from app.routers import me
    assert "CareerMilestone" in inspect.getsource(me.delete_my_account)
