"""The 5-résumé limit (security review M2): refuse and ask, never delete.

Against a real Postgres: the limit check reads résumés, the profile's main
résumé (career_profiles) and JD links in one go, and these are exactly the
rows a mock would get wrong.
"""
import io
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
from app.db.models import JobDescription, Resume
from app.db.session import get_db
from app.main import app

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


async def _resumes(Session, n, *, user=USER):
    """n résumés, oldest first (R1 is the oldest)."""
    now = datetime.now(timezone.utc)
    ids = []
    async with Session() as s:
        for i in range(n):
            r = Resume(user_id=user, title=f"R{i + 1}", content={}, template_id="ats_clean",
                       updated_at=now - timedelta(days=n - i))
            s.add(r)
            await s.flush()
            ids.append(r.id)
        await s.commit()
    return ids


async def _count(Session):
    async with Session() as s:
        return len((await s.execute(select(Resume.id).where(Resume.user_id == USER))).all())


async def _post(path, **kw):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        return await c.post(path, headers=auth(), **kw)


async def test_a_fifth_resume_is_fine(Session):
    await _resumes(Session, 4)
    r = await _post("/resumes", json={"title": "New"})
    assert r.status_code == 201
    assert await _count(Session) == 5


async def test_a_sixth_is_refused_and_nothing_is_deleted(Session):
    ids = await _resumes(Session, 5)
    r = await _post("/resumes", json={"title": "New"})
    assert r.status_code == 409
    d = r.json()["detail"]
    assert d["code"] == "resume_limit" and d["limit"] == 5 and d["need"] == 1
    assert d["suggested"] == [str(ids[0])]  # the oldest
    assert [x["title"] for x in d["resumes"]] == ["R5", "R4", "R3", "R2", "R1"]  # newest first
    assert "Delete one to add another" in d["message"]
    assert await _count(Session) == 5  # nothing silently deleted


async def test_the_main_resume_and_jd_resumes_are_not_suggested(Session):
    ids = await _resumes(Session, 5)
    async with Session() as s:
        await s.execute(text("INSERT INTO career_profiles (user_id, master_resume_id) VALUES (:u, :r)"),
                        {"u": USER, "r": ids[0]})
        s.add(JobDescription(user_id=USER, title="Backend @ Acme", raw_text="x", tailored_resume_id=ids[1]))
        await s.commit()
    d = (await _post("/resumes", json={"title": "New"})).json()["detail"]
    assert d["suggested"] == [str(ids[2])]  # oldest that's neither
    by_id = {x["id"]: x for x in d["resumes"]}
    assert by_id[str(ids[0])]["is_master"] is True
    assert by_id[str(ids[1])]["jd_title"] == "Backend @ Acme"


async def test_when_every_resume_is_in_use_the_oldest_is_still_offered(Session):
    ids = await _resumes(Session, 5)
    async with Session() as s:
        for i, rid in enumerate(ids):
            s.add(JobDescription(user_id=USER, title=f"JD{i}", raw_text="x", tailored_resume_id=rid))
        await s.commit()
    d = (await _post("/resumes", json={"title": "New"})).json()["detail"]
    assert d["suggested"] == [str(ids[0])]


async def test_someone_already_over_the_limit_is_asked_to_delete_enough(Session):
    ids = await _resumes(Session, 6)  # possible before: protected résumés were never evicted
    d = (await _post("/resumes", json={"title": "New"})).json()["detail"]
    assert d["need"] == 2
    assert d["suggested"] == [str(ids[0]), str(ids[1])]
    assert "Delete 2 to add another" in d["message"]


async def test_deleting_one_then_retrying_succeeds(Session):
    ids = await _resumes(Session, 5)
    assert (await _post("/resumes", json={"title": "New"})).status_code == 409
    with patch("app.routers.resumes._supabase"):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            assert (await c.delete(f"/resumes/{ids[0]}", headers=auth())).status_code == 204
    assert (await _post("/resumes", json={"title": "New"})).status_code == 201
    assert await _count(Session) == 5


async def test_saving_again_to_a_jd_overwrites_its_resume_without_asking(Session):
    ids = await _resumes(Session, 5)
    async with Session() as s:
        jd = JobDescription(user_id=USER, title="JD", raw_text="x", tailored_resume_id=ids[4])
        s.add(jd)
        await s.commit()
    r = await _post("/resumes", json={"title": "Tailored again", "jd_id": str(jd.id)})
    assert r.status_code == 201
    assert r.json()["id"] == str(ids[4])  # updated in place — no new row, so no limit
    assert await _count(Session) == 5


async def test_an_upload_at_the_limit_is_refused_before_any_credit_or_storage(Session, ledger):
    await _resumes(Session, 5)
    with patch("app.routers.resumes._supabase") as sb, \
         patch("app.routers.resumes.parse_resume_text", new=AsyncMock()) as parse:
        r = await _post("/resumes/parse-upload",
                        files={"file": ("cv.pdf", io.BytesIO(b"%PDF-1.4 x"), "application/pdf")},
                        data={"template_id": "ats_clean"})
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "resume_limit"
    assert ledger.spent == []
    sb.return_value.storage.from_.return_value.upload.assert_not_called()
    parse.assert_not_awaited()


async def test_replacing_a_resume_by_upload_is_not_limited(Session, ledger):
    ids = await _resumes(Session, 5)
    with patch("app.routers.resumes._supabase"), \
         patch("app.routers.resumes.sandbox.extract_pdf_text", return_value="Jane Doe, engineer"), \
         patch("app.routers.resumes.parse_resume_text", new=AsyncMock(return_value={"contact": {"name": "Jane"}})):
        r = await _post("/resumes/parse-upload",
                        files={"file": ("cv.pdf", io.BytesIO(b"%PDF-1.4 x"), "application/pdf")},
                        data={"template_id": "ats_clean", "resume_id": str(ids[2])})
    assert r.status_code == 200
    assert ledger.spent == ["parse_resume"]


async def test_generating_at_the_limit_is_refused_before_any_credit(Session, ledger):
    await _resumes(Session, 5)
    with patch("app.routers.resumes.generate_resume", new=AsyncMock()) as gen:
        r = await _post("/resumes/generate",
                        json={"profile": {"name": "Jane"}, "candidate_type": "experienced", "template_id": "ats_clean"})
    assert r.status_code == 409
    assert ledger.spent == []
    gen.assert_not_awaited()


async def test_other_users_resumes_dont_count(Session):
    await _resumes(Session, 5, user=uuid.uuid4())
    assert (await _post("/resumes", json={"title": "New"})).status_code == 201
