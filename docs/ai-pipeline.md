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

### No token-usage telemetry exists

Neither provider implementation logs real token consumption anywhere.
`OpenAIProvider`'s Responses API calls already return `response.usage`
(input/output/total token counts) on every call — the code discards it,
returning only `response.output_text` / `response.output_parsed`
(`openai_provider.py:25,37`). `GeminiProvider` similarly ignores
`response.usage_metadata`. Any token-count figures quoted below are
**estimates from fixed system-prompt sizes** (measured directly, ~4
chars/token heuristic), not observed data — actual per-call totals depend
heavily on resume/JD length (the variable input) and model output length
(the variable output), neither of which is captured today.

## Every agent / prompt call site

| # | Agent | Trigger | `model_tier` requested | Model actually used (this `.env`) | System prompt size |
|---|-------|---------|------------------------|-------------------------------------|---------------------|
| 0 | Company Intel (`_agent0_company_intel`) | Optional — only when a company name is given to Analyze/Tailor | `"fast"` | `gpt-5.6-luna` | 1,866 chars (~466 tokens) |
| 1 | JD Deconstructor (`_agent1_parse_jd`) | Every "Analyze Description" and every "Tailor Resume" | `"fast"` | `gpt-5.6-luna` | 1,284 chars (~321 tokens) |
| 2 | Semantic Mapper (`_agent2_semantic_map`) | Every "Tailor Resume" only | **`"premium"`** | **`gpt-5.6-sol`** | 3,288 chars (~822 tokens) |
| 3 | Precision Writer (`_agent3_write`) | Every "Tailor Resume" only | `"pro"` | `gpt-5.6-luna` | 2,302 chars (~575 tokens, varies slightly with humanize tone) |
| — | Prep Questions (`generate_prep_questions`) | Every "Tailor Resume" only, runs in parallel with Agent 3 | `"pro"` | `gpt-5.6-luna` | ~500 chars (~125 tokens) + the missing-skills list |
| — | Rewrite/Humanize bullet (`/ai/rewrite-bullet`, `apps/api/app/routers/ai.py`) | Per-click "Rewrite"/"Humanize" button in the tailoring review panel | `"fast"` | `gpt-5.6-luna` | 250–350 chars (~70–90 tokens) |

**Per "Tailor Resume" click:** Agent 1 → Agent 2 → [Agent 3 + Prep Questions
in parallel], plus optional Agent 0 if a company name was entered. That's
one `gpt-5.6-sol` call (Agent 2) plus 3-4 `gpt-5.6-luna` calls, all sharing
the same 16384-output-token ceiling.

**Per "Analyze Description" click:** just Agent 1 (+ optional Agent 0) — no
resume rewriting, no pro-tier-in-name-only calls.

## If real numbers are wanted later

Wiring up actual usage logging would mean capturing `response.usage` in
`OpenAIProvider.complete()`/`complete_structured()` (and
`response.usage_metadata` in `GeminiProvider`, for parity if the provider is
ever switched back) and logging/aggregating it per call site. Not done as
of this doc — flagged here so it isn't re-discovered from scratch later.
