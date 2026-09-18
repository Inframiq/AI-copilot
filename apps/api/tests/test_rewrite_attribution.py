"""Every kept rewrite moves the score; every dropped one gives it back.

project-score used to re-score the review's choices against the semantic
verdicts of the ORIGINAL résumé, so the credit a rewrite earned for covering
a JD responsibility never showed: ticking and unticking rewrites left
"With your choices" frozen unless an exact keyword appeared or vanished.
Now the session keeps the verdicts from before AND after tailoring, and each
accepted rewrite is credited with the after-verdicts for exactly the terms
it targeted.
"""
import uuid

import pytest

from app.services.ats import verdicts_with_rewrites
from tests.test_jd_and_tailor_endpoints import TEST_USER_ID, _post_project_score

BEFORE = {"own the deploy pipeline": "missing", "mentor engineers": "partial"}
AFTER = {"own the deploy pipeline": "matched", "mentor engineers": "matched"}
RATIONALE = {
    "exp0_b0": {"responsibility": "Own the deploy pipeline", "keywords": []},
    "exp0_b1": {"responsibility": "", "keywords": ["Mentor engineers"]},
}


def test_no_accepted_rewrites_leaves_the_before_verdicts():
    assert verdicts_with_rewrites(BEFORE, AFTER, RATIONALE, []) == BEFORE


def test_an_accepted_rewrite_earns_the_after_verdict_for_its_own_terms_only():
    out = verdicts_with_rewrites(BEFORE, AFTER, RATIONALE, ["exp0_b0"])
    assert out["own the deploy pipeline"] == "matched"
    assert out["mentor engineers"] == "partial"


def test_a_rewrite_never_downgrades_a_verdict():
    out = verdicts_with_rewrites({"x": "matched"}, {"x": "partial"},
                                 {"exp0_b0": {"responsibility": "x", "keywords": []}}, ["exp0_b0"])
    assert out["x"] == "matched"


def _session():
    from app.db.models import TailoringSession, JobDescription
    jd = JobDescription(
        id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID), title="T", raw_text="jd",
        parsed={"agent1": {
            "exact_technical_tools": ["Python"],
            "methodologies_and_frameworks": [], "domain_expertise_themes": [],
            "seniority_indicators": [], "ats_filter_phrases": [],
            "core_responsibilities": ["Own the deploy pipeline"], "target_job_titles": [],
            "nice_to_have_skills": [], "importance": {},
        }, "semantic": {"fingerprint": "x", "verdicts": {}}},
        status="applied",
    )
    content = {"skills": ["Python"], "experience": [{"title": "E", "bullets": ["Ran releases end to end"]}]}
    sess = TailoringSession(
        id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID), jd_id=jd.id, status="completed",
        ats_score=100, matched_skills=[], missing_skills=[], company_keywords=[],
        suggested_skills=[], ats_fixes=[], tailored_content=content,
        bullet_rationale={"exp0_b0": {"responsibility": "Own the deploy pipeline", "keywords": []}},
        score_verdicts={"before": {"own the deploy pipeline": "missing"},
                        "after": {"own the deploy pipeline": "matched"}},
    )
    sess.jd = jd
    return sess, content


@pytest.mark.asyncio
async def test_project_score_moves_with_each_accepted_rewrite():
    sess, content = _session()
    kept = await _post_project_score(sess, {
        "session_id": str(sess.id), "content": content, "accepted_bullet_ids": ["exp0_b0"]})
    dropped = await _post_project_score(sess, {
        "session_id": str(sess.id), "content": content, "accepted_bullet_ids": []})
    # Python (1.0) + responsibility (0.5): all matched vs only Python.
    assert kept.json()["projected_score"] == 100
    assert dropped.json()["projected_score"] == 67


@pytest.mark.asyncio
async def test_project_score_keeps_the_old_path_for_sessions_without_stored_verdicts():
    sess, content = _session()
    sess.score_verdicts = None
    r = await _post_project_score(sess, {
        "session_id": str(sess.id), "content": content, "accepted_bullet_ids": ["exp0_b0"]})
    assert r.json()["projected_score"] == 67  # JD cache has no verdict for it


def test_migration_025_adds_score_verdicts():
    import importlib.util, pathlib
    from app.db.models import TailoringSession
    mig = pathlib.Path(__file__).parents[1] / "alembic/versions/025_session_score_verdicts.py"
    spec = importlib.util.spec_from_file_location("m025", mig)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    assert m.revision == "025" and m.down_revision == "024"
    assert TailoringSession.__table__.columns["score_verdicts"].nullable
