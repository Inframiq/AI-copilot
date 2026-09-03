"""POST /ai/tailor rolling-30-day quota (settings.tailor_monthly_limit) and
GET /ai/sessions/{id}/questions lazy generation."""
import time
import uuid
import jwt as pyjwt
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.core.config import settings
from app.db.session import get_db
from app.db.models import Resume, JobDescription, TailoringSession, PrepQuestion

TEST_USER_ID = "00000000-0000-0000-0000-000000000001"


def make_auth_header():
    payload = {"sub": TEST_USER_ID, "email": "t@t.com", "aud": "authenticated",
               "exp": int(time.time()) + 3600}
    return {"Authorization": f"Bearer {pyjwt.encode(payload, settings.supabase_jwt_secret, algorithm='HS256')}"}


def make_mock_db():
    s = MagicMock()
    s.execute = AsyncMock()
    s.commit = AsyncMock()
    s.refresh = AsyncMock(side_effect=lambda o: setattr(o, "id", uuid.uuid4()))
    s.add = MagicMock()
    s.add_all = MagicMock()

    async def _override():
        yield s

    return _override, s


def make_resume():
    return Resume(id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID), title="R",
                  content={"experience": [], "skills": ["Python"]}, template_id="ats_clean")


def make_jd():
    return JobDescription(id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID),
                          title="Senior Engineer", raw_text="Need Python and AWS.")


class _BgCtx:
    """Stand-in for AsyncSessionLocal() used by _run_tailoring_background —
    its re-fetch of the session row returns None, so the background task
    exits cleanly right after the (mocked) pipeline call."""

    async def __aenter__(self):
        s = MagicMock()
        res = MagicMock()
        res.scalar_one_or_none.return_value = None
        s.execute = AsyncMock(return_value=res)
        s.commit = AsyncMock()
        s.add_all = MagicMock()
        return s

    async def __aexit__(self, *a):
        return False


# ── quota ────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_tailor_402_when_quota_reached():
    override, db = make_mock_db()
    resume, jd = make_resume(), make_jd()
    rr = MagicMock(); rr.scalar_one_or_none.return_value = resume
    jr = MagicMock(); jr.scalar_one_or_none.return_value = jd
    cr = MagicMock(); cr.scalar_one.return_value = 60
    db.execute = AsyncMock(side_effect=[rr, jr, cr])

    app.dependency_overrides[get_db] = override
    try:
        with patch.object(settings, "tailor_monthly_limit", 60):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                r = await c.post("/ai/tailor",
                                 json={"resume_id": str(resume.id), "jd_id": str(jd.id), "humanize_level": 50},
                                 headers=make_auth_header())
        assert r.status_code == 402
        assert "limit reached" in r.json()["detail"].lower()
        db.add.assert_not_called()
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_tailor_allowed_when_under_quota():
    override, db = make_mock_db()
    resume, jd = make_resume(), make_jd()
    rr = MagicMock(); rr.scalar_one_or_none.return_value = resume
    jr = MagicMock(); jr.scalar_one_or_none.return_value = jd
    cr = MagicMock(); cr.scalar_one.return_value = 12
    db.execute = AsyncMock(side_effect=[rr, jr, cr])
    db.add = MagicMock(side_effect=lambda o: setattr(o, "id", uuid.uuid4())
                       if isinstance(o, TailoringSession) and o.id is None else None)

    app.dependency_overrides[get_db] = override
    try:
        with patch.object(settings, "tailor_monthly_limit", 60), \
             patch("app.routers.ai.run_tailoring_pipeline", new=AsyncMock()), \
             patch("app.routers.ai.AsyncSessionLocal", new=lambda: _BgCtx()):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                r = await c.post("/ai/tailor",
                                 json={"resume_id": str(resume.id), "jd_id": str(jd.id), "humanize_level": 50},
                                 headers=make_auth_header())
        assert r.status_code == 202
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_tailor_quota_off_by_default_runs_no_count_query():
    override, db = make_mock_db()
    resume, jd = make_resume(), make_jd()
    rr = MagicMock(); rr.scalar_one_or_none.return_value = resume
    jr = MagicMock(); jr.scalar_one_or_none.return_value = jd
    db.execute = AsyncMock(side_effect=[rr, jr])
    db.add = MagicMock(side_effect=lambda o: setattr(o, "id", uuid.uuid4())
                       if isinstance(o, TailoringSession) and o.id is None else None)

    app.dependency_overrides[get_db] = override
    try:
        assert settings.tailor_monthly_limit == 0
        with patch("app.routers.ai.run_tailoring_pipeline", new=AsyncMock()), \
             patch("app.routers.ai.AsyncSessionLocal", new=lambda: _BgCtx()):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                r = await c.post("/ai/tailor",
                                 json={"resume_id": str(resume.id), "jd_id": str(jd.id), "humanize_level": 50},
                                 headers=make_auth_header())
        assert r.status_code == 202
        assert db.execute.await_count == 2
    finally:
        app.dependency_overrides.pop(get_db, None)


# ── lazy prep questions ──────────────────────────────────────────────────────

_AGENT1 = {
    "exact_technical_tools": ["Python"], "methodologies_and_frameworks": [],
    "domain_expertise_themes": [], "seniority_indicators": [], "ats_filter_phrases": [],
    "core_responsibilities": ["Own the pipeline"], "target_job_titles": ["Engineer"],
    "nice_to_have_skills": [], "importance": {},
}


@pytest.mark.asyncio
async def test_questions_generated_lazily_on_first_view_and_persisted():
    from app.services.tailoring import PrepQuestionData

    override, db = make_mock_db()
    sess = TailoringSession(id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID), jd_id=uuid.uuid4(),
                            status="completed", matched_skills=["Python"], missing_skills=["AWS"],
                            tailored_content={"experience": []})
    jd = make_jd(); jd.parsed = {"agent1": _AGENT1}
    sr = MagicMock(); sr.scalar_one_or_none.return_value = sess
    eq = MagicMock(); eq.scalars.return_value.all.return_value = []
    jr = MagicMock(); jr.scalar_one_or_none.return_value = jd
    db.execute = AsyncMock(side_effect=[sr, eq, jr])

    gen_out = [PrepQuestionData(topic="Technical", question="Tell me about the pipeline.",
                                answer_framework="STAR", is_gap_based=False, source="requirement",
                                basis="Own the pipeline", order_index=1)]
    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.ai.get_or_generate_prep_questions",
                   new=AsyncMock(return_value=gen_out)) as gen, \
             patch("app.routers.ai.get_ai_provider", return_value=MagicMock()):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                r = await c.get(f"/ai/sessions/{sess.id}/questions", headers=make_auth_header())
        assert r.status_code == 200
        assert [q["question"] for q in r.json()] == ["Tell me about the pipeline."]
        gen.assert_awaited_once()
        db.add_all.assert_called_once()
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_questions_return_existing_without_regenerating():
    override, db = make_mock_db()
    sess = TailoringSession(id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID),
                            jd_id=uuid.uuid4(), status="completed")
    existing = [PrepQuestion(id=uuid.uuid4(), session_id=sess.id, topic="Technical", question="Q1",
                             answer_framework="STAR", is_gap_based=False, source="requirement",
                             basis="x", order_index=1)]
    sr = MagicMock(); sr.scalar_one_or_none.return_value = sess
    qr = MagicMock(); qr.scalars.return_value.all.return_value = existing
    db.execute = AsyncMock(side_effect=[sr, qr])

    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.ai.get_or_generate_prep_questions", new=AsyncMock()) as gen:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                r = await c.get(f"/ai/sessions/{sess.id}/questions", headers=make_auth_header())
        assert r.status_code == 200
        assert len(r.json()) == 1
        gen.assert_not_awaited()
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_questions_empty_when_jd_has_no_cached_analysis():
    override, db = make_mock_db()
    sess = TailoringSession(id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID),
                            jd_id=uuid.uuid4(), status="completed")
    jd = make_jd(); jd.parsed = None
    sr = MagicMock(); sr.scalar_one_or_none.return_value = sess
    eq = MagicMock(); eq.scalars.return_value.all.return_value = []
    jr = MagicMock(); jr.scalar_one_or_none.return_value = jd
    db.execute = AsyncMock(side_effect=[sr, eq, jr])

    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.ai.get_or_generate_prep_questions", new=AsyncMock()) as gen:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                r = await c.get(f"/ai/sessions/{sess.id}/questions", headers=make_auth_header())
        assert r.status_code == 200
        assert r.json() == []
        gen.assert_not_awaited()
    finally:
        app.dependency_overrides.pop(get_db, None)
