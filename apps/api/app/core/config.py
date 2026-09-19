from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str
    supabase_jwt_secret: str
    database_url: str
    openai_api_key: str = ""
    openai_max_output_tokens: int = 16384
    # Used for "fast" and "pro" tiers alike — see openai_provider.py's
    # comment on why only Agent 2 (JD+resume semantic mapping, "premium"
    # tier) gets the pricier model; every other pro-tier call stays on this
    # one for cost reasons decided against real per-call token estimates.
    openai_model_fast: str = "gpt-5.6-luna"
    openai_model_premium: str = "gpt-5.6-sol"
    cors_extra_origins: str = ""  # comma-separated additional allowed origins
    # A regex for preview deployments' origins, e.g.
    # https://kripax-[a-z0-9-]+-inframiq\.vercel\.app — empty allows none.
    # Never a bare *.vercel.app: anyone can host a site there.
    cors_origin_regex: str = ""
    # /docs, /redoc and /openapi.json map every endpoint. Off unless asked for
    # (set ENABLE_API_DOCS=true locally).
    enable_api_docs: bool = False
    unlimited_credit_emails: str = ""  # comma-separated emails exempt from credit metering (QA/test accounts)
    admin_emails: str = "bharathrockz.k@gmail.com,tanishqkundrapu@gmail.com"  # comma-separated emails allowed to access admin endpoints
    # Subset of admin_emails with NO normal app access at all — see
    # app.main's admin_only_restriction_middleware. Both current admins are
    # admin-only; a future admin added to admin_emails but left out of this
    # list would keep full normal-user access alongside the dashboard.
    admin_only_emails: str = "bharathrockz.k@gmail.com,tanishqkundrapu@gmail.com"

    class Config:
        env_file = ".env"
        # A key this class no longer declares (AI_PROVIDER, GEMINI_API_KEY —
        # Gemini was removed) must not fail startup on a deploy whose .env
        # still carries it.
        extra = "ignore"

settings = Settings()
