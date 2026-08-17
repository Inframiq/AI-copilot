import logging
from openai import AsyncOpenAI
from pydantic import BaseModel
from app.services.ai_engine.base import AIProvider

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
        logger.info(
            "ai_usage call=%s tier=%s model=%s input_tokens=%s output_tokens=%s "
            "reasoning_tokens=%s total_tokens=%s",
            call_name, model_tier, model,
            getattr(usage, "input_tokens", None),
            getattr(usage, "output_tokens", None),
            reasoning_tokens,
            getattr(usage, "total_tokens", None),
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
        return response.output_parsed
