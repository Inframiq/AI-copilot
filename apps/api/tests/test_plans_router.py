import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.core.credits import PLAN_CREDITS


@pytest.mark.asyncio
async def test_plans_returns_free_then_premium_without_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/plans")
    assert r.status_code == 200
    plans = r.json()["plans"]
    assert [p["id"] for p in plans] == ["free", "premium"]

    free = plans[0]
    assert free["price_usd"] == 0
    assert free["period"] is None
    assert free["refills"] is False
    assert free["credits"] == PLAN_CREDITS["free"]
    assert isinstance(free["features"], list) and free["features"]

    premium = plans[1]
    assert premium["price_usd"] == 5
    assert premium["period"] == "month"
    assert premium["refills"] is True
    assert premium["credits"] == PLAN_CREDITS["premium"]
    assert isinstance(premium["features"], list) and premium["features"]
