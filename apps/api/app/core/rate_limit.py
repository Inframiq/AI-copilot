import jwt
from slowapi import Limiter
from starlette.requests import Request


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


limiter = Limiter(key_func=rate_limit_key)
