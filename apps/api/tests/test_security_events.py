"""Every refused request leaves one security_event line in the log, with a
reason and never the token (test INF-004)."""
import logging
import time

import jwt as pyjwt
import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import settings
from app.core.rate_limit import limiter
from app.main import app

USER_ID = "00000000-0000-0000-0000-0000000000a1"


def _token(email: str = "nobody@example.com", *, expires_in: int = 3600, secret: str | None = None) -> str:
    payload = {
        "sub": USER_ID,
        "email": email,
        "aud": "authenticated",
        "app_metadata": {"provider": "google", "providers": ["google"]},
        "exp": int(time.time()) + expires_in,
    }
    return pyjwt.encode(payload, secret or settings.supabase_jwt_secret, algorithm="HS256")


async def _get(path: str, headers: dict | None = None, *, from_ip: str = "203.0.113.9"):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        return await c.get(path, headers={"X-Forwarded-For": from_ip, **(headers or {})})


def _events(caplog) -> list[str]:
    return [r.getMessage() for r in caplog.records if r.name == "app.security"]


@pytest.fixture
def caplog(caplog):
    caplog.set_level(logging.INFO, logger="app")
    return caplog


@pytest.mark.asyncio
async def test_no_token_is_recorded(caplog):
    r = await _get("/resumes")
    assert r.status_code == 401
    assert _events(caplog) == [
        "security_event=denied status=401 method=GET path=/resumes ip=203.0.113.9 user=- reason=missing_token"
    ]


@pytest.mark.asyncio
async def test_forged_token_is_recorded_without_the_token(caplog):
    forged = _token(secret="not-the-real-secret-but-long-enough-for-hs256")
    r = await _get("/resumes?draft=1", headers={"Authorization": f"Bearer {forged}"})
    assert r.status_code == 401
    events = _events(caplog)
    assert len(events) == 1
    assert "status=401" in events[0] and "reason=invalid_token" in events[0]
    # A forged token's claims are not believed: no user named.
    assert "user=-" in events[0]
    # Nothing secret anywhere in the log: not the token, not one of its
    # three parts, not the query string.
    logged = caplog.text
    assert forged not in logged
    for part in forged.split("."):
        assert part not in logged
    assert "Bearer" not in logged and "draft=1" not in logged


@pytest.mark.asyncio
async def test_expired_token_is_recorded(caplog):
    expired = _token(expires_in=-3600)
    r = await _get("/resumes", headers={"Authorization": f"Bearer {expired}"})
    assert r.status_code == 401
    assert "reason=expired_token" in _events(caplog)[0]
    assert expired not in caplog.text


@pytest.mark.asyncio
async def test_non_admin_on_admin_route_is_recorded_with_their_id(caplog):
    token = _token("nobody@example.com")
    r = await _get("/admin/users", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403
    (event,) = _events(caplog)
    assert f"status=403 method=GET path=/admin/users ip=203.0.113.9 user={USER_ID} reason=not_admin" in event
    # The id, never the email.
    assert "nobody@example.com" not in caplog.text
    assert token not in caplog.text


@pytest.mark.asyncio
async def test_admin_only_account_refusal_is_recorded(caplog):
    email = settings.admin_only_emails.split(",")[0].strip()
    r = await _get("/learning", headers={"Authorization": f"Bearer {_token(email)}"})
    assert r.status_code == 403
    assert "reason=admin_only_account" in _events(caplog)[0]
    assert email not in caplog.text


@pytest.mark.asyncio
async def test_rate_limited_request_is_recorded(caplog):
    # The public deletion form allows 5 an hour per address. The hidden
    # field is filled, so the route answers without touching the database.
    limiter.reset()
    bot = {"email": "a@example.com", "requester_type": "not_a_user", "website": "x"}
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            statuses = [
                (await c.post("/data-requests/deletion", json=bot,
                              headers={"X-Forwarded-For": "198.51.100.77"})).status_code
                for _ in range(6)
            ]
    finally:
        limiter.reset()
    assert statuses == [202] * 5 + [429]
    assert _events(caplog) == [
        "security_event=denied status=429 method=POST path=/data-requests/deletion "
        "ip=198.51.100.77 user=- reason=rate_limited"
    ]
    assert "a@example.com" not in caplog.text


@pytest.mark.asyncio
async def test_allowed_requests_leave_no_security_event(caplog):
    r = await _get("/health")
    assert r.status_code == 200
    assert _events(caplog) == []


@pytest.mark.asyncio
async def test_a_newline_in_the_path_cannot_forge_a_second_line(caplog):
    r = await _get("/resumes%0Asecurity_event=denied%20status=200")
    assert r.status_code in (401, 404)
    for event in _events(caplog):
        assert "\n" not in event


def test_app_info_lines_reach_the_log():
    """The app's own INFO lines (account deleted, résumé deleted) used to be
    dropped: uvicorn configures only its own loggers."""
    app_logger = logging.getLogger("app")
    assert app_logger.getEffectiveLevel() <= logging.INFO
    assert any(getattr(h, "_kripax", False) for h in app_logger.handlers)


# ── Test ATK-047: denied record access and repeated refusals ────────────────

@pytest.fixture
def no_records():
    """A database with no rows: every record lookup comes back empty, which
    is what another account's record looks like to the API."""
    from unittest.mock import AsyncMock, MagicMock

    from app.db.session import get_db

    session = MagicMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = None
    session.execute = AsyncMock(return_value=result)

    async def db():
        yield session

    app.dependency_overrides[get_db] = db
    yield
    app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_someone_elses_record_is_recorded_with_who_asked(caplog, no_records):
    token = _token()
    r = await _get("/resumes/11111111-2222-4333-8444-555555555555", {"Authorization": f"Bearer {token}"})
    assert r.status_code == 404
    assert _events(caplog) == [
        "security_event=refused status=404 method=GET "
        "path=/resumes/11111111-2222-4333-8444-555555555555 "
        f"ip=203.0.113.9 user={USER_ID} reason=not_found"
    ]
    assert token not in caplog.text


@pytest.mark.asyncio
async def test_a_malformed_request_is_recorded_without_its_body(caplog):
    token = _token()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post("/jd", json={"title": "SECRET-BODY-TEXT", "raw_text": 5},
                         headers={"Authorization": f"Bearer {token}", "X-Forwarded-For": "203.0.113.9"})
    assert r.status_code == 422
    assert _events(caplog) == [
        f"security_event=refused status=422 method=POST path=/jd ip=203.0.113.9 user={USER_ID} reason=invalid_request"
    ]
    assert "SECRET-BODY-TEXT" not in caplog.text and token not in caplog.text


def _alerts(caplog) -> list[str]:
    return [e for e in _events(caplog) if e.startswith("security_alert=")]


@pytest.mark.asyncio
async def test_a_run_of_refusals_raises_one_alert(caplog, no_records):
    from app.core import security_log

    headers = {"Authorization": f"Bearer {_token()}"}
    for i in range(security_log.ALERT_AFTER - 1):
        await _get(f"/resumes/00000000-0000-4000-8000-{i:012d}", headers)
    assert _alerts(caplog) == []  # the odd stale link is not an alert
    for i in range(security_log.ALERT_AFTER, security_log.ALERT_AFTER + 10):
        await _get(f"/resumes/00000000-0000-4000-8000-{i:012d}", headers)
    assert _alerts(caplog) == [
        f"security_alert=repeated_refusals source=user:{USER_ID} count={security_log.ALERT_AFTER} window=300s"
    ]
    alert = next(r for r in caplog.records if r.getMessage().startswith("security_alert="))
    assert alert.levelname == "ERROR"


@pytest.mark.asyncio
async def test_alerts_count_each_source_on_its_own(caplog):
    from app.core import security_log

    # Signed-out probes are counted by address.
    for i in range(security_log.ALERT_AFTER - 1):
        await _get("/resumes", from_ip="198.51.100.1")
        await _get("/resumes", from_ip="198.51.100.2")
    assert _alerts(caplog) == []
    await _get("/resumes", from_ip="198.51.100.2")
    assert _alerts(caplog) == [
        f"security_alert=repeated_refusals source=ip:198.51.100.2 count={security_log.ALERT_AFTER} window=300s"
    ]


@pytest.mark.asyncio
async def test_refusals_older_than_the_window_are_forgotten(caplog, monkeypatch):
    from app.core import security_log

    clock = [1000.0]
    monkeypatch.setattr(security_log.time, "monotonic", lambda: clock[0])
    for _ in range(security_log.ALERT_AFTER - 1):
        await _get("/resumes", from_ip="198.51.100.3")
    clock[0] += security_log.ALERT_WINDOW + 1
    await _get("/resumes", from_ip="198.51.100.3")
    assert _alerts(caplog) == []


# ── Download links for stored files (test ATK-052) ──────────────────────────

def _resume_with_files(**overrides):
    import uuid
    from datetime import datetime, timezone
    from app.db.models import Resume

    return Resume(
        id=uuid.uuid4(), user_id=uuid.UUID(USER_ID), title="Mine", content={}, template_id="ats_clean",
        pdf_url=f"resumes/{USER_ID}/r.pdf", original_file_path=f"resumes/{USER_ID}/r/original-x.pdf",
        original_file_name="cv.pdf", created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc),
        **overrides,
    )


@pytest.fixture
def stored_files(monkeypatch):
    from unittest.mock import AsyncMock, MagicMock
    from app.db.session import get_db
    from app.routers import resumes

    found = {"resume": _resume_with_files()}
    session = MagicMock()
    result = MagicMock()
    result.scalar_one_or_none.side_effect = lambda: found["resume"]
    session.execute = AsyncMock(return_value=result)

    async def _db():
        yield session

    app.dependency_overrides[get_db] = _db
    monkeypatch.setattr(resumes, "_supabase", lambda: None)
    monkeypatch.setattr(resumes, "get_signed_url", lambda path, client: f"https://storage.test/{path}?token=SIGNEDLINKSECRET")
    yield found
    app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["pdf", "original"])
async def test_a_download_link_handed_out_is_recorded_with_who_asked(caplog, stored_files, kind):
    r = await _get(f"/resumes/{stored_files['resume'].id}/{kind}", headers={"Authorization": f"Bearer {_token()}"})
    assert r.status_code == 200
    assert "SIGNEDLINKSECRET" in r.json()["signed_url"]
    assert _events(caplog) == [
        f"security_event=file_link status=200 method=GET path=/resumes/{stored_files['resume'].id}/{kind} "
        f"ip=203.0.113.9 user={USER_ID}"
    ]
    # The link is a working download for whoever holds it: never in the log.
    assert "SIGNEDLINKSECRET" not in caplog.text and "storage.test" not in caplog.text


@pytest.mark.asyncio
async def test_no_link_no_file_link_line(caplog, stored_files):
    stored_files["resume"] = None  # someone else's record, or none: 404
    r = await _get(f"/resumes/{_resume_with_files().id}/pdf", headers={"Authorization": f"Bearer {_token()}"})
    assert r.status_code == 404
    events = _events(caplog)
    assert len(events) == 1 and events[0].startswith("security_event=refused status=404")


@pytest.mark.asyncio
async def test_a_link_asked_for_without_signing_in_is_only_a_denial(caplog, stored_files):
    r = await _get(f"/resumes/{stored_files['resume'].id}/pdf")
    assert r.status_code == 401
    assert [e.split(" ")[0] for e in _events(caplog)] == ["security_event=denied"]
