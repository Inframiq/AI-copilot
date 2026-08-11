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
OPENAI_MAX_OUTPUT_TOKENS=4096
```

`apps/api/app/services/ai_engine/factory.py` reads `AI_PROVIDER` and picks
the provider class at runtime. With this `.env`, **every** agent call in the
app goes through `OpenAIProvider` (`apps/api/app/services/ai_engine/openai_provider.py`),
using a single hardcoded model: **`gpt-5.6-luna`** (a fixed budget-tier
model, not read from `AI_MODEL_FAST`/`AI_MODEL_PRO` — see the comment at
`openai_provider.py:5-9` for why).

### `model_tier` is a no-op on this provider

`AIProvider.complete()` / `complete_structured()` both accept a
`model_tier: "fast" | "pro"` argument. `GeminiProvider` actually uses it to
pick between `gemini-2.5-flash` and `gemini-2.5-pro`. **`OpenAIProvider`
accepts the parameter but never reads it** (`openai_provider.py:18,27`) — every
call, regardless of the tier the caller requested, hits the same
`gpt-5.6-luna` model with the same `max_output_tokens=4096`. This is
invisible from the call sites in `tailoring.py` — they all say
`model_tier="fast"` or `model_tier="pro"` as if it mattered, and it silently
doesn't under this `.env`.

### Known risk: 4096 output tokens may be too low for Agent 3

`GeminiProvider` deliberately sets `max_output_tokens=16384`
(`gemini_provider.py:20`), with a comment explaining Agent 3 (the bullet
rewriter) can legitimately need 8k–16k output tokens to rewrite a full
resume's worth of bullets. `OpenAIProvider` under this `.env` is capped at
**4096**. Agent 3's own system prompt (`tailoring.py`, rule 5) states that
omitting even one bullet from its output is a **fatal** failure mode. For a
resume with many bullets, a 4096-token cap risks silent truncation or
incomplete coverage — this has not been confirmed as an active bug, just a
structural risk worth watching if tailoring output starts dropping bullets
on longer resumes.

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
| 2 | Semantic Mapper (`_agent2_semantic_map`) | Every "Tailor Resume" only | `"pro"` | `gpt-5.6-luna` | 3,288 chars (~822 tokens) |
| 3 | Precision Writer (`_agent3_write`) | Every "Tailor Resume" only | `"pro"` | `gpt-5.6-luna` | 2,302 chars (~575 tokens, varies slightly with humanize tone) |
| — | Prep Questions (`generate_prep_questions`) | Every "Tailor Resume" only, runs in parallel with Agent 3 | `"pro"` | `gpt-5.6-luna` | ~500 chars (~125 tokens) + the missing-skills list |
| — | Rewrite/Humanize bullet (`/ai/rewrite-bullet`, `apps/api/app/routers/ai.py`) | Per-click "Rewrite"/"Humanize" button in the tailoring review panel | `"fast"` | `gpt-5.6-luna` | 250–350 chars (~70–90 tokens) |

**Per "Tailor Resume" click:** Agent 1 → Agent 2 → [Agent 3 + Prep Questions
in parallel], plus optional Agent 0 if a company name was entered. That's
4-5 calls to `gpt-5.6-luna`, all sharing the same 4096-output-token ceiling.

**Per "Analyze Description" click:** just Agent 1 (+ optional Agent 0) — no
resume rewriting, no pro-tier-in-name-only calls.

## If real numbers are wanted later

Wiring up actual usage logging would mean capturing `response.usage` in
`OpenAIProvider.complete()`/`complete_structured()` (and
`response.usage_metadata` in `GeminiProvider`, for parity if the provider is
ever switched back) and logging/aggregating it per call site. Not done as
of this doc — flagged here so it isn't re-discovered from scratch later.
