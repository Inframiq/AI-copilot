"""Runs the tailoring pipeline over a set of fixtures and scores the output.

Why this exists: every prompt in services/tailoring.py has been tuned by
judgement, with no way to tell whether an edit helped. The ATS score alone
can't answer that — it actively rewards two of the things the prompts spend
paragraphs forbidding (keyword stuffing, bullets going generic). This harness
pairs the score with the metrics in services/eval_metrics.py, which measure
those rules directly, and writes a JSON record per run so two prompt revisions
can be diffed.

Running it against the real provider costs real money (three chained model
calls per fixture, two on the premium tier), so it is a deliberate command,
never part of the test suite. The suite instead drives this module with a
fake provider to prove the wiring — see tests/test_evals.py.

    python -m evals.runner run --out evals/results/before.json
    # ...edit a prompt...
    python -m evals.runner run --out evals/results/after.json
    python -m evals.runner compare evals/results/before.json evals/results/after.json
"""
import argparse
import asyncio
import json
import logging
import pathlib
import re
from dataclasses import dataclass
from datetime import datetime, timezone

from app.services.eval_metrics import build_report, compare_reports
from app.services.ats import build_resume_text, score_content
from app.services.tailoring import (
    JDAnalysis, _agent1_parse_jd, _collect_all_bullets, _verify_semantic_presence,
    run_tailoring_pipeline,
)

logger = logging.getLogger("app")

FIXTURE_DIR = pathlib.Path(__file__).parent / "fixtures"
# Agent 1's parse of each fixture's JD, frozen to a file.
#
# ats_before is computed before Agent 3 runs, so an Agent 3 prompt edit cannot
# change it — yet across two real runs it swung ±4 points per fixture, because
# Agent 1 re-parsed each JD and returned a slightly different keyword set,
# moving the scoring denominator under everything. That noise floor is bigger
# than most real effects, which makes an A/B comparison meaningless.
#
# Production already handles this: routers/ai.py stores the Agent 1 parse on
# jd_row.parsed so the same JD always yields the same skill list. The harness
# has no DB, so it pins to disk. Delete a pin (or the directory) to re-parse —
# necessary after editing a fixture's JD or the Agent 1 prompt.
PIN_DIR = pathlib.Path(__file__).parent / "pinned_analyses"
_REQUIRED_FIELDS = ("name", "jd_text", "resume_content")


@dataclass
class Fixture:
    name: str
    description: str
    jd_text: str
    resume_content: dict


def load_fixtures(directory: "str | pathlib.Path" = FIXTURE_DIR) -> list[Fixture]:
    """Every *.json fixture in *directory*, name-sorted so two runs line up."""
    out: list[Fixture] = []
    for path in sorted(pathlib.Path(directory).glob("*.json")):
        data = json.loads(path.read_text())
        missing = [f for f in _REQUIRED_FIELDS if not data.get(f)]
        if missing:
            raise ValueError(f"fixture {path.name} is missing: {', '.join(missing)}")
        out.append(Fixture(
            name=data["name"],
            description=data.get("description", ""),
            jd_text=data["jd_text"],
            resume_content=data["resume_content"],
        ))
    return out


def pinned_analysis_path(fixture: Fixture, pin_dir: "str | pathlib.Path") -> pathlib.Path:
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", fixture.name)
    return pathlib.Path(pin_dir) / f"{safe}.analysis.json"


def load_pinned_analysis(
    fixture: Fixture, pin_dir: "str | pathlib.Path"
) -> "tuple[JDAnalysis, dict[str, str]] | None":
    """The pinned (JD analysis, semantic verdicts) pair, or None if unpinned.

    Both halves matter. Agent 1's parse fixes WHICH phrases are scored; the
    semantic verdicts fix which of them count as present on the original
    resume. Pinning only the first still left ats_before moving up to 10
    points between runs.
    """
    path = pinned_analysis_path(fixture, pin_dir)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text())
        # Pins written before verdicts were included carry the analysis at the
        # top level; treat those as "no verdicts" rather than failing the run.
        verdicts = data.pop("semantic_verdicts", None) or {}
        return JDAnalysis(**data), verdicts
    except Exception:
        logger.warning("pinned analysis %s is unreadable — re-parsing", path, exc_info=True)
        return None


def save_pinned_analysis(
    fixture: Fixture,
    analysis: JDAnalysis,
    pin_dir: "str | pathlib.Path",
    semantic_verdicts: "dict[str, str] | None" = None,
) -> None:
    path = pinned_analysis_path(fixture, pin_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = analysis.model_dump()
    payload["semantic_verdicts"] = semantic_verdicts or {}
    path.write_text(json.dumps(payload, indent=2))


async def evaluate_fixture(
    fixture: Fixture,
    provider,
    humanize_level: int = 50,
    pin_dir: "str | pathlib.Path | None" = None,
) -> dict:
    """One fixture through the pipeline, scored. Never raises: a fixture that
    blows up is recorded with its error so one bad case doesn't discard the
    rest of a run that has already been paid for."""
    try:
        cached, verdicts = None, None
        if pin_dir is not None:
            pinned = load_pinned_analysis(fixture, pin_dir)
            if pinned is None:
                cached = await _agent1_parse_jd(fixture.jd_text, provider)
                # Reproduce exactly the verification the pipeline would do on
                # the untouched resume, then freeze it, so every later run
                # starts from the same "before" picture.
                resume_text, _ = build_resume_text(fixture.resume_content)
                probe = score_content(fixture.resume_content, cached, {})
                to_verify = list(probe.missing) + [
                    r.strip() for r in (cached.core_responsibilities or []) if r and r.strip()
                ]
                verdicts = (
                    await _verify_semantic_presence(to_verify, resume_text, provider)
                    if to_verify else {}
                )
                save_pinned_analysis(fixture, cached, pin_dir, verdicts)
            else:
                cached, verdicts = pinned
        result = await run_tailoring_pipeline(
            fixture.resume_content, fixture.jd_text, humanize_level, provider, db=None,
            cached_jd_analysis=cached,
            cached_semantic_verdicts=verdicts,
        )
    except Exception as exc:  # noqa: BLE001 - recorded, not swallowed
        logger.warning("eval fixture %s failed", fixture.name, exc_info=True)
        return {"name": fixture.name, "description": fixture.description, "error": str(exc)}

    original_bullets = _collect_all_bullets(fixture.resume_content)
    tailored_bullets = _collect_all_bullets(result.tailored_content)

    report = build_report(
        original_bullets=original_bullets,
        tailored_bullets=tailored_bullets,
        # matched + missing is exactly the JD's required and nice-to-have
        # phrase set, which is what the concentration rule is about.
        jd_keywords=list(result.matched_skills) + list(result.missing_skills),
        ats_before=result.ats_score_before,
        ats_after=result.ats_score,
        reverted_bullets=result.reverted_bullets,
    )
    report["name"] = fixture.name
    report["description"] = fixture.description
    # The numbers can't tell you a rewrite reads badly. Keep the text so a
    # human can skim what actually changed.
    report["bullets"] = [
        {"original": o, "tailored": t}
        for o, t in zip(original_bullets, tailored_bullets)
    ]
    report["reverted"] = result.reverted_bullets
    return report


# Keys that are per-fixture context, not metrics to average.
_NON_METRIC_KEYS = {"name", "description", "bullets", "reverted", "error", "keyword_overuse"}


def aggregate(reports: list[dict]) -> dict:
    """Mean of each numeric metric across the fixtures that ran clean."""
    ok = [r for r in reports if not r.get("error")]
    out: dict = {"fixtures_ok": len(ok), "fixtures_failed": len(reports) - len(ok)}
    if not ok:
        return out
    for key in sorted({k for r in ok for k in r} - _NON_METRIC_KEYS):
        values = [r[key] for r in ok if isinstance(r.get(key), (int, float))
                  and not isinstance(r.get(key), bool)]
        if values:
            out[key] = round(sum(values) / len(values), 4)
    return out


async def run_all(
    fixtures: list[Fixture],
    provider,
    humanize_level: int = 50,
    pin_dir: "str | pathlib.Path | None" = None,
) -> dict:
    reports = [await evaluate_fixture(f, provider, humanize_level, pin_dir) for f in fixtures]
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "aggregate": aggregate(reports),
        "fixtures": reports,
    }


def _cmd_run(args) -> int:
    from app.services.ai_engine.factory import get_ai_provider

    fixtures = load_fixtures(args.fixtures)
    if not fixtures:
        print(f"No fixtures found in {args.fixtures}")
        return 1
    print(f"Running {len(fixtures)} fixture(s) against the live provider — this costs money.")
    pin_dir = None if args.no_pin else args.pin_dir
    out = asyncio.run(run_all(fixtures, get_ai_provider(), args.humanize, pin_dir))

    path = pathlib.Path(args.out)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, indent=2))
    print(f"\nWrote {path}")
    for row in out["fixtures"]:
        if row.get("error"):
            print(f"  {row['name']:<28} ERROR: {row['error']}")
        else:
            print(
                f"  {row['name']:<28} ats {row['ats_before']:>3} -> {row['ats_after']:>3}"
                f"  spec {row['specificity_retention']:.2f}"
                f"  verbs {row['verb_diversity']:.2f}"
                f"  reverts {row['revert_rate']:.2f}"
            )
    print("\naggregate:", json.dumps(out["aggregate"], indent=2))
    return 0


def _cmd_compare(args) -> int:
    before = json.loads(pathlib.Path(args.before).read_text())
    after = json.loads(pathlib.Path(args.after).read_text())
    diff = compare_reports(before["aggregate"], after["aggregate"])
    if not diff:
        print("No metric moved.")
        return 0
    print(f"{'metric':<26} {'before':>10} {'after':>10} {'delta':>10}")
    for key, row in diff.items():
        delta = row.get("delta")
        print(f"{key:<26} {str(row['before']):>10} {str(row['after']):>10} "
              f"{('+' if isinstance(delta, (int, float)) and delta > 0 else '') + str(delta):>10}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", help="run every fixture against the live provider (costs money)")
    run.add_argument("--fixtures", default=str(FIXTURE_DIR))
    run.add_argument("--out", default=str(pathlib.Path(__file__).parent / "results" / "latest.json"))
    run.add_argument("--humanize", type=int, default=50)
    run.add_argument("--pin-dir", default=str(PIN_DIR),
                     help="where Agent 1's per-fixture JD parse is frozen (see PIN_DIR)")
    run.add_argument("--no-pin", action="store_true",
                     help="re-parse every JD instead of reusing the pin — reintroduces "
                          "run-to-run score noise; use after changing a JD or the Agent 1 prompt")
    run.set_defaults(func=_cmd_run)

    cmp_ = sub.add_parser("compare", help="diff two result files (offline, free)")
    cmp_.add_argument("before")
    cmp_.add_argument("after")
    cmp_.set_defaults(func=_cmd_compare)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
