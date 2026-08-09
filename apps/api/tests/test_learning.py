import time
import uuid
import jwt as pyjwt
import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import AsyncMock, MagicMock
from app.main import app
from app.core.config import settings
from app.db.session import get_db

TEST_USER_ID = "00000000-0000-0000-0000-000000000001"


def make_auth_header():
    payload = {
        "sub": TEST_USER_ID,
        "email": "test@test.com",
        "aud": "authenticated",
        "exp": int(time.time()) + 3600,
    }
    token = pyjwt.encode(payload, settings.supabase_jwt_secret, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def make_mock_db():
    mock_session = MagicMock()
    mock_session.execute = AsyncMock()
    mock_session.commit = AsyncMock()
    mock_session.refresh = AsyncMock()
    mock_session.add = MagicMock()
    mock_session.delete = AsyncMock()

    async def _override():
        yield mock_session

    return _override, mock_session


@pytest.mark.asyncio
async def test_add_learning_item_returns_201():
    override, mock_session = make_mock_db()

    from app.db.models import LearningItem
    from datetime import datetime, timezone

    created = LearningItem(
        id=uuid.uuid4(),
        user_id=uuid.UUID(TEST_USER_ID),
        skill="GraphQL",
        source_jd_title="Senior Backend Engineer",
        status="not_started",
        created_at=datetime.now(timezone.utc),
    )

    async def fake_refresh(obj):
        obj.id = created.id
        obj.status = created.status
        obj.created_at = created.created_at

    mock_session.refresh = fake_refresh

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.post(
                "/learning",
                json={"skill": "GraphQL", "source_jd_title": "Senior Backend Engineer"},
                headers=make_auth_header(),
            )
        assert r.status_code == 201
        body = r.json()
        assert body["skill"] == "GraphQL"
        assert body["status"] == "not_started"
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_list_learning_items_requires_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/learning")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_list_learning_items_returns_200():
    override, mock_session = make_mock_db()
    mock_scalars = MagicMock()
    mock_scalars.all.return_value = []
    mock_result = MagicMock()
    mock_result.scalars.return_value = mock_scalars
    mock_session.execute.return_value = mock_result

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/learning", headers=make_auth_header())
        assert r.status_code == 200
        assert r.json() == []
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_update_learning_item_404_when_not_found():
    override, mock_session = make_mock_db()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None
    mock_session.execute.return_value = mock_result

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.patch(
                f"/learning/{uuid.uuid4()}",
                json={"status": "done"},
                headers=make_auth_header(),
            )
        assert r.status_code == 404
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_update_learning_item_sets_status():
    override, mock_session = make_mock_db()
    from app.db.models import LearningItem
    from datetime import datetime, timezone

    existing = LearningItem(
        id=uuid.uuid4(),
        user_id=uuid.UUID(TEST_USER_ID),
        skill="Kubernetes",
        source_jd_title=None,
        status="not_started",
        created_at=datetime.now(timezone.utc),
    )
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = existing
    mock_session.execute.return_value = mock_result

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.patch(
                f"/learning/{existing.id}",
                json={"status": "learning"},
                headers=make_auth_header(),
            )
        assert r.status_code == 200
        assert r.json()["status"] == "learning"
        assert existing.status == "learning"
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_delete_learning_item_204():
    override, mock_session = make_mock_db()
    from app.db.models import LearningItem
    from datetime import datetime, timezone

    existing = LearningItem(
        id=uuid.uuid4(),
        user_id=uuid.UUID(TEST_USER_ID),
        skill="Rust",
        source_jd_title=None,
        status="not_started",
        created_at=datetime.now(timezone.utc),
    )
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = existing
    mock_session.execute.return_value = mock_result

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.delete(f"/learning/{existing.id}", headers=make_auth_header())
        assert r.status_code == 204
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_delete_learning_item_404_when_not_owned():
    override, mock_session = make_mock_db()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None
    mock_session.execute.return_value = mock_result

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.delete(f"/learning/{uuid.uuid4()}", headers=make_auth_header())
        assert r.status_code == 404
    finally:
        app.dependency_overrides.pop(get_db, None)
