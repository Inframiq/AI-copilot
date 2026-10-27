"""Runs interview prep generation over the eval fixtures and scores the sets.

Why this exists: the likely answers used to state details the résumé never
said as things the candidate did ("you used dual writes"), whatever the
prompt said, and nothing measured it. prep_set_report (services/eval_metrics)
counts those, plus the question rules (one ask, at most 40 words) and the
coaching voice, so a prompt edit can be checked before it ships.

Costs real money (two model calls per fixture, one on the standard tier), so
it is a deliberate command, never part of the test suite — tests/test_evals.py
drives it with a fake provider instead.

    python -m evals.prep_runner run --out evals/results/prep-before.json
    # ...edit a prompt...
    python -m evals.prep_runner run --out evals/results/prep-after.json
    python -m evals.runner compare evals/results/prep-before.json evals/results/prep-after.json

A set passes when answers_with_unmarked_details, multi_ask_questions and
first_person_answers are all 0. The check catches invented techniques and
tools, not an invented story ("a junior engineer pushed back") — read a few
behavioral answers too.
"""
import argparse
import asyncio
import json
import pathlib
from datetime import datetime, timezone

from app.core import usage
from app.services.eval_metrics import prep_set_report
from app.services.tailoring import analyze_jd_match, get_or_generate_prep_questions
from evals.runner import (
    FIXTURE_DIR, PIN_DIR, Fixture, aggregate, load_fixtures, load_pinned_analysis, token_totals,
)


async def evaluate_prep_fixture(fixture: Fixture, provider, pin_dir=None, company_name=None) -> dict:
    """One fixture's prep set and its report. Errors are recorded, not raised,
    so one bad fixture doesn't lose the others' results."""
    row: dict = {"name": fixture.name}
    pinned = load_pinned_analysis(fixture, pin_dir) if pin_dir else None
    token = usage._sink.set([])
    try:
        match = await analyze_jd_match(
            fixture.resume_content, fixture.jd_text, provider,
            cached_jd_analysis=pinned[0] if pinned else None,
            cached_semantic_verdicts=pinned[1] if pinned else None,
        )
        questions = await get_or_generate_prep_questions(
            match.missing_skills, fixture.resume_content, provider, None,
            jd_analysis=match.jd_analysis, company_name=company_name,
            matched_skills=match.matched_skills,
        )
        calls = usage._sink.get() or []
    except Exception as exc:  # noqa: BLE001 — the run reports it per fixture
        row["error"] = f"{type(exc).__name__}: {exc}"
        return row
    finally:
        usage._sink.reset(token)
    sets = [q.model_dump() for q in questions]
    row.update(prep_set_report(sets, fixture.resume_content, fixture.jd_text))
    row.update(token_totals(calls))
    row["questions"] = sets
    return row


async def run_all(fixtures, provider, pin_dir=None, company_name=None) -> dict:
    rows = [await evaluate_prep_fixture(f, provider, pin_dir, company_name) for f in fixtures]
    # aggregate() averages numbers only; the questions and term lists stay per fixture.
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "aggregate": aggregate([{k: v for k, v in r.items() if k != "questions"} for r in rows]),
        "fixtures": rows,
    }


def _cmd_run(args) -> int:
    from app.services.ai_engine.factory import get_ai_provider

    fixtures = load_fixtures(args.fixtures)
    if not fixtures:
        print(f"No fixtures found in {args.fixtures}")
        return 1
    print(f"Running {len(fixtures)} fixture(s) against the live provider — this costs money.")
    out = asyncio.run(run_all(fixtures, get_ai_provider(), None if args.no_pin else args.pin_dir, args.company))
    path = pathlib.Path(args.out)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nWrote {path}")
    for row in out["fixtures"]:
        if row.get("error"):
            print(f"  {row['name']:<28} ERROR: {row['error']}")
            continue
        print(
            f"  {row['name']:<28} {row['questions_total']:>2} questions"
            f"  unmarked {row['answers_with_unmarked_details']}"
            f"  multi-ask {row['multi_ask_questions']}"
            f"  I/my {row['first_person_answers']}"
            f"  {row['unmarked_details'] or ''}"
        )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run", help="make a prep set for every fixture (costs money)")
    run.add_argument("--fixtures", default=str(FIXTURE_DIR))
    run.add_argument("--out", default=str(pathlib.Path(__file__).parent / "results" / "prep-latest.json"))
    run.add_argument("--pin-dir", default=str(PIN_DIR))
    run.add_argument("--no-pin", action="store_true")
    run.add_argument("--company", default=None, help="a target company, to check the why-this-company question")
    run.set_defaults(func=_cmd_run)
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
