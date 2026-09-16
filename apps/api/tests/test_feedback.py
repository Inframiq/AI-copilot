import time
import uuid
from datetime import datetime, timezone
import jwt as pyjwt
import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import AsyncMock, MagicMock
from app.main import app
from app.core.config import settings
from app.db.session import get_db

TEST_USER_ID = "00000000-0000-0000-0000-000000000001"


def make_auth_header(email="test@test.com"):
    payload = {
        "sub": TEST_USER_ID,
        "email": email,
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

    async def _override():
        yield mock_session

    return _override, mock_session


@pytest.mark.asyncio
async def test_submit_feedback_returns_201():
    override, mock_session = make_mock_db()

    from app.db.models import Feedback

    created = Feedback(
        id=uuid.uuid4(),
        user_id=uuid.UUID(TEST_USER_ID),
        rating=5,
        comment="Love it",
        page="/dashboard",
        created_at=datetime.now(timezone.utc),
    )

    async def fake_refresh(obj):
        obj.id = created.id
        obj.created_at = created.created_at

    mock_session.refresh = fake_refresh

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.post(
                "/feedback",
                json={"rating": 5, "comment": "Love it", "page": "/dashboard"},
                headers=make_auth_header(),
            )
        assert r.status_code == 201
        body = r.json()
        assert body["rating"] == 5
        assert body["comment"] == "Love it"
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_submit_feedback_requires_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post("/feedback", json={"rating": 5})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_submit_feedback_rejects_out_of_range_rating():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post("/feedback", json={"rating": 6}, headers=make_auth_header())
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_list_feedback_forbidden_for_non_admin():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/feedback", headers=make_auth_header(email="nobody@example.com"))
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_list_feedback_returns_200_for_admin():
    override, mock_session = make_mock_db()
    mock_scalars = MagicMock()
    mock_scalars.all.return_value = []
    mock_result = MagicMock()
    mock_result.scalars.return_value = mock_scalars
    mock_session.execute.return_value = mock_result

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/feedback", headers=make_auth_header(email=settings.admin_emails.split(",")[0]))
        assert r.status_code == 200
        assert r.json() == []
    finally:
        app.dependency_overrides.pop(get_db, None)
