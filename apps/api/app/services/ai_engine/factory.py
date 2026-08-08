from app.core.config import settings
from app.services.ai_engine.base import AIProvider


def get_ai_provider() -> AIProvider:
    # Read from `settings` (pydantic-settings, parses .env), not os.getenv —
    # pydantic-settings loads .env into its own Settings object and never
    # exports those values into the process's actual environment variables,
    # so os.getenv() here would silently see nothing and fall back to
    # whatever hardcoded default was passed, regardless of .env's contents.
    provider = settings.ai_provider

    if provider == "gemini":
        from app.services.ai_engine.gemini_provider import GeminiProvider
        return GeminiProvider(
            fast_model=settings.ai_model_fast,
            pro_model=settings.ai_model_pro,
            api_key=settings.gemini_api_key,
        )

    if provider == "openai":
        from app.services.ai_engine.openai_provider import OpenAIProvider
        return OpenAIProvider(
            api_key=settings.openai_api_key,
            max_output_tokens=settings.openai_max_output_tokens,
        )

    raise ValueError(f"Unknown AI_PROVIDER: {provider!r}. Use 'gemini' or 'openai'.")
