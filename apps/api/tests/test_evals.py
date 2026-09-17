"""The eval runner's wiring — fixture loading, pipeline→metrics plumbing, and
aggregation. Exercised with a fake provider so the harness itself is verified
without spending money on live model calls."""
import json
import pytest

from evals.runner import load_fixtures, evaluate_fixture, aggregate, Fixture
from app.services.tailoring import (
    MappingPlan, BulletMapping, WriterOutput, RewrittenBullet, _JDAnalysisWire,
)
from tests.test_tailoring import make_jd_analysis, make_provider_dispatching_by_schema


# ── Fixture loading ──────────────────────────────────────────────────────────

def _write_fixture(tmp_path, name, **over):
    data = {
        "name": name,
        "description": "d",
        "jd_text": "Need Python.",
        "resume_content": {"experience": [{"title": "Eng", "bullets": ["Built services"]}], "skills": []},
    }
    data.update(over)
    (tmp_path / f"{name}.json").write_text(json.dumps(data))


def test_load_fixtures_reads_every_json_file_in_the_directory(tmp_path):
    _write_fixture(tmp_path, "a")
    _write_fixture(tmp_path, "b")
    assert {f.name for f in load_fixtures(tmp_path)} == {"a", "b"}


def test_load_fixtures_returns_them_in_a_stable_order(tmp_path):
    for n in ("c", "a", "b"):
        _write_fixture(tmp_path, n)
    assert [f.name for f in load_fixtures(tmp_path)] == ["a", "b", "c"]


def test_load_fixtures_ignores_non_json_files(tmp_path):
    _write_fixture(tmp_path, "a")
    (tmp_path / "README.md").write_text("not a fixture")
    assert len(load_fixtures(tmp_path)) == 1


def test_load_fixtures_rejects_a_fixture_missing_a_required_field(tmp_path):
    (tmp_path / "bad.json").write_text(json.dumps({"name": "bad"}))
    with pytest.raises(ValueError, match="bad"):
        load_fixtures(tmp_path)


# ── One fixture through the pipeline ─────────────────────────────────────────

def _provider():
    return make_provider_dispatching_by_schema({
        _JDAnalysisWire: make_jd_analysis(exact_technical_tools=["Python", "Kubernetes"]),
        MappingPlan: MappingPlan(
            mapping_plan=[BulletMapping(
                original_bullet_id="exp0_b0", original_text="Built services",
                target_jd_keywords_to_inject=["Python"], preserved_metrics=[],
                strategic_instruction="REINFORCE",
            )],
            plausible_skills_to_add=[],
        ),
        WriterOutput: WriterOutput(
            rewritten_bullets=[RewrittenBullet(
                bullet_id="exp0_b0", rewritten_text="Engineered Python services on Kubernetes",
            )],
            updated_skills=[],
        ),
    })


def _fixture():
    return Fixture(
        name="f", description="d", jd_text="Need Python.",
        resume_content={"experience": [{"title": "Eng", "bullets": ["Built services"]}], "skills": []},
    )


@pytest.mark.asyncio
async def test_evaluate_fixture_reports_the_score_movement():
    out = await evaluate_fixture(_fixture(), _provider())
    assert out["name"] == "f"
    assert out["ats_after"] > out["ats_before"]


@pytest.mark.asyncio
async def test_evaluate_fixture_carries_the_prompt_rule_metrics():
    out = await evaluate_fixture(_fixture(), _provider())
    for key in ("specificity_retention", "verb_diversity", "revert_rate", "keyword_overuse"):
        assert key in out


@pytest.mark.asyncio
async def test_evaluate_fixture_records_the_tailored_bullets_for_eyeballing():
    """Numbers alone can't tell you a rewrite reads badly — the harness keeps
    the text so a human can skim what actually changed."""
    out = await evaluate_fixture(_fixture(), _provider())
    assert out["bullets"][0]["tailored"] == "Engineered Python services on Kubernetes"
    assert out["bullets"][0]["original"] == "Built services"


@pytest.mark.asyncio
async def test_a_fixture_whose_run_fails_is_recorded_not_fatal():
    """One broken fixture must not lose the whole (paid-for) run."""
    class Boom:
        async def complete_structured(self, *a, **k):
            raise RuntimeError("provider exploded")

        async def complete(self, *a, **k):
            raise RuntimeError("provider exploded")

    out = await evaluate_fixture(_fixture(), Boom())
    assert out["error"] and "exploded" in out["error"]


# ── Aggregation across fixtures ──────────────────────────────────────────────

def test_aggregate_averages_each_numeric_metric():
    agg = aggregate([
        {"name": "a", "ats_delta": 10, "specificity_retention": 1.0},
        {"name": "b", "ats_delta": 20, "specificity_retention": 0.5},
    ])
    assert agg["ats_delta"] == 15
    assert agg["specificity_retention"] == 0.75


def test_aggregate_ignores_fixtures_that_errored():
    agg = aggregate([
        {"name": "a", "ats_delta": 10},
        {"name": "b", "error": "boom"},
    ])
    assert agg["ats_delta"] == 10
    assert agg["fixtures_failed"] == 1
    assert agg["fixtures_ok"] == 1


def test_aggregate_of_nothing_does_not_divide_by_zero():
    assert aggregate([]) == {"fixtures_ok": 0, "fixtures_failed": 0}


# ── Pinned JD analysis ───────────────────────────────────────────────────────
# The first A/B run showed ats_before — computed before Agent 3 even runs, and
# so structurally immune to an Agent 3 prompt edit — swinging ±4 points per
# fixture between runs. Agent 1 re-parses the JD each time and returns a
# slightly different keyword set, moving the scoring denominator. That noise
# floor is larger than most real effects, which makes A/B comparison useless.
#
# Production already solves this: routers/ai.py caches the Agent 1 parse on
# jd_row.parsed so "same JD text -> same skill list, same resume -> same
# score". The harness has no DB, so it pins the analysis to a file instead.

import pathlib as _pathlib
from evals.runner import pinned_analysis_path, load_pinned_analysis, save_pinned_analysis


def test_the_pin_path_is_derived_from_the_fixture_name(tmp_path):
    assert pinned_analysis_path(_fixture(), tmp_path).name.startswith("f")


def test_loading_a_pin_that_does_not_exist_returns_none(tmp_path):
    assert load_pinned_analysis(_fixture(), tmp_path) is None


def test_a_saved_pin_round_trips_to_an_equivalent_analysis(tmp_path):
    analysis = make_jd_analysis(exact_technical_tools=["Python", "Kubernetes"])
    save_pinned_analysis(_fixture(), analysis, tmp_path, {"python": "matched"})

    loaded_analysis, loaded_verdicts = load_pinned_analysis(_fixture(), tmp_path)
    assert loaded_analysis.exact_technical_tools == ["Python", "Kubernetes"]
    assert loaded_verdicts == {"python": "matched"}


@pytest.mark.asyncio
async def test_evaluate_fixture_writes_a_pin_on_the_first_run(tmp_path):
    await evaluate_fixture(_fixture(), _provider(), pin_dir=tmp_path)
    assert pinned_analysis_path(_fixture(), tmp_path).exists()


@pytest.mark.asyncio
async def test_a_second_run_reuses_the_pin_instead_of_reparsing_the_jd(tmp_path):
    """Agent 1 must not be called again — that re-parse is the noise source."""
    await evaluate_fixture(_fixture(), _provider(), pin_dir=tmp_path)

    second = _provider()
    await evaluate_fixture(_fixture(), second, pin_dir=tmp_path)
    schemas = [c.args[2] for c in second.complete_structured.call_args_list]
    assert _JDAnalysisWire not in schemas


@pytest.mark.asyncio
async def test_the_before_score_is_identical_across_runs_once_pinned(tmp_path):
    first = await evaluate_fixture(_fixture(), _provider(), pin_dir=tmp_path)
    second = await evaluate_fixture(_fixture(), _provider(), pin_dir=tmp_path)
    assert first["ats_before"] == second["ats_before"]


@pytest.mark.asyncio
async def test_pinning_is_off_when_no_directory_is_given():
    """Callers that want a genuinely fresh parse (e.g. re-pinning after a JD
    or Agent 1 change) must still be able to get one."""
    provider = _provider()
    await evaluate_fixture(_fixture(), provider)
    schemas = [c.args[2] for c in provider.complete_structured.call_args_list]
    assert _JDAnalysisWire in schemas


@pytest.mark.asyncio
async def test_the_pin_also_freezes_the_semantic_verdicts(tmp_path):
    """Pinning Agent 1 alone left ats_before swinging up to 10 points between
    runs — the semantic verifier is a second model call and re-ran each time.
    A pin that doesn't cover it doesn't make an A/B controlled."""
    await evaluate_fixture(_fixture(), _provider(), pin_dir=tmp_path)
    data = json.loads(pinned_analysis_path(_fixture(), tmp_path).read_text())
    assert "semantic_verdicts" in data


@pytest.mark.asyncio
async def test_a_second_run_reuses_the_pinned_verdicts(tmp_path):
    await evaluate_fixture(_fixture(), _provider(), pin_dir=tmp_path)

    second = _provider()
    await evaluate_fixture(_fixture(), second, pin_dir=tmp_path)
    kwargs = second.complete_structured.call_args_list
    # The pre-tailor verification must not be re-issued from scratch.
    assert all(c.args[2] is not _JDAnalysisWire for c in kwargs)


@pytest.mark.asyncio
async def test_an_old_pin_without_verdicts_still_loads(tmp_path):
    """Pins written before verdicts were included must not crash a run."""
    path = pinned_analysis_path(_fixture(), tmp_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(make_jd_analysis(exact_technical_tools=["Python"]).model_dump()))

    out = await evaluate_fixture(_fixture(), _provider(), pin_dir=tmp_path)
    assert not out.get("error")
