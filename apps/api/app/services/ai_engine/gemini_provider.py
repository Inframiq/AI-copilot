import re
import json
import logging
import google.generativeai as genai
from pydantic import BaseModel
from app.services.ai_engine.base import AIProvider

logger = logging.getLogger("app")


def _strip_fence(raw: str) -> str:
    s = raw.strip()
    s = re.sub(r"^```(?:json)?\s*", "", s)
    s = re.sub(r"\s*```$", "", s)
    return s.strip()


class GeminiProvider(AIProvider):
    def __init__(self, fast_model: str, pro_model: str, api_key: str):
        genai.configure(api_key=api_key)
        # Raise max_output_tokens high enough for a full resume rewrite
        # (Agent 3 must emit one JSON entry per bullet — easily 8–16k tokens).
        gen_cfg = genai.GenerationConfig(max_output_tokens=16384)
        self._fast = genai.GenerativeModel(fast_model, generation_config=gen_cfg)
        self._pro = genai.GenerativeModel(pro_model, generation_config=gen_cfg)

    def _model(self, tier: str):
        # No distinct premium model here — "premium" falls back to "pro"
        # (the best available), not "fast" (a silent downgrade for the one
        # call that's supposed to be getting an upgrade). See base.py.
        if tier in ("pro", "premium"):
            return self._pro
        return self._fast

    def _log_usage(self, call_name: str, model_tier: str, usage) -> None:
        if usage is None:
            return
        logger.info(
            "ai_usage call=%s tier=%s prompt_tokens=%s output_tokens=%s total_tokens=%s",
            call_name, model_tier,
            getattr(usage, "prompt_token_count", None),
            getattr(usage, "candidates_token_count", None),
            getattr(usage, "total_token_count", None),
        )

    async def complete(
        self,
        system: str,
        user: str,
        model_tier: str = "fast",
        max_output_tokens: int | None = None,
        call_name: str = "unknown",
    ) -> str:
        prompt = f"{system}\n\n{user}"
        gen_cfg = genai.GenerationConfig(max_output_tokens=max_output_tokens) if max_output_tokens else None
        response = await self._model(model_tier).generate_content_async(prompt, generation_config=gen_cfg)
        self._log_usage(call_name, model_tier, getattr(response, "usage_metadata", None))
        return response.text

    async def complete_structured(
        self,
        system: str,
        user: str,
        schema: type[BaseModel],
        model_tier: str = "fast",
        max_output_tokens: int | None = None,
        call_name: str = "unknown",
    ) -> BaseModel:
        prompt = (
            f"{system}\n\nRespond ONLY with valid JSON matching this schema: "
            f"{schema.model_json_schema()}\n\n{user}"
        )
        gen_cfg = genai.GenerationConfig(max_output_tokens=max_output_tokens) if max_output_tokens else None
        response = await self._model(model_tier).generate_content_async(prompt, generation_config=gen_cfg)
        text = _strip_fence(response.text)
        self._log_usage(call_name, model_tier, getattr(response, "usage_metadata", None))
        return schema.model_validate(json.loads(text))
