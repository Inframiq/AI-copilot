import re
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from app.routers import resumes, jd, ai
from app.core.rate_limit import limiter

app = FastAPI(title="Career Copilot API", version="1.0.0")

# Rate limiter
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

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


@app.get("/health")
async def health():
    return {"status": "ok"}
