from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str
    supabase_jwt_secret: str
    # The API's own login: reads and writes the app's tables and nothing else
    # (the kripax_api role, migration 043).
    database_url: str
    # The login the deploy's migration step (app.migrate) uses: changing the
    # schema needs the database owner, postgres. Unset, migrations use
    # database_url.
    migration_database_url: str = ""
    openai_api_key: str = ""
    openai_max_output_tokens: int = 16384
    # Used for "fast" and "pro" tiers alike — see openai_provider.py's
    # comment on why only Agent 2 (JD+resume semantic mapping, "premium"
    # tier) gets the pricier model; every other pro-tier call stays on this
    # one for cost reasons decided against real per-call token estimates.
    openai_model_fast: str = "gpt-5.6-luna"
    openai_model_premium: str = "gpt-5.6-sol"
    # The "standard" tier, between the two: interview follow-up answers,
    # which a user pays for one at a time and reads closely. 5.6-terra is
    # ~10x luna and half of sol per token.
    openai_model_standard: str = "gpt-5.6-terra"
    # Company intel with live web search (Agent 0). Compared 2026-10-13 on the
    # same lookup: 5.6-luna ~1c but one loose search on aggregator sites;
    # 5.6-terra ~4c, ~10s, every source the company's own and its published
    # values exact; 5.6-sol ~12c; 5.5 ~25c and ~19s. Cached per company.
    openai_model_research: str = "gpt-5.6-terra"
    # Site-wide ceiling on OpenAI spend per UTC day (USD), priced from
    # ai_usage_events — see app.core.ai_budget. AI features pause once it's
    # reached. 0 turns it off. The busiest day so far (2026-10-11) was ~$0.19.
    ai_daily_spend_limit_usd: float = 10.0
    # Site-wide cap on AI actions (tailor, analyze, rewrite…) started per
    # minute, across every user — so a swarm of accounts can't saturate the
    # OpenAI quota and stall the site for everyone. Checked before anything
    # is charged. The busiest minute so far (2026-09-16) had 2 actions.
    ai_global_requests_per_minute: int = 60
    # Where rate-limit counters live. "memory://" (one process; they reset on
    # deploy) is right for today's single uvicorn process. Before running
    # more than one instance, point this at a shared store — e.g.
    # "redis://host:6379" (and add the `redis` package) — or each instance
    # counts on its own and every limit multiplies by the instance count.
    rate_limit_storage_uri: str = "memory://"
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

    # A key this class no longer declares (AI_PROVIDER, GEMINI_API_KEY —
    # Gemini was removed) must not fail startup on a deploy whose .env still
    # carries it.
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def migration_url(self) -> str:
        return self.migration_database_url or self.database_url

settings = Settings()
