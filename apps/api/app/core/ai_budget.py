"""Bounds on what one request — and one day — can cost in OpenAI fees.

Credits cap what a *user* can spend; these cap what a *request* and the
*whole site* can cost, whatever the input:

- `jd_for_model` trims job-description text to MAX_JD_CHARS_FOR_MODEL before
  it goes into a prompt. Real JDs are well under it (the longest stored on
  2026-10-12 was 9,165 characters); what gets cut from a longer one is the
  tail — usually benefits and legal boilerplate. The full text is still
  stored and still used by the (free, local) ATS scorer.
- `check_input_size` refuses any single model call whose prompt is over
  MAX_MODEL_INPUT_CHARS — about 3x the largest real call — so an oversized
  résumé, profile or anything else can't run up a large bill for a flat
  credit price. Raised before the request is sent; nothing is billed.
- `ensure_ai_budget` pauses AI features for the rest of the UTC day once
  that day's OpenAI spend reaches settings.ai_daily_spend_limit_usd, priced
  from ai_usage_events. It's the backstop for anything the other limits
  and credits miss (a bug, abuse across many accounts).

All three are enforced in the OpenAI provider, the one place every model
call goes through. Endpoints already refund credits when a call fails, and
main.py turns these errors into plain messages (422 / 503).
"""
import logging
import time
from datetime import datetime, timezone

from app.core.config import settings
from app.services.ai_engine.base import AIInputTooLargeError, AIPausedError

logger = logging.getLogger("app")

MAX_JD_CHARS_FOR_MODEL = 12_000
MAX_MODEL_INPUT_CHARS = 60_000

# USD per 1M tokens (input, output), OpenAI list prices. A model's versioned
# name ("gpt-4.1-mini-2025-04-14") is matched by its longest listed prefix.
_PRICES_PER_MILLION: dict[str, tuple[float, float]] = {
    # GPT-5.6 / 5.5 list prices (short context), developers.openai.com
    # pricing, 2026-10-13. Unlisted, they fell to _UNKNOWN_PRICE and the
    # day's spend was overstated ~25x for the fast tier.
    "gpt-5.6-luna": (0.20, 1.20),
    "gpt-5.6-terra": (2.00, 12.00),
    "gpt-5.6-sol": (4.00, 20.00),
    "gpt-5.5": (5.00, 30.00),
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-4o": (2.50, 10.00),
    "gpt-4.1-nano": (0.10, 0.40),
    "gpt-4.1-mini": (0.40, 1.60),
    "gpt-4.1": (2.00, 8.00),
}
# A model that isn't listed counts as expensive, so the ceiling errs on the
# safe side rather than letting an unpriced model run free.
_UNKNOWN_PRICE = (5.00, 20.00)

_CACHE_SECONDS = 30


def jd_for_model(text: str | None) -> str:
    """The job description as a prompt should see it: at most
    MAX_JD_CHARS_FOR_MODEL characters, cut at a paragraph (else line, else
    word) boundary so the model never reads half a sentence."""
    text = (text or "").strip()
    if len(text) <= MAX_JD_CHARS_FOR_MODEL:
        return text
    head = text[:MAX_JD_CHARS_FOR_MODEL]
    for sep in ("\n\n", "\n", " "):
        cut = head.rfind(sep)
        if cut >= MAX_JD_CHARS_FOR_MODEL * 0.8:
            return head[:cut].rstrip()
    return head


def check_input_size(system: str, user: str) -> None:
    size = len(system or "") + len(user or "")
    if size > MAX_MODEL_INPUT_CHARS:
        raise AIInputTooLargeError(
            f"model input is {size:,} characters; the limit is {MAX_MODEL_INPUT_CHARS:,}"
        )


def price_of(model: str, input_tokens: int, output_tokens: int) -> float:
    """USD for one call."""
    name = (model or "").lower()
    match = max((k for k in _PRICES_PER_MILLION if name.startswith(k)), key=len, default=None)
    p_in, p_out = _PRICES_PER_MILLION[match] if match else _UNKNOWN_PRICE
    return (input_tokens or 0) * p_in / 1_000_000 + (output_tokens or 0) * p_out / 1_000_000


# Today's spend, cached briefly so a busy minute doesn't sum the usage table
# on every call. Calls made by this process since the last read are added
# as they happen (note_spend), so the cache never lags behind this server.
_cache: dict = {"day": None, "read_at": 0.0, "spent": 0.0}


def _today():
    return datetime.now(timezone.utc).date()


def note_spend(model: str, input_tokens, output_tokens) -> None:
    """Add a call that just finished to today's cached total."""
    if _cache["day"] == _today():
        _cache["spent"] += price_of(model, int(input_tokens or 0), int(output_tokens or 0))


def _session_factory():
    from app.db.session import AsyncSessionLocal
    return AsyncSessionLocal()


async def spent_today() -> float:
    """USD spent on OpenAI so far today (UTC), from ai_usage_events."""
    day = _today()
    if _cache["day"] == day and time.monotonic() - _cache["read_at"] < _CACHE_SECONDS:
        return _cache["spent"]
    from sqlalchemy import func, select
    from app.db.models import AiUsageEvent

    start = datetime(day.year, day.month, day.day, tzinfo=timezone.utc)
    try:
        async with _session_factory() as db:
            rows = (
                await db.execute(
                    select(
                        AiUsageEvent.model,
                        func.sum(AiUsageEvent.input_tokens),
                        func.sum(AiUsageEvent.output_tokens),
                    )
                    .where(AiUsageEvent.created_at >= start)
                    .group_by(AiUsageEvent.model)
                )
            ).all()
    except Exception:
        # Can't read the usage log: keep serving (credits still gate every
        # user) on the last known figure rather than switching AI off.
        logger.warning("ai budget: couldn't read today's usage; using the last known total", exc_info=True)
        return _cache["spent"] if _cache["day"] == day else 0.0
    spent = sum(price_of(m, int(i or 0), int(o or 0)) for m, i, o in rows)
    _cache.update(day=day, read_at=time.monotonic(), spent=spent)
    return spent


async def ensure_ai_budget() -> None:
    """Raise AIPausedError once today's spend has reached the daily limit.
    A limit of 0 (or below) turns the ceiling off."""
    limit = settings.ai_daily_spend_limit_usd
    if limit <= 0:
        return
    spent = await spent_today()
    if spent >= limit:
        logger.error("ai budget: daily limit reached (spent $%.2f of $%.2f) — AI paused", spent, limit)
        raise AIPausedError(f"daily AI spend limit reached (${spent:.2f} of ${limit:.2f})")
