"""The same user in two tabs or on two devices at once, on a real Postgres.

Postgres never shows one session another's uncommitted writes (no dirty
reads at any level). What two sessions of one user could still do: write
over each other from stale copies (lost updates), both pass one check
(write skew), act on a row the other just removed, or read a list across
the other's commit. Each test here is one of those, found in the app and
fixed; each fails on the code before the fix.
"""
import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import delete, select, text

from app.db.models import (
    CoverLetter, JobDescription, PrepFollowup, PrepQuestion, Resume, TailoringSession,
)
from app.db.session import read_from_one_snapshot
from app.routers import ai as ai_router
from app.routers import cover_letters as letters_router
from app.services import prep_questions
from app.services.tailoring import FollowupAnswerData, JDAnalysis, JDMatchAnalysis
from tests.test_jd_and_tailor_endpoints import usage_log_offline
from tests.test_repeated_requests_at_once import (  # noqa: F401 — Session is a fixture
    USER, Session, _client, _credits, auth, held_until_all_arrive,
)


async def _jd(Session, **fields):
    async with Session() as s:
        resume = Resume(user_id=USER, title="Tailored", content={"experience": []}, template_id="ats_clean")
        s.add(resume)
        await s.flush()
        jd = JobDescription(user_id=USER, title="Backend @ Acme", raw_text="Need Python.",
                            tailored_resume_id=resume.id, **fields)
        s.add(jd)
        await s.commit()
        return jd.id, resume.id


# ── Cover letters ──────────────────────────────────────────────────────────

async def _letters(Session, jd_id, resume_id, n, saved_at=None):
    async with Session() as s:
        await s.execute(delete(CoverLetter))
        rows = [
            CoverLetter(user_id=USER, jd_id=jd_id, resume_id=resume_id, status="completed",
                        title="Cover letter — Acme", content=f"Letter {i}", saved_at=saved_at)
            for i in range(n)
        ]
        s.add_all(rows)
        await s.commit()
        return [r.id for r in rows]


async def test_two_letters_for_one_job_saved_at_once_get_different_names(Session):
    """Write skew: both saves looked for a free number before either kept
    one, so both took the same name."""
    jd_id, resume_id = await _jd(Session)
    a, b = await _letters(Session, jd_id, resume_id, 2)
    with held_until_all_arrive(letters_router, "_numbered_title", 2):
        async with _client() as c:
            ra, rb = await asyncio.gather(
                c.patch(f"/cover-letters/{a}", headers=auth(), json={"content": "Kept A"}),
                c.patch(f"/cover-letters/{b}", headers=auth(), json={"content": "Kept B"}),
            )
    assert ra.status_code == rb.status_code == 200, (ra.text, rb.text)
    assert {ra.json()["title"], rb.json()["title"]} == {"Cover letter - Acme", "Cover letter - Acme (2)"}


async def test_a_letter_saved_in_another_tab_is_not_overwritten(Session):
    """Lost update: two tabs editing one letter, the last save silently won.
    A save from the version a tab loaded is refused once another has saved."""
    jd_id, resume_id = await _jd(Session)
    loaded = datetime(2026, 10, 1, tzinfo=timezone.utc)
    (letter,) = await _letters(Session, jd_id, resume_id, 1, saved_at=loaded)
    async with _client() as c:
        first = await c.patch(f"/cover-letters/{letter}", headers=auth(),
                              json={"content": "Tab one", "expected_saved_at": loaded.isoformat()})
        stale = await c.patch(f"/cover-letters/{letter}", headers=auth(),
                              json={"content": "Tab two", "expected_saved_at": loaded.isoformat()})
        assert first.status_code == 200
        assert stale.status_code == 409
        assert stale.json()["detail"]["code"] == "letter_changed"
        newer = stale.json()["detail"]["saved_at"]
        def when(v):
            return datetime.fromisoformat(v.replace("Z", "+00:00"))
        assert when(newer) == when(first.json()["saved_at"])
        # "Keep this version": saves over exactly the newer one.
        kept = await c.patch(f"/cover-letters/{letter}", headers=auth(),
                             json={"content": "Tab two", "expected_saved_at": newer})
    assert kept.status_code == 200
    async with Session() as s:
        assert (await s.get(CoverLetter, letter)).content == "Tab two"


async def test_two_tabs_saving_one_letter_at_once_cannot_both_win(Session):
    jd_id, resume_id = await _jd(Session)
    loaded = datetime(2026, 10, 1, tzinfo=timezone.utc)
    (letter,) = await _letters(Session, jd_id, resume_id, 1, saved_at=loaded)
    async with _client() as c:
        replies = await asyncio.gather(*[
            c.patch(f"/cover-letters/{letter}", headers=auth(),
                    json={"content": f"Tab {i}", "expected_saved_at": loaded.isoformat()})
            for i in range(2)
        ])
    assert sorted(r.status_code for r in replies) == [200, 409], [r.text for r in replies]


# ── The JD's cached analysis ───────────────────────────────────────────────

def _analysis(tool):
    return JDMatchAnalysis(
        jd_analysis=JDAnalysis(exact_technical_tools=[tool], methodologies_and_frameworks=[],
                               domain_expertise_themes=[], seniority_indicators=[], ats_filter_phrases=[]),
        matched_skills=[], missing_skills=[tool], ats_score=40, company_keywords=[],
        semantic_verdicts={},
    )


async def test_two_analyses_at_once_keep_the_first_cached_parse(Session):
    """Lost update: each analysis wrote back the whole cache it had read
    before its model call, so the later one replaced the parse the first
    had stored — the parse the shown score came from."""
    jd_id, resume_id = await _jd(Session, parsed={})
    both_started = asyncio.Event()
    started = 0

    async def analyze(content, jd_text, provider, **kwargs):
        nonlocal started
        from app.core.usage import record_call
        record_call(call_name="agent1_parse_jd", model="m", model_tier="fast",
                    input_tokens=1, output_tokens=1, reasoning_tokens=0, total_tokens=2)
        started += 1
        mine = started
        if started == 2:
            both_started.set()
        await asyncio.wait_for(both_started.wait(), timeout=2)
        # The first to start finishes first; the second is the late writer.
        await asyncio.sleep(0 if mine == 1 else 0.3)
        return _analysis("First" if mine == 1 else "Second")

    with patch.object(ai_router, "analyze_jd_match", analyze), \
         patch.object(ai_router, "get_ai_provider"), usage_log_offline():
        async with _client() as c:
            replies = await asyncio.gather(*[
                c.post("/ai/analyze", headers=auth(), json={"resume_id": str(resume_id), "jd_id": str(jd_id)})
                for _ in range(2)
            ])
    assert [r.status_code for r in replies] == [200, 200], [r.text for r in replies]
    async with Session() as s:
        parsed = (await s.get(JobDescription, jd_id)).parsed
    assert parsed["agent1"]["exact_technical_tools"] == ["First"]


# ── Interview questions ────────────────────────────────────────────────────

async def _question_with_followup(Session, jd_id):
    async with Session() as s:
        run = TailoringSession(user_id=USER, jd_id=jd_id, status="completed")
        s.add(run)
        await s.flush()
        q = PrepQuestion(session_id=run.id, topic="Technical", question="Q", answer_framework="",
                         likely_answer="Context: x.", is_gap_based=False, source="requirement",
                         basis="b", order_index=1)
        s.add(q)
        await s.flush()
        f = PrepFollowup(question_id=q.id, position=1, question="And then?")
        s.add(f)
        await s.commit()
        return run.id, q.id, f.id


async def test_a_followup_answer_for_a_set_replaced_meanwhile_is_refunded(Session):
    """Acting on a removed row: Regenerate in another tab replaced the set
    while a follow-up answer was being written; writing it then failed
    after the credits were taken."""
    jd_id, _ = await _jd(Session)
    _, qid, fid = await _question_with_followup(Session, jd_id)
    writing = asyncio.Event()
    replaced = asyncio.Event()

    async def answer(**kwargs):
        writing.set()
        await asyncio.wait_for(replaced.wait(), timeout=2)
        return FollowupAnswerData(likely_answer="Direct answer: yes.", next_follow_up="Why?")

    async def regenerate_elsewhere():
        await writing.wait()
        async with Session() as s:
            await s.execute(delete(PrepQuestion).where(PrepQuestion.id == qid))
            await s.commit()
        replaced.set()

    with patch.object(prep_questions, "answer_followup", answer), \
         patch.object(prep_questions, "get_ai_provider"), usage_log_offline():
        async with _client() as c:
            reply, _ = await asyncio.gather(
                c.post(f"/ai/followups/{fid}/answer", headers=auth()),
                regenerate_elsewhere(),
            )
    assert reply.status_code == 409, reply.text
    assert "No credits were used" in reply.json()["detail"]
    # Charged when the answer started (the real balance: the service's own
    # credit calls), given back when it couldn't be kept.
    assert await _credits(Session) == 50


async def test_marking_a_question_from_a_replaced_set_is_a_404(Session):
    jd_id, _ = await _jd(Session)
    _, qid, _ = await _question_with_followup(Session, jd_id)
    async with _client() as c:
        ok = await c.patch(f"/ai/questions/{qid}/practice", headers=auth())
        async with Session() as s:
            await s.execute(delete(PrepQuestion).where(PrepQuestion.id == qid))
            await s.commit()
        gone = await c.patch(f"/ai/questions/{qid}/practice", headers=auth())
    assert ok.status_code == 200 and ok.json()["practiced_at"]
    assert gone.status_code == 404


async def test_marking_another_users_question_is_a_404_and_changes_nothing(Session):
    jd_id, _ = await _jd(Session)
    _, qid, _ = await _question_with_followup(Session, jd_id)
    async with Session() as s:
        await s.execute(text("UPDATE tailoring_sessions SET user_id = gen_random_uuid()"))
        await s.commit()
    async with _client() as c:
        r = await c.patch(f"/ai/questions/{qid}/practice", headers=auth())
    assert r.status_code == 404
    async with Session() as s:
        assert (await s.get(PrepQuestion, qid)).practiced_at is None


# ── Reads that take several queries ────────────────────────────────────────

async def test_a_read_sees_one_snapshot_across_another_tabs_commit(Session):
    """A list read in several queries (runs, then questions, then follow-ups)
    saw each as of its own moment, so a set replaced in between showed a mix."""
    jd_id, _ = await _jd(Session)
    _, qid, _ = await _question_with_followup(Session, jd_id)
    async with Session() as reader:
        await read_from_one_snapshot(reader)
        before = (await reader.execute(select(PrepQuestion.id))).scalars().all()
        async with Session() as other:
            await other.execute(delete(PrepQuestion).where(PrepQuestion.id == qid))
            await other.commit()
        after = (await reader.execute(select(PrepQuestion.id))).scalars().all()
    assert before == after == [qid]


@pytest.mark.parametrize("path", ["/ai/questions/mine", "/ai/sessions/{run}/questions", "/jd/{jd}/details"])
async def test_every_multi_query_question_read_uses_one_snapshot(Session, path):
    jd_id, _ = await _jd(Session)
    run_id, _, _ = await _question_with_followup(Session, jd_id)
    spy = AsyncMock(wraps=read_from_one_snapshot)
    with patch("app.routers.ai.read_from_one_snapshot", spy), patch("app.routers.jd.read_from_one_snapshot", spy):
        async with _client() as c:
            r = await c.get(path.format(run=run_id, jd=jd_id), headers=auth())
    assert r.status_code == 200, r.text
    spy.assert_awaited_once()
