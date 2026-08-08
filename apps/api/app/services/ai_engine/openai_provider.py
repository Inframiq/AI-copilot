from openai import AsyncOpenAI
from pydantic import BaseModel
from app.services.ai_engine.base import AIProvider

# Budget tier only. gpt-5.6-luna is OpenAI's cheapest/fastest GPT-5.6
# model ($1/$6 per 1M tokens vs. Sol's $5/$30) — hardcoded rather than
# read from AI_MODEL_FAST/AI_MODEL_PRO so those env vars can't silently
# upgrade this provider onto a pricier tier. It's only reachable via the
# Responses API, not /chat/completions.
_MODEL = "gpt-5.6-luna"


class OpenAIProvider(AIProvider):
    def __init__(self, api_key: str, max_output_tokens: int = 800):
        self._client = AsyncOpenAI(api_key=api_key)
        self._max_output_tokens = max_output_tokens

    async def complete(self, system: str, user: str, model_tier: str = "fast") -> str:
        response = await self._client.responses.create(
            model=_MODEL,
            instructions=system,
            input=user,
            max_output_tokens=self._max_output_tokens,
        )
        return response.output_text

    async def complete_structured(
        self, system: str, user: str, schema: type[BaseModel], model_tier: str = "fast"
    ) -> BaseModel:
        response = await self._client.responses.parse(
            model=_MODEL,
            instructions=system,
            input=user,
            text_format=schema,
            max_output_tokens=self._max_output_tokens,
        )
        return response.output_parsed
