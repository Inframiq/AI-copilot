"""POST /ai/restructure-notes — the notes canvas's one AI call — and the
deterministic clean-up after it (services/misc_notes.clean_points)."""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.db.session import get_db
from app.main import app
from app.services.misc_notes import MAX_POINTS_PER_SAVE, NotePoint, NotesDraft, clean_points
from tests.test_jd_and_tailor_endpoints import credit_sub_result, make_auth_header, make_mock_db


# ── clean_points ──────────────────────────────────────────────────────────────


def test_clean_points_keeps_known_sections_and_maps_unknown_to_miscellaneous():
    out = clean_points(
        [NotePoint(text="Won the college hackathon", section="Awards"),
         NotePoint(text="Speaks Telugu", section="languages")],
        "won the college hackathon, I speak telugu",
    )
    assert [(p.text, p.section) for p in out] == [
        ("Won the college hackathon", "awards"),
        ("Speaks Telugu", "miscellaneous"),
    ]


def test_clean_points_drops_empty_and_duplicate_points_and_collapses_spaces():
    out = clean_points(
        [NotePoint(text="  ", section="awards"),
         NotePoint(text="Led   the robotics club", section="leadership"),
         NotePoint(text="led the robotics club", section="leadership")],
        "led the robotics club",
    )
    assert [p.text for p in out] == ["Led the robotics club"]


def test_clean_points_flags_a_number_the_user_never_wrote():
    out = clean_points(
        [NotePoint(text="Cut build time by 40%", section="experience"),
         NotePoint(text="Mentored 2,000 students", section="volunteer")],
        "made the build faster. mentored 2000 students",
    )
    assert out[0].flags == ["Adds a number you didn't write: 40"]
    # "2,000" and "2000" are the same number.
    assert out[1].flags == []


def test_clean_points_caps_the_count():
    raw = [NotePoint(text=f"Point {chr(65 + i)}", section="achievements") for i in range(15)]
    assert len(clean_points(raw, "notes")) == MAX_POINTS_PER_SAVE


# ── the endpoint ──────────────────────────────────────────────────────────────


async def _post(json, provider=None, credits=50, raise_app_exceptions=True):
    sub_result = credit_sub_result(credits=credits)
    sub = sub_result.scalar_one_or_none()
    override, mock_session = make_mock_db()
    mock_session.execute = AsyncMock(return_value=sub_result)
    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.ai.get_ai_provider", return_value=provider or MagicMock()):
            transport = ASGITransport(app=app, raise_app_exceptions=raise_app_exceptions)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                r = await client.post("/ai/restructure-notes", json=json, headers=make_auth_header())
    finally:
        app.dependency_overrides.pop(get_db, None)
    return r, sub


def _provider(points):
    p = MagicMock()
    p.complete_structured = AsyncMock(return_value=NotesDraft(points=points))
    return p


@pytest.mark.asyncio
async def test_restructure_notes_charges_one_credit_and_returns_points():
    provider = _provider([NotePoint(text="Organised a 3-day coding bootcamp", section="leadership")])
    r, sub = await _post({"text": "i organised a 3 day coding bootcamp"}, provider)
    assert r.status_code == 200
    assert r.json() == {"points": [
        {"text": "Organised a 3-day coding bootcamp", "section": "leadership", "flags": []},
    ]}
    assert sub.credits_remaining == 49
    # The user's text reaches the model fenced as data.
    assert "<notes>\ni organised a 3 day coding bootcamp\n</notes>" in provider.complete_structured.call_args.args[1]


@pytest.mark.asyncio
async def test_restructure_notes_refunds_when_the_model_fails():
    provider = MagicMock()
    provider.complete_structured = AsyncMock(side_effect=RuntimeError("provider exploded"))
    r, sub = await _post({"text": "won an award"}, provider, raise_app_exceptions=False)
    assert r.status_code == 500
    assert sub.credits_remaining == 50


@pytest.mark.asyncio
async def test_restructure_notes_refunds_when_nothing_usable_comes_back():
    r, sub = await _post({"text": "hmm"}, _provider([NotePoint(text=" ", section="awards")]))
    assert r.status_code == 422
    assert "credit was returned" in r.json()["detail"]
    assert sub.credits_remaining == 50


@pytest.mark.asyncio
async def test_restructure_notes_refuses_blank_text_without_charging():
    provider = _provider([])
    r, sub = await _post({"text": "   \n "}, provider)
    assert r.status_code == 422
    assert sub.credits_remaining == 50
    provider.complete_structured.assert_not_called()


@pytest.mark.asyncio
async def test_restructure_notes_refuses_text_over_2000_characters():
    r, sub = await _post({"text": "a" * 2001}, _provider([]))
    assert r.status_code == 422
    assert sub.credits_remaining == 50


@pytest.mark.asyncio
async def test_restructure_notes_requires_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post("/ai/restructure-notes", json={"text": "won an award"})
    assert r.status_code == 401
