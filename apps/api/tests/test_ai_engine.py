import pytest
from app.services.ai_engine.factory import get_ai_provider
from app.core.config import settings


@pytest.mark.asyncio
async def test_factory_returns_gemini_by_default(monkeypatch):
    monkeypatch.setattr(settings, "ai_provider", "gemini")
    monkeypatch.setattr(settings, "gemini_api_key", "fake")
    provider = get_ai_provider()
    assert provider.__class__.__name__ == "GeminiProvider"


@pytest.mark.asyncio
async def test_factory_returns_openai_when_set(monkeypatch):
    monkeypatch.setattr(settings, "ai_provider", "openai")
    monkeypatch.setattr(settings, "openai_api_key", "fake")
    provider = get_ai_provider()
    assert provider.__class__.__name__ == "OpenAIProvider"


@pytest.mark.asyncio
async def test_factory_raises_on_unknown_provider(monkeypatch):
    monkeypatch.setattr(settings, "ai_provider", "unknown")
    with pytest.raises(ValueError, match="Unknown AI_PROVIDER"):
        get_ai_provider()
