"""POST /ai/tailor credit gate (app.core.credits.spend_credits) and
interview prep questions (made by Save to JD, never by viewing)."""
import time
import uuid
import jwt as pyjwt
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.core.config import settings
from app.db.session import get_db
from app.db.models import Resume, JobDescription, TailoringSession, PrepQuestion, Subscription
from tests.test_jd_and_tailor_endpoints import no_previous_run

TEST_USER_ID = "00000000-0000-0000-0000-000000000001"


def make_auth_header():
    payload = {"sub": TEST_USER_ID, "email": "t@t.com", "aud": "authenticated",
               "exp": int(time.time()) + 3600}
    return {"Authorization": f"Bearer {pyjwt.encode(payload, settings.supabase_jwt_secret, algorithm='HS256')}"}


def make_mock_db():
    s = MagicMock()
    s.execute = AsyncMock()
    s.commit = AsyncMock()
    s.flush = AsyncMock()
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


# ── credit gate ──────────────────────────────────────────────────────────────


def _sub(credits, status="active", allotment=50):
    return Subscription(id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID), plan="free",
                        status=status, credits_remaining=credits, credits_allotment=allotment,
                        current_period_end=None)


@pytest.mark.asyncio
async def test_tailor_402_when_out_of_credits():
    override, db = make_mock_db()
    resume, jd = make_resume(), make_jd()
    rr = MagicMock(); rr.scalar_one_or_none.return_value = resume
    jr = MagicMock(); jr.scalar_one_or_none.return_value = jd
    sr = MagicMock(); sr.scalar_one_or_none.return_value = _sub(credits=4)  # < 10
    db.execute = AsyncMock(side_effect=[rr, jr, no_previous_run(), sr])

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            r = await c.post("/ai/tailor",
                             json={"resume_id": str(resume.id), "jd_id": str(jd.id), "humanize_level": 50},
                             headers=make_auth_header())
        assert r.status_code == 402
        assert "out of credits" in r.json()["detail"].lower()
        db.add.assert_not_called()  # no tailoring session row created
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_tailor_deducts_credits_and_proceeds_when_balance_ok():
    override, db = make_mock_db()
    resume, jd = make_resume(), make_jd()
    sub = _sub(credits=50)
    rr = MagicMock(); rr.scalar_one_or_none.return_value = resume
    jr = MagicMock(); jr.scalar_one_or_none.return_value = jd
    sr = MagicMock(); sr.scalar_one_or_none.return_value = sub
    db.execute = AsyncMock(side_effect=[rr, jr, no_previous_run(), sr])
    db.add = MagicMock(side_effect=lambda o: setattr(o, "id", uuid.uuid4())
                       if isinstance(o, TailoringSession) and o.id is None else None)

    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.ai.run_tailoring_pipeline", new=AsyncMock()), \
             patch("app.routers.ai.AsyncSessionLocal", new=lambda: _BgCtx()):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                r = await c.post("/ai/tailor",
                                 json={"resume_id": str(resume.id), "jd_id": str(jd.id), "humanize_level": 50},
                                 headers=make_auth_header())
        assert r.status_code == 202
        assert sub.credits_remaining == 40  # 50 - CREDIT_COSTS["tailor"]
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_tailor_creates_a_free_subscription_on_first_use():
    override, db = make_mock_db()
    resume, jd = make_resume(), make_jd()
    rr = MagicMock(); rr.scalar_one_or_none.return_value = resume
    jr = MagicMock(); jr.scalar_one_or_none.return_value = jd
    sr = MagicMock(); sr.scalar_one_or_none.return_value = None  # no subscription yet
    db.execute = AsyncMock(side_effect=[rr, jr, no_previous_run(), sr])
    added = []
    db.add = MagicMock(side_effect=lambda o: (added.append(o),
        setattr(o, "id", uuid.uuid4()) if isinstance(o, TailoringSession) and o.id is None else None))
    db.flush = AsyncMock()

    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.ai.run_tailoring_pipeline", new=AsyncMock()), \
             patch("app.routers.ai.AsyncSessionLocal", new=lambda: _BgCtx()):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                r = await c.post("/ai/tailor",
                                 json={"resume_id": str(resume.id), "jd_id": str(jd.id), "humanize_level": 50},
                                 headers=make_auth_header())
        assert r.status_code == 202
        subs = [o for o in added if isinstance(o, Subscription)]
        assert len(subs) == 1 and subs[0].plan == "free"
        assert subs[0].credits_remaining == 40  # 50 free grant - 10
    finally:
        app.dependency_overrides.pop(get_db, None)


# ── prep questions: made by Save to JD, never by viewing ─────────────────────

_AGENT1 = {
    "exact_technical_tools": ["Python"], "methodologies_and_frameworks": [],
    "domain_expertise_themes": [], "seniority_indicators": [], "ats_filter_phrases": [],
    "core_responsibilities": ["Own the pipeline"], "target_job_titles": ["Engineer"],
    "nice_to_have_skills": [], "importance": {},
}


def _gen_out():
    from app.services.tailoring import PrepQuestionData
    return [PrepQuestionData(topic="Technical", question="Tell me about the pipeline.",
                             answer_framework="STAR", is_gap_based=False, source="requirement",
                             basis="Own the pipeline", order_index=1)]


def _scalars(rows):
    r = MagicMock()
    r.scalars.return_value.all.return_value = rows
    return r


@pytest.mark.asyncio
async def test_viewing_a_sessions_questions_never_generates_any():
    """The Interview Center lists and never generates; this page used to be
    the only thing that generated, so new runs showed no questions anywhere."""
    override, db = make_mock_db()
    sess = TailoringSession(id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID), jd_id=uuid.uuid4(),
                            status="completed")
    sr = MagicMock(); sr.scalar_one_or_none.return_value = sess
    db.execute = AsyncMock(side_effect=[sr, _scalars([])])

    app.dependency_overrides[get_db] = override
    try:
        with patch("app.services.prep_questions.get_or_generate_prep_questions", new=AsyncMock()) as gen:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                r = await c.get(f"/ai/sessions/{sess.id}/questions", headers=make_auth_header())
        assert r.status_code == 200
        assert r.json() == []
        gen.assert_not_awaited()
        db.add_all.assert_not_called()
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_viewing_returns_the_existing_set():
    override, db = make_mock_db()
    sess = TailoringSession(id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID),
                            jd_id=uuid.uuid4(), status="completed")
    existing = [PrepQuestion(id=uuid.uuid4(), session_id=sess.id, topic="Technical", question="Q1",
                             answer_framework="STAR", is_gap_based=False, source="requirement",
                             basis="x", order_index=1)]
    sr = MagicMock(); sr.scalar_one_or_none.return_value = sess
    db.execute = AsyncMock(side_effect=[sr, _scalars(existing)])

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            r = await c.get(f"/ai/sessions/{sess.id}/questions", headers=make_auth_header())
        assert r.status_code == 200
        assert [q["question"] for q in r.json()] == ["Q1"]
    finally:
        app.dependency_overrides.pop(get_db, None)


def _session():
    return TailoringSession(id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID), jd_id=uuid.uuid4(),
                            status="completed", matched_skills=["Python"], missing_skills=["AWS"],
                            tailored_content={"experience": ["from the run"]})


@pytest.mark.asyncio
async def test_generation_writes_questions_from_the_saved_resume_and_cached_analysis():
    from app.services import prep_questions

    db = MagicMock()
    db.execute = AsyncMock(side_effect=[_scalars([]), _scalars([])])
    db.commit = AsyncMock(); db.refresh = AsyncMock(); db.add_all = MagicMock()
    jd = make_jd(); jd.parsed = {"agent1": _AGENT1}
    sess = _session()
    saved = {"experience": ["as saved"]}

    with patch.object(prep_questions, "get_or_generate_prep_questions",
                      new=AsyncMock(return_value=_gen_out())) as gen, \
         patch.object(prep_questions, "_agent1_parse_jd", new=AsyncMock()) as parse, \
         patch.object(prep_questions, "get_ai_provider", return_value=MagicMock()), \
         patch.object(prep_questions, "record_ai_usage"):
        rows = await prep_questions.generate_for_session(db, sess, jd, saved)

    assert [r.question for r in rows] == ["Tell me about the pipeline."]
    assert all(r.session_id == sess.id for r in rows)
    parse.assert_not_awaited()
    args, kwargs = gen.call_args
    assert args[0] == ["AWS"] and args[1] == saved  # the résumé as saved, not the raw run
    assert kwargs["jd_analysis"].core_responsibilities == ["Own the pipeline"]
    db.add_all.assert_called_once()


@pytest.mark.asyncio
async def test_generation_parses_the_jd_when_no_analysis_is_cached():
    """A run made with a target company caches no JD analysis — that used to
    mean no questions at all."""
    from app.services import prep_questions
    from app.services.tailoring import JDAnalysis

    db = MagicMock()
    db.execute = AsyncMock(side_effect=[_scalars([]), _scalars([])])
    db.commit = AsyncMock(); db.refresh = AsyncMock(); db.add_all = MagicMock()
    jd = make_jd(); jd.parsed = {}

    with patch.object(prep_questions, "get_or_generate_prep_questions",
                      new=AsyncMock(return_value=_gen_out())), \
         patch.object(prep_questions, "_agent1_parse_jd",
                      new=AsyncMock(return_value=JDAnalysis(**_AGENT1))) as parse, \
         patch.object(prep_questions, "get_ai_provider", return_value=MagicMock()), \
         patch.object(prep_questions, "record_ai_usage"):
        rows = await prep_questions.generate_for_session(db, _session(), jd, {"experience": []})

    parse.assert_awaited_once()
    assert len(rows) == 1
    assert jd.parsed == {}  # the score's cache is not written from here


@pytest.mark.asyncio
async def test_generation_keeps_a_set_that_already_exists():
    from app.services import prep_questions

    sess = _session()
    have = [PrepQuestion(id=uuid.uuid4(), session_id=sess.id, topic="Technical", question="Old",
                         answer_framework="STAR", is_gap_based=False, source="requirement",
                         basis="x", order_index=1)]
    db = MagicMock(); db.execute = AsyncMock(return_value=_scalars(have)); db.add_all = MagicMock()

    with patch.object(prep_questions, "get_or_generate_prep_questions", new=AsyncMock()) as gen:
        rows = await prep_questions.generate_for_session(db, sess, make_jd(), {})

    assert [r.question for r in rows] == ["Old"]
    gen.assert_not_awaited()
    db.add_all.assert_not_called()


@pytest.mark.asyncio
async def test_generate_endpoint_refuses_a_jd_that_was_only_analyzed():
    override, db = make_mock_db()
    jd = make_jd(); jd.tailored_resume_id = None
    jr = MagicMock(); jr.scalar_one_or_none.return_value = jd
    no_run = MagicMock(); no_run.scalars.return_value.first.return_value = None
    db.execute = AsyncMock(side_effect=[jr, no_run])

    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.jd.generate_for_session", new=AsyncMock()) as gen:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                r = await c.post(f"/jd/{jd.id}/prep-questions", headers=make_auth_header())
        assert r.status_code == 409
        assert "save it to the JD" in r.json()["detail"]
        gen.assert_not_awaited()
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_generate_endpoint_makes_questions_for_a_saved_jd():
    override, db = make_mock_db()
    saved = make_resume(); saved.content = {"experience": ["saved"]}
    jd = make_jd(); jd.tailored_resume_id = saved.id
    sess = _session(); sess.jd_id = jd.id
    jr = MagicMock(); jr.scalar_one_or_none.return_value = jd
    rr = MagicMock(); rr.scalar_one_or_none.return_value = saved
    run = MagicMock(); run.scalars.return_value.first.return_value = sess
    none_yet = MagicMock(); none_yet.scalar_one.return_value = 0
    sub = _sub(credits=50)
    sr = MagicMock(); sr.scalar_one_or_none.return_value = sub
    # jd, saved résumé, run, existing-count, balance check, charge
    db.execute = AsyncMock(side_effect=[jr, rr, run, none_yet, sr, sr])

    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.jd.generate_for_session",
                   new=AsyncMock(return_value=[MagicMock(), MagicMock()])) as gen:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                r = await c.post(f"/jd/{jd.id}/prep-questions", headers=make_auth_header())
        assert r.status_code == 200
        assert r.json() == {"session_id": str(sess.id), "questions_total": 2}
        gen.assert_awaited_once()
        assert gen.call_args.args[3] == {"experience": ["saved"]}
        # Making the set is a model call, so it is charged.
        assert sub.credits_remaining == 48
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_generate_endpoint_uses_the_run_the_saved_resume_came_from():
    """Called by the client straight after Save to JD, naming the run it
    reviewed — which need not be the JD's latest."""
    override, db = make_mock_db()
    saved = make_resume()
    jd = make_jd(); jd.tailored_resume_id = saved.id
    named = _session(); named.jd_id = jd.id
    jr = MagicMock(); jr.scalar_one_or_none.return_value = jd
    rr = MagicMock(); rr.scalar_one_or_none.return_value = saved
    nr = MagicMock(); nr.scalar_one_or_none.return_value = named
    none_yet = MagicMock(); none_yet.scalar_one.return_value = 0
    sr = MagicMock(); sr.scalar_one_or_none.return_value = _sub(credits=50)
    db.execute = AsyncMock(side_effect=[jr, rr, nr, none_yet, sr])

    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.jd.generate_for_session", new=AsyncMock(return_value=[])) as gen:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                r = await c.post(f"/jd/{jd.id}/prep-questions",
                                 json={"tailoring_session_id": str(named.id)},
                                 headers=make_auth_header())
        assert r.status_code == 200
        assert r.json()["session_id"] == str(named.id)
        assert gen.call_args.args[1] is named
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_generate_endpoint_returns_an_existing_set_free_even_with_no_credits():
    override, db = make_mock_db()
    saved = make_resume()
    jd = make_jd(); jd.tailored_resume_id = saved.id
    sess = _session(); sess.jd_id = jd.id
    jr = MagicMock(); jr.scalar_one_or_none.return_value = jd
    rr = MagicMock(); rr.scalar_one_or_none.return_value = saved
    run = MagicMock(); run.scalars.return_value.first.return_value = sess
    have = MagicMock(); have.scalar_one.return_value = 10
    db.execute = AsyncMock(side_effect=[jr, rr, run, have])  # no balance lookups at all

    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.jd.generate_for_session",
                   new=AsyncMock(return_value=[MagicMock()] * 10)):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                r = await c.post(f"/jd/{jd.id}/prep-questions", headers=make_auth_header())
        assert r.status_code == 200
        assert r.json()["questions_total"] == 10
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_generate_endpoint_402_before_any_model_call_when_out_of_credits():
    override, db = make_mock_db()
    saved = make_resume()
    jd = make_jd(); jd.tailored_resume_id = saved.id
    sess = _session(); sess.jd_id = jd.id
    jr = MagicMock(); jr.scalar_one_or_none.return_value = jd
    rr = MagicMock(); rr.scalar_one_or_none.return_value = saved
    run = MagicMock(); run.scalars.return_value.first.return_value = sess
    none_yet = MagicMock(); none_yet.scalar_one.return_value = 0
    sr = MagicMock(); sr.scalar_one_or_none.return_value = _sub(credits=1)
    db.execute = AsyncMock(side_effect=[jr, rr, run, none_yet, sr])

    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.jd.generate_for_session", new=AsyncMock()) as gen:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                r = await c.post(f"/jd/{jd.id}/prep-questions", headers=make_auth_header())
        assert r.status_code == 402
        assert "Interview questions costs 2 credits" in r.json()["detail"]
        gen.assert_not_awaited()
    finally:
        app.dependency_overrides.pop(get_db, None)


# ── Tailoring caches its JD analysis, like analyze does ──────────────────────
# Without it, POST /ai/project-score 409s ("Session JD has no cached analysis")
# and the review screen's live before->now score silently stops responding to
# the user's selections. 14 of 40 real completed sessions were in this state.

@pytest.mark.asyncio
async def test_tailoring_persists_the_jd_analysis_when_the_jd_has_none():
    from app.services.tailoring import TailoringResult, JDAnalysis

    jd = make_jd()
    jd.parsed = {}
    session = TailoringSession(id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID),
                               jd_id=jd.id, status="pending")
    analysis = JDAnalysis(
        exact_technical_tools=["Python"], methodologies_and_frameworks=[],
        domain_expertise_themes=[], seniority_indicators=[], ats_filter_phrases=[],
        core_responsibilities=[], target_job_titles=[], nice_to_have_skills=[],
    )
    result = TailoringResult(
        tailored_content={"experience": []}, matched_skills=[], missing_skills=[],
        ats_score=70, prep_questions=[], company_keywords=[], suggested_skills=[],
        jd_analysis=analysis,
    )

    db = MagicMock()
    db.commit = AsyncMock()
    db.add_all = MagicMock()

    async def execute(stmt):
        r = MagicMock()
        # first lookup is the session, second is the JD row
        r.scalar_one_or_none.return_value = session if execute.n == 0 else jd
        execute.n += 1
        return r
    execute.n = 0
    db.execute = AsyncMock(side_effect=execute)

    from app.routers import ai as ai_router
    with patch.object(ai_router, "AsyncSessionLocal") as sl, \
         patch.object(ai_router, "run_tailoring_pipeline", new=AsyncMock(return_value=result)), \
         patch.object(ai_router, "record_ai_usage"):
        sl.return_value.__aenter__ = AsyncMock(return_value=db)
        sl.return_value.__aexit__ = AsyncMock(return_value=False)
        await ai_router._run_tailoring_background(
            session.id, uuid.UUID(TEST_USER_ID), {"experience": []}, "jd text",
            50, MagicMock(), None, [], None,
        )

    assert jd.parsed.get("agent1"), "Agent 1 analysis was not cached onto the JD"
    assert jd.parsed["agent1"]["exact_technical_tools"] == ["Python"]


@pytest.mark.asyncio
async def test_tailoring_does_not_overwrite_an_existing_jd_analysis_cache():
    """An analysis already cached by /ai/analyze is what the user's displayed
    score was computed from — replacing it would make the score jump for no
    visible reason."""
    from app.services.tailoring import TailoringResult, JDAnalysis

    jd = make_jd()
    jd.parsed = {"agent1": {"exact_technical_tools": ["Original"],
                            "methodologies_and_frameworks": [], "domain_expertise_themes": [],
                            "seniority_indicators": [], "ats_filter_phrases": [],
                            "core_responsibilities": [], "target_job_titles": [],
                            "nice_to_have_skills": [], "importance": {}}}
    session = TailoringSession(id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID),
                               jd_id=jd.id, status="pending")
    result = TailoringResult(
        tailored_content={"experience": []}, matched_skills=[], missing_skills=[],
        ats_score=70, prep_questions=[], company_keywords=[], suggested_skills=[],
        jd_analysis=JDAnalysis(
            exact_technical_tools=["Replacement"], methodologies_and_frameworks=[],
            domain_expertise_themes=[], seniority_indicators=[], ats_filter_phrases=[],
            core_responsibilities=[], target_job_titles=[], nice_to_have_skills=[]),
    )

    db = MagicMock(); db.commit = AsyncMock(); db.add_all = MagicMock()

    async def execute(stmt):
        r = MagicMock()
        r.scalar_one_or_none.return_value = session if execute.n == 0 else jd
        execute.n += 1
        return r
    execute.n = 0
    db.execute = AsyncMock(side_effect=execute)

    from app.routers import ai as ai_router
    with patch.object(ai_router, "AsyncSessionLocal") as sl, \
         patch.object(ai_router, "run_tailoring_pipeline", new=AsyncMock(return_value=result)), \
         patch.object(ai_router, "record_ai_usage"):
        sl.return_value.__aenter__ = AsyncMock(return_value=db)
        sl.return_value.__aexit__ = AsyncMock(return_value=False)
        await ai_router._run_tailoring_background(
            session.id, uuid.UUID(TEST_USER_ID), {"experience": []}, "jd text",
            50, MagicMock(), None, [], None,
        )

    assert jd.parsed["agent1"]["exact_technical_tools"] == ["Original"]
