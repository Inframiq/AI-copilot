# AI Agent Pipeline — Prompts, Model Config, and Known Limitations

Reference doc for every LLM call this app makes. Written after auditing
`apps/api/app/services/tailoring.py`, `apps/api/app/routers/ai.py`, and
`apps/api/app/services/ai_engine/*` against this repo's actual `.env`
configuration (not just the code's hardcoded defaults).

## Active provider (as configured in `apps/api/.env`)

```
AI_PROVIDER=openai
GEMINI_API_KEY=            # empty — Gemini path is unused
OPENAI_API_KEY=<set>
OPENAI_MODEL_FAST=gpt-5.6-luna
OPENAI_MODEL_PREMIUM=gpt-5.6-sol
OPENAI_MAX_OUTPUT_TOKENS=16384
```

`apps/api/app/services/ai_engine/factory.py` reads `AI_PROVIDER` and picks
the provider class at runtime. With this `.env`, **every** agent call in the
app goes through `OpenAIProvider` (`apps/api/app/services/ai_engine/openai_provider.py`).

### `model_tier` now resolves to two models, deliberately not three

`AIProvider.complete()` / `complete_structured()` accept a
`model_tier: "fast" | "pro" | "premium"` argument. **`OpenAIProvider` maps
"fast" and "pro" to the SAME budget model** (`gpt-5.6-luna`) and reserves
`gpt-5.6-sol` (5x the input cost, 5x the output cost) for `"premium"`
only (`openai_provider.py`'s `_model_for`). This was a deliberate
cost/margin decision, not an oversight this time (compare the git history —
`model_tier` used to be silently ignored entirely, mapping every tier onto
`gpt-5.6-luna`): real per-call token estimates showed putting every "pro"-tier
call on `sol` (Agent 2, Agent 3, prep questions, cover letter) costs
~2.5x a $5-for-100-generations budget, while upgrading only Agent 2 — the
JD+resume semantic mapper, the single call that most determines whether
the tailoring makes sense — lands close to that budget.

**Only one call site requests `"premium"`:** `tailoring.py`'s
`_agent2_semantic_map` (Agent 2). Every other call in the table below still
requests `"fast"` or `"pro"` and lands on `gpt-5.6-luna`, same as before —
this is intentional, re-derive the cost math in the git history before
changing which calls get `"premium"`.

`GeminiProvider` (currently unused — `AI_PROVIDER=openai`) has no distinct
premium model; `model_tier="premium"` falls back to its `"pro"` model
(`gemini-2.5-pro`) rather than silently downgrading to `"fast"`.

### Confirmed bug (2026-08-13): 4096 output tokens is too low, and it was silently killing entire tailoring runs

`GeminiProvider` deliberately sets `max_output_tokens=16384`
(`gemini_provider.py:20`), with a comment explaining Agent 3 (the bullet
rewriter) can legitimately need 8k–16k output tokens to rewrite a full
resume's worth of bullets. `OpenAIProvider` under this `.env` was capped at
**4096**. This was flagged below as a theoretical risk; it turned out to be
an active one. Reproduced directly against a real user's resume/JD: the
Prep Questions call's structured-output JSON was cut off mid-string by the
token cap (`gpt-5.6-luna` is a reasoning model — reasoning tokens share the
same `max_output_tokens` budget as the visible output, so the visible JSON
can run out of budget before it's complete), and the resulting
`pydantic.ValidationError` (`Invalid JSON: EOF while parsing a string`)
propagated out of `run_tailoring_pipeline`'s `asyncio.gather(...)` call and
discarded an already-successful Agent 3 bullet rewrite along with it —
every "Tailor Resume" click for that user was failing outright, not just
losing prep questions.

Fixed in two parts:
1. **`.env`**: `OPENAI_MAX_OUTPUT_TOKENS` raised to `16384` (matching
   Gemini's proven-safe cap) locally. This is a per-environment variable —
   the production value on Render must be updated separately; it is not
   controlled by this repo.
2. **Code (`tailoring.py`, `run_tailoring_pipeline`)**: the Agent 3 / Prep
   Questions `asyncio.gather` now uses `return_exceptions=True`. Agent 3
   failing is still fatal (re-raised — there's no tailored resume without
   it). Prep Questions failing is now non-fatal: it's logged and the
   pipeline returns with an empty `prep_questions` list instead of
   discarding a successful bullet rewrite. This is defense-in-depth on top
   of the token-cap fix, not a replacement for it — Agent 3 itself has no
   equivalent fallback (per rule 5 below, a partial rewrite is unacceptable,
   so raising the cap is the only real fix for Agent 3's exposure).

### Per-call output-token ceilings (2026-08-17)

`OpenAIProvider.complete()` / `complete_structured()` now accept an optional
`max_output_tokens` override per call (falling back to the provider's
`OPENAI_MAX_OUTPUT_TOKENS` default, 16384, when omitted) plus a `call_name`
label used only for logging. Every call site in `tailoring.py` and
`routers/ai.py` now passes both, replacing the single blanket 16384-token
ceiling every call used before.

The reasoning: `max_output_tokens` isn't a direct cost lever by itself —
billing is by tokens actually generated, not the ceiling — but `gpt-5.6-luna`
is a reasoning model whose **invisible reasoning tokens share the same
output budget and are billed the same as visible output**. A call with a
small, fixed-shape output (a handful of keyword lists, 2-3 interview
questions, one rewritten bullet) gets no quality benefit from a 16384-token
ceiling, and a needlessly high ceiling only gives the model more room to
reason longer than the task needs. Agent 2 and Agent 3 are the exception —
their output is one JSON entry per resume bullet, so it genuinely scales
with resume size, and both keep the full 16384 ceiling (matching
`GeminiProvider`'s original Agent 3 reasoning). See the constants and
comment at the top of `tailoring.py` (`_MAX_TOKENS_*`) for the exact value
per call site. Every value keeps a wide safety margin over its realistic max
output specifically so this doesn't reintroduce the 4096-was-too-low
truncation bug above — this is a headroom trim, not a re-run of that mistake.

`GeminiProvider` accepts the same two parameters for interface parity
(building a per-call `GenerationConfig` override when `max_output_tokens` is
passed) even though it's currently unused in production (`AI_PROVIDER=openai`).

### Token-usage telemetry now exists

`OpenAIProvider` and `GeminiProvider` both capture `response.usage` /
`response.usage_metadata` after every call and log it at INFO level under
the `"app"` logger as `ai_usage call=<call_name> tier=<model_tier>
model=<model> input_tokens=... output_tokens=... reasoning_tokens=...
total_tokens=...` (Gemini's line omits `reasoning_tokens`, which OpenAI's
Responses API doesn't expose either unless the model actually used
reasoning tokens — logged as `None` when absent). This is the way to verify,
from real production data rather than the char-count estimates below,
whether the new per-call ceilings above are sized correctly — grep server
logs for `ai_usage call=agent2_semantic_map` etc. to see real per-call-site
consumption. Any token-count figures quoted below are still **estimates
from fixed system-prompt sizes** (measured directly, ~4 chars/token
heuristic), not observed data.

### Content-quality prompt upgrade (2026-08-17): responsibility-alignment, not just keyword injection

Three rounds of research (ATS mechanics, keyword-vs-responsibility alignment,
and higher-leverage LLM-quality techniques) drove a set of prompt/schema
changes aimed at two confirmed problems: (1) `pdf.py`'s keyword highlighter
had no word-boundary anchoring (`Java` falsely bolded inside `JavaScript`,
`React` truncated inside `ReactJS`) — fixed by porting `ats.py`'s
`_exact_pattern` alphanumeric-lookaround approach into
`_highlight_keywords`; and (2) tailored bullets read as keyword-stuffed
rather than genuinely tied to what the JD's role actually does.

**Reasoning-first structured output** (`BulletMapping` and `RewrittenBullet`
in `tailoring.py`): both models now declare a `reasoning: str = ""` field
*first*, before any other field. The Responses API generates structured
fields in schema-declaration order, so this forces Agent 2 to reason about
which JD responsibility a bullet serves (and Agent 3 to reason about
fact-lock/specificity) before committing to the rest of the entry — same API
call, no new cost, small output-token increase (well inside the existing
16384 ceiling on both calls, which was already sized for one full JSON entry
per resume bullet).

**New responsibility-alignment fields, threaded through all three agents:**
- Agent 1 (`_AGENT1_SYSTEM` / `JDAnalysis`) now extracts `core_responsibilities`
  — the JD's actual duty lines ("owns X", "partners with Y on Z"), distinct
  from the tool/theme/methodology lists it already pulled out.
- Agent 2 (`_AGENT2_SYSTEM` / `BulletMapping`) now names
  `jd_responsibility_addressed` per bullet — which specific responsibility
  (if any) the transformation serves — before choosing REINFORCE/REFRAME/
  INJECT/SKIP (rule 3, "RESPONSIBILITY-FIRST REASONING"). Rule 5,
  "SPECIFICITY OVER JD-MIRRORING", is the explicit anti-genericness guardrail:
  a bullet that becomes vaguer just to match the JD is a failure even if it
  scores better. INJECT also now carries a density cap (rule 4) — the same
  keyword can't be injected into more than 2-3 bullets unless the JD itself
  repeats it 3+ times, guarding against a term getting stuffed everywhere.
- Agent 3 (`_build_agent3_system`) rule 1 reframes keyword injection as a
  byproduct of demonstrating `jd_responsibility_addressed`, not the goal
  itself; rule 3, "PRESERVE SPECIFICS", is the last-line-of-defense version
  of the same anti-genericness guardrail, applied at final-text time.

**Other prompt additions to Agent 3, same call, no new cost:**
- Rule 4 adds action-verb variety (don't open more than one bullet with the
  same verb unless no synonym fits — a known LLM regression-to-a-few-verbs
  failure mode).
- Rule 5 adds acronym/full-form pairing on first use (e.g. "Search Engine
  Optimization (SEO)") — some ATS platforms index only the literal string
  present.
- Rule 6 adds tense consistency (past tense throughout, including the
  current role) — ATS itself barely cares which tense, but mixed tense
  across 40-80 independently-rewritten bullets is a real LLM risk.
- Rule 12, "SENIORITY-AWARE EMPHASIS", passes `seniority_indicators` (already
  extracted by Agent 1, previously unused beyond keyword injection) into
  Agent 3 so IC/management/executive bullets get different rhetorical
  emphasis (technical depth vs. team scope vs. strategic outcomes), not just
  different keywords. `run_tailoring_pipeline` threads
  `analysis.jd_analysis.seniority_indicators` into `_agent3_write` for this.
- A `<examples>` block gives Agent 3 one concrete bad (keyword-stuffed) and
  one good (specific + responsibility-demonstrating) bullet transformation —
  few-shot exemplars for single-turn stylistic control, evidenced as a strong
  complement to (not replacement for) rule-based instructions.

**Explicitly not implemented this round** (flagged as real gaps, deliberately
deferred — see git history / conversation record for the reasoning): embedding-based
semantic matching for `ats_score`/`missing_skills` (lowest ROI of the
research findings — `ats.py`'s existing 3-pass matcher already beats naive
keyword-only matching, and true embeddings would need a new API dependency
for a UI metric, not the bullet text users read); auto-tailoring the
Summary/Objective field inside `run_tailoring_pipeline` (needs a new agent
call, real added cost per run); and reintroducing a JD-title-matching
headline field (conflicts with an earlier explicit product decision to
remove it).

## Every agent / prompt call site

| # | Agent | Trigger | `model_tier` requested | Model actually used (this `.env`) | System prompt size | `max_output_tokens` (`call_name`) |
|---|-------|---------|------------------------|-------------------------------------|---------------------|-------------------------------------|
| 0 | Company Intel (`_agent0_company_intel`) | Optional — only when a company name is given to Analyze/Tailor | `"fast"` | `gpt-5.6-luna` | 1,866 chars (~466 tokens) | 3000 (`agent0_company_intel`) |
| 1 | JD Deconstructor (`_agent1_parse_jd`) | Every "Analyze Description" and every "Tailor Resume" | `"fast"` | `gpt-5.6-luna` | 1,284 chars (~321 tokens) | 3000 (`agent1_parse_jd`) |
| 2 | Semantic Mapper (`_agent2_semantic_map`) | Every "Tailor Resume" only | **`"premium"`** | **`gpt-5.6-sol`** | 3,288 chars (~822 tokens) | 16384 (`agent2_semantic_map`) — scales with bullet count |
| 3 | Precision Writer (`_agent3_write`) | Every "Tailor Resume" only | `"pro"` | `gpt-5.6-luna` | 2,302 chars (~575 tokens, varies slightly with humanize tone) | 16384 (`agent3_write`) — scales with bullet count |
| — | Cover letter (`write_cover_letter`) | "Generate Cover Letter" action | `"pro"` | `gpt-5.6-luna` | ~1,000 chars (~250 tokens) | 3000 (`cover_letter`) |
| — | Prep Questions — skill bank (`_generate_questions_for_skills`) | Every "Tailor Resume" only, runs in parallel with Agent 3 | `"pro"` | `gpt-5.6-luna` | ~500 chars (~125 tokens) + the missing-skills list | 8000 (`prep_questions_skills`) |
| — | Prep Questions — JD-specific (`_generate_jd_specific_questions`) | Every "Tailor Resume" only, runs alongside the skill-bank prep questions | `"pro"` | `gpt-5.6-luna` | ~600 chars (~150 tokens) | 2500 (`prep_questions_jd_specific`) |
| — | Rewrite/Humanize bullet (`/ai/rewrite-bullet`, `apps/api/app/routers/ai.py`) | Per-click "Rewrite"/"Humanize" button in the tailoring review panel | `"fast"` | `gpt-5.6-luna` | 250–350 chars (~70–90 tokens) | 1200 (`rewrite_bullet`) |
| — | Legacy JD skill extractor (`extract_jd_skills`) | `/jd` create endpoint (older, non-agent-pipeline path) | `"fast"` | `gpt-5.6-luna` | ~150 chars (~40 tokens) | 3000 (`extract_jd_skills_legacy`) |

**Per "Tailor Resume" click:** Agent 1 → Agent 2 → [Agent 3 + Prep Questions
in parallel], plus optional Agent 0 if a company name was entered. That's
one `gpt-5.6-sol` call (Agent 2) plus 3-4 `gpt-5.6-luna` calls — see the
`max_output_tokens` column above for each call's actual ceiling (no longer a
single shared 16384 across the board).

**Per "Analyze Description" click:** just Agent 1 (+ optional Agent 0) — no
resume rewriting, no pro-tier-in-name-only calls.
