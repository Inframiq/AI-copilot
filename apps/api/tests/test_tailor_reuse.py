"""Same inputs → same tailored résumé.

The model takes no temperature or seed, so a re-run always rewords. Reuse is
the only way to make tailoring reproducible: a completed session whose inputs
fingerprint identically is handed back instead of spending another run.
"""
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.db.session import get_db
from app.db.models import TailoringSession
from app.services.tailoring import tailor_fingerprint
from tests.test_jd_and_tailor_endpoints import (
    make_auth_header, make_mock_db, make_resume, make_jd, credit_sub_result,
)

CONTENT = {"experience": [{"title": "Eng", "bullets": ["Did stuff"]}], "skills": ["Python"]}


def _fp(**over):
    args = dict(resume_content=CONTENT, jd_text="Need Python.", humanize_level=50,
                priority_skills=["AWS"], company_name=None)
    args.update(over)
    return tailor_fingerprint(**args)


def test_fingerprint_is_stable_for_identical_inputs():
    assert _fp() == _fp()
    # key order and priority-skill order/case are not meaningful inputs
    assert _fp(resume_content={"skills": ["Python"], "experience": CONTENT["experience"]}) == _fp()
    assert _fp(priority_skills=["aws"]) == _fp()
    assert _fp(jd_text="  Need Python.\n") == _fp()


@pytest.mark.parametrize("change", [
    {"resume_content": {**CONTENT, "skills": ["Python", "Go"]}},
    {"jd_text": "Need Go."},
    {"humanize_level": 70},
    {"priority_skills": ["GCP"]},
    {"company_name": "Acme"},
])
def test_fingerprint_changes_with_any_real_input(change):
    assert _fp(**change) != _fp()


def _result(value):
    r = MagicMock()
    r.scalar_one_or_none.return_value = value
    return r




@pytest.mark.asyncio
async def test_identical_rerun_reuses_the_completed_session_without_charging():
    override, db = make_mock_db()
    resume, jd = make_resume(), make_jd()
    previous = TailoringSession(id=uuid.uuid4(), user_id=resume.user_id, resume_id=resume.id,
                                jd_id=jd.id, humanize_level=50, status="completed")
    db.execute = AsyncMock(side_effect=[_result(resume), _result(jd), _result(previous)])
    spend = AsyncMock()
    pipeline = AsyncMock()

    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.ai.spend_credits", new=spend), \
             patch("app.routers.ai.run_tailoring_pipeline", new=pipeline):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                r = await c.post("/ai/tailor", headers=make_auth_header(), json={
                    "resume_id": str(resume.id), "jd_id": str(jd.id), "humanize_level": 50})
        assert r.status_code == 202
        body = r.json()
        assert body["session_id"] == str(previous.id)
        assert body["status"] == "completed"
        assert body["reused"] is True
        spend.assert_not_called()
        pipeline.assert_not_called()
        db.add.assert_not_called()
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_fresh_run_skips_reuse_and_records_the_fingerprint():
    override, db = make_mock_db()
    resume, jd = make_resume(), make_jd()
    db.execute = AsyncMock(side_effect=[_result(resume), _result(jd), credit_sub_result()])
    added = []
    db.add = MagicMock(side_effect=lambda o: (added.append(o), setattr(o, "id", uuid.uuid4())))

    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.ai._run_tailoring_background", new=AsyncMock()):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                r = await c.post("/ai/tailor", headers=make_auth_header(), json={
                    "resume_id": str(resume.id), "jd_id": str(jd.id), "humanize_level": 50,
                    "fresh": True})
        assert r.status_code == 202
        assert r.json()["reused"] is False
        session = next(o for o in added if isinstance(o, TailoringSession))
        assert session.input_fingerprint == tailor_fingerprint(
            resume_content=resume.content, jd_text=jd.raw_text, humanize_level=50,
            priority_skills=[], company_name=None)
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_tailor_reuses_the_analyzers_semantic_verdicts_for_the_before_score():
    import hashlib
    from app.services.ats import build_resume_text

    override, db = make_mock_db()
    resume, jd = make_resume(), make_jd()
    fp = hashlib.sha1(build_resume_text(resume.content)[0].encode("utf-8")).hexdigest()
    jd.parsed = {"semantic": {"fingerprint": fp, "verdicts": {"aws": "partial"}}}
    db.execute = AsyncMock(side_effect=[_result(resume), _result(jd), _result(None), credit_sub_result()])
    db.add = MagicMock(side_effect=lambda o: setattr(o, "id", uuid.uuid4()))
    bg = AsyncMock()

    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.ai._run_tailoring_background", new=bg):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                await c.post("/ai/tailor", headers=make_auth_header(), json={
                    "resume_id": str(resume.id), "jd_id": str(jd.id), "humanize_level": 50})
        assert bg.call_args.kwargs["cached_semantic_verdicts"] == {"aws": "partial"}
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_migration_024_adds_input_fingerprint():
    import importlib.util, pathlib
    mig = pathlib.Path(__file__).parents[1] / "alembic/versions/024_tailor_input_fingerprint.py"
    spec = importlib.util.spec_from_file_location("m024", mig)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    assert m.revision == "024" and m.down_revision == "023"
    assert "input_fingerprint" in TailoringSession.__table__.columns
    assert TailoringSession.__table__.columns["input_fingerprint"].nullable


def test_results_from_before_per_rewrite_scoring_are_never_reused(monkeypatch):
    """Sessions saved before score_verdicts existed have no per-point values
    and a frozen live score; the version in the fingerprint retires them."""
    import app.services.tailoring as t
    assert t.TAILOR_PIPELINE_VERSION == "2"
    now = _fp()
    monkeypatch.setattr(t, "TAILOR_PIPELINE_VERSION", "1")
    assert _fp() != now
