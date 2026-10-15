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


async def test_a_database_error_never_carries_the_values_into_the_log(pg_uri):
    """Test DB-005: an error's message names the query, not what it sent."""
    import pytest
    from sqlalchemy import text
    from sqlalchemy.exc import DBAPIError
    from sqlalchemy.ext.asyncio import create_async_engine
    from app.db.session import engine as app_engine

    hidden = app_engine.sync_engine.hide_parameters
    assert hidden
    probe = create_async_engine(pg_uri, hide_parameters=hidden)
    try:
        async with probe.connect() as conn:
            with pytest.raises(DBAPIError) as err:
                # Fails for a reason of its own; without hide_parameters the message lists :v.
                await conn.execute(text("SELECT CAST(:v AS text), 1 / 0"), {"v": "jane@example.com secret résumé text"})
        assert "jane@example.com" not in str(err.value)
        assert "hidden due to hide_parameters" in str(err.value)
    finally:
        await probe.dispose()
