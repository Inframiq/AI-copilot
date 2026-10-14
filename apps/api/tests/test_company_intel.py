"""Agent 0 researches a company on the live web, and keeps the result per
company so a company is looked up once a month rather than on every run."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import BaseModel

from app.core.ai_budget import WEB_SEARCH_MODEL, price_of
from app.services import tailoring
from app.services.ai_engine.base import AIProvider
from app.services.ai_engine.openai_provider import OpenAIProvider
from app.services.tailoring import CompanyIntel, _CompanyIntelWire


def _wire(**kw):
    base = dict(company_name="Stripe", culture_keywords=["Users first"], tech_stack_preferences=["Ruby"],
                ats_filter_phrases=[], terminology_preferences=["Stripes"], known_not_found=False)
    base.update(kw)
    return _CompanyIntelWire(**base)


# ── the provider: a required web search, its sources, and its cost ──────────

def _search_call(*urls):
    return SimpleNamespace(type="web_search_call",
                           action=SimpleNamespace(sources=[SimpleNamespace(url=u) for u in urls]))


@pytest.mark.asyncio
async def test_web_research_must_search_and_returns_the_pages_it_read():
    client = MagicMock()
    client.responses.parse = AsyncMock(return_value=SimpleNamespace(
        output_parsed=_wire(),
        output=[
            _search_call("https://stripe.com/jobs?utm_source=openai", "https://stripe.com/blog"),
            _search_call("https://stripe.com/jobs?utm_source=openai&gh_jid=1"),
        ],
        usage=None,
    ))
    with patch("app.services.ai_engine.openai_provider.AsyncOpenAI", return_value=client):
        provider = OpenAIProvider(api_key="k", fast_model="gpt-5.6-luna", premium_model="gpt-5.6-sol",
                                  research_model="gpt-5.6-terra")
    with patch("app.services.ai_engine.openai_provider.ensure_ai_budget", new=AsyncMock()), patch(
        "app.services.ai_engine.openai_provider.note_spend"
    ) as spend:
        result, sources = await provider.complete_structured_with_web("sys", "Company: Stripe", _CompanyIntelWire)

    kwargs = client.responses.parse.call_args.kwargs
    assert kwargs["model"] == "gpt-5.6-terra"
    assert kwargs["tools"] == [{"type": "web_search"}]
    assert kwargs["tool_choice"] == "required"
    assert "web_search_call.action.sources" in kwargs["include"]
    assert result.company_name == "Stripe"
    # Tracking parameters dropped, duplicates removed, order kept.
    assert sources == ["https://stripe.com/jobs", "https://stripe.com/blog", "https://stripe.com/jobs?gh_jid=1"]
    # Two searches billed as two web-search calls.
    spend.assert_called_with(WEB_SEARCH_MODEL, 2, 0)


def test_web_search_calls_and_the_5_6_models_are_priced():
    assert price_of(WEB_SEARCH_MODEL, 1, 0) == pytest.approx(0.01)
    assert price_of("gpt-5.6-luna", 1_000_000, 0) == pytest.approx(0.20)
    assert price_of("gpt-5.6-terra", 1_000_000, 1_000_000) == pytest.approx(14.00)
    assert price_of("gpt-5.6-sol", 1_000_000, 0) == pytest.approx(4.00)


@pytest.mark.asyncio
async def test_a_provider_without_web_search_answers_without_it():
    class _Plain(AIProvider):
        async def complete(self, *a, **k):
            return ""

        async def complete_structured(self, system, user, schema, **kwargs):
            return schema(text="ok")

    class _S(BaseModel):
        text: str

    result, sources = await _Plain().complete_structured_with_web("s", "u", _S)
    assert result.text == "ok" and sources == []


# ── the per-company store ────────────────────────────────────────────────────

def _provider_returning(wire, sources):
    provider = MagicMock()
    provider.complete_structured_with_web = AsyncMock(return_value=(wire, sources))
    return provider


@pytest.mark.asyncio
async def test_a_stored_company_is_not_researched_again():
    stored = CompanyIntel(**_wire().model_dump(), sources=["https://stripe.com/jobs"])
    provider = _provider_returning(_wire(), [])
    with patch.object(tailoring, "_read_intel_cache", new=AsyncMock(return_value=stored)), patch.object(
        tailoring, "_write_intel_cache", new=AsyncMock()
    ) as write:
        intel = await tailoring.get_company_intel("  STRIPE ", provider)
    assert intel == stored
    provider.complete_structured_with_web.assert_not_called()
    write.assert_not_called()


@pytest.mark.asyncio
async def test_a_new_company_is_researched_live_and_stored_with_its_sources():
    provider = _provider_returning(_wire(), ["https://stripe.com/jobs"])
    with patch.object(tailoring, "_read_intel_cache", new=AsyncMock(return_value=None)), patch.object(
        tailoring, "_write_intel_cache", new=AsyncMock()
    ) as write:
        intel = await tailoring.get_company_intel("Stripe", provider)
    assert intel.sources == ["https://stripe.com/jobs"]
    assert intel.culture_keywords == ["Users first"]
    write.assert_awaited_once()
    assert write.call_args.args[0] == "stripe"


@pytest.mark.asyncio
async def test_a_broken_store_never_blocks_the_research():
    provider = _provider_returning(_wire(), [])
    with patch.object(tailoring, "_read_intel_cache", new=AsyncMock(side_effect=RuntimeError("db down"))), patch.object(
        tailoring, "_write_intel_cache", new=AsyncMock(side_effect=RuntimeError("db down"))
    ):
        intel = await tailoring.get_company_intel("Stripe", provider)
    assert intel.company_name == "Stripe"


class _FakeSession:
    def __init__(self, row):
        self._row = row

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, model, key):
        return self._row


@pytest.mark.asyncio
@pytest.mark.parametrize("found, age_days, fresh", [
    (True, 29, True), (True, 31, False),   # found: kept a month
    (False, 0.5, True), (False, 2, False),  # not found: retried after a day
])
async def test_how_long_stored_research_counts_as_fresh(found, age_days, fresh):
    intel = CompanyIntel(**_wire(known_not_found=not found).model_dump())
    row = SimpleNamespace(intel=intel.model_dump(),
                          fetched_at=datetime.now(timezone.utc) - timedelta(days=age_days))
    with patch("app.db.session.AsyncSessionLocal", new=lambda: _FakeSession(row)):
        result = await tailoring._read_intel_cache("stripe")
    assert (result is not None) is fresh


def test_company_names_share_a_key_regardless_of_case_and_spacing():
    assert tailoring.company_key("  Stripe   Inc ") == tailoring.company_key("stripe inc")


# ── the company path through analysis uses the store ─────────────────────────

@pytest.mark.asyncio
async def test_analysis_with_a_company_name_goes_through_the_store():
    intel = CompanyIntel(**_wire().model_dump())
    with patch.object(tailoring, "get_company_intel", new=AsyncMock(return_value=intel)) as get, patch.object(
        tailoring, "_agent1_parse_jd", new=AsyncMock(side_effect=RuntimeError("stop after Agent 0"))
    ):
        with pytest.raises(RuntimeError, match="stop after Agent 0"):
            await tailoring.analyze_jd_match({"skills": []}, "JD text", MagicMock(), " Stripe ")
    get.assert_awaited_once()
    assert get.call_args.args[0] == "Stripe"
