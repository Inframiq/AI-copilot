import time
import uuid
import jwt as pyjwt
import pytest
from datetime import datetime, timezone
from httpx import AsyncClient, ASGITransport
from unittest.mock import AsyncMock, MagicMock, patch
from app.main import app
from app.core.config import settings
from app.db.session import get_db
from app.db.models import Resume, JobDescription

TEST_USER_ID = "00000000-0000-0000-0000-000000000001"


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
    from app.services.tailoring import ParsedJD

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

    app.dependency_overrides[get_db] = override
    try:
        with patch(
            "app.routers.jd.extract_jd_skills",
            new=AsyncMock(return_value=ParsedJD(required=["Python"], nice_to_have=[])),
        ):
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
        assert body["parsed_skills"] == ["Python"]
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_create_jd_requires_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post("/jd", json={"raw_text": "Some JD text"})
    assert r.status_code == 401


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


@pytest.mark.asyncio
async def test_tailor_resume_returns_200_and_creates_session():
    from app.services.tailoring import TailoringResult, PrepQuestionData

    override, mock_session = make_mock_db()
    resume = make_resume()
    jd = make_jd()

    # First execute() call resolves the resume lookup, second the JD lookup
    resume_result = MagicMock()
    resume_result.scalar_one_or_none.return_value = resume
    jd_result = MagicMock()
    jd_result.scalar_one_or_none.return_value = jd
    mock_session.execute = AsyncMock(side_effect=[resume_result, jd_result])

    # A real flush/commit assigns the Python-side uuid.uuid4() default the
    # moment each row is inserted — simulate that so PrepQuestionOut, which
    # requires non-null id/session_id, can validate against these mocks.
    from app.db.models import TailoringSession, PrepQuestion

    def fake_add(obj):
        if isinstance(obj, TailoringSession) and obj.id is None:
            obj.id = uuid.uuid4()

    def fake_add_all(objs):
        for obj in objs:
            if isinstance(obj, PrepQuestion) and obj.id is None:
                obj.id = uuid.uuid4()

    mock_session.add = MagicMock(side_effect=fake_add)
    mock_session.add_all = MagicMock(side_effect=fake_add_all)

    fake_result = TailoringResult(
        tailored_content={"experience": [{"title": "Eng", "bullets": ["Did Python stuff"]}]},
        matched_skills=["Python"],
        missing_skills=["AWS"],
        ats_score=50,
        prep_questions=[
            PrepQuestionData(
                topic="AWS", question="How would you use AWS?", answer_framework="STAR", order_index=1
            )
        ],
    )

    app.dependency_overrides[get_db] = override
    try:
        with patch(
            "app.routers.ai.run_tailoring_pipeline", new=AsyncMock(return_value=fake_result)
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                r = await client.post(
                    "/ai/tailor",
                    json={"resume_id": str(resume.id), "jd_id": str(jd.id), "humanize_level": 50},
                    headers=make_auth_header(),
                )
        assert r.status_code == 200
        body = r.json()
        assert body["ats_score"] == 50
        assert body["matched_skills"] == ["Python"]
        assert body["missing_skills"] == ["AWS"]
        assert len(body["questions"]) == 1
        mock_session.add.assert_called_once()  # the TailoringSession
        mock_session.add_all.assert_called_once()  # the PrepQuestion rows
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
