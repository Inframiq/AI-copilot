"""Follow-up answers in the Interview Center, against a real Postgres.

Each question carries a chain of follow-ups. The next follow-up is shown
free; its likely answer is written only when the user asks, costs
"followup_answer" credits, and adds the follow-up after it. The row is
claimed before the charge so a double click can't pay twice, and a failed
answer gives the credits back.

Skipped where pgserver isn't installed.
"""
import asyncio
import contextlib
import uuid
from datetime import timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text

from app.core.credits import CREDIT_COSTS
from app.db.models import (
    FreeGrantLedger, JobDescription, PrepFollowup, PrepQuestion, Resume, Subscription,
    TailoringSession, utcnow,
)
from app.services import prep_questions
from app.services.tailoring import FollowupAnswerData

COST = CREDIT_COSTS["followup_answer"]
_TABLES = (Subscription, FreeGrantLedger, Resume, JobDescription, TailoringSession, PrepQuestion, PrepFollowup)


@pytest.fixture
async def Session(pg_uri):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    engine = create_async_engine(pg_uri, pool_size=10, max_overflow=0)
    async with engine.begin() as conn:
        for model in _TABLES:
            await conn.run_sync(lambda c, t=model.__table__: t.create(c, checkfirst=True))
        await conn.execute(text(
            "TRUNCATE subscriptions, free_grant_ledger, prep_followups, prep_questions, "
            "tailoring_sessions, job_descriptions, resumes CASCADE"
        ))
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture(autouse=True)
def no_usage_log(monkeypatch):
    """record_ai_usage writes through the app's own engine; not here."""
    @contextlib.asynccontextmanager
    async def noop(*a, **k):
        yield
    monkeypatch.setattr(prep_questions, "record_ai_usage", noop)
    monkeypatch.setattr(prep_questions, "get_ai_provider", lambda: MagicMock())


async def _seed(Session, *, credits=50, answered=0):
    """A user with a saved résumé, a JD, a run, one question and a chain of
    `answered` answered follow-ups plus one unanswered at the end. Returns
    (user_id, question_id, [follow-up ids in order])."""
    uid = uuid.uuid4()
    async with Session() as s:
        s.add(Subscription(
            user_id=uid, plan="free", status="active", credits_remaining=credits,
            credits_allotment=50, current_period_start=utcnow(),
        ))
        resume = Resume(id=uuid.uuid4(), user_id=uid, title="Saved", content={"experience": ["as saved"]})
        s.add(resume)
        await s.flush()
        jd = JobDescription(id=uuid.uuid4(), user_id=uid, title="Engineer", raw_text="Need Python.", tailored_resume_id=resume.id)
        s.add(jd)
        await s.flush()
        sess = TailoringSession(
            id=uuid.uuid4(), user_id=uid, jd_id=jd.id, status="completed",
            matched_skills=["Python"], missing_skills=["AWS"], tailored_content={"experience": ["run"]},
        )
        s.add(sess)
        await s.flush()
        q = PrepQuestion(
            id=uuid.uuid4(), session_id=sess.id, topic="Technical", question="Tell me about the pipeline.",
            answer_framework="", likely_answer="Context: the pipeline.", is_gap_based=False,
            source="requirement", basis="x", order_index=1,
        )
        s.add(q)
        await s.flush()
        ids = []
        for pos in range(1, answered + 2):
            f = PrepFollowup(
                id=uuid.uuid4(), question_id=q.id, position=pos, question=f"Follow-up {pos}?",
                answer=f"Answer {pos}." if pos <= answered else None,
            )
            s.add(f)
            ids.append(f.id)
        await s.commit()
    return uid, q.id, ids


async def _balance(Session, uid):
    async with Session() as s:
        return (await s.execute(select(Subscription.credits_remaining).where(Subscription.user_id == uid))).scalar_one()


async def _chain(Session, qid):
    async with Session() as s:
        rows = (await s.execute(
            select(PrepFollowup).where(PrepFollowup.question_id == qid).order_by(PrepFollowup.position)
        )).scalars().all()
        return [(r.position, r.question, r.answer, r.claimed_at) for r in rows]


def _model(answer="Direct answer: we diffed totals.", next_q="What broke first?"):
    return AsyncMock(return_value=FollowupAnswerData(likely_answer=answer, next_follow_up=next_q))


@pytest.mark.asyncio
async def test_answering_writes_the_answer_charges_once_and_adds_the_next_follow_up(Session):
    uid, qid, (fid,) = await _seed(Session)
    model = _model()
    with patch.object(prep_questions, "answer_followup", new=model):
        async with Session() as s:
            chain = await prep_questions.answer_followup_for_user(s, uid, None, fid)

    assert [(f.position, f.question, f.answer) for f in chain] == [
        (1, "Follow-up 1?", "Direct answer: we diffed totals."),
        (2, "What broke first?", None),
    ]
    assert await _balance(Session, uid) == 50 - COST
    assert (await _chain(Session, qid))[0][3] is None  # the claim is released
    kw = model.call_args.kwargs
    assert kw["resume_content"] == {"experience": ["as saved"]}  # the résumé as saved, not the run
    assert kw["question"] == "Tell me about the pipeline."
    assert kw["likely_answer"] == "Context: the pipeline."
    assert kw["follow_up"] == "Follow-up 1?"
    assert kw["earlier"] == []


@pytest.mark.asyncio
async def test_a_deeper_answer_builds_on_the_earlier_ones(Session):
    uid, qid, ids = await _seed(Session, answered=2)
    model = _model(next_q="")
    with patch.object(prep_questions, "answer_followup", new=model):
        async with Session() as s:
            chain = await prep_questions.answer_followup_for_user(s, uid, None, ids[-1])

    assert model.call_args.kwargs["earlier"] == [("Follow-up 1?", "Answer 1."), ("Follow-up 2?", "Answer 2.")]
    # No next follow-up from the model: the chain ends here.
    assert [f.position for f in chain] == [1, 2, 3] and chain[-1].answer


@pytest.mark.asyncio
async def test_an_answer_already_written_comes_back_free(Session):
    uid, qid, ids = await _seed(Session, answered=1)
    model = _model()
    with patch.object(prep_questions, "answer_followup", new=model):
        async with Session() as s:
            chain = await prep_questions.answer_followup_for_user(s, uid, None, ids[0])

    model.assert_not_awaited()
    assert await _balance(Session, uid) == 50
    assert [f.answer for f in chain] == ["Answer 1.", None]


@pytest.mark.asyncio
async def test_a_double_click_is_charged_once(Session):
    uid, qid, (fid,) = await _seed(Session)
    release = asyncio.Event()
    started = asyncio.Event()

    async def slow(**kwargs):
        started.set()
        await release.wait()
        return FollowupAnswerData(likely_answer="Direct answer: once.", next_follow_up="Next?")

    model = AsyncMock(side_effect=slow)

    async def call():
        async with Session() as s:
            return await prep_questions.answer_followup_for_user(s, uid, None, fid)

    with patch.object(prep_questions, "answer_followup", new=model):
        first = asyncio.create_task(call())
        await asyncio.wait_for(started.wait(), timeout=5)
        with pytest.raises(HTTPException) as exc:
            await call()
        release.set()
        chain = await first

    assert exc.value.status_code == 409
    assert model.await_count == 1
    assert await _balance(Session, uid) == 50 - COST
    assert chain[0].answer == "Direct answer: once."


@pytest.mark.asyncio
async def test_a_stale_claim_is_taken_over(Session):
    """A request that died mid-answer leaves its claim; it doesn't lock the
    follow-up forever."""
    uid, qid, (fid,) = await _seed(Session)
    async with Session() as s:
        f = await s.get(PrepFollowup, fid)
        f.claimed_at = utcnow() - timedelta(minutes=10)
        await s.commit()

    with patch.object(prep_questions, "answer_followup", new=_model()):
        async with Session() as s:
            chain = await prep_questions.answer_followup_for_user(s, uid, None, fid)
    assert chain[0].answer


@pytest.mark.asyncio
async def test_a_failed_answer_gives_the_credits_back_and_releases_the_claim(Session):
    uid, qid, (fid,) = await _seed(Session)
    with patch.object(prep_questions, "answer_followup", new=AsyncMock(side_effect=RuntimeError("down"))):
        async with Session() as s:
            with pytest.raises(HTTPException) as exc:
                await prep_questions.answer_followup_for_user(s, uid, None, fid)

    assert exc.value.status_code == 502
    assert "No credits were used" in exc.value.detail
    assert await _balance(Session, uid) == 50
    assert await _chain(Session, qid) == [(1, "Follow-up 1?", None, None)]


@pytest.mark.asyncio
async def test_an_empty_answer_counts_as_a_failure(Session):
    uid, qid, (fid,) = await _seed(Session)
    with patch.object(prep_questions, "answer_followup", new=_model(answer="  ")):
        async with Session() as s:
            with pytest.raises(HTTPException) as exc:
                await prep_questions.answer_followup_for_user(s, uid, None, fid)
    assert exc.value.status_code == 502
    assert await _balance(Session, uid) == 50


@pytest.mark.asyncio
async def test_out_of_credits_is_refused_before_the_model_runs(Session):
    uid, qid, (fid,) = await _seed(Session, credits=COST - 1)
    model = _model()
    with patch.object(prep_questions, "answer_followup", new=model):
        async with Session() as s:
            with pytest.raises(HTTPException) as exc:
                await prep_questions.answer_followup_for_user(s, uid, None, fid)

    assert exc.value.status_code == 402
    model.assert_not_awaited()
    assert await _balance(Session, uid) == COST - 1
    assert (await _chain(Session, qid))[0][3] is None  # released, so it can be retried after a top-up


@pytest.mark.asyncio
async def test_another_users_follow_up_is_not_found(Session):
    _, _, (fid,) = await _seed(Session)
    model = _model()
    with patch.object(prep_questions, "answer_followup", new=model):
        async with Session() as s:
            with pytest.raises(HTTPException) as exc:
                await prep_questions.answer_followup_for_user(s, uuid.uuid4(), None, fid)
    assert exc.value.status_code == 404
    model.assert_not_awaited()


@pytest.mark.asyncio
async def test_the_endpoint_returns_the_chain():
    from app.db.session import get_db
    from app.main import app
    from tests.test_jd_and_tailor_endpoints import make_auth_header, make_mock_db

    fid, qid = uuid.uuid4(), uuid.uuid4()
    chain = [
        PrepFollowup(id=fid, question_id=qid, position=1, question="Q1?", answer="A1."),
        PrepFollowup(id=uuid.uuid4(), question_id=qid, position=2, question="Q2?", answer=None),
    ]
    override, _ = make_mock_db()
    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.ai.answer_followup_for_user", new=AsyncMock(return_value=chain)) as svc:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                r = await c.post(f"/ai/followups/{fid}/answer", headers=make_auth_header())
        assert r.status_code == 200
        assert [(f["position"], f["question"], f["answer"]) for f in r.json()] == [
            (1, "Q1?", "A1."), (2, "Q2?", None),
        ]
        assert svc.call_args.args[3] == fid
    finally:
        app.dependency_overrides.pop(get_db, None)
