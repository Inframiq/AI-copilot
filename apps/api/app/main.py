import logging
import re
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from app.routers import resumes, jd, ai, learning, contacts
from app.core.rate_limit import limiter

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
# for dynamic Vercel preview URLs.
_VERCEL_ORIGIN_RE = re.compile(r"https://[\w-]+\.vercel\.app")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_origin_regex=r"https://[\w-]+\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(resumes.router)
app.include_router(jd.router)
app.include_router(ai.router)
app.include_router(learning.router)
app.include_router(contacts.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
