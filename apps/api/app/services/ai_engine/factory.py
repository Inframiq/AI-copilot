import os
from app.services.ai_engine.base import AIProvider


def get_ai_provider() -> AIProvider:
    provider = os.getenv("AI_PROVIDER", "gemini")
    fast = os.getenv("AI_MODEL_FAST", "gemini-2.5-flash")
    pro = os.getenv("AI_MODEL_PRO", "gemini-2.5-pro")

    if provider == "gemini":
        from app.services.ai_engine.gemini_provider import GeminiProvider
        return GeminiProvider(fast_model=fast, pro_model=pro, api_key=os.getenv("GEMINI_API_KEY", ""))

    if provider == "openai":
        from app.services.ai_engine.openai_provider import OpenAIProvider
        max_output_tokens = int(os.getenv("OPENAI_MAX_OUTPUT_TOKENS", "800"))
        return OpenAIProvider(
            api_key=os.getenv("OPENAI_API_KEY", ""),
            max_output_tokens=max_output_tokens,
        )

    raise ValueError(f"Unknown AI_PROVIDER: {provider!r}. Use 'gemini' or 'openai'.")
