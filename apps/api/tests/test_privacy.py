"""What the app keeps about a user, and what it lets go of."""
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.db.session import get_db
from app.main import app
from tests.test_routers import make_auth_header, make_mock_db


@pytest.mark.asyncio
async def test_policy_acceptance_reads_back_as_nulls_before_any_agreement():
    override, session = make_mock_db()
    session.get = AsyncMock(return_value=None)
    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/me/policy-acceptance", headers=make_auth_header())
        assert r.status_code == 200
        assert r.json() == {"terms_version": None, "privacy_version": None, "accepted_at": None}
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_policy_acceptance_reads_back_the_versions_agreed_to():
    from app.db.models import PolicyAcceptance

    override, session = make_mock_db()
    session.get = AsyncMock(return_value=PolicyAcceptance(
        terms_version="2026-09-19", privacy_version="2026-09-19",
        accepted_at=datetime(2026, 9, 19, tzinfo=timezone.utc),
    ))
    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/me/policy-acceptance", headers=make_auth_header())
        assert r.json()["terms_version"] == "2026-09-19"
        assert r.json()["privacy_version"] == "2026-09-19"
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_deleting_an_account_deletes_its_feedback_too():
    override, session = make_mock_db()
    empty = MagicMock()
    empty.all.return_value = []
    empty.scalars.return_value.all.return_value = []
    session.execute = AsyncMock(return_value=empty)
    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.me._supabase", return_value=MagicMock()):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                r = await client.delete("/me", headers=make_auth_header())
        assert r.status_code == 204
        deleted_from = {
            getattr(getattr(call.args[0], "table", None), "name", None)
            for call in session.execute.call_args_list
        }
        assert "feedback" in deleted_from
        assert "policy_acceptances" in deleted_from
    finally:
        app.dependency_overrides.pop(get_db, None)
