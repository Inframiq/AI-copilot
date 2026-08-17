from abc import ABC, abstractmethod
from pydantic import BaseModel


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
