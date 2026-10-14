from abc import ABC, abstractmethod
from pydantic import BaseModel


class AIResponseError(RuntimeError):
    """The model returned nothing a caller can use.

    Providers raise one of the subclasses below instead of handing back None.
    Returning None meant every caller died on an opaque AttributeError
    ('NoneType' object has no attribute 'mapping_plan'), a whole tailoring run
    failed, the user's credit was refunded, and nothing in the logs said why.
    Catch this base class to mean "no usable output, whatever the reason".
    """


class AITruncatedError(AIResponseError):
    """The model hit its output-token ceiling mid-response, so the structured
    output never closed. Retrying identically will truncate identically — the
    fix is a smaller request (see tailoring._agent3_write, which splits its
    mapping plan) or a larger ceiling."""


class AIRefusalError(AIResponseError):
    """The model declined to answer."""


class AIEmptyResponseError(AIResponseError):
    """Empty output with no stated reason."""


class AIInputTooLargeError(ValueError):
    """The prompt is over the per-call size limit (app.core.ai_budget), so it
    was never sent. Not retryable as is: the input has to get shorter."""


class AIPausedError(RuntimeError):
    """Today's site-wide OpenAI spend has reached its limit
    (app.core.ai_budget); AI features are paused until the next UTC day."""


class AIProvider(ABC):
    @abstractmethod
    async def complete(
        self,
        system: str,
        user: str,
        model_tier: str = "fast",
        max_output_tokens: int | None = None,
        call_name: str = "unknown",
    ) -> str:
        """model_tier: 'fast' | 'pro' | 'premium'.

        'premium' is reserved for the single highest-leverage call in the
        pipeline (currently only tailoring.py's Agent 2, the JD+resume
        semantic mapper) — a deliberate cost/quality tradeoff, not a
        general-purpose upgrade tier. A provider that has no distinct
        premium model should fall back to its 'pro' model for it.

        max_output_tokens: per-call output-token ceiling. None falls back to
        the provider's configured default. Callers with a small, roughly
        fixed-shape output should pass a tight value — on a reasoning model,
        a needlessly high ceiling can let invisible reasoning tokens (billed
        the same as visible output) run longer than the task needs. Callers
        whose output scales with resume/JD content (bullet rewriting) should
        leave this generous; see docs/ai-pipeline.md.

        call_name: caller-supplied label used only for token-usage logging,
        so real per-call-site consumption can be observed instead of
        estimated. Never affects behavior.
        """

    async def complete_structured_with_web(
        self,
        system: str,
        user: str,
        schema: type[BaseModel],
        max_output_tokens: int | None = None,
        call_name: str = "unknown",
    ) -> tuple[BaseModel, list[str]]:
        """Like complete_structured, but the model must search the live web
        first. Returns (result, the URLs it read). A provider without web
        search answers without it and reports no sources."""
        result = await self.complete_structured(
            system, user, schema, model_tier="fast",
            max_output_tokens=max_output_tokens, call_name=call_name,
        )
        return result, []

    @abstractmethod
    async def complete_structured(
        self,
        system: str,
        user: str,
        schema: type[BaseModel],
        model_tier: str = "fast",
        max_output_tokens: int | None = None,
        call_name: str = "unknown",
    ) -> BaseModel:
        """Returns a validated instance of schema. See complete() for
        max_output_tokens and call_name semantics."""
