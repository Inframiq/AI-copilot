import pytest
from unittest.mock import AsyncMock, patch
from pydantic import BaseModel
from app.services.ai_engine.factory import get_ai_provider


class SkillList(BaseModel):
    skills: list[str]


@pytest.mark.asyncio
async def test_factory_returns_gemini_by_default():
    with patch.dict("os.environ", {"AI_PROVIDER": "gemini", "GEMINI_API_KEY": "fake"}):
        from app.services.ai_engine import factory
        import importlib; importlib.reload(factory)
        provider = factory.get_ai_provider()
        assert provider.__class__.__name__ == "GeminiProvider"


@pytest.mark.asyncio
async def test_factory_returns_openai_when_set():
    with patch.dict("os.environ", {"AI_PROVIDER": "openai", "OPENAI_API_KEY": "fake"}):
        from app.services.ai_engine import factory
        import importlib; importlib.reload(factory)
        provider = factory.get_ai_provider()
        assert provider.__class__.__name__ == "OpenAIProvider"


@pytest.mark.asyncio
async def test_factory_raises_on_unknown_provider():
    with patch.dict("os.environ", {"AI_PROVIDER": "unknown"}):
        from app.services.ai_engine import factory
        import importlib; importlib.reload(factory)
        with pytest.raises(ValueError, match="Unknown AI_PROVIDER"):
            factory.get_ai_provider()
