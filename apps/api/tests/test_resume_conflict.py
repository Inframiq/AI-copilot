"""Two devices editing one résumé (security review M3): a stale save is refused.

Each save carries the résumé's updated_at as the device last saw it. If the
résumé has moved on since, the save is refused with 409 `resume_changed`
instead of silently overwriting the other device's work.

Against a real Postgres: the check has to hold when two saves land at once,
which is a row lock a mock can't show.
"""
import asyncio
import time
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import jwt as pyjwt
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import settings
from app.core.rate_limit import limiter
from app.db.models import Resume
from app.db.session import get_db
from app.main import app
from app.routers import resumes as resumes_router

USER = uuid.UUID("00000000-0000-0000-0000-000000000001")


def auth():
    payload = {"sub": str(USER), "email": "t@t.com", "aud": "authenticated", "exp": int(time.time()) + 3600}
    return {"Authorization": f"Bearer {pyjwt.encode(payload, settings.supabase_jwt_secret, algorithm='HS256')}"}


@pytest.fixture
async def Session(pg_uri):
    engine = create_async_engine(pg_uri)
    from app.db.session import Base
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(c, checkfirst=True))
        await conn.execute(text("TRUNCATE resumes CASCADE"))
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async def real_db():
        async with Session() as s:
            yield s

    app.dependency_overrides[get_db] = real_db
    limiter.reset()
    yield Session
    app.dependency_overrides.pop(get_db, None)
    await engine.dispose()


async def _resume(Session):
    async with Session() as s:
        r = Resume(user_id=USER, title="Mine", content={"summary": "original"}, template_id="ats_clean",
                   updated_at=datetime.now(timezone.utc) - timedelta(hours=1))
        s.add(r)
        await s.commit()
        return r.id, r.updated_at


async def _row(Session, rid):
    async with Session() as s:
        return (await s.execute(select(Resume).where(Resume.id == rid))).scalar_one()


async def _patch(rid, body):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        return await c.patch(f"/resumes/{rid}", headers=auth(), json=body)


async def test_a_save_from_the_current_version_goes_through(Session):
    rid, seen = await _resume(Session)
    r = await _patch(rid, {"content": {"summary": "edited"}, "expected_updated_at": seen.isoformat()})
    assert r.status_code == 200
    # The device carries this forward as the version it now has.
    assert datetime.fromisoformat(r.json()["updated_at"]) > seen
    assert (await _row(Session, rid)).content == {"summary": "edited"}


async def test_a_stale_save_is_refused_and_changes_nothing(Session):
    rid, seen = await _resume(Session)
    # The laptop saves first...
    laptop = await _patch(rid, {"content": {"summary": "laptop"}, "expected_updated_at": seen.isoformat()})
    assert laptop.status_code == 200
    # ...then the phone, still holding the version from before that.
    phone = await _patch(rid, {"content": {"summary": "phone"}, "expected_updated_at": seen.isoformat()})
    assert phone.status_code == 409
    detail = phone.json()["detail"]
    assert detail["code"] == "resume_changed"
    assert "another device" in detail["message"]
    # What the phone needs to "keep mine": the version it would overwrite.
    assert datetime.fromisoformat(detail["updated_at"]) == datetime.fromisoformat(laptop.json()["updated_at"])
    assert (await _row(Session, rid)).content == {"summary": "laptop"}


async def test_keep_mine_saves_over_the_version_it_was_shown(Session):
    rid, seen = await _resume(Session)
    await _patch(rid, {"content": {"summary": "laptop"}, "expected_updated_at": seen.isoformat()})
    refused = await _patch(rid, {"content": {"summary": "phone"}, "expected_updated_at": seen.isoformat()})
    current = refused.json()["detail"]["updated_at"]
    r = await _patch(rid, {"content": {"summary": "phone"}, "expected_updated_at": current})
    assert r.status_code == 200
    assert (await _row(Session, rid)).content == {"summary": "phone"}


async def test_a_save_without_a_version_still_saves(Session):
    # A tab opened before this shipped sends no version; it keeps working.
    rid, _ = await _resume(Session)
    r = await _patch(rid, {"content": {"summary": "old tab"}})
    assert r.status_code == 200
    assert (await _row(Session, rid)).content == {"summary": "old tab"}


async def test_a_version_without_a_timezone_is_read_as_utc(Session):
    rid, seen = await _resume(Session)
    naive = seen.astimezone(timezone.utc).replace(tzinfo=None).isoformat()
    r = await _patch(rid, {"content": {"summary": "edited"}, "expected_updated_at": naive})
    assert r.status_code == 200


async def test_two_saves_from_one_version_at_once_only_one_wins(Session):
    rid, seen = await _resume(Session)
    a, b = await asyncio.gather(
        _patch(rid, {"content": {"summary": "a"}, "expected_updated_at": seen.isoformat()}),
        _patch(rid, {"content": {"summary": "b"}, "expected_updated_at": seen.isoformat()}),
    )
    assert sorted([a.status_code, b.status_code]) == [200, 409]
    winner = a if a.status_code == 200 else b
    assert (await _row(Session, rid)).content == winner.json()["content"]


async def test_recording_an_exported_pdf_is_not_an_edit(Session):
    # It runs after the export responds; if it moved updated_at, the device's
    # next autosave would be refused as if another device had edited.
    rid, seen = await _resume(Session)
    with patch.object(resumes_router, "upload_pdf", AsyncMock(return_value="u/r.pdf")), \
         patch.object(resumes_router, "_supabase", return_value=None), \
         patch.object(resumes_router, "AsyncSessionLocal", Session):
        await resumes_router._persist_pdf_to_storage(b"%PDF", str(USER), rid)
    row = await _row(Session, rid)
    assert row.pdf_url == "u/r.pdf"
    assert row.updated_at == seen


async def test_an_export_that_saves_settings_returns_the_new_version(Session):
    # Exporting with a new template saves it; the device needs the version
    # that produced, or its next autosave would be refused.
    rid, seen = await _resume(Session)
    with patch.object(resumes_router, "generate_pdf_with_meta", return_value=(b"%PDF", {})), \
         patch.object(resumes_router, "_persist_pdf_to_storage", AsyncMock()):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            r = await c.post(f"/resumes/{rid}/pdf", headers=auth(), json={"template_id": "ats_modern"})
    assert r.status_code == 200, r.text
    row = await _row(Session, rid)
    assert row.template_id == "ats_modern"
    assert datetime.fromisoformat(r.json()["updated_at"]) == row.updated_at
    assert row.updated_at > seen
