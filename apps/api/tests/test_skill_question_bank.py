import uuid
import time
import pytest
import jwt as pyjwt
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from httpx import AsyncClient, ASGITransport
from app.services.tailoring import (
    get_or_generate_prep_questions,
    SkillQuestionData,
    SkillQuestionsWrapper,
)
from app.db.models import SkillQuestionBank
from app.main import app
from app.core.config import settings
from app.db.session import get_db

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


def make_mock_db_with_rows(rows):
    session = MagicMock()
    result = MagicMock()
    result.scalars.return_value.all.return_value = rows
    session.execute = AsyncMock(return_value=result)
    session.add = MagicMock()
    session.commit = AsyncMock()
    return session


@pytest.mark.asyncio
async def test_uses_cached_rows_without_calling_the_llm():
    cached = SkillQuestionBank(
        id=uuid.uuid4(),
        skill="kubernetes",
        topic="Technical",
        question="Describe how you've used Kubernetes in production.",
        answer_framework="STAR: ...",
    )
    db = make_mock_db_with_rows([cached])
    provider = MagicMock()
    provider.complete_structured = AsyncMock()

    result = await get_or_generate_prep_questions(
        ["Kubernetes"], {"skills": []}, provider, db
    )

    provider.complete_structured.assert_not_called()
    assert len(result) == 1
    assert result[0].question == cached.question
    assert result[0].topic == "Technical"
    assert result[0].order_index == 1


@pytest.mark.asyncio
async def test_generates_and_stores_only_for_uncovered_skills():
    cached = SkillQuestionBank(
        id=uuid.uuid4(),
        skill="kubernetes",
        topic="Technical",
        question="Describe how you've used Kubernetes in production.",
        answer_framework="STAR: ...",
    )
    db = make_mock_db_with_rows([cached])
    provider = MagicMock()
    provider.complete_structured = AsyncMock(
        return_value=SkillQuestionsWrapper(
            questions=[
                SkillQuestionData(
                    skill="GraphQL",
                    topic="Technical",
                    question="How would you design a GraphQL schema for this API?",
                    answer_framework="STAR: ...",
                )
            ]
        )
    )

    result = await get_or_generate_prep_questions(
        ["Kubernetes", "GraphQL"], {"skills": []}, provider, db
    )

    # Only the uncovered skill (GraphQL) was sent to the LLM — Kubernetes was cached.
    provider.complete_structured.assert_called_once()
    called_system_prompt = provider.complete_structured.call_args.args[0]
    assert "GraphQL" in called_system_prompt
    assert "Kubernetes" not in called_system_prompt

    # The new question was persisted to the bank.
    db.add.assert_called_once()
    added_row = db.add.call_args.args[0]
    assert added_row.skill == "graphql"
    db.commit.assert_awaited_once()

    assert len(result) == 2


@pytest.mark.asyncio
async def test_drops_llm_questions_for_skills_that_were_not_asked():
    db = make_mock_db_with_rows([])
    provider = MagicMock()
    provider.complete_structured = AsyncMock(
        return_value=SkillQuestionsWrapper(
            questions=[
                SkillQuestionData(
                    skill="Some Hallucinated Skill",
                    topic="Technical",
                    question="...",
                    answer_framework="...",
                )
            ]
        )
    )

    result = await get_or_generate_prep_questions(
        ["Rust"], {"skills": []}, provider, db
    )

    db.add.assert_not_called()
    assert result == []


@pytest.mark.asyncio
async def test_empty_missing_skills_returns_empty_without_db_or_llm_calls():
    db = make_mock_db_with_rows([])
    provider = MagicMock()
    provider.complete_structured = AsyncMock()

    result = await get_or_generate_prep_questions([], {"skills": []}, provider, db)

    assert result == []
    db.execute.assert_not_called()
    provider.complete_structured.assert_not_called()


@pytest.mark.asyncio
async def test_browse_questions_filters_by_topic():
    row = SkillQuestionBank(
        id=uuid.uuid4(),
        skill="kubernetes",
        topic="Technical",
        question="Describe how you've used Kubernetes in production.",
        answer_framework="STAR: ...",
        created_at=datetime.now(timezone.utc),
    )
    mock_session = MagicMock()
    result = MagicMock()
    result.scalars.return_value.all.return_value = [row]
    mock_session.execute = AsyncMock(return_value=result)

    async def override():
        yield mock_session

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get(
                "/ai/questions/browse?topic=Technical", headers=make_auth_header()
            )
        assert r.status_code == 200
        body = r.json()
        assert len(body) == 1
        assert body[0]["skill"] == "kubernetes"
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_browse_questions_requires_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/ai/questions/browse")
    assert r.status_code == 401
