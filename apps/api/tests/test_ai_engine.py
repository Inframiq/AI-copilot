import pytest
from app.services.ai_engine.factory import get_ai_provider
from app.core.config import settings


@pytest.mark.asyncio
async def test_factory_returns_openai(monkeypatch):
    monkeypatch.setattr(settings, "openai_api_key", "fake")
    provider = get_ai_provider()
    assert provider.__class__.__name__ == "OpenAIProvider"


def test_a_leftover_provider_setting_does_not_break_startup(tmp_path, monkeypatch):
    """Gemini was removed along with its settings. A deploy whose .env still
    carries AI_PROVIDER / GEMINI_API_KEY must keep booting, not fail
    validation on keys the app no longer reads."""
    from app.core.config import Settings

    env = tmp_path / ".env"
    env.write_text("AI_PROVIDER=gemini\nGEMINI_API_KEY=x\nAI_MODEL_FAST=gemini-2.5-flash\n")
    monkeypatch.chdir(tmp_path)
    s = Settings(
        supabase_url="u", supabase_anon_key="a", supabase_service_role_key="s",
        supabase_jwt_secret="j", database_url="d",
    )
    assert not hasattr(s, "gemini_api_key")
