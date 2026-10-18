import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from app.routers import resumes, jd, ai, learning, cover_letters, me, plans, feedback, admin, data_requests
from app.services.ai_engine.base import AIInputTooLargeError, AIPausedError
from app.core.rate_limit import limiter
from app.core.body_limit import BodySizeLimitMiddleware
from app.core.config import settings
from app.core.security import get_optional_user_email, is_admin_only_email

logger = logging.getLogger("app")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Uploaded PDFs and photos are opened only in the sandbox process
    (app/services/sandbox.py). If it can't run on this host, say so in the
    log at startup rather than on someone's first upload. Off the startup
    path: the check spawns a process."""
    import threading
    from app.services import sandbox

    threading.Thread(target=sandbox.self_check, name="sandbox-self-check", daemon=True).start()
    yield


app = FastAPI(
    lifespan=lifespan,
    title="KripaX API",
    version="1.0.0",
    docs_url="/docs" if settings.enable_api_docs else None,
    redoc_url="/redoc" if settings.enable_api_docs else None,
    openapi_url="/openapi.json" if settings.enable_api_docs else None,
)
app.add_middleware(BodySizeLimitMiddleware)

# Rate limiter
app.state.limiter = limiter


@app.exception_handler(RateLimitExceeded)
async def rate_limited_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    """A rate limit, in words, where the web app reads errors (`detail`).

    slowapi's own handler answered {"error": "Rate limit exceeded: 10 per 1
    minute"}; the app reads `detail`, so every limit showed as a bare
    "Request failed". A limit with its own message (the site-wide AI cap)
    says it; the rest say to wait. Retry-After tells clients when.
    """
    message = getattr(exc.limit, "error_message", None) or (
        "Too many requests — wait a minute and try again."
    )
    return JSONResponse(status_code=429, content={"detail": message}, headers={"Retry-After": "60"})




# The OpenAI cost bounds (app.core.ai_budget), in words. Credits are already
# refunded by the time these reach here — every charged endpoint refunds
# when its model call fails.
@app.exception_handler(AIInputTooLargeError)
async def ai_input_too_large_handler(request: Request, exc: AIInputTooLargeError) -> JSONResponse:
    logger.warning("Model input too large on %s %s: %s", request.method, request.url.path, exc)
    return JSONResponse(
        status_code=422,
        content={"detail": "This is too long for the AI to read. Shorten the job description or your résumé and try again — your credits weren't used."},
    )


@app.exception_handler(AIPausedError)
async def ai_paused_handler(request: Request, exc: AIPausedError) -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={"detail": "AI features are paused for the rest of today. Please try again tomorrow — your credits weren't used."},
    )


# Catch-all for anything an endpoint doesn't handle itself — without this,
# Starlette's default 500 handler can leak stack traces to the client
# depending on debug settings. HTTPException (404s, 401s, validation errors,
# etc.) is unaffected — FastAPI dispatches to the more specific registered
# handler for those, this only catches what nothing else caught.
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})

# Paths an ADMIN_ONLY_EMAILS account may still reach — everything else 403s
# for them, so a new normal-user route is locked out by default instead of
# needing to remember to add it to a denylist.
_ADMIN_ONLY_EXEMPT_EXACT = {"/health", "/docs", "/openapi.json"}


@app.middleware("http")
async def admin_only_restriction_middleware(request: Request, call_next):
    """settings.ADMIN_ONLY_EMAILS accounts (e.g. tanishqkundrapu@gmail.com)
    are admin-only — no normal app access, only the admin dashboard. Every
    other admin email is unaffected and keeps full normal-user access."""
    if request.method != "OPTIONS":
        email = await get_optional_user_email(request)
        if is_admin_only_email(email):
            path = request.url.path
            exempt = (
                path.startswith("/admin")
                or path.startswith("/redoc")
                or path in _ADMIN_ONLY_EXEMPT_EXACT
                or (path == "/feedback" and request.method == "GET")
            )
            if not exempt:
                return JSONResponse(
                    status_code=403, content={"detail": "This account is admin-only."}
                )
    return await call_next(request)


# Registered after every middleware that can answer on its own (the
# admin-only 403 above): the last one added is the outermost, so CORS and
# the security headers wrap every response. Added before it, a refusal
# went out without Access-Control-Allow-Origin and the browser showed
# "Failed to fetch" instead of the 403 (test API-002).
# CORS — explicit origins only; wildcard glob strings are not supported by
# the CORSMiddleware and would silently allow all origins. Other origins go
# in CORS_EXTRA_ORIGINS — local development's localhost:3000 included, since
# production must not trust a page on a visitor's own machine (security
# review L7). Preview deployments, if the API should answer them, go in
# CORS_ORIGIN_REGEX scoped to this project. It used to accept every
# *.vercel.app origin, which is anyone's site, and the retired
# resumebuilder.inframiq.com, which only redirects now (test API-004).

_extra_origins = [o.strip() for o in settings.cors_extra_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://kripax.inframiq.com", *_extra_origins],
    allow_origin_regex=settings.cors_origin_regex or None,
    # The web app authenticates with a bearer token and sends no cookies, so
    # there is nothing a credentialed cross-site request should carry.
    allow_credentials=False,
    # What lib/api-client.ts sends, nothing more.
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    """Baseline security headers. This API is called via fetch/XHR from a
    separate frontend origin and only ever answers with JSON:
      - nosniff: stops browsers from MIME-sniffing JSON responses into
        something executable.
      - DENY / frame-ancestors 'none': nothing here should ever be framed.
      - CSP default-src 'none': opened straight in a tab, a response may load
        and run nothing, whatever text it carries (test WEB-001).
      - HSTS: HTTPS only, so a token is never sent over plain HTTP. Not
        includeSubDomains: the host is a subdomain of Render's, not ours.
    """
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
    response.headers["Strict-Transport-Security"] = "max-age=63072000"
    return response


app.include_router(resumes.router)
app.include_router(jd.router)
app.include_router(ai.router)
app.include_router(learning.router)
app.include_router(cover_letters.router)
app.include_router(me.router)
app.include_router(plans.router)
app.include_router(feedback.router)
app.include_router(admin.router)
app.include_router(data_requests.router)
app.include_router(data_requests.admin_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
