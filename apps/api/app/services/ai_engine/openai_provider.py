import logging
from openai import AsyncOpenAI
from pydantic import BaseModel
from app.services.ai_engine.base import (
    AIEmptyResponseError,
    AIProvider,
    AIRefusalError,
    AITruncatedError,
)

logger = logging.getLogger("app")


class OpenAIProvider(AIProvider):
    def __init__(
        self,
        api_key: str,
        fast_model: str,
        premium_model: str,
        max_output_tokens: int = 4096,
    ):
        self._client = AsyncOpenAI(api_key=api_key)
        self._fast_model = fast_model
        self._premium_model = premium_model
        self._max_output_tokens = max_output_tokens

    # "fast" and "pro" both resolve to the budget model — deliberate, not an
    # oversight. Real per-call token estimates (docs/ai-pipeline.md) showed
    # putting every "pro"-tier call (Agent 2, Agent 3, prep questions, cover
    # letter) on the pricier model blows a $5-for-100-generations budget by
    # 2.5x; putting only Agent 2 (the JD+resume semantic mapping — the call
    # that most determines whether the tailoring makes sense) on it lands
    # close to that budget while still upgrading the highest-leverage step.
    # So Agent 2 is the only caller that requests "premium"
    # (tailoring.py's _agent2_semantic_map) — everything else keeps
    # requesting "pro" and silently gets the budget model, same as before.
    def _model_for(self, model_tier: str) -> str:
        return self._premium_model if model_tier == "premium" else self._fast_model

    def _log_usage(self, call_name: str, model_tier: str, model: str, usage) -> None:
        if usage is None:
            return
        reasoning_tokens = getattr(
            getattr(usage, "output_tokens_details", None), "reasoning_tokens", None
        )
        input_tokens = getattr(usage, "input_tokens", None)
        output_tokens = getattr(usage, "output_tokens", None)
        total_tokens = getattr(usage, "total_tokens", None)
        logger.info(
            "ai_usage call=%s tier=%s model=%s input_tokens=%s output_tokens=%s "
            "reasoning_tokens=%s total_tokens=%s",
            call_name, model_tier, model,
            input_tokens, output_tokens, reasoning_tokens, total_tokens,
        )
        # Persist to ai_usage_events when a record_ai_usage(...) block is
        # active (deferred import keeps this module free of an app.core dep
        # at import time).
        try:
            from app.core.usage import record_call

            record_call(
                call_name=call_name, model=model, model_tier=model_tier,
                input_tokens=input_tokens, output_tokens=output_tokens,
                reasoning_tokens=reasoning_tokens, total_tokens=total_tokens,
            )
        except Exception:
            logger.debug("record_call failed", exc_info=True)


    @staticmethod
    def _refusal_text(response) -> str:
        """The refusal string the Responses API tucks inside output content,
        or "" when the response isn't a refusal."""
        for item in getattr(response, "output", None) or []:
            for part in getattr(item, "content", None) or []:
                refusal = getattr(part, "refusal", None)
                if isinstance(refusal, str) and refusal:
                    return refusal
        return ""

    def _raise_for_empty(self, response, call_name: str, model: str, budget: int) -> None:
        """Turn a missing result into a typed, diagnosable error.

        Only ever called when the result is absent — a response flagged
        incomplete that nevertheless carries usable output is left alone, so a
        status quirk never discards work already paid for.
        """
        details = getattr(response, "incomplete_details", None)
        reason = getattr(details, "reason", None) if details else None
        context = f"call={call_name} model={model} max_output_tokens={budget}"
        if reason == "max_output_tokens":
            raise AITruncatedError(
                f"model ran out of output budget mid-response ({context}); "
                "the structured output never closed"
            )
        refusal = self._refusal_text(response)
        if refusal:
            raise AIRefusalError(f"model refused ({context}): {refusal}")
        raise AIEmptyResponseError(
            f"model returned no usable output ({context}, "
            f"status={getattr(response, 'status', None)!r}, reason={reason!r})"
        )

    async def complete(
        self,
        system: str,
        user: str,
        model_tier: str = "fast",
        max_output_tokens: int | None = None,
        call_name: str = "unknown",
    ) -> str:
        model = self._model_for(model_tier)
        response = await self._client.responses.create(
            model=model,
            instructions=system,
            input=user,
            max_output_tokens=max_output_tokens or self._max_output_tokens,
        )
        self._log_usage(call_name, model_tier, model, getattr(response, "usage", None))
        budget = max_output_tokens or self._max_output_tokens
        if not response.output_text:
            self._raise_for_empty(response, call_name, model, budget)
        return response.output_text

    async def complete_structured(
        self,
        system: str,
        user: str,
        schema: type[BaseModel],
        model_tier: str = "fast",
        max_output_tokens: int | None = None,
        call_name: str = "unknown",
    ) -> BaseModel:
        # gpt-5.6-luna rejects the `temperature` param on the Responses API
        # (400 Unsupported parameter) — neither budget nor premium GPT-5.6
        # tiers expose a sampling knob to set here.
        model = self._model_for(model_tier)
        response = await self._client.responses.parse(
            model=model,
            instructions=system,
            input=user,
            text_format=schema,
            max_output_tokens=max_output_tokens or self._max_output_tokens,
        )
        self._log_usage(call_name, model_tier, model, getattr(response, "usage", None))
        budget = max_output_tokens or self._max_output_tokens
        if response.output_parsed is None:
            self._raise_for_empty(response, call_name, model, budget)
        return response.output_parsed
