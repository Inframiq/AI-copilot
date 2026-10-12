"""Save to JD pressed twice at once makes one résumé, not two (security review M4).

Save and Export together, or a double tap on Save, send two POST /resumes
with the same jd_id. Both used to see "no résumé linked to this JD yet" and
each create one. The JD row is now locked for the save, so the second waits
and then updates the résumé the first made.

Against a real Postgres: it's a row lock. To make the race happen every run
rather than by luck, the first request to reach "create a résumé" waits
(up to a second) for the other to get that far too. Without the lock both
get there and two résumés appear; with it the second is held at the JD.
"""
import asyncio
import time
import uuid
from contextlib import contextmanager
from unittest.mock import patch

import jwt as pyjwt
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import settings
from app.core.rate_limit import limiter
from app.db.models import JobDescription, Resume
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
        await conn.execute(text(
            "CREATE TABLE IF NOT EXISTS career_profiles (user_id uuid primary key, master_resume_id uuid)"
        ))
        await conn.execute(text(
            "TRUNCATE career_profiles, job_descriptions, resumes, tailoring_sessions, resume_deletion_log CASCADE"
        ))
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async def real_db():
        async with Session() as s:
            yield s

    app.dependency_overrides[get_db] = real_db
    limiter.reset()
    yield Session
    app.dependency_overrides.pop(get_db, None)
    await engine.dispose()


@contextmanager
def both_reach_create():
    """Hold the first request at "make a new résumé" until the second gets
    there too, or a second passes (it's been held at the JD lock)."""
    real = resumes_router._ensure_room_for_a_new_resume
    arrived = 0
    both = asyncio.Event()

    async def waiting(db, uid):
        nonlocal arrived
        arrived += 1
        if arrived >= 2:
            both.set()
        try:
            await asyncio.wait_for(both.wait(), timeout=1.0)
        except asyncio.TimeoutError:
            pass
        return await real(db, uid)

    with patch.object(resumes_router, "_ensure_room_for_a_new_resume", waiting):
        yield


async def _jd(Session, **kw):
    async with Session() as s:
        jd = JobDescription(user_id=USER, title="Backend @ Acme", raw_text="x", **kw)
        s.add(jd)
        await s.commit()
        return jd.id


async def _save(jd_id, title):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        return await c.post("/resumes", headers=auth(), json={"title": title, "content": {}, "jd_id": str(jd_id)})


async def _resumes(Session):
    async with Session() as s:
        return (await s.execute(select(Resume).where(Resume.user_id == USER))).scalars().all()


async def _link(Session, jd_id):
    async with Session() as s:
        return (await s.execute(select(JobDescription.tailored_resume_id).where(JobDescription.id == jd_id))).scalar_one()


async def test_two_saves_at_once_make_one_resume_and_link_it(Session):
    jd_id = await _jd(Session)
    with both_reach_create():
        a, b = await asyncio.gather(_save(jd_id, "first"), _save(jd_id, "second"))
    assert a.status_code in (200, 201) and b.status_code in (200, 201), (a.text, b.text)
    rows = await _resumes(Session)
    assert len(rows) == 1
    # Both requests answer with that one résumé, so either tab edits it.
    assert a.json()["id"] == b.json()["id"] == str(rows[0].id)
    assert await _link(Session, jd_id) == rows[0].id


async def test_a_jd_linked_to_the_main_resume_still_gets_just_one_copy(Session):
    # An older flow linked the profile's main résumé to the JD. A save never
    # overwrites it — it makes the JD its own copy — and two saves make one.
    async with Session() as s:
        main = Resume(user_id=USER, title="Main", content={}, template_id="ats_clean")
        s.add(main)
        await s.commit()
        await s.execute(text("INSERT INTO career_profiles (user_id, master_resume_id) VALUES (:u, :r)"),
                        {"u": str(USER), "r": str(main.id)})
        await s.commit()
    jd_id = await _jd(Session, tailored_resume_id=main.id)
    with both_reach_create():
        await asyncio.gather(_save(jd_id, "first"), _save(jd_id, "second"))
    rows = await _resumes(Session)
    copies = [r for r in rows if r.id != main.id]
    assert len(copies) == 1
    assert await _link(Session, jd_id) == copies[0].id
    assert next(r for r in rows if r.id == main.id).title == "Main"


async def test_a_save_refused_at_the_limit_leaves_the_jd_unlinked(Session):
    # The résumé and the JD's link to it are one commit: there is never a
    # link without its résumé, or a résumé the JD doesn't know about.
    async with Session() as s:
        for i in range(5):
            s.add(Resume(user_id=USER, title=f"R{i}", content={}, template_id="ats_clean"))
        await s.commit()
    jd_id = await _jd(Session)
    r = await _save(jd_id, "sixth")
    assert r.status_code == 409
    assert await _link(Session, jd_id) is None
    assert len(await _resumes(Session)) == 5


async def test_saving_again_later_updates_the_same_resume(Session):
    jd_id = await _jd(Session)
    first = await _save(jd_id, "first")
    again = await _save(jd_id, "again")
    assert first.json()["id"] == again.json()["id"]
    rows = await _resumes(Session)
    assert [r.title for r in rows] == ["again"]
