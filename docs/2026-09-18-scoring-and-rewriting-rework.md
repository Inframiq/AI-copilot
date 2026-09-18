# Résumé pipeline rework — before and after

An audit found the résumé scorer was measuring the wrong thing and the bullet
rewriter's quality rules were promises with nothing behind them. This records
what changed and the evidence for each.

15 commits, 63 files, +7,429/−472. API tests 270 → 651, web tests ~330 → 450.
Migrations 021–023 applied.

---

## Scoring the résumé

### Projects, achievements and leadership were invisible

**Before** — `build_resume_text` walked only headline, summary, experience,
education, skills, certifications and awards. A new graduate whose technical
evidence lives entirely in Projects was scored against an effectively empty
résumé. `resume_spec.SECTION_ORDER` ranks Projects *above* Experience for
freshers, so this was half the supported candidate types.

**After** — projects, achievements, leadership, volunteer work and languages
all count.

```
Project bullet: "Built end-to-end ML pipelines in Python with Kubernetes."
  'Python'      before: missing   after: matched
  'Kubernetes'  before: missing   after: matched

Whole-résumé score for that fresher   0 → 84
```

### The phrase matcher invented matches

**Before** — a multi-word phrase counted as matched when two thirds of its
`>2`-character words appeared *anywhere* in the résumé. Filler words
("through") and repeats ("growth"…"growth") counted as evidence.

**After** — every distinctive token must appear inside one segment (a single
bullet, a title, the summary). Stopwords are dropped rather than required, and
a repeated token counts once.

```
A marketing coordinator's résumé against an engineering JD:
  'distributed systems design'                  matched → not matched
  'revenue growth through product-led growth'   matched → not matched
```

The reasoning, recorded in `ats.py`: a lexical **miss** is recovered by the
semantic verifier downstream, so recall costs nothing there. A false **match**
is reviewed by nothing — it inflates the "before" score and shrinks the
measured lift from tailoring. That pass is now precision-first.

### Importance was extracted, displayed — and never scored

**Before** — Agent 1 rated every JD term high/medium/low, `_backfill_importance`
guaranteed full coverage, the UI rendered the badge, and `blend_scores`
weighted every required phrase at 1.0 regardless.

**After** — weight is `base × importance`, multipliers `1.5 / 1.0 / 0.5`
centred on medium so a JD with no importance data scores exactly as before.

### The "+X%" argued for keyword stuffing

**Before** — `estimate_fix_delta` scored the patched résumé against *frozen*
semantic verdicts, so only a fix whose text echoed the JD phrase could move the
number. The UI hides a zero delta.

**After** — `verdicts_with_fixes` credits a fix for the gap it exists to close.

```
Same gap, "infrastructure as code":
  "Automated cloud provisioning using declarative templates."   +0 → +15
  "Managed infrastructure as code across staging and prod."    +15 → +15
```

---

## Rewriting bullets

### Tailoring a fresher's résumé did nothing

**Before** — `_index_bullets` walked `experience` only, so Agents 2 and 3 never
saw a project. Three model calls, one credit, nothing changed that was scored.

**After** — `_BULLET_SECTIONS` covers experience and projects; project bullets
are indexed (`proj{i}_b{j}`), rewritten, reviewable and mergeable.

### "Fact lock" was a promise, not a check

**Before** — nothing verified that `preserved_metrics` survived, that no new
number appeared, that the 35-word cap held, or that banned filler stayed out.
`resume_validator` did all of this and was only called by the from-scratch
builder.

**After** — `services/bullet_guard.py` runs on every rewrite. A violation
reverts that bullet to the candidate's own text and is reported to the UI.
Deliberately not built on `validate_resume`, which is whole-résumé and renders
a PDF to count pages — that would drag WeasyPrint into the hot path.

```
Checked per bullet: invented metric · dropped metric · word cap · banned filler
Live eval revert rate: 0.00 across every run since
```

### A long résumé could kill the whole run

**Before** — when Agent 3 hit its output ceiling mid-JSON, the provider returned
`None` and the caller died on an opaque `AttributeError`. The run failed, the
credit was refunded, nothing in the logs said why.

**After** — providers raise `AITruncatedError` / `AIRefusalError` /
`AIEmptyResponseError` naming the call, model and budget. `_agent3_call` halves
its plan and retries recursively.

```
20-bullet résumé, provider truncating above 6:
  agent3_write truncated on 20 bullets — splitting into 10 + 10
  agent3_write truncated on 10 bullets — splitting into 5 + 5
  bullets in 20 · out 20 · all rewritten
```

Applied to both providers — Gemini truncation arrived as a bare
`JSONDecodeError`, indistinguishable from malformed output.

### Dropped bullets failed silently

**Before** — an omitted bullet kept its original text and logged a warning. The
review screen only lists bullets that *changed*, so a drop was
indistinguishable from a deliberate skip.

**After** — `transformation` is a real enum, so drops are distinguishable from
skips and only the drops are re-requested. One retry, then the fallback stands.

### The inline Rewrite button was a different, worse product

**Before** — a two-sentence prompt on the fast model. No word cap, no banned
phrases, no metric preservation, no fact-lock. It was also the last remaining
path for a fabricated metric to reach a résumé.

**After** — `build_single_bullet_system` carries Agent 3's rules minus the
batch-only ones, and the same guard runs on the result. A rejected rewrite
returns the original plus `reverted_reasons`, which the panel displays.

---

## The review screen

### You had to spot the difference yourself

**Before** — the original struck through in full above the rewrite.

**After** — `lib/word-diff.ts`, a word-level LCS diff.

```
ORIGINAL:  [Managed the] deployment [process] for [the] team
TAILORED:  [Owned end-to-end CI/CD] deployment [pipelines] for [a] team [of 6]
```

### The reasoning was generated, billed, and thrown away

**Before** — `jd_responsibility_addressed` and `target_jd_keywords_to_inject`
were produced on every run and discarded; only a derived importance badge
reached the UI.

**After** — persisted as `bullet_rationale` and shown per bullet.

### The live score ignored most of your choices

Three separate faults:

1. `setAllBulletDecisions`, `applyBulletDecisions`, `updatePendingBullet` and
   `updatePendingSummary` changed the résumé without re-scoring.
2. `POST /ai/project-score` scored the all-accepted snapshot, so rejecting a
   bullet moved nothing.
3. `POST /ai/tailor` read `jd_row.parsed["agent1"]` but never wrote it, and
   project-score 409s without it — **14 of 40 real sessions** had a
   permanently frozen score. The silent `catch {}` made it look like a score
   that simply never moves.

All three fixed; a failed re-score now sets `projectedScoreStale` and the panel
says so.

### The lift was invisible

**Before** — caption text inside a subheading, no before-score. `ScoreRing`
existed and was imported by nothing.

**After** — `ats_score_before` persisted (migration 023) and shown as paired
rings with the gain, using that component.

---

## The prompts

All eight reviewed statically, then measured against 90 real rewritten bullets
from live runs. Less changed than expected.

### A four-way choice was free text

`strategic_instruction` was a plain `str` while Agent 3's rule 9 exact-matches
`"SKIP"`. `"Skip — no JD fit"` missed that branch silently and no code checked
it. Now `Literal["REINFORCE","REFRAME","INJECT","SKIP"]`, enforced by structured
outputs and honoured in `_apply_writer_output`.

### The highest-leverage call had no examples

Agent 2 — 964 words on the premium model, deciding whether the tailoring makes
sense at all — had zero worked examples; Agent 3, which only executes its plan,
had two. Added good and bad entries including a SKIP. Also deleted ~2,400
characters of duplicate `<output_schema>` prose from all eight prompts: OpenAI
enforces the Pydantic model and GeminiProvider injects the real schema itself.

```
word growth per bullet        1.50  → 1.35
longest bullet                20.6w → 17.8w
contentless trailing clauses  23%   → 9%
specificity / verbs / reverts unchanged and perfect
```

### Two contradictory skill lists on one page

The JD page showed "Skills from JD" from a legacy extractor beside the
Matched/Not Matched columns from Agent 1. They disagreed, and creating a JD
paid for the worse extraction. `parsed_skills` now derives from Agent 1's four
skill-shaped buckets; creating a JD is a plain insert, one call cheaper.

---

## Measuring any of this

`apps/api/evals/` — five fixtures chosen for failure modes that actually
occurred, with deterministic metrics for the prompt rules nothing measured:
specificity retention, keyword concentration, verb diversity, revert rate,
word growth. See `evals/README.md`.

Its first run found the writer padding every bullet with a restating clause —
invisible to the ATS score, which had gone *up*.

### Two corrections the harness forced

- I reported 53% of rewrites ended in filler. Measured properly, 56% of those
  clauses carry a real metric; the true rate was **23%**.
- I proposed a length fix built on a "word floor" mechanism the data falsified:
  bullets already above the floor grew just as much (1.47x vs 1.50x).

Both came from the fixtures, not from re-reading the prompts.

---

## Interface

- **Sidebar** collapses to a 72px icon rail between 768–1279px, full width
  above, with an edge flap that pins either state and persists it. The
  automatic rule is pure CSS so the right width paints before hydration. Three
  flicker sources fixed: the logo was re-fetching its other file mid-animation,
  padding snapped while width animated, and the active row's hover scale was
  resizing its own icon.
- **Header "Download PDF" removed** at request. This was the only export path
  outside tailoring review, so a saved résumé can no longer be downloaded from
  the Studio.

---

## Still open

| Area | Item |
|---|---|
| Scoring | Still a JD keyword-coverage ratio presented as an "ATS score" — no placement, recency or parse-hygiene signals. Rename it or add them. |
| Scoring | A `partial` match earns 0.5 while displaying under **Missing** — a red chip already scoring points. |
| Interface | `title_match` is the highest-weighted single signal and is never shown. |
| Interface | Missing-keyword chips carry no importance badge, in the one place users pick priorities. |
| Evals | Five fixtures cannot separate a small effect from noise. Nearer twenty would make prompt tuning measurable. |

## Caveats

Eval figures compare single runs; same-prompt variation is roughly ±0.12 on
`word_growth`, so small movements are suggestive rather than proven. The
`ats_*` columns across earlier result files are not comparable to each other —
the scoring baseline was re-pinned partway through, and only runs from
`prompt-cleanup.json` onward share a frozen denominator.

Existing tailoring sessions keep their old data: no before-score, no rationale,
no revert list. They render as they always did; new runs get everything above.
