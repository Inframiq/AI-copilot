"""Tests for OpenAIProvider's tier→model resolution.

Only Agent 2 (JD+resume semantic mapping, tailoring.py) requests
model_tier="premium" — every other caller requests "fast" or "pro" and
must keep landing on the budget model. See docs/ai-pipeline.md and the
comment on OpenAIProvider._model_for for why.
"""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import BaseModel

from app.services.ai_engine.openai_provider import OpenAIProvider


class _Schema(BaseModel):
    text: str


def _make_provider(mock_client: MagicMock) -> OpenAIProvider:
    with patch("app.services.ai_engine.openai_provider.AsyncOpenAI", return_value=mock_client):
        return OpenAIProvider(
            api_key="fake",
            fast_model="gpt-5.6-luna",
            premium_model="gpt-5.6-sol",
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("model_tier", ["fast", "pro"])
async def test_complete_uses_fast_model_for_fast_and_pro_tiers(model_tier):
    mock_client = MagicMock()
    mock_client.responses.create = AsyncMock(return_value=MagicMock(output_text="ok"))
    provider = _make_provider(mock_client)

    await provider.complete("system", "user", model_tier=model_tier)

    assert mock_client.responses.create.call_args.kwargs["model"] == "gpt-5.6-luna"


@pytest.mark.asyncio
async def test_complete_uses_premium_model_only_for_premium_tier():
    mock_client = MagicMock()
    mock_client.responses.create = AsyncMock(return_value=MagicMock(output_text="ok"))
    provider = _make_provider(mock_client)

    await provider.complete("system", "user", model_tier="premium")

    assert mock_client.responses.create.call_args.kwargs["model"] == "gpt-5.6-sol"


@pytest.mark.asyncio
@pytest.mark.parametrize("model_tier", ["fast", "pro"])
async def test_complete_structured_uses_fast_model_for_fast_and_pro_tiers(model_tier):
    mock_client = MagicMock()
    mock_client.responses.parse = AsyncMock(return_value=MagicMock(output_parsed=_Schema(text="ok")))
    provider = _make_provider(mock_client)

    await provider.complete_structured("system", "user", _Schema, model_tier=model_tier)

    assert mock_client.responses.parse.call_args.kwargs["model"] == "gpt-5.6-luna"


@pytest.mark.asyncio
async def test_complete_structured_uses_premium_model_only_for_premium_tier():
    mock_client = MagicMock()
    mock_client.responses.parse = AsyncMock(return_value=MagicMock(output_parsed=_Schema(text="ok")))
    provider = _make_provider(mock_client)

    await provider.complete_structured("system", "user", _Schema, model_tier="premium")

    assert mock_client.responses.parse.call_args.kwargs["model"] == "gpt-5.6-sol"
