"""app.core.usage — the per-request AI-usage capture context manager."""
import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.core.usage import record_ai_usage, record_call

USER = uuid.uuid4()


class _FakeSession:
    def __init__(self):
        self.added = []
        self.committed = False

    def add_all(self, rows):
        self.added.extend(rows)

    async def commit(self):
        self.committed = True

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


@pytest.mark.asyncio
async def test_persists_one_row_per_recorded_call():
    fake = _FakeSession()
    with patch("app.db.session.AsyncSessionLocal", new=lambda: fake):
        async with record_ai_usage(USER, "tailor"):
            record_call(call_name="agent2_semantic_map", model="gpt-4.1-mini",
                        model_tier="premium", input_tokens=3000, output_tokens=6000,
                        reasoning_tokens=2000, total_tokens=9000)
            record_call(call_name="agent3_write", model="gpt-4.1-mini", model_tier="premium",
                        input_tokens=4000, output_tokens=4000, reasoning_tokens=1000,
                        total_tokens=8000)
    assert fake.committed
    assert len(fake.added) == 2
    r0 = fake.added[0]
    assert r0.user_id == USER and r0.action == "tailor"
    assert r0.call_name == "agent2_semantic_map" and r0.input_tokens == 3000
    assert r0.total_tokens == 9000


@pytest.mark.asyncio
async def test_no_calls_means_no_session_opened():
    opened = False

    def _factory():
        nonlocal opened
        opened = True
        return _FakeSession()

    with patch("app.db.session.AsyncSessionLocal", new=_factory):
        async with record_ai_usage(USER, "analyze"):
            pass
    assert opened is False


@pytest.mark.asyncio
async def test_record_call_outside_block_is_a_noop():
    # No active sink → must not raise.
    record_call(call_name="x", model="m", model_tier="fast", input_tokens=1,
                output_tokens=1, reasoning_tokens=0, total_tokens=2)


@pytest.mark.asyncio
async def test_persist_failure_is_swallowed():
    class _Boom(_FakeSession):
        async def commit(self):
            raise RuntimeError("db down")

    with patch("app.db.session.AsyncSessionLocal", new=lambda: _Boom()):
        async with record_ai_usage(USER, "tailor"):
            record_call(call_name="c", model="m", model_tier="fast", input_tokens=1,
                        output_tokens=1, reasoning_tokens=0, total_tokens=2)
    # reaching here without raising is the assertion


@pytest.mark.asyncio
async def test_does_not_swallow_an_exception_from_the_wrapped_block():
    # Regression: a `return` inside the finally used to eat this.
    with patch("app.db.session.AsyncSessionLocal", new=lambda: _FakeSession()):
        with pytest.raises(ValueError, match="boom"):
            async with record_ai_usage(USER, "tailor"):
                record_call(call_name="c", model="m", model_tier="fast", input_tokens=1,
                            output_tokens=1, reasoning_tokens=0, total_tokens=2)
                raise ValueError("boom")
