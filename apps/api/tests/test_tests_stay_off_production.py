"""The test run can't reach production: the database, Supabase and OpenAI
settings are placeholders whatever apps/api/.env says (see conftest.py)."""
from sqlalchemy.engine import make_url


def test_settings_point_nowhere_real():
    from app.core.config import settings
    from app.db.session import engine

    for url in (settings.database_url, settings.migration_url, str(engine.url)):
        assert make_url(url).host == "127.0.0.1", url
    assert "placeholder" in settings.supabase_url
    assert settings.supabase_service_role_key == "test-placeholder"
    assert settings.openai_api_key == "test-placeholder"
