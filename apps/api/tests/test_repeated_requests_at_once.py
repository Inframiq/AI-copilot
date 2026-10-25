"""The same request sent several times at once gets its effect once (test ATK-038).

A double click, two tabs or a script can send one request many times in the
same instant. Each one-time effect has to come out once however they
interleave:

- interview questions for a run: one set, charged once. Both requests used to
  see "no questions yet", both ran the model and both saved a set — 20
  questions and 6 credits instead of 10 and 3;
- the 5-résumé limit: creates sent together at four résumés all counted four
  and all went in. That held for plain saves, generated résumés and uploads.

Already covered elsewhere, also against a real Postgres: credits can't be
overdrawn or a refill doubled (test_credits_concurrency.py), Save to JD
twice makes one résumé (test_save_to_jd_twice.py), and a follow-up answer is
claimed before it's charged (test_prep_followups.py).

Against a real Postgres: these are locks, which a mock can't show. Every
request is held at the risky point until the others get there too (or a
second passes: held by a lock), so the worst interleaving happens every run.
"""
import asyncio
import time
import uuid
from contextlib import asynccontextmanager, contextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import jwt as pyjwt
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core import credits
from app.core.config import settings
from app.core.rate_limit import limiter
from app.db.models import JobDescription, PrepQuestion, Resume, Subscription, TailoringSession, utcnow
from app.db.session import get_db
from app.main import app
from app.routers import jd as jd_router
from app.routers import resumes as resumes_router
from app.services import prep_questions
from app.services.tailoring import PrepQuestionData

USER = uuid.UUID("00000000-0000-0000-0000-000000000038")


def auth():
    payload = {"sub": str(USER), "email": "atk038@example.com", "aud": "authenticated",
               "exp": int(time.time()) + 3600}
    return {"Authorization": f"Bearer {pyjwt.encode(payload, settings.supabase_jwt_secret, algorithm='HS256')}"}


@pytest.fixture
async def Session(pg_uri, monkeypatch, ledger):
    # The real credit functions on the real balance, not conftest's ledger:
    # what a race does to the balance is half of what these tests check.
    monkeypatch.setattr(settings, "unlimited_credit_emails", "")
    for router in (jd_router, resumes_router):
        monkeypatch.setattr(router, "spend_credits", credits.spend_credits)
        monkeypatch.setattr(router, "refund_credits", credits.refund_credits)
    engine = create_async_engine(pg_uri, pool_size=10)
    from app.db.session import Base
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(c, checkfirst=True))
        await conn.execute(text(
            "CREATE TABLE IF NOT EXISTS career_profiles (user_id uuid primary key, master_resume_id uuid)"
        ))
        await conn.execute(text(
            "TRUNCATE career_profiles, job_descriptions, resumes, tailoring_sessions, prep_questions,"
            " prep_followups, resume_deletion_log, subscriptions CASCADE"
        ))
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async def real_db():
        async with Session() as s:
            yield s

    app.dependency_overrides[get_db] = real_db
    limiter.reset()
    async with Session() as s:
        s.add(Subscription(user_id=USER, plan="free", status="active", credits_remaining=50,
                           credits_allotment=50, current_period_start=utcnow(), current_period_end=None))
        await s.commit()
    yield Session
    app.dependency_overrides.pop(get_db, None)
    await engine.dispose()


@contextmanager
def held_until_all_arrive(target, name, n):
    """Wrap target.name so each caller waits (up to a second) for n callers to
    get there before going on. A caller held by a lock never arrives, so the
    others go on after the second."""
    real = getattr(target, name)
    arrived = 0
    everyone = asyncio.Event()

    async def waiting(*args, **kwargs):
        nonlocal arrived
        result = await real(*args, **kwargs)
        arrived += 1
        if arrived >= n:
            everyone.set()
        try:
            await asyncio.wait_for(everyone.wait(), timeout=1.0)
        except asyncio.TimeoutError:
            pass
        return result

    with patch.object(target, name, waiting):
        yield


@asynccontextmanager
async def _client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def _credits(Session):
    async with Session() as s:
        return (await s.execute(
            select(Subscription.credits_remaining).where(Subscription.user_id == USER)
        )).scalar_one()


async def _resume_count(Session):
    async with Session() as s:
        return (await s.execute(select(func.count(Resume.id)).where(Resume.user_id == USER))).scalar_one()


async def _resumes(Session, n):
    async with Session() as s:
        for i in range(n):
            s.add(Resume(user_id=USER, title=f"R{i + 1}", content={}, template_id="ats_clean"))
        await s.commit()


# ── Interview questions ─────────────────────────────────────────────────────

def _ten_questions():
    return [
        PrepQuestionData(topic="Technical", question=f"Question {i}", likely_answer="An answer.",
                         follow_up="And then?", is_gap_based=False, source="requirement",
                         basis="Own the pipeline", order_index=i)
        for i in range(1, 11)
    ]


@contextmanager
def question_model(n):
    """The question model, stood in for: records a model call as the real one
    does, and holds until all n requests are generating at once."""
    from app.core.usage import record_call

    arrived = 0
    everyone = asyncio.Event()

    async def generate(*args, **kwargs):
        nonlocal arrived
        record_call(call_name="prep_questions_interview", model="m", model_tier="premium",
                    input_tokens=1, output_tokens=1, reasoning_tokens=0, total_tokens=2)
        arrived += 1
        if arrived >= n:
            everyone.set()
        await asyncio.wait_for(everyone.wait(), timeout=2.0)
        return _ten_questions()

    usage_db = MagicMock()
    usage_db.return_value.__aenter__.return_value.add_all = MagicMock()
    with patch.object(prep_questions, "get_or_generate_prep_questions", generate), \
         patch.object(prep_questions, "_agent1_parse_jd", new=AsyncMock()), \
         patch.object(prep_questions, "get_ai_provider", return_value=MagicMock()), \
         patch("app.db.session.AsyncSessionLocal", new=usage_db):
        yield


async def _saved_jd(Session):
    """A JD with its tailored résumé saved and the completed run it came from."""
    async with Session() as s:
        resume = Resume(user_id=USER, title="Tailored", content={"experience": []}, template_id="ats_clean")
        s.add(resume)
        await s.flush()
        jd = JobDescription(user_id=USER, title="Backend @ Acme", raw_text="x",
                            parsed={"agent1": {"core_responsibilities": ["Own the pipeline"]}},
                            tailored_resume_id=resume.id)
        s.add(jd)
        await s.flush()
        run = TailoringSession(user_id=USER, jd_id=jd.id, status="completed",
                               matched_skills=["Python"], missing_skills=["AWS"])
        s.add(run)
        await s.commit()
        return jd.id, run.id


async def _questions(Session, run_id):
    async with Session() as s:
        return (await s.execute(
            select(func.count(PrepQuestion.id)).where(PrepQuestion.session_id == run_id)
        )).scalar_one()


async def test_questions_asked_for_twice_at_once_are_made_and_charged_once(Session):
    jd_id, run_id = await _saved_jd(Session)
    with question_model(2):
        async with _client() as c:
            a, b = await asyncio.gather(
                c.post(f"/jd/{jd_id}/prep-questions", headers=auth(), json={}),
                c.post(f"/jd/{jd_id}/prep-questions", headers=auth(), json={}),
            )
    assert a.status_code == b.status_code == 200, (a.text, b.text)
    assert await _questions(Session, run_id) == 10  # one set, not two
    assert a.json()["questions_total"] == b.json()["questions_total"] == 10
    assert await _credits(Session) == 50 - 3  # charged once: the second got its 3 back


async def test_five_requests_at_once_still_make_one_set(Session):
    jd_id, run_id = await _saved_jd(Session)
    with question_model(5):
        async with _client() as c:
            replies = await asyncio.gather(*[
                c.post(f"/jd/{jd_id}/prep-questions", headers=auth(), json={}) for _ in range(5)
            ])
    assert [r.status_code for r in replies] == [200] * 5
    assert await _questions(Session, run_id) == 10
    assert await _credits(Session) == 47


async def test_asking_again_later_returns_the_set_free(Session):
    jd_id, run_id = await _saved_jd(Session)
    with question_model(1):
        async with _client() as c:
            assert (await c.post(f"/jd/{jd_id}/prep-questions", headers=auth(), json={})).status_code == 200
            assert (await c.post(f"/jd/{jd_id}/prep-questions", headers=auth(), json={})).status_code == 200
    assert await _questions(Session, run_id) == 10
    assert await _credits(Session) == 47


# ── The 5-résumé limit ──────────────────────────────────────────────────────

async def test_saves_sent_together_at_four_resumes_stop_at_five(Session):
    await _resumes(Session, 4)
    with held_until_all_arrive(resumes_router, "_ensure_room_for_a_new_resume", 3):
        async with _client() as c:
            replies = await asyncio.gather(*[
                c.post("/resumes", headers=auth(), json={"title": f"New {i}", "content": {}}) for i in range(3)
            ])
    assert sorted(r.status_code for r in replies) == [201, 409, 409], [r.text for r in replies]
    assert await _resume_count(Session) == 5


def _generated():
    from app.services.resume_validator import ValidationResult
    return SimpleNamespace(resume_content={"contact": {"name": "Ada"}}, underfilled=False,
                           validation=ValidationResult(valid=True))


async def test_generated_resumes_sent_together_stop_at_five_and_refund_the_refused(Session):
    await _resumes(Session, 4)

    async def generate(*args, **kwargs):
        await asyncio.sleep(0.05)
        return _generated()

    body = {"candidate_type": "experienced", "profile": {"contact": {"name": "Ada"}}}
    with held_until_all_arrive(resumes_router, "_ensure_room_for_a_new_resume", 2), \
         patch.object(resumes_router, "generate_resume", generate), \
         patch.object(resumes_router, "get_ai_provider", return_value=MagicMock()):
        async with _client() as c:
            replies = await asyncio.gather(*[
                c.post("/resumes/generate", headers=auth(), json=body) for _ in range(2)
            ])
    assert sorted(r.status_code for r in replies) == [201, 409], [r.text for r in replies]
    assert await _resume_count(Session) == 5
    assert await _credits(Session) == 50 - 3  # the refused one was given its credits back


async def test_uploads_sent_together_stop_at_five_and_clean_up_the_refused(Session):
    import io
    from tests.test_resumes_more import _FAKE_PDF_BYTES

    await _resumes(Session, 4)

    async def parse(*args, **kwargs):
        await asyncio.sleep(0.05)
        return {"contact": {"name": "Ada"}, "experience": [], "education": [], "skills": []}

    storage = MagicMock()

    async def upload(c):
        return await c.post(
            "/resumes/parse-upload", headers=auth(), data={"template_id": "ats_clean"},
            files={"file": ("resume.pdf", io.BytesIO(_FAKE_PDF_BYTES), "application/pdf")},
        )

    with held_until_all_arrive(resumes_router, "_ensure_room_for_a_new_resume", 2), \
         patch.object(resumes_router, "_supabase", return_value=storage), \
         patch.object(resumes_router.sandbox, "extract_pdf_text", return_value="Ada"), \
         patch.object(resumes_router, "parse_resume_text", parse), \
         patch.object(resumes_router, "get_ai_provider", return_value=MagicMock()):
        async with _client() as c:
            replies = await asyncio.gather(upload(c), upload(c))
    assert sorted(r.status_code for r in replies) == [201, 409], [r.text for r in replies]
    assert await _resume_count(Session) == 5
    assert await _credits(Session) == 50 - 1  # the refused one was given its credit back
    bucket = storage.storage.from_.return_value
    stored = [c.args[0] for c in bucket.upload.call_args_list]
    removed = [p for c in bucket.remove.call_args_list for p in c.args[0]]
    assert len(stored) == 2 and len(removed) == 1 and removed[0] in stored  # the refused one's file
