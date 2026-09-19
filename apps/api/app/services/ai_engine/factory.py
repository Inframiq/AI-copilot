from app.core.config import settings
from app.services.ai_engine.base import AIProvider


def get_ai_provider() -> AIProvider:
    # Read from `settings` (pydantic-settings, parses .env), not os.getenv —
    # pydantic-settings loads .env into its own Settings object and never
    # exports those values into the process's actual environment variables,
    # so os.getenv() here would silently see nothing and fall back to
    # whatever hardcoded default was passed, regardless of .env's contents.
    #
    # OpenAI is the only provider. The Gemini one was removed; routers and
    # tests still go through this function, so it stays the one seam.
    from app.services.ai_engine.openai_provider import OpenAIProvider
    return OpenAIProvider(
        api_key=settings.openai_api_key,
        fast_model=settings.openai_model_fast,
        premium_model=settings.openai_model_premium,
        max_output_tokens=settings.openai_max_output_tokens,
    )
