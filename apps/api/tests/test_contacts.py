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


def make_contact(**overrides):
    from app.db.models import ExternalContact
    from datetime import datetime, timezone

    defaults = dict(
        id=uuid.uuid4(),
        user_id=uuid.UUID(TEST_USER_ID),
        name="Sarah Chen",
        role="Engineering Manager",
        company="Google",
        status="new",
        notes="",
        email="",
        linkedin_url="",
        last_contact=datetime.now(timezone.utc),
        created_at=datetime.now(timezone.utc),
    )
    defaults.update(overrides)
    return ExternalContact(**defaults)


@pytest.mark.asyncio
async def test_list_contacts_requires_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/contacts")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_list_contacts_returns_200():
    override, mock_session = make_mock_db()
    mock_scalars = MagicMock()
    mock_scalars.all.return_value = []
    mock_result = MagicMock()
    mock_result.scalars.return_value = mock_scalars
    mock_session.execute.return_value = mock_result

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/contacts", headers=make_auth_header())
        assert r.status_code == 200
        assert r.json() == []
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_create_contact_returns_201():
    override, mock_session = make_mock_db()
    created = make_contact()

    async def fake_refresh(obj):
        obj.id = created.id
        obj.last_contact = created.last_contact
        obj.created_at = created.created_at

    mock_session.refresh = fake_refresh

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.post(
                "/contacts",
                json={"name": "Sarah Chen", "role": "Engineering Manager", "company": "Google"},
                headers=make_auth_header(),
            )
        assert r.status_code == 201
        body = r.json()
        assert body["name"] == "Sarah Chen"
        assert body["status"] == "new"
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_create_contact_requires_name_role_company():
    override, mock_session = make_mock_db()
    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.post("/contacts", json={"name": "", "role": "Eng", "company": "Acme"}, headers=make_auth_header())
        assert r.status_code == 422
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_update_contact_status_sets_status():
    override, mock_session = make_mock_db()
    contact = make_contact(status="new")
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = contact
    mock_session.execute.return_value = mock_result

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.patch(
                f"/contacts/{contact.id}/status",
                json={"status": "connected"},
                headers=make_auth_header(),
            )
        assert r.status_code == 200
        assert r.json()["status"] == "connected"
        assert contact.status == "connected"
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_delete_contact_204():
    override, mock_session = make_mock_db()
    contact = make_contact()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = contact
    mock_session.execute.return_value = mock_result

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.delete(f"/contacts/{contact.id}", headers=make_auth_header())
        assert r.status_code == 204
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_delete_contact_404_when_not_owned():
    override, mock_session = make_mock_db()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None
    mock_session.execute.return_value = mock_result

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.delete(f"/contacts/{uuid.uuid4()}", headers=make_auth_header())
        assert r.status_code == 404
    finally:
        app.dependency_overrides.pop(get_db, None)
