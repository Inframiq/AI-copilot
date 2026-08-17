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


@pytest.mark.asyncio
async def test_complete_falls_back_to_provider_default_max_output_tokens():
    mock_client = MagicMock()
    mock_client.responses.create = AsyncMock(return_value=MagicMock(output_text="ok"))
    with patch("app.services.ai_engine.openai_provider.AsyncOpenAI", return_value=mock_client):
        provider = OpenAIProvider(
            api_key="fake", fast_model="gpt-5.6-luna", premium_model="gpt-5.6-sol",
            max_output_tokens=16384,
        )

    await provider.complete("system", "user")

    assert mock_client.responses.create.call_args.kwargs["max_output_tokens"] == 16384


@pytest.mark.asyncio
async def test_complete_uses_per_call_max_output_tokens_override():
    # A caller with a small, fixed-shape output (e.g. rewrite-bullet) can ask
    # for a tighter ceiling than the provider default, so a reasoning model
    # doesn't get unneeded headroom to burn extra billed reasoning tokens.
    mock_client = MagicMock()
    mock_client.responses.create = AsyncMock(return_value=MagicMock(output_text="ok"))
    with patch("app.services.ai_engine.openai_provider.AsyncOpenAI", return_value=mock_client):
        provider = OpenAIProvider(
            api_key="fake", fast_model="gpt-5.6-luna", premium_model="gpt-5.6-sol",
            max_output_tokens=16384,
        )

    await provider.complete("system", "user", max_output_tokens=1200)

    assert mock_client.responses.create.call_args.kwargs["max_output_tokens"] == 1200


@pytest.mark.asyncio
async def test_complete_structured_uses_per_call_max_output_tokens_override():
    mock_client = MagicMock()
    mock_client.responses.parse = AsyncMock(return_value=MagicMock(output_parsed=_Schema(text="ok")))
    provider = _make_provider(mock_client)

    await provider.complete_structured("system", "user", _Schema, max_output_tokens=3000)

    assert mock_client.responses.parse.call_args.kwargs["max_output_tokens"] == 3000


@pytest.mark.asyncio
async def test_complete_logs_token_usage_without_raising_when_usage_present(caplog):
    mock_client = MagicMock()
    usage = MagicMock(input_tokens=100, output_tokens=50, total_tokens=150)
    usage.output_tokens_details.reasoning_tokens = 20
    mock_client.responses.create = AsyncMock(return_value=MagicMock(output_text="ok", usage=usage))
    provider = _make_provider(mock_client)

    with caplog.at_level("INFO"):
        result = await provider.complete("system", "user", call_name="test_call")

    assert result == "ok"
    assert any("ai_usage" in r.message and "test_call" in r.message for r in caplog.records)


@pytest.mark.asyncio
async def test_complete_does_not_raise_when_usage_is_missing():
    mock_client = MagicMock()
    response = MagicMock(spec=["output_text"], output_text="ok")
    mock_client.responses.create = AsyncMock(return_value=response)
    provider = _make_provider(mock_client)

    result = await provider.complete("system", "user")

    assert result == "ok"
