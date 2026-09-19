"""Deletion requests from people who can't use Account -> Delete account."""
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import settings
from app.core.rate_limit import limiter
from app.db.models import DeletionRequest
from app.db.session import get_db
from app.main import app
from tests.test_feedback import make_auth_header, make_mock_db

ADMIN = settings.admin_emails.split(",")[0]
VALID = {"email": "Jane@Example.com", "name": " Jane ", "requester_type": "not_a_user", "details": "Remove me"}


@pytest.fixture(autouse=True)
def _fresh_rate_limit():
    limiter.reset()
    yield
    limiter.reset()


async def _post(json):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        return await client.post("/data-requests/deletion", json=json)


@pytest.mark.asyncio
async def test_anyone_can_ask_without_signing_in():
    override, session = make_mock_db()
    app.dependency_overrides[get_db] = override
    try:
        r = await _post(VALID)
        assert r.status_code == 202
        stored = session.add.call_args.args[0]
        assert isinstance(stored, DeletionRequest)
        assert stored.email == "jane@example.com"
        assert stored.name == "Jane"
        assert stored.requester_type == "not_a_user"
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_a_bot_filling_the_hidden_field_is_told_yes_and_ignored():
    override, session = make_mock_db()
    app.dependency_overrides[get_db] = override
    try:
        r = await _post({**VALID, "website": "http://spam.example"})
        assert r.status_code == 202
        session.add.assert_not_called()
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_a_malformed_request_is_refused():
    assert (await _post({**VALID, "email": "not-an-email"})).status_code == 422
    assert (await _post({**VALID, "requester_type": "someone"})).status_code == 422
    assert (await _post({**VALID, "details": "x" * 2001})).status_code == 422


@pytest.mark.asyncio
async def test_requests_are_rate_limited():
    override, _ = make_mock_db()
    app.dependency_overrides[get_db] = override
    try:
        codes = [(await _post(VALID)).status_code for _ in range(6)]
        assert codes[:5] == [202] * 5
        assert codes[5] == 429
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_only_admins_see_requests():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/admin/deletion-requests", headers=make_auth_header(email="nobody@example.com"))
    assert r.status_code == 403


def _stored(**overrides):
    return DeletionRequest(**{
        "id": uuid.uuid4(), "email": "jane@example.com", "name": "Jane",
        "requester_type": "account_holder", "details": None, "status": "open",
        "resolution_note": None, "created_at": datetime.now(timezone.utc), "resolved_at": None,
        **overrides,
    })


@pytest.mark.asyncio
async def test_admins_see_whether_the_email_has_an_account():
    override, session = make_mock_db()
    result = MagicMock()
    result.scalars.return_value.all.return_value = [_stored(), _stored(email="ghost@example.com")]
    session.execute = AsyncMock(return_value=result)
    app.dependency_overrides[get_db] = override
    try:
        users = [SimpleNamespace(email="Jane@example.com")]
        with patch("app.routers.data_requests.list_all_auth_users", return_value=users):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                r = await client.get("/admin/deletion-requests", headers=make_auth_header(email=ADMIN))
        assert r.status_code == 200
        assert [row["has_account"] for row in r.json()] == [True, False]
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_closing_a_request_records_when_and_why():
    override, session = make_mock_db()
    item = _stored()
    session.get = AsyncMock(return_value=item)
    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.data_requests.list_all_auth_users", return_value=[]):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                r = await client.patch(
                    f"/admin/deletion-requests/{item.id}",
                    json={"status": "completed", "resolution_note": "Deleted account after email check"},
                    headers=make_auth_header(email=ADMIN),
                )
        assert r.status_code == 200
        assert item.status == "completed"
        assert item.resolution_note == "Deleted account after email check"
        assert item.resolved_at is not None
    finally:
        app.dependency_overrides.pop(get_db, None)
