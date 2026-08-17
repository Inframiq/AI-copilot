import re
import json
import google.generativeai as genai
from pydantic import BaseModel
from app.services.ai_engine.base import AIProvider


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

    async def complete(self, system: str, user: str, model_tier: str = "fast") -> str:
        prompt = f"{system}\n\n{user}"
        response = await self._model(model_tier).generate_content_async(prompt)
        # response.usage_metadata (prompt/candidates/total token counts) is
        # available here but not captured — no token-usage telemetry exists
        # anywhere in this codebase today. See docs/ai-pipeline.md. (Also
        # note: this provider is currently unused — AI_PROVIDER=openai in
        # .env — so this path isn't exercised in production right now.)
        return response.text

    async def complete_structured(
        self, system: str, user: str, schema: type[BaseModel], model_tier: str = "fast"
    ) -> BaseModel:
        prompt = (
            f"{system}\n\nRespond ONLY with valid JSON matching this schema: "
            f"{schema.model_json_schema()}\n\n{user}"
        )
        response = await self._model(model_tier).generate_content_async(prompt)
        text = _strip_fence(response.text)
        # Same unused response.usage_metadata as above.
        return schema.model_validate(json.loads(text))
