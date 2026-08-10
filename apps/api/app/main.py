import logging
import re
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from app.routers import resumes, jd, ai, learning, contacts
from app.core.rate_limit import limiter
from app.core.config import settings

logger = logging.getLogger("app")

app = FastAPI(title="Career Copilot API", version="1.0.0")

# Rate limiter
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


# Catch-all for anything an endpoint doesn't handle itself — without this,
# Starlette's default 500 handler can leak stack traces to the client
# depending on debug settings. HTTPException (404s, 401s, validation errors,
# etc.) is unaffected — FastAPI dispatches to the more specific registered
# handler for those, this only catches what nothing else caught.
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})

# CORS — explicit origins only; wildcard glob strings are not supported by
# the CORSMiddleware and would silently allow all origins. Use allow_origin_regex
# for dynamic Vercel preview URLs. Production custom domains (which don't match
# the Vercel regex) go in CORS_EXTRA_ORIGINS so they don't require a code change.
_VERCEL_ORIGIN_RE = re.compile(r"https://[\w-]+\.vercel\.app")

_extra_origins = [o.strip() for o in settings.cors_extra_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "https://resumebuilder.inframiq.com",
        *_extra_origins,
    ],
    allow_origin_regex=r"https://[\w-]+\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    """Baseline security headers. This API is called via fetch/XHR from a
    separate frontend origin and never server-renders HTML, so most
    browser-facing headers (CSP, HSTS) belong on the Next.js app instead.
    These two are cheap, universally safe, and defend even non-browser or
    misconfigured clients:
      - nosniff: stops browsers from MIME-sniffing JSON/PDF responses into
        something executable.
      - DENY: this API serves no HTML, so it should never be framed.
    """
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


app.include_router(resumes.router)
app.include_router(jd.router)
app.include_router(ai.router)
app.include_router(learning.router)
app.include_router(contacts.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
