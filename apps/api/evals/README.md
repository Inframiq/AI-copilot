# Tailoring evals

Every prompt in `app/services/tailoring.py` has been tuned by judgement. There
was no way to tell whether an edit helped — and the one visible number, the ATS
score, is actively misleading as a quality signal: it **rewards** two of the
things the prompts spend paragraphs forbidding.

- Agent 2 rule 4 forbids spreading one keyword across more than 2–3 bullets.
  The score goes up every time you do.
- Agent 2 rule 5 / Agent 3 rule 3 say specificity beats JD-mirroring. The score
  goes up when a bullet sheds its specifics to echo the JD.

So a prompt edit can raise the score while making the résumé worse, and nothing
would show it. This harness pairs the score with metrics that measure those
rules directly.

## What gets measured

| Metric | The rule it enforces | Read it as |
|---|---|---|
| `ats_before` / `ats_after` / `ats_delta` | — | the lift, the product's core claim |
| `specificity_retention` | Agent 2 r5, Agent 3 r3 | 1.0 = no concrete detail lost. **Falling is bad even if `ats_delta` rises.** |
| `keyword_overuse` | Agent 2 r4 | `{}` is the goal. Any entry means a keyword landed in >3 bullets. |
| `verb_diversity` | Agent 3 r4 | 1.0 = no repeated opener. Low means thin vocabulary. |
| `revert_rate` | Agent 3 r2/r7/r8 | share of rewrites the fact-lock rejected (`bullet_guard.py`). Rising means the writer is fabricating more. |
| `quantified_share` | Agent 3 r4 | not a target. A sharp rise may mean invented metrics; a sharp fall, real ones dropped. |
| `word_growth` | Agent 3 r7 | mean words-out ÷ words-in on rewritten bullets. 1.0 = same length. Well above it means padding. |

`max_bullet_words` and `bullets_changed` are context, not goals.

## The current baseline

`results/baseline.json`, first live run against `gpt-5.6-luna` / `gpt-5.6-sol`:

| | ats_before | ats_after | word_growth |
|---|---|---|---|
| career_changer_thin_overlap | 18 | 18 | 1.64x |
| experienced_backend_ic | 59 | 71 | 1.50x |
| fresher_projects_only | 70 | 71 | 1.36x |
| management_seniority_signals | 43 | 55 | 1.48x |
| sparse_unquantified | 50 | 52 | 2.06x |
| **aggregate** | **48.0** | **53.4** | **1.61x** |

specificity 1.00, verb diversity 1.00, revert rate 0.00, no keyword overuse.

Two things to fix, both visible only because of this run:

1. **Padding (`word_growth` 1.61x).** Every rewrite ended with a comma +
   gerund clause restating its own first half — "…supporting component reuse
   throughout client-facing implementations". Worst (2.06x) on the shortest
   inputs, which is padding-to-fill, not added information. Agent 3 rule 7
   already forbids this; the prompt needs to enforce it harder.
2. **Three of five fixtures barely moved** (+0, +1, +2). The +0 on
   `career_changer_thin_overlap` is arguably *correct* — the JD wants SQL and
   Tableau, the candidate has neither, and inventing them is what fact-lock
   exists to prevent. But `sparse_unquantified` (+2) and
   `fresher_projects_only` (+1) suggest the pipeline adds words far more
   readily than it adds matched keywords.

`word_growth` was added *after* this run and backfilled from the stored bullet
text, so the baseline is internally consistent and needed no re-spend.

## Run-to-run noise, and the pin

The first A/B run exposed a methodology problem: `ats_before` swung **±4 points
per fixture** between runs on identical input. It is computed before Agent 3
executes, so an Agent 3 prompt edit cannot change it — Agent 1 was simply
re-parsing each JD and returning a slightly different keyword set, moving the
scoring denominator under everything.

That noise floor is larger than most real effects. Aggregate `ats_delta` moved
-1.0 between the two runs and **that is not distinguishable from noise.**

So the runner now pins Agent 1's parse per fixture to `pinned_analyses/`,
mirroring what production already does on `jd_row.parsed`. Both arms of a
comparison then share one denominator and only Agent 2/3 vary. Delete a pin to
re-parse — required after editing a fixture's JD or the Agent 1 prompt, and
available as `--no-pin`.

**The two result files here predate pinning**, so read their `ats_*` deltas as
indicative only. `word_growth` and `specificity_retention` are computed purely
from bullet text and are unaffected.

## A/B: tightening Agent 3 rule 7 — no detectable effect

Rule 7 gained an explicit `NO TRAILING RESTATEMENT` clause, a `LENGTH FOLLOWS
FACTS` clause, and a worked BAD/GOOD example taken from the baseline's own
output. Four runs, two per arm:

| run | prompt | word_growth | ats_delta |
|---|---|---|---|
| baseline | old | 1.606 | 5.4 |
| ab-old-prompt | old | 1.492 | 8.0 |
| rule7-tightened | new | 1.368 | 4.4 |
| ab-new-prompt | new | 1.498 | 11.4 |

**old mean 1.549 (spread 0.115) · new mean 1.433 (spread 0.130)**

The first pair suggested a −0.24 improvement. The second pair, better
controlled, showed **+0.006 — nothing**. Same-prompt run-to-run spread (~0.12)
is as large as the apparent effect, and the two pairs disagree in direction.

**Verdict: no detectable effect at n=5 fixtures × 2 runs.** The edit is kept
because it is harmless and makes an already-stated rule concrete — no run
showed any specificity or verb-diversity cost — but it is *not* evidence-backed
and should not be cited as a win.

The real lesson is about the harness: with this noise floor, only large effects
are visible. Detecting something the size of the first pair's apparent −0.24
needs more fixtures (target ~20) or several runs per arm, and preferably both.
Do not read a single pair of runs as a result — that mistake was made here.

### What the ats_* columns are worth

`word_growth` and `specificity_retention` come purely from bullet text and are
valid across all four runs. The `ats_*` columns are **not** comparable between
the first two runs and the last two: pinning changed mid-experiment. Even the
pinned pair is only partly controlled — see below.

## Run-to-run noise, and the pin

`ats_before` is computed before Agent 3 executes, so an Agent 3 prompt edit
cannot change it. It nevertheless swung **±4 points per fixture** between the
first two runs, because Agent 1 re-parsed each JD and returned a different
keyword set, moving the scoring denominator.

Pinning Agent 1 was not enough. With identical pins in place, `ats_before`
*still* moved by up to **10 points** — the semantic verifier is a second model
call, and it re-ran every time. `analyze_jd_match` had always accepted cached
verdicts (routers/ai.py caches them per resume fingerprint); the pipeline just
never passed them through.

A pin now freezes **both**: Agent 1's parse *and* the semantic verdicts for the
untouched resume, written to `pinned_analyses/`. Delete a pin to re-derive it —
required after editing a fixture's JD, the Agent 1 prompt, or the scorer — and
available as `--no-pin`.

**Both pinned result files here predate the verdict half of the pin**, so their
`ats_*` deltas remain confounded. The first comparison run with a complete pin
will be the first trustworthy ATS baseline.

## Two bugs this found in the harness itself

1. **`specificity_retention` cried wolf.** It scored "6 engineers" ->
   "6-engineer squad" as total loss, because the tokenizer kept the hyphenated
   compound whole. That read as a prompt-caused regression and was not one.
   Fixed, with tests.
2. **The pin was half a pin** (above). Both were found only by checking a
   surprising number against the stored bullet text.

A metric that cries wolf is worse than no metric. Check a surprising movement
against `fixtures[].bullets` before believing it.

## What this does not do

These are structural metrics. They cannot tell you a bullet reads *well* — only
that it kept its specifics, varied its verbs, and didn't stuff keywords. Every
result file keeps the full before/after bullet text under `fixtures[].bullets`
precisely so a human still skims the output. Treat the numbers as a regression
alarm, not a quality score.

Still open from the runs so far: `management_seniority_signals` shows JD phrases
pasted mid-bullet — "delivering platform or infrastructure work" — which no
current metric catches. Padding moved rather than disappeared there.


## Prompt cleanup run (`results/prompt-cleanup.json`)

Three changes, made because they are correctness or cost wins independent of
output quality:

1. `transformation` became a real enum (`REINFORCE|REFRAME|INJECT|SKIP`) on
   `BulletMapping`. Agent 3's rule 9 exact-matches `"SKIP"`, and nothing
   validated it — a free-text "Skip — no JD fit" missed that branch silently.
   `_apply_writer_output` now drops rewrites for skipped ids in code.
2. Agent 2 gained worked examples. It is the premium-tier call that decides
   whether the tailoring makes sense at all and it had none, while Agent 3 —
   which only executes its plan — had two.
3. The prose `<output_schema>` blocks were deleted from all eight prompts
   (~2.4k chars). OpenAI enforces the Pydantic model through structured
   outputs and GeminiProvider injects the real JSON schema itself, so the copy
   was token cost that could only drift from the truth.

Measured against `ab-new-prompt`:

| metric | before | after | |
|---|---|---|---|
| word_growth | 1.498 | 1.350 | −0.148 |
| max_bullet_words | 20.6 | 17.8 | −2.8 |
| contentless trailing clauses | 5/22 (23%) | 2/22 (9%) | |
| specificity_retention | 1.00 | 1.00 | held |
| verb_diversity | 1.00 | 1.00 | held |
| revert_rate | 0.00 | 0.00 | held |

**Read this cautiously.** `ats_before` moved +5.2 between the two runs because
the pins were regenerated in between, so the `ats_*` columns are not
comparable and `ats_delta` −3.4 is not evidence of a regression. `word_growth`
−0.148 sits right at the measured same-prompt noise floor (~±0.12), and the
filler drop is 5 bullets to 2 out of 22. Nothing regressed on the guarded
metrics; the improvement is suggestive, not established.

This run wrote the first pins that carry semantic verdicts as well as the
Agent 1 parse, so from here both halves of the scoring denominator are frozen
and A/B comparisons are finally controlled.


## Meaning-first rewrite of Agents 2 and 3 (`results/refine-before.json` → `results/refine-final.json`)

Reading the bullets, not the metrics, showed the rewrites were often not
true: a marketer who never used SQL got "using SQL", "order fulfilment API"
became "payment processing API", "4M records" became "4M high-volume
transactions", and most bullets ended in an invented purpose clause
("…to enhance revenue forecasting and financial planning"). No metric caught
any of it — no number changed and no named specific was dropped. The cause was
Agent 2's own wording: "as aggressively as possible", INJECT keywords "even if
the original bullet didn't use that exact language", and a cap of 20% SKIPs.

Changes:
1. Agent 2 rewritten around an evidence rule — a keyword is planned only if it
   is already in the bullet, is the standard name for what the bullet
   describes ("automated deployment pipelines" → CI/CD), or is named in the
   same role. Unchanged is now an allowed outcome. ~1300 → ~700 words.
2. Agent 3 rewritten around a meaning test (a reader who never saw the JD
   understands it; literal, grammatical, no pasted JD phrases) and a rule
   against added tails. ~1400 → ~800 words. Both reasoning fields capped.
3. Agent 3 no longer receives Agent 2's reasoning.
4. `bullet_guard` gained two deterministic checks: a JD tool the résumé never
   mentions reverts the bullet (practice names like CI/CD are exempt), and an
   invented closing purpose clause is cut.
5. The runner records token usage per fixture (`tokens_*`, `token_calls`).

| metric | before | after |
|---|---|---|
| tokens_total | 7922 | 6621 (−16%) |
| tokens_input / tokens_output | 6624 / 1298 | 5439 / 1181 |
| word_growth | 1.61 | 1.11 |
| specificity_retention | 1.00 | 1.00 |
| verb_diversity | 0.95 | 1.00 |
| ats_delta | 9.6 | 0.8 |

Pins were shared, so `ats_before` is identical in both runs. **`ats_delta`
fell, and most of that is intended**: the old lift came largely from terms the
candidate could not claim (SQL, payment processing, distributed systems, "owned
the platform roadmap"). It is also noisy — two intermediate runs of the new
prompts scored +3.2 and +3.4. Known leftovers: a tool named elsewhere in the
résumé (React in skills, SQL in another project) can still be attached to a
bullet that did not use it; the guard cannot tell, by design.


## Assertive tailoring, flag-don't-revert (`results/assertive-h50.json`, `results/assertive-h85.json`)

Product call after the meaning-first run: people come to raise their ATS
score, so tailoring must be assertive, and where a claim can't be verified
the candidate decides — the review already starts any unverified point
unticked. Changes:

1. Agent 2 is told which JD phrases the résumé lacks
   (`jd_terms_missing_from_resume`) and to land every one the résumé
   supports, verbatim; it may offer a JD tool the résumé lacks where the
   bullet's work is exactly what the tool is for, as a flagged option.
2. Keyword intensity follows the existing Humanize ↔ ATS slider
   (`keyword_intensity`: 1 / 2 / 3 phrases per bullet).
3. Only phrases of ≤5 words reach Agent 3 as verbatim keywords
   (`_verbatim_keywords`); whole JD duties were being pasted in front of
   bullets as "[duty] by [real work]".
4. `bullet_guard` flags instead of reverting. Flagged rewrites are kept,
   start unticked in the review with the reason on the card, and Auto-select
   skips them.
5. The scorer accepts a phrase's leading verb in past tense ("owned the
   platform roadmap" matches "own the platform roadmap").

| metric | meaning-first | h50 | h85 |
|---|---|---|---|
| ats_delta | 0.8 | 15.2 | 21.4 |
| tokens_total | 6621 | 7364 | 7413 |
| flagged share (`revert_rate`) | 0.00 | 0.08 | 0.16 |
| word_growth | 1.11 | 1.45 | 1.47 |
| specificity_retention | 1.00 | 0.99 | 0.99 |

`ats_after` here counts every rewrite as accepted, including flagged ones and
JD tools the résumé lacks (h85's career-changer +57 is mostly SQL/Tableau/
Looker it offers as options). In the product those start unticked, so the
default score is lower until the candidate opts in.

Still seen in the text, not caught by any metric: the "payment processing"
domain swap persists on one bullet in both runs, and a few label stacks /
tails get through ("platform development infrastructure service scaffolding",
"under own platform roadmap", "for revenue stakeholders").

### gpt-4.1 as the premium model (`results/assertive-h50-gpt41.json`)

Same pins and prompts at h50, only `OPENAI_MODEL_PREMIUM=gpt-4.1` (Agents 2
and 3). `ats_delta` 27.0 vs 15.2, tokens about equal (7512 vs 7364) — but at
roughly 5x the per-token price, and the text is not better: it brought back
the "[JD duty] by [real work]" opener the prompt forbids ("Owned end-to-end
delivery for payment processing by migrating…"), stuffed more tools
(Kubernetes, TypeScript) and more filler ("applying data pipeline concepts
throughout the process"). More aggressive, not more obedient. Kept
gpt-4.1-mini.
