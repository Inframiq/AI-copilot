"""app.core.ai_budget — what one request, and one day, can cost in OpenAI fees."""
import time
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import BaseModel

from app.core import ai_budget
from app.core.ai_budget import (
    MAX_JD_CHARS_FOR_MODEL, MAX_MODEL_INPUT_CHARS, check_input_size, ensure_ai_budget,
    jd_for_model, price_of, spent_today,
)
from app.core.config import settings
from app.services.ai_engine.base import AIInputTooLargeError, AIPausedError
from app.services.ai_engine.openai_provider import OpenAIProvider


# ── Job text is trimmed before it reaches a prompt ──────────────────────────

def test_a_normal_jd_reaches_the_model_untouched():
    jd = "Senior Engineer\n\nWe need Python and AWS.\n" * 50
    assert jd_for_model(jd) == jd.strip()
    assert jd_for_model(None) == ""


def test_a_huge_jd_is_cut_at_a_paragraph_break():
    para = ("Requirement line about the role and its duties. " * 8).strip()
    jd = "\n\n".join([para] * 400)  # ~160k characters
    out = jd_for_model(jd)
    assert len(out) <= MAX_JD_CHARS_FOR_MODEL
    assert len(out) >= MAX_JD_CHARS_FOR_MODEL * 0.8
    assert out.endswith(para)  # whole paragraphs only — never half a sentence


def test_a_jd_with_no_breaks_still_gets_a_hard_cut():
    out = jd_for_model("x" * 50_000)
    assert len(out) == MAX_JD_CHARS_FOR_MODEL


@pytest.mark.asyncio
async def test_the_jd_parser_sends_at_most_the_trimmed_text():
    from app.services import tailoring

    provider = MagicMock()
    provider.complete_structured = AsyncMock(side_effect=RuntimeError("stop here"))
    with pytest.raises(RuntimeError):
        await tailoring._agent1_parse_jd("Needs Python.\n\n" * 10_000, provider)
    sent = provider.complete_structured.call_args.args[1]
    assert len(sent) <= MAX_JD_CHARS_FOR_MODEL


# ── One call can't be oversized ─────────────────────────────────────────────

def test_check_input_size():
    check_input_size("s" * 1000, "u" * (MAX_MODEL_INPUT_CHARS - 1000))  # at the limit: fine
    with pytest.raises(AIInputTooLargeError):
        check_input_size("s", "u" * MAX_MODEL_INPUT_CHARS)


class _Schema(BaseModel):
    text: str


def _provider(client):
    with patch("app.services.ai_engine.openai_provider.AsyncOpenAI", return_value=client):
        return OpenAIProvider(api_key="fake", fast_model="gpt-4o-mini", premium_model="gpt-4.1-mini")


@pytest.mark.asyncio
async def test_an_oversized_call_is_refused_before_anything_is_sent():
    client = MagicMock()
    client.responses.create = AsyncMock()
    client.responses.parse = AsyncMock()
    provider = _provider(client)
    huge = "x" * (MAX_MODEL_INPUT_CHARS + 1)
    with pytest.raises(AIInputTooLargeError):
        await provider.complete("system", huge)
    with pytest.raises(AIInputTooLargeError):
        await provider.complete_structured("system", huge, _Schema)
    client.responses.create.assert_not_awaited()
    client.responses.parse.assert_not_awaited()


# ── Pricing ─────────────────────────────────────────────────────────────────

def test_price_of_known_models_including_versioned_names():
    assert price_of("gpt-4o-mini", 1_000_000, 1_000_000) == pytest.approx(0.75)
    assert price_of("gpt-4.1-mini-2025-04-14", 1_000_000, 0) == pytest.approx(0.40)
    assert price_of("gpt-4.1-2025-04-14", 1_000_000, 0) == pytest.approx(2.00)  # not mini's price


def test_an_unknown_model_counts_as_expensive():
    assert price_of("some-new-model", 1_000_000, 1_000_000) >= price_of("gpt-4.1", 1_000_000, 1_000_000)


# ── The daily ceiling ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_the_ceiling_pauses_ai_once_todays_spend_reaches_it(monkeypatch):
    monkeypatch.setattr(settings, "ai_daily_spend_limit_usd", 5.0)
    monkeypatch.setattr(ai_budget, "spent_today", AsyncMock(return_value=4.99))
    await ensure_ai_budget()  # under: fine
    monkeypatch.setattr(ai_budget, "spent_today", AsyncMock(return_value=5.0))
    with pytest.raises(AIPausedError):
        await ensure_ai_budget()


@pytest.mark.asyncio
async def test_a_limit_of_zero_turns_the_ceiling_off(monkeypatch):
    monkeypatch.setattr(settings, "ai_daily_spend_limit_usd", 0.0)
    spent = AsyncMock(return_value=1_000_000.0)
    monkeypatch.setattr(ai_budget, "spent_today", spent)
    await ensure_ai_budget()
    spent.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_paused_day_stops_the_call_before_it_is_sent(monkeypatch):
    monkeypatch.setattr(settings, "ai_daily_spend_limit_usd", 1.0)
    monkeypatch.setattr(ai_budget, "spent_today", AsyncMock(return_value=2.0))
    client = MagicMock()
    client.responses.create = AsyncMock()
    with pytest.raises(AIPausedError):
        await _provider(client).complete("system", "user")
    client.responses.create.assert_not_awaited()


@pytest.mark.asyncio
async def test_each_finished_call_is_added_to_todays_total_straight_away(monkeypatch):
    monkeypatch.setitem(ai_budget._cache, "day", datetime.now(timezone.utc).date())
    monkeypatch.setitem(ai_budget._cache, "read_at", time.monotonic())
    monkeypatch.setitem(ai_budget._cache, "spent", 1.0)
    client = MagicMock()
    usage = MagicMock(input_tokens=1_000_000, output_tokens=0, total_tokens=1_000_000)
    client.responses.create = AsyncMock(return_value=MagicMock(output_text="ok", usage=usage))
    await _provider(client).complete("system", "user", model_tier="pro")  # gpt-4o-mini
    assert await spent_today() == pytest.approx(1.15)


@pytest.fixture
async def usage_db(pg_uri, monkeypatch):
    """A real ai_usage_events table, wired in as the budget's database."""
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from app.db.models import AiUsageEvent

    engine = create_async_engine(pg_uri)
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: AiUsageEvent.__table__.create(c, checkfirst=True))
        await conn.execute(text("TRUNCATE ai_usage_events"))
    Session = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(ai_budget, "_session_factory", lambda: Session())
    yield Session
    await engine.dispose()


async def _log(Session, model, inp, out, when):
    from app.db.models import AiUsageEvent
    async with Session() as s:
        s.add(AiUsageEvent(user_id=uuid.uuid4(), action="tailor", call_name="x", model=model,
                           model_tier="", input_tokens=inp, output_tokens=out, created_at=when))
        await s.commit()


@pytest.mark.asyncio
async def test_todays_spend_is_priced_from_the_usage_log(usage_db):
    now = datetime.now(timezone.utc)
    await _log(usage_db, "gpt-4o-mini", 1_000_000, 1_000_000, now)          # $0.75
    await _log(usage_db, "gpt-4.1-mini-2025-04-14", 1_000_000, 0, now)      # $0.40
    await _log(usage_db, "gpt-4.1-mini", 9_000_000, 9_000_000, now - timedelta(days=1))  # yesterday
    assert await spent_today() == pytest.approx(1.15)


@pytest.mark.asyncio
async def test_the_ceiling_trips_on_real_usage(usage_db, monkeypatch):
    monkeypatch.setattr(settings, "ai_daily_spend_limit_usd", 1.0)
    await _log(usage_db, "gpt-4.1-mini", 2_000_000, 200_000, datetime.now(timezone.utc))  # $1.12
    with pytest.raises(AIPausedError):
        await ensure_ai_budget()


@pytest.mark.asyncio
async def test_an_unreadable_usage_log_doesnt_switch_ai_off(monkeypatch):
    """Credits still gate every user; a database blip shouldn't stop the app."""
    monkeypatch.setattr(settings, "ai_daily_spend_limit_usd", 1.0)

    def broken():
        raise ConnectionError("db down")

    monkeypatch.setattr(ai_budget, "_session_factory", broken)
    await ensure_ai_budget()


# ── What the user sees ──────────────────────────────────────────────────────

@pytest.mark.asyncio
@pytest.mark.parametrize("error, status, words", [
    (AIPausedError("limit"), 503, "paused for the rest of today"),
    (AIInputTooLargeError("big"), 422, "too long for the AI to read"),
])
async def test_paused_or_oversized_says_so_and_refunds(ledger, error, status, words):
    from app.db.session import get_db
    from app.main import app
    from tests.test_jd_and_tailor_endpoints import TEST_USER_ID, make_auth_header, make_mock_db

    override, _ = make_mock_db()
    provider = MagicMock()
    provider.complete = AsyncMock(side_effect=error)
    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.ai.get_ai_provider", return_value=provider):
            async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False),
                                   base_url="http://test") as c:
                r = await c.post("/ai/rewrite-bullet", json={"bullet_text": "Did a thing.", "mode": "rewrite"},
                                 headers=make_auth_header())
        assert r.status_code == status
        assert words in r.json()["detail"]
        assert "credits weren't used" in r.json()["detail"]
        assert ledger.refunded == ["rewrite_bullet"]
        assert ledger.balance(TEST_USER_ID) == 50
    finally:
        app.dependency_overrides.pop(get_db, None)
