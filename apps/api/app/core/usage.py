"""Per-request AI-usage capture.

The AI providers call `record_call(...)` after every LLM request. While a
`record_ai_usage(user_id, action)` block is active on the same asyncio task,
those calls accumulate in a ContextVar sink and are written to
`ai_usage_events` when the block exits. Providers stay DB- and user-agnostic;
only the router/background task knows who the user is and which action ran.

Telemetry only — a failure to record must never break the user's action, so
persistence runs in its own DB session and swallows every exception.
"""
import contextvars
import logging
from contextlib import asynccontextmanager

logger = logging.getLogger("app")

_sink: contextvars.ContextVar[list | None] = contextvars.ContextVar(
    "ai_usage_sink", default=None
)


def record_call(
    *,
    call_name: str | None,
    model: str | None,
    model_tier: str | None,
    input_tokens,
    output_tokens,
    reasoning_tokens,
    total_tokens,
) -> None:
    """Append one LLM call to the active sink. No-op when no block is active."""
    sink = _sink.get()
    if sink is None:
        return
    sink.append(
        {
            "call_name": (call_name or "unknown")[:60],
            "model": (model or "")[:80],
            "model_tier": (model_tier or "")[:20],
            "input_tokens": int(input_tokens or 0),
            "output_tokens": int(output_tokens or 0),
            "reasoning_tokens": int(reasoning_tokens or 0),
            "total_tokens": int(total_tokens or 0),
        }
    )


@asynccontextmanager
async def record_ai_usage(user_id, action: str):
    """Collect every `record_call` made inside the block and persist one
    `ai_usage_events` row each. Opens its own session so telemetry can't
    interfere with (or be rolled back by) the caller's transaction."""
    from app.db.session import AsyncSessionLocal
    from app.db.models import AiUsageEvent

    token = _sink.set([])
    try:
        yield
    finally:
        calls = _sink.get() or []
        _sink.reset(token)
        # No `return` in this finally — it would swallow an exception
        # propagating out of the wrapped block.
        if calls:
            try:
                async with AsyncSessionLocal() as db:
                    db.add_all(
                        [AiUsageEvent(user_id=user_id, action=action, **c) for c in calls]
                    )
                    await db.commit()
            except Exception:
                logger.exception(
                    "ai_usage_events persist failed (action=%s, %d calls)", action, len(calls)
                )
