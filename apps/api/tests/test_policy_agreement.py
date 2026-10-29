"""A feature that needs agreement to a newer policy is refused, on the server,
until the user has agreed — the in-app prompt alone can be beaten by a fast
click, a failed check or a direct API call."""
import pathlib
import re
from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest
from fastapi import Depends, FastAPI
from httpx import ASGITransport, AsyncClient

from app.core import policy
from app.core.policy import POLICY_UPDATE_REQUIRED, require_agreement
from app.core.security import get_current_user
from app.db.models import PolicyAcceptance
from app.db.session import get_db
from tests.test_routers import TEST_USER_ID, make_mock_db


def _app(dependency) -> tuple[FastAPI, object]:
    app = FastAPI()

    @app.post("/feature", dependencies=[Depends(dependency)])
    async def feature():
        return {"ran": True}

    override, session = make_mock_db()
    app.dependency_overrides[get_db] = override
    app.dependency_overrides[get_current_user] = lambda: {"sub": TEST_USER_ID}
    return app, session


def _agreed(terms: str, privacy: str) -> PolicyAcceptance:
    return PolicyAcceptance(
        terms_version=terms, privacy_version=privacy, accepted_at=datetime(2026, 9, 19, tzinfo=timezone.utc)
    )


async def _post(app: FastAPI):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        return await client.post("/feature")


@pytest.mark.asyncio
async def test_refused_when_the_user_never_agreed():
    app, session = _app(require_agreement(terms="2026-09-19"))
    session.get = AsyncMock(return_value=None)
    r = await _post(app)
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == POLICY_UPDATE_REQUIRED


@pytest.mark.asyncio
async def test_refused_when_the_agreement_is_older_than_the_feature_needs(monkeypatch):
    monkeypatch.setattr(policy, "TERMS_VERSION", "2027-01-10")
    app, session = _app(require_agreement(terms="2027-01-10"))
    session.get = AsyncMock(return_value=_agreed("2026-09-19", "2026-09-19"))
    r = await _post(app)
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == POLICY_UPDATE_REQUIRED


@pytest.mark.asyncio
async def test_runs_once_the_user_has_agreed_to_that_version_or_later():
    app, session = _app(require_agreement(terms="2026-09-19", privacy="2026-09-19"))
    session.get = AsyncMock(return_value=_agreed("2026-09-19", "2026-09-19"))
    r = await _post(app)
    assert r.status_code == 200 and r.json() == {"ran": True}


@pytest.mark.asyncio
async def test_checks_each_policy_on_its_own(monkeypatch):
    monkeypatch.setattr(policy, "PRIVACY_VERSION", "2027-01-10")
    app, session = _app(require_agreement(privacy="2027-01-10"))
    # Newer Terms don't stand in for the Privacy Policy.
    session.get = AsyncMock(return_value=_agreed("2027-01-10", "2026-09-19"))
    assert (await _post(app)).status_code == 403


def test_a_feature_cannot_ask_for_a_version_that_does_not_exist_yet():
    with pytest.raises(ValueError):
        require_agreement(terms="2999-01-01")


def test_server_versions_match_the_web_apps():
    # The web app asks for agreement to its versions; the server checks
    # against its own. If they drift, the prompt and the refusal disagree.
    web = (pathlib.Path(__file__).parents[2] / "web/lib/legal-versions.ts").read_text("utf8")
    found = dict(re.findall(r'export const (TERMS_VERSION|PRIVACY_VERSION) = "([^"]+)"', web))
    assert found == {"TERMS_VERSION": policy.TERMS_VERSION, "PRIVACY_VERSION": policy.PRIVACY_VERSION}
