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


# ── Truncated / refused / empty structured responses ─────────────────────────
# The Responses API returns output_parsed=None when the model ran out of
# output budget mid-JSON, refused, or produced nothing. The provider used to
# return that None straight to the caller, which then died on an opaque
# AttributeError ('NoneType' object has no attribute 'mapping_plan') — the
# whole tailoring run failed and the credit was refunded with nothing in the
# logs saying why.

from app.services.ai_engine.base import (
    AIEmptyResponseError, AIRefusalError, AIResponseError, AITruncatedError,
)


def _parse_returns(response) -> MagicMock:
    mc = MagicMock()
    mc.responses.parse = AsyncMock(return_value=response)
    return mc


@pytest.mark.asyncio
async def test_a_response_truncated_by_the_token_cap_raises_truncated():
    resp = MagicMock(output_parsed=None, status="incomplete")
    resp.incomplete_details.reason = "max_output_tokens"
    provider = _make_provider(_parse_returns(resp))

    with pytest.raises(AITruncatedError):
        await provider.complete_structured("s", "u", _Schema, max_output_tokens=16384)


@pytest.mark.asyncio
async def test_the_truncation_error_names_the_call_and_the_budget_it_hit():
    """The message is the only diagnostic a failed background run leaves."""
    resp = MagicMock(output_parsed=None, status="incomplete")
    resp.incomplete_details.reason = "max_output_tokens"
    provider = _make_provider(_parse_returns(resp))

    with pytest.raises(AITruncatedError) as exc:
        await provider.complete_structured(
            "s", "u", _Schema, max_output_tokens=16384, call_name="agent3_write",
        )
    assert "agent3_write" in str(exc.value)
    assert "16384" in str(exc.value)


@pytest.mark.asyncio
async def test_a_model_refusal_raises_refusal():
    resp = MagicMock(output_parsed=None, status="completed")
    resp.incomplete_details = None
    resp.output = [MagicMock(content=[MagicMock(refusal="I can't help with that")])]
    provider = _make_provider(_parse_returns(resp))

    with pytest.raises(AIRefusalError):
        await provider.complete_structured("s", "u", _Schema)


@pytest.mark.asyncio
async def test_an_empty_parse_with_no_stated_reason_raises_empty():
    resp = MagicMock(output_parsed=None, status="completed")
    resp.incomplete_details = None
    resp.output = []
    provider = _make_provider(_parse_returns(resp))

    with pytest.raises(AIEmptyResponseError):
        await provider.complete_structured("s", "u", _Schema)


@pytest.mark.asyncio
async def test_every_empty_response_error_shares_one_catchable_base():
    """Callers that only want "the model gave us nothing usable" should not
    have to enumerate the subclasses."""
    for cls in (AITruncatedError, AIRefusalError, AIEmptyResponseError):
        assert issubclass(cls, AIResponseError)


@pytest.mark.asyncio
async def test_a_successful_parse_is_returned_unchanged():
    resp = MagicMock(output_parsed=_Schema(text="ok"), status="completed")
    provider = _make_provider(_parse_returns(resp))

    assert (await provider.complete_structured("s", "u", _Schema)).text == "ok"


@pytest.mark.asyncio
async def test_an_incomplete_status_still_returns_a_parse_that_did_come_back():
    """Only a MISSING parse is an error — a status quirk alongside usable
    output must not throw away work already paid for."""
    resp = MagicMock(output_parsed=_Schema(text="ok"), status="incomplete")
    resp.incomplete_details.reason = "max_output_tokens"
    provider = _make_provider(_parse_returns(resp))

    assert (await provider.complete_structured("s", "u", _Schema)).text == "ok"


@pytest.mark.asyncio
async def test_complete_raises_empty_rather_than_returning_none_text():
    mc = MagicMock()
    mc.responses.create = AsyncMock(return_value=MagicMock(output_text=None, status="completed"))
    provider = _make_provider(mc)

    with pytest.raises(AIResponseError):
        await provider.complete("s", "u")


@pytest.mark.asyncio
async def test_neither_call_asks_openai_to_keep_the_response():
    # The Responses API stores prompts and outputs unless told not to, and
    # these carry resume and job-description text. Nothing reads one back.
    mock_client = MagicMock()
    mock_client.responses.create = AsyncMock(return_value=MagicMock(output_text="ok"))
    mock_client.responses.parse = AsyncMock(return_value=MagicMock(output_parsed=_Schema(text="ok")))
    provider = _make_provider(mock_client)

    await provider.complete("system", "user")
    await provider.complete_structured("system", "user", _Schema)

    assert mock_client.responses.create.call_args.kwargs["store"] is False
    assert mock_client.responses.parse.call_args.kwargs["store"] is False
