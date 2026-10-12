import jwt
from slowapi import Limiter
from starlette.requests import Request

from app.core.config import settings


def client_ip(request: Request) -> str:
    """The visitor's IP address, not the proxy's.

    The API runs behind the host's proxy, so the socket peer is the proxy
    and every visitor would share one rate-limit bucket. The proxy puts the
    visitor's address first in X-Forwarded-For. A client can prepend its
    own value there, so this key is only as strong as that: endpoints
    limited by IP alone also carry a global cap.
    """
    forwarded = request.headers.get("x-forwarded-for", "")
    first = forwarded.split(",")[0].strip()
    if first:
        return first
    return request.client.host if request.client else "unknown"


def rate_limit_key(request: Request) -> str:
    """One bucket per signed-in user, else per IP.

    The token is read without verifying it: that happens in the endpoint's
    auth dependency, which runs first and turns away a forged token before
    the limit is counted. So a bucket named after a user only ever fills
    with that user's own requests.
    """
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        try:
            sub = jwt.decode(auth[7:], options={"verify_signature": False}).get("sub")
        except jwt.PyJWTError:
            sub = None
        if isinstance(sub, str) and sub:
            return f"user:{sub}"
    return f"ip:{client_ip(request)}"


limiter = Limiter(key_func=rate_limit_key, storage_uri=settings.rate_limit_storage_uri)


def _ai_global_limit() -> str:
    return f"{settings.ai_global_requests_per_minute}/minute"


# One bucket for the whole site, on every route that starts an AI action
# (security review M6). Per-user limits stop one account; this stops many —
# a swarm of free accounts can't saturate the OpenAI quota and stall the
# site for everyone. It runs before the route, so a refused request is
# never charged. Stack it under the route's own @limiter.limit; a test
# checks every route that spends credits carries it.
ai_global_limit = limiter.shared_limit(
    _ai_global_limit,
    scope="ai-global",
    key_func=lambda request: "ai-global",
    error_message="AI features are busy right now. Try again in a minute — you weren't charged.",
)
