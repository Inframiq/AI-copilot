"""Where "+N from tailoring" comes from, in steps.

A tester saw 19 → 100 with one point badged +39 and every reworded point
±0. A badge is what turning that one point off would change: points that
cover the same JD terms each show ±0, and the summary written for the job
has no badge at all. project-score now scores the review in steps — the
résumé with none of the changes, then the headline, the summary, the kept
rewrites, the AI-written points, skills and Miscellaneous points added one
kind at a time — so the review can show what each kind added. Each step is
scored exactly as the projected score is, so the last one is that score.
"""
import uuid

import pytest

from tests.test_jd_and_tailor_endpoints import TEST_USER_ID, _post_project_score


def _session():
    from app.db.models import TailoringSession, JobDescription
    jd = JobDescription(
        id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID), title="T", raw_text="jd",
        parsed={"agent1": {
            "exact_technical_tools": ["Python", "SQL"],
            "methodologies_and_frameworks": [], "domain_expertise_themes": [],
            "seniority_indicators": [], "ats_filter_phrases": [],
            "core_responsibilities": ["Own the deploy pipeline"], "target_job_titles": ["Data Engineer"],
            "nice_to_have_skills": [], "importance": {},
        }, "semantic": {"fingerprint": "x", "verdicts": {}}},
        status="applied",
    )
    original = {"headline": "Clerk", "skills": ["Python"],
                "experience": [{"title": "Clerk", "bullets": ["Ran releases end to end"]}]}
    tailored = {**original, "experience": [{"title": "Clerk", "bullets": ["Owned the deploy pipeline end to end"]}]}
    sess = TailoringSession(
        id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID), jd_id=jd.id, status="completed",
        ats_score=100, ats_score_before=17, matched_skills=[], missing_skills=[], company_keywords=[],
        suggested_skills=[], tailored_content=tailored,
        ats_fixes=[{"id": "headline:data-engineer", "type": "headline", "gap": "Data Engineer",
                    "importance": "high", "grounded": True, "text": "Data Engineer"}],
        bullet_rationale={"exp0_b0": {"responsibility": "Own the deploy pipeline", "keywords": []}},
        score_verdicts={"before": {"own the deploy pipeline": "missing"},
                        "after": {"own the deploy pipeline": "matched"}},
    )
    sess.jd = jd
    return sess, original, tailored


@pytest.mark.asyncio
async def test_each_step_adds_its_own_points_and_the_last_is_the_projected_score():
    sess, original, tailored = _session()
    with_headline = {**original, "headline": "Data Engineer"}
    with_summary = {**with_headline, "summary": "Engineer who writes SQL."}
    full = {**with_summary, "experience": tailored["experience"]}
    r = await _post_project_score(sess, {
        "session_id": str(sess.id), "content": full,
        "accepted_bullet_ids": ["exp0_b0"], "accepted_fix_ids": ["headline:data-engineer"],
        "original_bullets": {"exp0_b0": "Ran releases end to end"},
        "parts": [
            {"key": "start", "content": original},
            {"key": "headline", "content": with_headline, "accepted_fix_ids": ["headline:data-engineer"]},
            {"key": "summary", "content": with_summary, "accepted_fix_ids": ["headline:data-engineer"]},
            {"key": "reworded", "content": full, "accepted_bullet_ids": ["exp0_b0"],
             "accepted_fix_ids": ["headline:data-engineer"]},
        ],
    })
    body = r.json()
    parts = body["part_scores"]
    # Python 1.0 · SQL 1.0 · deploy pipeline 0.5 · title 2.0 → 4.5 in all.
    assert parts["start"] == 22          # Python only
    assert parts["headline"] == 67       # + title
    assert parts["summary"] == 89        # + SQL, from the summary's words
    assert parts["reworded"] == 100      # + the responsibility the rewrite covers
    assert parts["reworded"] == body["projected_score"]


@pytest.mark.asyncio
async def test_no_parts_asked_none_returned():
    sess, _, tailored = _session()
    r = await _post_project_score(sess, {
        "session_id": str(sess.id), "content": tailored, "accepted_bullet_ids": []})
    assert r.json()["part_scores"] == {}


@pytest.mark.asyncio
async def test_parts_are_capped_and_named():
    sess, original, _ = _session()
    too_many = [{"key": "start", "content": original}] * 8
    r = await _post_project_score(sess, {
        "session_id": str(sess.id), "content": original, "accepted_bullet_ids": [], "parts": too_many})
    assert r.status_code == 422
    r = await _post_project_score(sess, {
        "session_id": str(sess.id), "content": original, "accepted_bullet_ids": [],
        "parts": [{"key": "anything", "content": original}]})
    assert r.status_code == 422
