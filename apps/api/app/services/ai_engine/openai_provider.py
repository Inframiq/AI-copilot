import json
from openai import AsyncOpenAI
from pydantic import BaseModel
from app.services.ai_engine.base import AIProvider


class OpenAIProvider(AIProvider):
    def __init__(self, fast_model: str, pro_model: str, api_key: str):
        self._client = AsyncOpenAI(api_key=api_key)
        self._fast = fast_model
        self._pro = pro_model

    def _model(self, tier: str) -> str:
        return self._pro if tier == "pro" else self._fast

    async def complete(self, system: str, user: str, model_tier: str = "fast") -> str:
        response = await self._client.chat.completions.create(
            model=self._model(model_tier),
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        )
        return response.choices[0].message.content

    async def complete_structured(
        self, system: str, user: str, schema: type[BaseModel], model_tier: str = "fast"
    ) -> BaseModel:
        response = await self._client.chat.completions.create(
            model=self._model(model_tier),
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            response_format={"type": "json_object"},
        )
        return schema.model_validate(json.loads(response.choices[0].message.content))
