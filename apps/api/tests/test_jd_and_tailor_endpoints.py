import time
import uuid
import jwt as pyjwt
import pytest
from datetime import datetime, timedelta, timezone
from httpx import AsyncClient, ASGITransport
from unittest.mock import AsyncMock, MagicMock, patch
from app.main import app
from app.core.config import settings
from app.db.session import get_db
from app.db.models import Resume, JobDescription, Subscription

TEST_USER_ID = "00000000-0000-0000-0000-000000000001"


def credit_sub_result(credits=9999):
    """A MagicMock execute-result yielding a well-funded subscription, so
    spend_credits() in POST /ai/tailor passes without touching a real DB."""
    r = MagicMock()
    r.scalar_one_or_none.return_value = Subscription(
        id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID), plan="premium", status="active",
        credits_remaining=credits, credits_allotment=credits, current_period_end=None,
    )
    return r


def no_previous_run():
    """The execute-result for POST /ai/tailor's reuse lookup: no completed
    session with the same input fingerprint, so the run goes ahead."""
    r = MagicMock()
    r.scalar_one_or_none.return_value = None
    return r


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
    mock_session.flush = AsyncMock()
    mock_session.add = MagicMock()
    mock_session.add_all = MagicMock()

    async def _override():
        yield mock_session

    return _override, mock_session


# ── POST /jd ──────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_jd_returns_201():
    override, mock_session = make_mock_db()
    created = JobDescription(
        id=uuid.uuid4(),
        user_id=uuid.UUID(TEST_USER_ID),
        title="Senior Engineer",
        raw_text="We need a senior engineer with Python.",
        parsed={"required": ["Python"], "nice_to_have": []},
        status="applied",
        created_at=datetime.now(timezone.utc),
    )

    async def fake_refresh(obj):
        obj.id = created.id
        obj.created_at = created.created_at
        obj.status = created.status

    mock_session.refresh = fake_refresh
    # No existing JD with this text — the dedup lookup finds nothing.
    no_match = MagicMock()
    no_match.scalars.return_value.first.return_value = None
    mock_session.execute.return_value = no_match

    app.dependency_overrides[get_db] = override
    try:
        # Creating a JD no longer calls a model — nothing to patch.
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.post(
                "/jd",
                json={"raw_text": "We need a senior engineer with Python.", "title": "Senior Engineer"},
                headers=make_auth_header(),
            )
        assert r.status_code == 201
        body = r.json()
        assert body["title"] == "Senior Engineer"
        assert body["status"] == "applied"
        # A freshly created JD has no skills yet: parsed_skills derives from
        # Agent 1, which runs on Analyze. Creation is a plain insert now.
        assert body["parsed_skills"] == []
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_create_jd_reuses_existing_entry_for_duplicate_text():
    """Re-submitting identical JD text (e.g. clicking Analyze again on
    unchanged text) must return the existing entry, not create a duplicate —
    otherwise every resubmission starts with an empty parse cache and
    /ai/analyze's determinism guarantee (same JD -> same score) breaks."""
    override, mock_session = make_mock_db()
    existing_jd = JobDescription(
        id=uuid.uuid4(),
        user_id=uuid.UUID(TEST_USER_ID),
        title="Senior Engineer",
        raw_text="We need a senior engineer with Python.",
        parsed={"required": ["Python"], "nice_to_have": []},
        status="applied",
        created_at=datetime.now(timezone.utc),
    )
    found = MagicMock()
    found.scalars.return_value.first.return_value = existing_jd
    mock_session.execute.return_value = found

    app.dependency_overrides[get_db] = override
    try:
        # Creating a JD no longer calls a model — nothing to patch.
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.post(
                "/jd",
                json={"raw_text": "We need a senior engineer with Python.", "title": "Senior Engineer"},
                headers=make_auth_header(),
            )
        assert r.status_code == 200
        assert r.json()["id"] == str(existing_jd.id)
        # No AI call and no new row — this must be a pure lookup, not a re-parse.
        mock_session.add.assert_not_called()
        # Same title as already stored — no redundant write either.
        mock_session.commit.assert_not_called()
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_create_jd_renames_existing_entry_on_content_match_with_new_title():
    """Save As with a name that differs from the matched entry's current
    title must actually apply that name — otherwise typing a new name for
    JD text you've already saved silently does nothing, which is exactly
    the confusion "Save As" exists to prevent."""
    override, mock_session = make_mock_db()
    existing_jd = JobDescription(
        id=uuid.uuid4(),
        user_id=uuid.UUID(TEST_USER_ID),
        title="Untitled JD",
        raw_text="We need a senior engineer with Python.",
        parsed={"required": ["Python"], "nice_to_have": []},
        status="applied",
        created_at=datetime.now(timezone.utc),
    )
    found = MagicMock()
    found.scalars.return_value.first.return_value = existing_jd
    mock_session.execute.return_value = found

    app.dependency_overrides[get_db] = override
    try:
        # Creating a JD no longer calls a model — nothing to patch.
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.post(
                "/jd",
                json={"raw_text": "We need a senior engineer with Python.", "title": "jd1"},
                headers=make_auth_header(),
            )
        assert r.status_code == 200
        assert r.json()["id"] == str(existing_jd.id)
        assert r.json()["title"] == "jd1"
        assert existing_jd.title == "jd1"
        mock_session.add.assert_not_called()
        mock_session.commit.assert_called_once()
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_create_jd_handles_pre_existing_duplicate_rows():
    """Accounts that used the app before this dedup check existed can already
    have MULTIPLE rows with identical raw_text. The lookup must tolerate
    that (picking one) instead of crashing — this reproduces a real
    production bug where .scalar_one_or_none() raised MultipleResultsFound
    and the request failed with no HTTP response at all."""
    override, mock_session = make_mock_db()
    older_duplicate = JobDescription(
        id=uuid.uuid4(),
        user_id=uuid.UUID(TEST_USER_ID),
        title="Senior Engineer",
        raw_text="We need a senior engineer with Python.",
        parsed={"required": ["Python"], "nice_to_have": []},
        status="applied",
        created_at=datetime.now(timezone.utc),
    )
    found = MagicMock()
    # first() reflects the DB-side ORDER BY created_at ASC LIMIT 1 — the mock
    # only needs to prove the route doesn't call scalar_one_or_none() (which
    # would raise given >1 row) and handles a single returned row correctly.
    found.scalars.return_value.first.return_value = older_duplicate
    mock_session.execute.return_value = found

    app.dependency_overrides[get_db] = override
    try:
        # Creating a JD no longer calls a model — nothing to patch.
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.post(
                "/jd",
                json={"raw_text": "We need a senior engineer with Python.", "title": "Senior Engineer"},
                headers=make_auth_header(),
            )
        assert r.status_code == 200
        assert r.json()["id"] == str(older_duplicate.id)
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_create_jd_requires_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post("/jd", json={"raw_text": "Some JD text"})
    assert r.status_code == 401


# ── GET /jd/{jd_id}/details ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_jd_details_returns_resume_and_question_progress():
    from app.db.models import TailoringSession, Resume

    jd_id = uuid.uuid4()
    user_id = uuid.UUID(TEST_USER_ID)
    resume = Resume(
        id=uuid.uuid4(),
        user_id=user_id,
        title="My Resume",
        template_id="ats_clean",
        pdf_url="resumes/user/resume.pdf",
    )
    session_row = TailoringSession(
        id=uuid.uuid4(),
        user_id=user_id,
        resume_id=resume.id,
        jd_id=jd_id,
        status="completed",
        ats_score=82,
        created_at=datetime.now(timezone.utc),
    )
    session_row.resume = resume

    override, mock_session = make_mock_db()
    session_result = MagicMock()
    session_result.scalars.return_value.first.return_value = session_row
    # JD lookup for the tailored_resume_id link — unset here, so resume
    # display falls back to session.resume (the resume tailoring ran
    # against), same as before this field existed.
    jd_result = MagicMock()
    jd_result.scalar_one_or_none.return_value = None
    questions_result = MagicMock()
    questions_result.one.return_value = (5, 2)
    mock_session.execute = AsyncMock(side_effect=[session_result, jd_result, questions_result])

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get(f"/jd/{jd_id}/details", headers=make_auth_header())
        assert r.status_code == 200
        body = r.json()
        assert body["session_id"] == str(session_row.id)
        assert body["ats_score"] == 82
        assert body["resume_id"] == str(resume.id)
        assert body["resume_title"] == "My Resume"
        assert body["resume_pdf_url"] == "resumes/user/resume.pdf"
        assert body["questions_total"] == 5
        assert body["questions_practiced"] == 2
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_get_jd_details_prefers_the_saved_tailored_resume_over_the_session_input_resume():
    """Studio's "Save tailored resume" links JobDescription.tailored_resume_id
    to the resume the user actually chose to keep — that's what JD Details
    should show, not session.resume (the resume tailoring was run against,
    which may be an entirely different, untouched master resume)."""
    from app.db.models import TailoringSession

    jd_id = uuid.uuid4()
    user_id = uuid.UUID(TEST_USER_ID)
    input_resume = Resume(
        id=uuid.uuid4(), user_id=user_id, title="Master Resume", template_id="ats_clean", pdf_url="master.pdf"
    )
    saved_resume = Resume(
        id=uuid.uuid4(), user_id=user_id, title="Resume — Acme", template_id="ats_clean", pdf_url="acme.pdf"
    )
    session_row = TailoringSession(
        id=uuid.uuid4(),
        user_id=user_id,
        resume_id=input_resume.id,
        jd_id=jd_id,
        status="completed",
        ats_score=82,
        created_at=datetime.now(timezone.utc),
    )
    session_row.resume = input_resume
    jd_row = JobDescription(
        id=jd_id, user_id=user_id, title="Acme JD", raw_text="...", tailored_resume_id=saved_resume.id
    )

    override, mock_session = make_mock_db()
    session_result = MagicMock()
    session_result.scalars.return_value.first.return_value = session_row
    jd_result = MagicMock()
    jd_result.scalar_one_or_none.return_value = jd_row
    tailored_resume_result = MagicMock()
    tailored_resume_result.scalar_one_or_none.return_value = saved_resume
    questions_result = MagicMock()
    questions_result.one.return_value = (0, 0)
    mock_session.execute = AsyncMock(
        side_effect=[session_result, jd_result, tailored_resume_result, questions_result]
    )

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get(f"/jd/{jd_id}/details", headers=make_auth_header())
        assert r.status_code == 200
        body = r.json()
        assert body["resume_id"] == str(saved_resume.id)
        assert body["resume_title"] == "Resume — Acme"
        assert body["resume_pdf_url"] == "acme.pdf"
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_get_jd_details_no_session_returns_empty_state():
    jd_id = uuid.uuid4()
    override, mock_session = make_mock_db()
    session_result = MagicMock()
    session_result.scalars.return_value.first.return_value = None
    jd_result = MagicMock()
    jd_result.scalar_one_or_none.return_value = None
    mock_session.execute = AsyncMock(side_effect=[session_result, jd_result])

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get(f"/jd/{jd_id}/details", headers=make_auth_header())
        assert r.status_code == 200
        body = r.json()
        assert body["session_id"] is None
        assert body["resume_id"] is None
        assert body["questions_total"] == 0
        assert body["questions_practiced"] == 0
    finally:
        app.dependency_overrides.pop(get_db, None)


# ── GET /jd/{jd_id}/cover-letter ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_jd_cover_letter_returns_latest():
    from app.db.models import CoverLetter

    jd_id = uuid.uuid4()
    letter = CoverLetter(
        id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID),
        resume_id=uuid.uuid4(), jd_id=jd_id,
        status="completed", created_at=datetime.now(timezone.utc),
    )
    override, mock_session = make_mock_db()
    result = MagicMock()
    result.scalars.return_value.first.return_value = letter
    mock_session.execute = AsyncMock(return_value=result)

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get(f"/jd/{jd_id}/cover-letter", headers=make_auth_header())
        assert r.status_code == 200
        body = r.json()
        assert body["cover_letter_id"] == str(letter.id)
        assert body["status"] == "completed"
        assert body["created_at"] == letter.created_at.isoformat()
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_get_jd_cover_letter_none_when_no_letter_yet():
    jd_id = uuid.uuid4()
    override, mock_session = make_mock_db()
    result = MagicMock()
    result.scalars.return_value.first.return_value = None
    mock_session.execute = AsyncMock(return_value=result)

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get(f"/jd/{jd_id}/cover-letter", headers=make_auth_header())
        assert r.status_code == 200
        assert r.json() == {"cover_letter_id": None, "status": None, "created_at": None}
    finally:
        app.dependency_overrides.pop(get_db, None)


# ── GET /jd/{jd_id}/latest-session ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_latest_session_returns_completed_not_pending():
    """A TailoringSession row is now inserted up-front with status="pending"
    before the AI pipeline runs, and stays in the table permanently if the
    run fails or the user's poll times out. ORDER BY created_at DESC LIMIT 1
    alone would return that newer, hollow row and shadow an earlier, real,
    completed session — the query must filter to status="completed" first."""
    from app.db.models import TailoringSession

    jd_id = uuid.uuid4()
    user_id = uuid.UUID(TEST_USER_ID)
    now = datetime.now(timezone.utc)

    completed_session = TailoringSession(
        id=uuid.uuid4(),
        user_id=user_id,
        resume_id=uuid.uuid4(),
        jd_id=jd_id,
        status="completed",
        created_at=now - timedelta(hours=1),
    )
    pending_session = TailoringSession(
        id=uuid.uuid4(),
        user_id=user_id,
        resume_id=uuid.uuid4(),
        jd_id=jd_id,
        status="pending",
        created_at=now,
    )
    rows = [completed_session, pending_session]

    override, mock_session = make_mock_db()

    async def fake_execute(stmt):
        # Stand in for the real DB: apply the compiled statement's WHERE and
        # ORDER BY/LIMIT against our two in-memory rows, so this exercises
        # the route's actual query-building rather than trusting a canned
        # mock return value.
        compiled_sql = str(stmt.compile(compile_kwargs={"literal_binds": True})).lower()
        candidates = rows
        if "status" in compiled_sql and "completed" in compiled_sql:
            candidates = [r for r in candidates if r.status == "completed"]
        candidates = sorted(candidates, key=lambda r: r.created_at, reverse=True)
        result = MagicMock()
        result.scalar_one_or_none.return_value = candidates[0].id if candidates else None
        return result

    mock_session.execute = fake_execute

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get(f"/jd/{jd_id}/latest-session", headers=make_auth_header())
        assert r.status_code == 200
        assert r.json()["session_id"] == str(completed_session.id)
    finally:
        app.dependency_overrides.pop(get_db, None)


# ── POST /ai/analyze ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_analyze_uses_saved_resume_content_by_default():
    from app.services.tailoring import JDMatchAnalysis, JDAnalysis

    override, mock_session = make_mock_db()
    resume = make_resume()
    jd = make_jd()
    resume_result = MagicMock()
    resume_result.scalar_one_or_none.return_value = resume
    jd_result = MagicMock()
    jd_result.scalar_one_or_none.return_value = jd
    mock_session.execute = AsyncMock(side_effect=[resume_result, jd_result, no_previous_run(), credit_sub_result()])

    fake_analysis = JDMatchAnalysis(
        jd_analysis=JDAnalysis(
            exact_technical_tools=["Python"],
            methodologies_and_frameworks=[],
            domain_expertise_themes=[],
            seniority_indicators=[],
            ats_filter_phrases=[],
        ),
        matched_skills=["Python"],
        missing_skills=[],
        ats_score=100,
        company_keywords=[],
    )

    app.dependency_overrides[get_db] = override
    try:
        with patch(
            "app.routers.ai.analyze_jd_match", new=AsyncMock(return_value=fake_analysis)
        ) as mock_analyze:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                r = await client.post(
                    "/ai/analyze",
                    json={"resume_id": str(resume.id), "jd_id": str(jd.id)},
                    headers=make_auth_header(),
                )
        assert r.status_code == 200
        assert r.json()["ats_score"] == 100
        # Whatever's saved on the resume row — no override was sent.
        assert mock_analyze.call_args.args[0] == resume.content
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_analyze_uses_content_override_when_provided():
    """The bullet-review screen's Reanalyze action passes the current,
    unsaved (accepted/rejected/humanized) bullet state as `content` so the
    score reflects what's actually on screen — not what's saved in the DB,
    which this override must take priority over."""
    from app.services.tailoring import JDMatchAnalysis, JDAnalysis

    override, mock_session = make_mock_db()
    resume = make_resume()
    jd = make_jd()
    resume_result = MagicMock()
    resume_result.scalar_one_or_none.return_value = resume
    jd_result = MagicMock()
    jd_result.scalar_one_or_none.return_value = jd
    mock_session.execute = AsyncMock(side_effect=[resume_result, jd_result, no_previous_run(), credit_sub_result()])

    fake_analysis = JDMatchAnalysis(
        jd_analysis=JDAnalysis(
            exact_technical_tools=["Python"],
            methodologies_and_frameworks=[],
            domain_expertise_themes=[],
            seniority_indicators=[],
            ats_filter_phrases=[],
        ),
        matched_skills=[],
        missing_skills=["Python"],
        ats_score=0,
        company_keywords=[],
    )
    override_content = {"experience": [{"title": "Eng", "bullets": ["Humanized, no keywords"]}], "skills": []}

    app.dependency_overrides[get_db] = override
    try:
        with patch(
            "app.routers.ai.analyze_jd_match", new=AsyncMock(return_value=fake_analysis)
        ) as mock_analyze:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                r = await client.post(
                    "/ai/analyze",
                    json={
                        "resume_id": str(resume.id),
                        "jd_id": str(jd.id),
                        "content": override_content,
                    },
                    headers=make_auth_header(),
                )
        assert r.status_code == 200
        assert r.json()["ats_score"] == 0
        assert mock_analyze.call_args.args[0] == override_content
        assert mock_analyze.call_args.args[0] != resume.content
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_analyze_reuses_cached_semantic_verdicts_when_resume_unchanged():
    """Second analyze of the same resume+JD must not re-run the semantic
    model — the stored verdicts are passed straight back in."""
    from app.services.tailoring import JDMatchAnalysis, JDAnalysis

    override, mock_session = make_mock_db()
    resume = make_resume()
    jd = make_jd()
    jd.parsed = {}

    def _rows():
        rr = MagicMock(); rr.scalar_one_or_none.return_value = resume
        jr = MagicMock(); jr.scalar_one_or_none.return_value = jd
        return [rr, jr]

    mock_session.execute = AsyncMock(side_effect=_rows() + _rows())

    fake_analysis = JDMatchAnalysis(
        jd_analysis=JDAnalysis(
            exact_technical_tools=["Python", "AWS"],
            methodologies_and_frameworks=[],
            domain_expertise_themes=[],
            seniority_indicators=[],
            ats_filter_phrases=[],
        ),
        matched_skills=["Python", "AWS"],
        missing_skills=[],
        ats_score=100,
        company_keywords=[],
        semantic_verdicts={"aws": "matched"},
    )

    app.dependency_overrides[get_db] = override
    try:
        with patch(
            "app.routers.ai.analyze_jd_match", new=AsyncMock(return_value=fake_analysis)
        ) as mock_analyze:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                body = {"resume_id": str(resume.id), "jd_id": str(jd.id)}
                r1 = await client.post("/ai/analyze", json=body, headers=make_auth_header())
                r2 = await client.post("/ai/analyze", json=body, headers=make_auth_header())

        assert r1.status_code == r2.status_code == 200
        assert mock_analyze.call_args_list[0].kwargs["cached_semantic_verdicts"] is None
        assert mock_analyze.call_args_list[1].kwargs["cached_semantic_verdicts"] == {"aws": "matched"}
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_analyze_returns_importance_map():
    from app.services.tailoring import JDMatchAnalysis, JDAnalysis

    override, mock_session = make_mock_db()
    resume = make_resume()
    jd = make_jd()
    rr = MagicMock(); rr.scalar_one_or_none.return_value = resume
    jr = MagicMock(); jr.scalar_one_or_none.return_value = jd
    mock_session.execute = AsyncMock(side_effect=[rr, jr])

    fake = JDMatchAnalysis(
        jd_analysis=JDAnalysis(
            exact_technical_tools=["Python"], methodologies_and_frameworks=[],
            domain_expertise_themes=[], seniority_indicators=[], ats_filter_phrases=[],
            importance={"python": "high", "job title": "medium"},
        ),
        matched_skills=["Python"], missing_skills=[], ats_score=100, company_keywords=[],
    )

    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.ai.analyze_jd_match", new=AsyncMock(return_value=fake)):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                r = await client.post("/ai/analyze",
                    json={"resume_id": str(resume.id), "jd_id": str(jd.id)},
                    headers=make_auth_header())
        assert r.status_code == 200
        assert r.json()["importance"] == {"python": "high", "job title": "medium"}
    finally:
        app.dependency_overrides.pop(get_db, None)


# ── POST /ai/tailor ───────────────────────────────────────────────────────────


def make_resume():
    return Resume(
        id=uuid.uuid4(),
        user_id=uuid.UUID(TEST_USER_ID),
        title="My Resume",
        content={"experience": [{"title": "Eng", "bullets": ["Did stuff"]}], "skills": ["Python"]},
        template_id="ats_clean",
        pdf_url=None,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )


def make_jd():
    return JobDescription(
        id=uuid.uuid4(),
        user_id=uuid.UUID(TEST_USER_ID),
        title="Senior Engineer",
        raw_text="Need Python and AWS.",
        parsed={"required": ["Python", "AWS"], "nice_to_have": []},
        status="applied",
        created_at=datetime.now(timezone.utc),
    )


def test_tailor_request_caps_and_defaults_priority_skills():
    from app.schemas.ai import TailorRequest

    req = TailorRequest(
        resume_id=uuid.uuid4(),
        jd_id=uuid.uuid4(),
        priority_skills=[f"skill-{i}" for i in range(25)] + ["  padded  ", "", "   "],
    )
    # Capped to 20, trimmed, blanks dropped
    assert len(req.priority_skills) == 20
    assert req.priority_skills[0] == "skill-0"

    req_default = TailorRequest(resume_id=uuid.uuid4(), jd_id=uuid.uuid4())
    assert req_default.priority_skills == []


@pytest.mark.asyncio
async def test_tailor_resume_returns_202_and_creates_pending_session():
    override, mock_session = make_mock_db()
    resume = make_resume()
    jd = make_jd()

    resume_result = MagicMock()
    resume_result.scalar_one_or_none.return_value = resume
    jd_result = MagicMock()
    jd_result.scalar_one_or_none.return_value = jd
    mock_session.execute = AsyncMock(side_effect=[resume_result, jd_result, no_previous_run(), credit_sub_result()])

    from app.db.models import TailoringSession

    created_session = TailoringSession(
        user_id=resume.user_id, resume_id=resume.id, jd_id=jd.id, humanize_level=50, status="pending"
    )

    def fake_add(obj):
        if isinstance(obj, TailoringSession) and obj.id is None:
            obj.id = uuid.uuid4()
            created_session.id = obj.id

    mock_session.add = MagicMock(side_effect=fake_add)

    # ASGITransport runs BackgroundTasks synchronously, so
    # _run_tailoring_background actually executes during this request and
    # opens its own AsyncSessionLocal() — fake it out the same way the
    # neighboring background-task tests do, or it'll hit a real DB.
    bg_session = MagicMock()
    # The background task now makes TWO queries: the session row, then the JD
    # row it caches Agent 1's parse onto (see _run_tailoring_background). One
    # always-the-same result would hand it a TailoringSession where it expects
    # a JobDescription.
    def bg_execute(stmt):
        r = MagicMock()
        r.scalar_one_or_none.return_value = created_session if bg_execute.n == 0 else jd
        bg_execute.n += 1
        return r
    bg_execute.n = 0
    bg_session.execute = AsyncMock(side_effect=bg_execute)
    bg_session.commit = AsyncMock()
    bg_session.add_all = MagicMock()

    class _FakeSessionContextManager:
        async def __aenter__(self):
            return bg_session

        async def __aexit__(self, *exc_info):
            return False

    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.ai.run_tailoring_pipeline", new=AsyncMock()), patch(
            "app.routers.ai.AsyncSessionLocal", new=lambda: _FakeSessionContextManager()
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                r = await client.post(
                    "/ai/tailor",
                    json={"resume_id": str(resume.id), "jd_id": str(jd.id), "humanize_level": 50},
                    headers=make_auth_header(),
                )
        assert r.status_code == 202
        body = r.json()
        assert body["status"] == "pending"
        assert "session_id" in body
        mock_session.add.assert_called_once()  # the pending TailoringSession row
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_tailor_resume_background_task_persists_result_and_forwards_priority_skills():
    from app.services.tailoring import TailoringResult, PrepQuestionData
    from app.db.models import TailoringSession

    override, mock_session = make_mock_db()
    resume = make_resume()
    jd = make_jd()

    resume_result = MagicMock()
    resume_result.scalar_one_or_none.return_value = resume
    jd_result = MagicMock()
    jd_result.scalar_one_or_none.return_value = jd
    mock_session.execute = AsyncMock(side_effect=[resume_result, jd_result, no_previous_run(), credit_sub_result()])

    created_session = TailoringSession(
        user_id=resume.user_id, resume_id=resume.id, jd_id=jd.id, humanize_level=50, status="pending"
    )

    def fake_add(obj):
        if isinstance(obj, TailoringSession) and obj.id is None:
            obj.id = uuid.uuid4()
            created_session.id = obj.id

    mock_session.add = MagicMock(side_effect=fake_add)

    # The background task's own DB session — its execute() re-fetches the
    # row the request handler just created.
    bg_session = MagicMock()
    bg_result = MagicMock()
    bg_result.scalar_one_or_none.side_effect = lambda: created_session
    bg_session.execute = AsyncMock(return_value=bg_result)
    bg_session.commit = AsyncMock()
    bg_session.add_all = MagicMock()

    class _FakeSessionContextManager:
        async def __aenter__(self):
            return bg_session

        async def __aexit__(self, *exc_info):
            return False

    fake_result = TailoringResult(
        tailored_content={"experience": []},
        matched_skills=["Python"],
        missing_skills=["AWS"],
        ats_score=50,
        prep_questions=[],
        company_keywords=["Acme Corp"],
        suggested_skills=["Kubernetes"],
    )
    pipeline_mock = AsyncMock(return_value=fake_result)

    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.ai.run_tailoring_pipeline", new=pipeline_mock), patch(
            "app.routers.ai.AsyncSessionLocal", new=lambda: _FakeSessionContextManager()
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                r = await client.post(
                    "/ai/tailor",
                    json={
                        "resume_id": str(resume.id),
                        "jd_id": str(jd.id),
                        "humanize_level": 50,
                        "priority_skills": ["Kubernetes", "Terraform"],
                    },
                    headers=make_auth_header(),
                )
        assert r.status_code == 202
        _, kwargs = pipeline_mock.call_args
        assert kwargs["priority_skills"] == ["Kubernetes", "Terraform"]
        assert created_session.status == "completed"
        assert created_session.suggested_skills == ["Kubernetes"]
        assert created_session.company_keywords == ["Acme Corp"]
        bg_session.commit.assert_called()
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_tailor_resume_background_task_marks_session_failed_on_pipeline_error():
    from app.db.models import TailoringSession

    override, mock_session = make_mock_db()
    resume = make_resume()
    jd = make_jd()

    resume_result = MagicMock()
    resume_result.scalar_one_or_none.return_value = resume
    jd_result = MagicMock()
    jd_result.scalar_one_or_none.return_value = jd
    mock_session.execute = AsyncMock(side_effect=[resume_result, jd_result, no_previous_run(), credit_sub_result()])

    created_session = TailoringSession(
        user_id=resume.user_id, resume_id=resume.id, jd_id=jd.id, humanize_level=50, status="pending"
    )

    def fake_add(obj):
        if isinstance(obj, TailoringSession) and obj.id is None:
            obj.id = uuid.uuid4()
            created_session.id = obj.id

    mock_session.add = MagicMock(side_effect=fake_add)

    # spend_credits already deducted 10 for this run before the background
    # job started — the pipeline failure below must credit it back.
    sub = Subscription(
        id=uuid.uuid4(), user_id=resume.user_id, plan="premium", status="active",
        credits_remaining=590, credits_allotment=600, current_period_end=None,
    )
    session_result = MagicMock()
    session_result.scalar_one_or_none.side_effect = lambda: created_session
    sub_result = MagicMock()
    sub_result.scalar_one_or_none.return_value = sub

    bg_session = MagicMock()
    bg_session.execute = AsyncMock(side_effect=[session_result, sub_result])
    bg_session.commit = AsyncMock()
    bg_session.flush = AsyncMock()

    class _FakeSessionContextManager:
        async def __aenter__(self):
            return bg_session

        async def __aexit__(self, *exc_info):
            return False

    pipeline_mock = AsyncMock(side_effect=RuntimeError("LLM provider timed out"))

    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.ai.run_tailoring_pipeline", new=pipeline_mock), patch(
            "app.routers.ai.AsyncSessionLocal", new=lambda: _FakeSessionContextManager()
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                r = await client.post(
                    "/ai/tailor",
                    json={"resume_id": str(resume.id), "jd_id": str(jd.id), "humanize_level": 50},
                    headers=make_auth_header(),
                )
        assert r.status_code == 202
        assert created_session.status == "failed"
        assert sub.credits_remaining == 600  # 590 + the 10-credit tailor cost refunded
    finally:
        app.dependency_overrides.pop(get_db, None)


# ── GET /ai/sessions/latest ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_latest_session_resolves_before_session_id_route():
    """Guards the registration-order requirement: /sessions/latest must be
    matched instead of /sessions/{session_id} trying (and failing) to parse
    "latest" as a UUID."""
    from app.db.models import TailoringSession

    session_row = TailoringSession(
        id=uuid.uuid4(),
        user_id=uuid.UUID(TEST_USER_ID),
        resume_id=uuid.uuid4(),
        jd_id=uuid.uuid4(),
        status="completed",
        ats_score=77,
        created_at=datetime.now(timezone.utc),
    )
    override, mock_session = make_mock_db()
    result = MagicMock()
    result.scalars.return_value.first.return_value = session_row
    mock_session.execute = AsyncMock(return_value=result)

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/ai/sessions/latest", headers=make_auth_header())
        assert r.status_code == 200
        body = r.json()
        assert body["session_id"] == str(session_row.id)
        assert body["ats_score"] == 77
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_get_latest_session_no_sessions_returns_null():
    override, mock_session = make_mock_db()
    result = MagicMock()
    result.scalars.return_value.first.return_value = None
    mock_session.execute = AsyncMock(return_value=result)

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/ai/sessions/latest", headers=make_auth_header())
        assert r.status_code == 200
        assert r.json() == {"session_id": None}
    finally:
        app.dependency_overrides.pop(get_db, None)


# ── GET /ai/sessions/{id} ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_session_includes_status_field():
    from app.db.models import TailoringSession

    override, mock_session = make_mock_db()
    session_row = TailoringSession(
        id=uuid.uuid4(),
        user_id=uuid.UUID(TEST_USER_ID),
        resume_id=uuid.uuid4(),
        jd_id=uuid.uuid4(),
        status="pending",
        company_keywords=["Acme"],
        suggested_skills=["Kubernetes"],
    )
    result = MagicMock()
    result.scalar_one_or_none.return_value = session_row
    mock_session.execute = AsyncMock(return_value=result)

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get(f"/ai/sessions/{session_row.id}", headers=make_auth_header())
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "pending"
        assert body["company_keywords"] == ["Acme"]
        assert body["suggested_skills"] == ["Kubernetes"]
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_tailor_resume_404_when_resume_or_jd_not_owned():
    override, mock_session = make_mock_db()
    empty_result = MagicMock()
    empty_result.scalar_one_or_none.return_value = None
    mock_session.execute = AsyncMock(side_effect=[empty_result, empty_result])

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.post(
                "/ai/tailor",
                json={"resume_id": str(uuid.uuid4()), "jd_id": str(uuid.uuid4()), "humanize_level": 50},
                headers=make_auth_header(),
            )
        assert r.status_code == 404
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_tailor_resume_requires_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post(
            "/ai/tailor",
            json={"resume_id": str(uuid.uuid4()), "jd_id": str(uuid.uuid4()), "humanize_level": 50},
        )
    assert r.status_code == 401


# ── GET /ai/questions/mine ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_my_questions_annotates_each_question_with_its_jd():
    from app.db.models import PrepQuestion
    from types import SimpleNamespace

    uid = uuid.UUID(TEST_USER_ID)
    session_id = uuid.uuid4()
    jd_id = uuid.uuid4()
    question = PrepQuestion(
        id=uuid.uuid4(),
        session_id=session_id,
        topic="Technical",
        question="Tell me about a distributed systems project.",
        answer_framework="STAR: ...",
        is_gap_based=False,
        source="requirement",
        basis="",
        order_index=0,
        practiced_at=None,
    )

    override, mock_session = make_mock_db()
    sessions_result = MagicMock()
    sessions_result.all.return_value = [
        SimpleNamespace(id=session_id, jd_id=jd_id, title="Senior Backend Engineer — Acme")
    ]
    questions_result = MagicMock()
    questions_result.scalars.return_value.all.return_value = [question]
    mock_session.execute = AsyncMock(side_effect=[sessions_result, questions_result])

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/ai/questions/mine", headers=make_auth_header())
        assert r.status_code == 200
        body = r.json()
        assert len(body) == 1
        assert body[0]["question"] == "Tell me about a distributed systems project."
        assert body[0]["jd_id"] == str(jd_id)
        assert body[0]["jd_title"] == "Senior Backend Engineer — Acme"
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_get_my_questions_returns_empty_list_when_no_completed_sessions():
    override, mock_session = make_mock_db()
    sessions_result = MagicMock()
    sessions_result.all.return_value = []
    mock_session.execute = AsyncMock(return_value=sessions_result)

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/ai/questions/mine", headers=make_auth_header())
        assert r.status_code == 200
        assert r.json() == []
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_get_my_questions_requires_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/ai/questions/mine")
    assert r.status_code == 401


# ── POST /ai/rewrite-bullet ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_rewrite_bullet_custom_mode_requires_instructions():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post(
            "/ai/rewrite-bullet",
            json={"bullet_text": "Led a team of 5 engineers", "mode": "custom"},
            headers=make_auth_header(),
        )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_rewrite_bullet_custom_mode_follows_instructions():
    override, mock_session = make_mock_db()
    mock_session.execute = AsyncMock(return_value=credit_sub_result())
    mock_provider = MagicMock()
    mock_provider.complete = AsyncMock(return_value="Rewritten per instructions.")
    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.ai.get_ai_provider", return_value=mock_provider):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                r = await client.post(
                    "/ai/rewrite-bullet",
                    json={
                        "bullet_text": "Original summary text.",
                        "mode": "custom",
                        "custom_instruction": "Make it punchier and mention leadership.",
                        "field": "summary",
                    },
                    headers=make_auth_header(),
                )
        assert r.status_code == 200
        assert r.json()["rewritten_text"] == "Rewritten per instructions."
        system_prompt, user_msg = mock_provider.complete.call_args.args[:2]
        assert "instructions" in system_prompt.lower()
        assert "Make it punchier and mention leadership." in user_msg
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_rewrite_bullet_summary_field_truncates_to_word_cap():
    from app.services.resume_spec import HARD_LIMITS

    max_words = HARD_LIMITS["summary"]["max_words"]
    overlong = " ".join(f"word{i}" for i in range(max_words + 30))
    override, mock_session = make_mock_db()
    mock_session.execute = AsyncMock(return_value=credit_sub_result())
    mock_provider = MagicMock()
    mock_provider.complete = AsyncMock(return_value=overlong)
    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.ai.get_ai_provider", return_value=mock_provider):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                r = await client.post(
                    "/ai/rewrite-bullet",
                    json={"bullet_text": "Original summary.", "mode": "rewrite", "field": "summary"},
                    headers=make_auth_header(),
                )
        assert r.status_code == 200
        assert len(r.json()["rewritten_text"].split()) <= max_words
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_rewrite_bullet_bullet_field_not_truncated_by_summary_cap():
    """The summary's 80-word cap must never be applied to a bullet.

    This used to assert an over-long bullet came back verbatim — which was
    really the absence of ANY length enforcement on this endpoint. Bullets now
    carry the pipeline's own 35-word cap through the fact-lock, so an over-long
    rewrite is REVERTED to the original rather than silently truncated to 80
    words. Either way the summary cap is not what governs a bullet.
    """
    from app.services.resume_spec import HARD_LIMITS

    max_words = HARD_LIMITS["summary"]["max_words"]
    long_bullet = " ".join(f"word{i}" for i in range(max_words + 30))
    override, mock_session = make_mock_db()
    mock_session.execute = AsyncMock(return_value=credit_sub_result())
    mock_provider = MagicMock()
    mock_provider.complete = AsyncMock(return_value=long_bullet)
    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.ai.get_ai_provider", return_value=mock_provider):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                r = await client.post(
                    "/ai/rewrite-bullet",
                    json={"bullet_text": "Original bullet.", "mode": "rewrite"},
                    headers=make_auth_header(),
                )
        assert r.status_code == 200
        body = r.json()
        # Reverted whole, not chopped at the summary's 80-word boundary.
        assert body["rewritten_text"] == "Original bullet."
        assert len(body["rewritten_text"].split()) != max_words
        assert any("word" in reason for reason in body["reverted_reasons"])
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_rewrite_bullet_requires_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post(
            "/ai/rewrite-bullet",
            json={"bullet_text": "Original bullet.", "mode": "rewrite"},
        )
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_rewrite_bullet_deducts_one_credit():
    sub_result = credit_sub_result(credits=50)
    sub = sub_result.scalar_one_or_none()
    override, mock_session = make_mock_db()
    mock_session.execute = AsyncMock(return_value=sub_result)
    mock_provider = MagicMock()
    mock_provider.complete = AsyncMock(return_value="Rewritten.")
    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.ai.get_ai_provider", return_value=mock_provider):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                r = await client.post(
                    "/ai/rewrite-bullet",
                    json={"bullet_text": "Original bullet.", "mode": "rewrite"},
                    headers=make_auth_header(),
                )
        assert r.status_code == 200
        assert sub.credits_remaining == 49  # rewrite_bullet costs 1
        mock_session.commit.assert_called()
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_rewrite_bullet_refunds_credit_when_provider_fails():
    sub_result = credit_sub_result(credits=50)
    sub = sub_result.scalar_one_or_none()
    override, mock_session = make_mock_db()
    mock_session.execute = AsyncMock(return_value=sub_result)
    mock_provider = MagicMock()
    mock_provider.complete = AsyncMock(side_effect=RuntimeError("provider exploded"))
    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.ai.get_ai_provider", return_value=mock_provider):
            transport = ASGITransport(app=app, raise_app_exceptions=False)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                r = await client.post(
                    "/ai/rewrite-bullet",
                    json={"bullet_text": "Original bullet.", "mode": "rewrite"},
                    headers=make_auth_header(),
                )
        assert r.status_code == 500
        assert sub.credits_remaining == 50  # charged then refunded — net zero
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_get_session_returns_ats_fixes_and_bullet_importance():
    from app.db.models import TailoringSession

    override, mock_session = make_mock_db()
    sess = TailoringSession(
        id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID), jd_id=uuid.uuid4(),
        status="completed", tailored_content={"experience": []}, ats_score=70,
        matched_skills=[], missing_skills=[], company_keywords=[], suggested_skills=[],
    )
    sess.ats_fixes = [{"id": "skill:k8s", "type": "skill", "gap": "Kubernetes",
                       "importance": "high", "grounded": True, "text": "Kubernetes",
                       "experience_index": None, "score_delta": 5, "default_accept": False}]
    sess.bullet_importance = {"exp0_b0": "high"}
    res = MagicMock(); res.scalar_one_or_none.return_value = sess
    mock_session.execute = AsyncMock(return_value=res)

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get(f"/ai/sessions/{sess.id}", headers=make_auth_header())
        assert r.status_code == 200
        body = r.json()
        assert body["ats_fixes"][0]["gap"] == "Kubernetes"
        assert body["bullet_importance"] == {"exp0_b0": "high"}
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_project_score_applies_only_accepted_fixes_no_llm():
    from app.db.models import TailoringSession, JobDescription
    import uuid as _uuid

    override, mock_session = make_mock_db()
    jd = JobDescription(
        id=_uuid.uuid4(), user_id=_uuid.UUID(TEST_USER_ID), title="T",
        raw_text="need Python and Kubernetes",
        parsed={"agent1": {
            "exact_technical_tools": ["Python", "Kubernetes"],
            "methodologies_and_frameworks": [], "domain_expertise_themes": [],
            "seniority_indicators": [], "ats_filter_phrases": [],
            "core_responsibilities": [], "target_job_titles": [],
            "nice_to_have_skills": [], "importance": {},
        }, "semantic": {"fingerprint": "x", "verdicts": {"kubernetes": "missing"}}},
        status="applied",
    )
    sess = TailoringSession(
        id=_uuid.uuid4(), user_id=_uuid.UUID(TEST_USER_ID), jd_id=jd.id,
        status="completed", ats_score=50, matched_skills=[], missing_skills=[],
        company_keywords=[], suggested_skills=[],
        tailored_content={"skills": ["Python"], "experience": [{"title": "E", "bullets": ["Used Python"]}]},
    )
    sess.jd = jd
    sess.ats_fixes = [
        {"id": "skill:kubernetes", "type": "skill", "gap": "Kubernetes", "importance": "high",
         "grounded": True, "text": "Kubernetes", "experience_index": None,
         "score_delta": 50, "default_accept": False},
        {"id": "skill:terraform", "type": "skill", "gap": "Terraform", "importance": "low",
         "grounded": True, "text": "Terraform", "experience_index": None,
         "score_delta": 0, "default_accept": False},
    ]
    res = MagicMock(); res.scalar_one_or_none.return_value = sess
    mock_session.execute = AsyncMock(return_value=res)

    provider_spy = MagicMock()
    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.ai.get_ai_provider", return_value=provider_spy):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                r = await client.post("/ai/project-score",
                    json={"session_id": str(sess.id), "accepted_fix_ids": ["skill:kubernetes"]},
                    headers=make_auth_header())
        assert r.status_code == 200
        assert r.json()["projected_score"] == 100   # Python + accepted Kubernetes
        provider_spy.assert_not_called()
    finally:
        app.dependency_overrides.pop(get_db, None)


# ── The projected score must reflect the bullets the user actually kept ──────
# Regression: project-score always scored session.tailored_content — the
# all-bullets-accepted snapshot — so rejecting every tailored bullet left the
# projected "→ N%" completely unmoved. The client already builds the exact
# merged content for its preview; scoring that covers bullet decisions, skill
# decisions, role overrides and inline edits in one pass.

def _project_score_session():
    from app.db.models import TailoringSession, JobDescription
    import uuid as _uuid

    jd = JobDescription(
        id=_uuid.uuid4(), user_id=_uuid.UUID(TEST_USER_ID), title="T",
        raw_text="need Python and Kubernetes",
        parsed={"agent1": {
            "exact_technical_tools": ["Python", "Kubernetes"],
            "methodologies_and_frameworks": [], "domain_expertise_themes": [],
            "seniority_indicators": [], "ats_filter_phrases": [],
            "core_responsibilities": [], "target_job_titles": [],
            "nice_to_have_skills": [], "importance": {},
        }, "semantic": {"fingerprint": "x", "verdicts": {}}},
        status="applied",
    )
    sess = TailoringSession(
        id=_uuid.uuid4(), user_id=_uuid.UUID(TEST_USER_ID), jd_id=jd.id,
        status="completed", ats_score=100, matched_skills=[], missing_skills=[],
        company_keywords=[], suggested_skills=[], ats_fixes=[],
        # The tailored bullet mentions both tools -> scores 100 on its own.
        tailored_content={"skills": [],
                          "experience": [{"title": "E", "bullets": ["Shipped Python services on Kubernetes"]}]},
    )
    sess.jd = jd
    return sess


async def _post_project_score(sess, payload):
    override, mock_session = make_mock_db()
    res = MagicMock(); res.scalar_one_or_none.return_value = sess
    mock_session.execute = AsyncMock(return_value=res)
    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.ai.get_ai_provider", return_value=MagicMock()):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                return await client.post("/ai/project-score", json=payload, headers=make_auth_header())
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_project_score_scores_the_content_the_client_sends():
    """Rejecting the tailored bullet reverts it to the original, which no
    longer mentions Kubernetes — the projected score must drop."""
    sess = _project_score_session()
    r = await _post_project_score(sess, {
        "session_id": str(sess.id),
        "accepted_fix_ids": [],
        "content": {"skills": [], "experience": [{"title": "E", "bullets": ["Shipped Python services"]}]},
    })
    assert r.status_code == 200
    assert r.json()["projected_score"] == 50   # Python only, Kubernetes gone


@pytest.mark.asyncio
async def test_project_score_without_a_content_override_uses_the_session():
    sess = _project_score_session()
    r = await _post_project_score(sess, {"session_id": str(sess.id), "accepted_fix_ids": []})
    assert r.status_code == 200
    assert r.json()["projected_score"] == 100


@pytest.mark.asyncio
async def test_project_score_rejects_an_oversized_content_override():
    sess = _project_score_session()
    r = await _post_project_score(sess, {
        "session_id": str(sess.id),
        "content": {"experience": [{"title": "E", "bullets": ["x" * 250_000]}]},
    })
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_get_session_returns_reverted_bullets():
    """The fact-lock guard's rejections have to reach the review screen —
    a bullet silently left unchanged is indistinguishable from one the
    pipeline chose not to touch."""
    from app.db.models import TailoringSession
    import uuid as _uuid

    override, mock_session = make_mock_db()
    sess = TailoringSession(
        id=_uuid.uuid4(), user_id=_uuid.UUID(TEST_USER_ID), jd_id=_uuid.uuid4(),
        status="completed", ats_score=70, matched_skills=[], missing_skills=[],
        company_keywords=[], suggested_skills=[], ats_fixes=[],
        tailored_content={"experience": []},
        reverted_bullets=[{"bullet_id": "exp0_b0", "reasons": ["invented metric(s) not in the original bullet: 2"],
                           "original_text": "Built checkout.", "rejected_text": "Built checkout for 2M users."}],
    )
    res = MagicMock(); res.scalar_one_or_none.return_value = sess
    mock_session.execute = AsyncMock(return_value=res)
    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get(f"/ai/sessions/{sess.id}", headers=make_auth_header())
        assert r.status_code == 200
        body = r.json()
        assert body["reverted_bullets"][0]["bullet_id"] == "exp0_b0"
        assert "invented" in body["reverted_bullets"][0]["reasons"][0]
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_get_session_defaults_reverted_bullets_to_empty_for_older_sessions():
    from app.db.models import TailoringSession
    import uuid as _uuid

    override, mock_session = make_mock_db()
    sess = TailoringSession(
        id=_uuid.uuid4(), user_id=_uuid.UUID(TEST_USER_ID), jd_id=_uuid.uuid4(),
        status="completed", ats_score=70, matched_skills=[], missing_skills=[],
        company_keywords=[], suggested_skills=[], ats_fixes=[],
        tailored_content={"experience": []}, reverted_bullets=None,
    )
    res = MagicMock(); res.scalar_one_or_none.return_value = sess
    mock_session.execute = AsyncMock(return_value=res)
    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get(f"/ai/sessions/{sess.id}", headers=make_auth_header())
        assert r.json()["reverted_bullets"] == []
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_get_session_returns_bullet_rationale():
    from app.db.models import TailoringSession
    import uuid as _uuid

    override, mock_session = make_mock_db()
    sess = TailoringSession(
        id=_uuid.uuid4(), user_id=_uuid.UUID(TEST_USER_ID), jd_id=_uuid.uuid4(),
        status="completed", ats_score=70, matched_skills=[], missing_skills=[],
        company_keywords=[], suggested_skills=[], ats_fixes=[],
        tailored_content={"experience": []},
        bullet_rationale={"exp0_b0": {"responsibility": "own checkout delivery",
                                      "keywords": ["Python"]}},
    )
    res = MagicMock(); res.scalar_one_or_none.return_value = sess
    mock_session.execute = AsyncMock(return_value=res)
    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get(f"/ai/sessions/{sess.id}", headers=make_auth_header())
        assert r.json()["bullet_rationale"]["exp0_b0"]["responsibility"] == "own checkout delivery"
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_get_session_defaults_bullet_rationale_for_older_sessions():
    from app.db.models import TailoringSession
    import uuid as _uuid

    override, mock_session = make_mock_db()
    sess = TailoringSession(
        id=_uuid.uuid4(), user_id=_uuid.UUID(TEST_USER_ID), jd_id=_uuid.uuid4(),
        status="completed", ats_score=70, matched_skills=[], missing_skills=[],
        company_keywords=[], suggested_skills=[], ats_fixes=[],
        tailored_content={"experience": []}, bullet_rationale=None,
    )
    res = MagicMock(); res.scalar_one_or_none.return_value = sess
    mock_session.execute = AsyncMock(return_value=res)
    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get(f"/ai/sessions/{sess.id}", headers=make_auth_header())
        assert r.json()["bullet_rationale"] == {}
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_rewrite_bullet_refunds_the_credit_when_the_model_returns_nothing():
    """Regression: the provider used to return None for an empty response
    instead of raising, so the router's except/refund block was skipped and
    `rewritten.strip()` — which sits OUTSIDE the try — raised AttributeError.
    The user was charged a credit, got a 500, and was never refunded.

    Wired through the REAL provider rather than a hand-rolled mock, because
    the contract under test is exactly "the provider raises here".
    """
    from app.services.ai_engine.openai_provider import OpenAIProvider
    from app.db.models import Resume
    import uuid as _uuid

    override, mock_session = make_mock_db()
    res = MagicMock(); res.scalar_one_or_none.return_value = Resume(
        id=_uuid.uuid4(), user_id=_uuid.UUID(TEST_USER_ID), title="R",
        content={"experience": []}, template_id="ats_clean",
    )
    mock_session.execute = AsyncMock(return_value=res)

    client_mock = MagicMock()
    empty = MagicMock(output_text="", status="completed", usage=None)
    empty.incomplete_details = None
    empty.output = []
    client_mock.responses.create = AsyncMock(return_value=empty)
    with patch("app.services.ai_engine.openai_provider.AsyncOpenAI", return_value=client_mock):
        provider = OpenAIProvider(api_key="fake", fast_model="f", premium_model="p")

    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.ai.get_ai_provider", return_value=provider), \
             patch("app.routers.ai.spend_credits", new=AsyncMock()), \
             patch("app.routers.ai.refund_credits", new=AsyncMock()) as refund:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                with pytest.raises(Exception):
                    await c.post(
                        "/ai/rewrite-bullet",
                        json={"bullet_text": "Built checkout", "mode": "rewrite",
                              "humanize_level": 50, "field": "bullet"},
                        headers=make_auth_header(),
                    )
        refund.assert_awaited_once()
    finally:
        app.dependency_overrides.pop(get_db, None)


def _gap_fix_session():
    """A session whose one gap fix is a naturally-worded bullet — it closes
    "infrastructure as code" without containing the phrase."""
    from app.db.models import TailoringSession, JobDescription
    import uuid as _uuid

    jd = JobDescription(
        id=_uuid.uuid4(), user_id=_uuid.UUID(TEST_USER_ID), title="T",
        raw_text="need Python and IaC",
        parsed={"agent1": {
            "exact_technical_tools": ["Python"],
            "methodologies_and_frameworks": [], "domain_expertise_themes": [],
            "seniority_indicators": [], "ats_filter_phrases": ["infrastructure as code"],
            "core_responsibilities": [], "target_job_titles": [],
            "nice_to_have_skills": [], "importance": {},
        }, "semantic": {"fingerprint": "x", "verdicts": {"infrastructure as code": "missing"}}},
        status="applied",
    )
    sess = TailoringSession(
        id=_uuid.uuid4(), user_id=_uuid.UUID(TEST_USER_ID), jd_id=jd.id,
        status="completed", ats_score=50, matched_skills=[], missing_skills=[],
        company_keywords=[], suggested_skills=[],
        tailored_content={"skills": ["Python"],
                          "experience": [{"title": "E", "bullets": ["Used Python"]}]},
        ats_fixes=[{
            "id": "bullet:infrastructure-as-code", "type": "bullet",
            "gap": "infrastructure as code", "importance": "high", "grounded": False,
            "text": "Automated cloud provisioning using declarative configuration templates.",
            "experience_index": 0, "score_delta": 50, "default_accept": False,
        }],
    )
    sess.jd = jd
    return sess


@pytest.mark.asyncio
async def test_projected_score_credits_an_accepted_gap_bullet_written_naturally():
    """Regression: the projected score only moved for a fix whose text echoed
    the JD phrase verbatim, so accepting a well-written gap bullet appeared to
    be worth nothing."""
    sess = _gap_fix_session()
    r = await _post_project_score(sess, {
        "session_id": str(sess.id),
        "accepted_fix_ids": ["bullet:infrastructure-as-code"],
    })
    assert r.status_code == 200
    assert r.json()["projected_score"] == 100


@pytest.mark.asyncio
async def test_projected_score_credits_the_gap_when_the_client_sends_merged_content():
    """The client applies fixes itself and sends the merged résumé, but still
    reports which fixes it accepted — that's what names the gaps to credit."""
    sess = _gap_fix_session()
    r = await _post_project_score(sess, {
        "session_id": str(sess.id),
        "accepted_fix_ids": ["bullet:infrastructure-as-code"],
        "content": {"skills": ["Python"], "experience": [{"title": "E", "bullets": [
            "Used Python",
            "Automated cloud provisioning using declarative configuration templates.",
        ]}]},
    })
    assert r.json()["projected_score"] == 100


@pytest.mark.asyncio
async def test_projected_score_does_not_credit_a_gap_the_user_rejected():
    sess = _gap_fix_session()
    r = await _post_project_score(sess, {"session_id": str(sess.id), "accepted_fix_ids": []})
    assert r.json()["projected_score"] == 50


@pytest.mark.asyncio
async def test_get_session_returns_the_pre_tailoring_score():
    """The lift is the product's core claim. Without the before-score the UI
    can only show a bare number, which says nothing about what tailoring did."""
    from app.db.models import TailoringSession
    import uuid as _uuid

    override, mock_session = make_mock_db()
    sess = TailoringSession(
        id=_uuid.uuid4(), user_id=_uuid.UUID(TEST_USER_ID), jd_id=_uuid.uuid4(),
        status="completed", ats_score=81, ats_score_before=62,
        matched_skills=[], missing_skills=[], company_keywords=[],
        suggested_skills=[], ats_fixes=[], tailored_content={"experience": []},
    )
    res = MagicMock(); res.scalar_one_or_none.return_value = sess
    mock_session.execute = AsyncMock(return_value=res)
    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get(f"/ai/sessions/{sess.id}", headers=make_auth_header())
        assert r.json()["ats_score_before"] == 62
        assert r.json()["ats_score"] == 81
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_get_session_leaves_the_pre_tailoring_score_null_for_older_sessions():
    from app.db.models import TailoringSession
    import uuid as _uuid

    override, mock_session = make_mock_db()
    sess = TailoringSession(
        id=_uuid.uuid4(), user_id=_uuid.UUID(TEST_USER_ID), jd_id=_uuid.uuid4(),
        status="completed", ats_score=81, ats_score_before=None,
        matched_skills=[], missing_skills=[], company_keywords=[],
        suggested_skills=[], ats_fixes=[], tailored_content={"experience": []},
    )
    res = MagicMock(); res.scalar_one_or_none.return_value = sess
    mock_session.execute = AsyncMock(return_value=res)
    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get(f"/ai/sessions/{sess.id}", headers=make_auth_header())
        assert r.json()["ats_score_before"] is None
    finally:
        app.dependency_overrides.pop(get_db, None)


# ── The inline Rewrite button uses the pipeline's rules and fact-lock ────────

async def _post_rewrite(body, completion):
    override, mock_session = make_mock_db()
    from app.db.models import Resume
    import uuid as _uuid
    res = MagicMock(); res.scalar_one_or_none.return_value = Resume(
        id=_uuid.uuid4(), user_id=_uuid.UUID(TEST_USER_ID), title="R",
        content={"experience": []}, template_id="ats_clean")
    mock_session.execute = AsyncMock(return_value=res)
    provider = MagicMock()
    provider.complete = AsyncMock(return_value=completion)
    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.ai.get_ai_provider", return_value=provider), \
             patch("app.routers.ai.spend_credits", new=AsyncMock()), \
             patch("app.routers.ai.refund_credits", new=AsyncMock()):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                r = await c.post("/ai/rewrite-bullet", json=body, headers=make_auth_header())
        return r, provider
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_rewrite_bullet_sends_the_pipeline_rule_set():
    body = {"bullet_text": "Built the checkout flow", "mode": "rewrite",
            "humanize_level": 50, "field": "bullet", "jd_context": "Need Python."}
    _, provider = await _post_rewrite(body, "Engineered the checkout flow")
    system = provider.complete.call_args.args[0]
    assert "FACT LOCK" in system
    assert "PRESERVE SPECIFICS" in system


@pytest.mark.asyncio
async def test_rewrite_bullet_reverts_a_rewrite_that_invents_a_metric():
    """Same fact-lock the pipeline applies. Without it this endpoint was the
    one way to get a fabricated number into a resume."""
    body = {"bullet_text": "Built the checkout flow", "mode": "rewrite",
            "humanize_level": 50, "field": "bullet"}
    r, _ = await _post_rewrite(body, "Built a checkout flow serving 2M users")
    assert r.json()["rewritten_text"] == "Built the checkout flow"
    assert r.json()["reverted_reasons"]


@pytest.mark.asyncio
async def test_rewrite_bullet_returns_a_clean_rewrite_untouched():
    body = {"bullet_text": "Built the checkout flow", "mode": "rewrite",
            "humanize_level": 50, "field": "bullet"}
    r, _ = await _post_rewrite(body, "Engineered the checkout flow")
    assert r.json()["rewritten_text"] == "Engineered the checkout flow"
    assert r.json()["reverted_reasons"] == []


@pytest.mark.asyncio
async def test_the_summary_field_does_not_get_bullet_rules():
    """A summary is an 80-word paragraph, not a bullet — the bullet word cap
    and action-verb rule would be wrong instructions for it."""
    body = {"bullet_text": "Engineer with six years experience.", "mode": "rewrite",
            "humanize_level": 50, "field": "summary"}
    _, provider = await _post_rewrite(body, "Backend engineer with six years experience.")
    assert "PRESERVE SPECIFICS" not in provider.complete.call_args.args[0]
