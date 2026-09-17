"""GeminiProvider's handling of truncated / refused responses.

Gemini is the configured default (settings.ai_provider). A response cut off at
max_output_tokens arrives as unparseable half-JSON, which surfaced as a bare
JSONDecodeError — indistinguishable from a model that just emitted bad JSON,
and invisible to _agent3_write's split-and-retry, which keys off
AITruncatedError. Both providers must report the same condition the same way.
"""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import BaseModel

from app.services.ai_engine.base import (
    AIEmptyResponseError, AIRefusalError, AITruncatedError,
)


class _Schema(BaseModel):
    text: str


def _provider_returning(response) -> "object":
    model = MagicMock()
    model.generate_content_async = AsyncMock(return_value=response)
    with patch("app.services.ai_engine.gemini_provider.genai") as genai:
        genai.GenerativeModel.return_value = model
        from app.services.ai_engine.gemini_provider import GeminiProvider
        return GeminiProvider(fast_model="f", pro_model="p", api_key="k")


def _response(*, text=None, finish_reason="STOP"):
    candidate = MagicMock(finish_reason=finish_reason)
    resp = MagicMock(candidates=[candidate], usage_metadata=None)
    if text is None:
        type(resp).text = property(lambda self: (_ for _ in ()).throw(ValueError("no text")))
    else:
        resp.text = text
    return resp


@pytest.mark.asyncio
async def test_a_response_cut_off_at_the_token_cap_raises_truncated():
    provider = _provider_returning(_response(text='{"text": "half', finish_reason="MAX_TOKENS"))

    with pytest.raises(AITruncatedError):
        await provider.complete_structured("s", "u", _Schema, call_name="agent3_write")


@pytest.mark.asyncio
async def test_the_truncation_error_names_the_call():
    provider = _provider_returning(_response(text='{"text": "half', finish_reason="MAX_TOKENS"))

    with pytest.raises(AITruncatedError) as exc:
        await provider.complete_structured("s", "u", _Schema, call_name="agent3_write")
    assert "agent3_write" in str(exc.value)


@pytest.mark.asyncio
async def test_a_safety_block_raises_refusal():
    provider = _provider_returning(_response(text=None, finish_reason="SAFETY"))

    with pytest.raises(AIRefusalError):
        await provider.complete_structured("s", "u", _Schema)


@pytest.mark.asyncio
async def test_a_response_with_no_text_at_all_raises_empty():
    provider = _provider_returning(_response(text=None, finish_reason="STOP"))

    with pytest.raises(AIEmptyResponseError):
        await provider.complete_structured("s", "u", _Schema)


@pytest.mark.asyncio
async def test_a_complete_response_still_parses_normally():
    provider = _provider_returning(_response(text='{"text": "ok"}'))

    assert (await provider.complete_structured("s", "u", _Schema)).text == "ok"


@pytest.mark.asyncio
async def test_a_fenced_response_still_parses_normally():
    provider = _provider_returning(_response(text='```json\n{"text": "ok"}\n```'))

    assert (await provider.complete_structured("s", "u", _Schema)).text == "ok"


@pytest.mark.asyncio
async def test_malformed_json_that_was_not_truncated_is_not_reported_as_truncated():
    """A model that simply emitted bad JSON is a different bug — splitting the
    request would not help and would just double the spend."""
    provider = _provider_returning(_response(text="not json at all", finish_reason="STOP"))

    with pytest.raises(Exception) as exc:
        await provider.complete_structured("s", "u", _Schema)
    assert not isinstance(exc.value, AITruncatedError)


@pytest.mark.asyncio
async def test_complete_raises_truncated_too():
    provider = _provider_returning(_response(text="half a sentence", finish_reason="MAX_TOKENS"))

    with pytest.raises(AITruncatedError):
        await provider.complete("s", "u")
