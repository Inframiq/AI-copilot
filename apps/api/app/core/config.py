from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str
    supabase_jwt_secret: str
    database_url: str
    ai_provider: str = "gemini"
    ai_model_fast: str = "gemini-2.5-flash"
    ai_model_pro: str = "gemini-2.5-pro"
    gemini_api_key: str = ""
    openai_api_key: str = ""
    openai_max_output_tokens: int = 4096
    cors_extra_origins: str = ""  # comma-separated additional allowed origins

    class Config:
        env_file = ".env"

settings = Settings()
