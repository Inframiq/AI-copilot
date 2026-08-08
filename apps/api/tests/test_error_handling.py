import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.core.security import get_current_user


async def _broken_auth():
    raise RuntimeError("boom — simulated unexpected failure")
    yield  # pragma: no cover — makes this a generator, never reached


@pytest.mark.asyncio
async def test_unhandled_exception_returns_structured_500_without_leaking_internals():
    app.dependency_overrides[get_current_user] = _broken_auth
    try:
        # raise_app_exceptions=False mirrors a real deployment: Starlette's
        # ServerErrorMiddleware sends the 500 response our handler built,
        # then re-raises for the ASGI server's own logging — a real uvicorn
        # server swallows that re-raise; the default ASGITransport doesn't.
        transport = ASGITransport(app=app, raise_app_exceptions=False)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            r = await client.get("/resumes")
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert r.status_code == 500
    body = r.json()
    assert body == {"detail": "Internal server error"}
    # The real exception message/traceback must not leak to the client.
    assert "boom" not in r.text
    assert "RuntimeError" not in r.text
