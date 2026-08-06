import json
import google.generativeai as genai
from pydantic import BaseModel
from app.services.ai_engine.base import AIProvider


class GeminiProvider(AIProvider):
    def __init__(self, fast_model: str, pro_model: str, api_key: str):
        genai.configure(api_key=api_key)
        self._fast = genai.GenerativeModel(fast_model)
        self._pro = genai.GenerativeModel(pro_model)

    def _model(self, tier: str):
        return self._pro if tier == "pro" else self._fast

    async def complete(self, system: str, user: str, model_tier: str = "fast") -> str:
        prompt = f"{system}\n\n{user}"
        response = await self._model(model_tier).generate_content_async(prompt)
        return response.text

    async def complete_structured(
        self, system: str, user: str, schema: type[BaseModel], model_tier: str = "fast"
    ) -> BaseModel:
        prompt = (
            f"{system}\n\nRespond ONLY with valid JSON matching this schema: "
            f"{schema.model_json_schema()}\n\n{user}"
        )
        response = await self._model(model_tier).generate_content_async(prompt)
        text = response.text.strip().lstrip("```json").rstrip("```").strip()
        return schema.model_validate(json.loads(text))
