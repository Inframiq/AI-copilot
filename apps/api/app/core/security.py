import json as _json
import time
import httpx
import jwt
from jwt.algorithms import RSAAlgorithm, ECAlgorithm
from jwt.exceptions import InvalidTokenError, ExpiredSignatureError
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.core.config import settings
from app.core.security_log import note_denial

bearer_scheme = HTTPBearer()

# Only allow algorithms the Supabase auth service actually uses.
_ALLOWED_ALGORITHMS = frozenset({"HS256", "RS256", "ES256"})

# Tolerate clock drift between this host and the Supabase auth server
# when checking iat/nbf/exp — without it, NTP skew trips "not yet valid
# (iat)" on otherwise-valid tokens. Measured drift on the dev machine
# (w32time service was stopped) was ~40s, so 30s wasn't enough — the
# real fix is `w32tm /resync` as admin; this is the defensive floor.
_CLOCK_LEEWAY_SECONDS = 90

# JWKS cache with a 1-hour TTL so key rotations propagate within the hour.
_jwks_cache: dict | None = None
_jwks_cache_at: float = 0.0
_JWKS_TTL = 3600.0


async def _get_jwks() -> dict:
    global _jwks_cache, _jwks_cache_at
    now = time.monotonic()
    if _jwks_cache is None or (now - _jwks_cache_at) > _JWKS_TTL:
        url = f"{settings.supabase_url}/auth/v1/.well-known/jwks.json"
        async with httpx.AsyncClient() as client:
            resp = await client.get(url, timeout=5.0)
            resp.raise_for_status()
            _jwks_cache = resp.json()
            _jwks_cache_at = now
    return _jwks_cache


def _public_key_from_jwk(jwk_dict: dict, alg: str):
    """Reconstruct a public key object from a JWK dict using PyJWT's algorithm classes."""
    jwk_str = _json.dumps(jwk_dict)
    if alg.startswith("RS"):
        return RSAAlgorithm.from_jwk(jwk_str)
    if alg.startswith("ES"):
        return ECAlgorithm.from_jwk(jwk_str)
    raise ValueError(f"Cannot reconstruct key for algorithm: {alg!r}")


class TokenExpired(ValueError):
    """An otherwise good token past its expiry — the one failure worth naming
    to the caller, since the web app refreshes the session on it."""


async def _verify_jwt(token: str) -> dict:
    """Verify a Supabase JWT and return its payload."""
    try:
        header = jwt.get_unverified_header(token)
        alg = header.get("alg", "HS256")

        if alg not in _ALLOWED_ALGORITHMS:
            raise ValueError(f"Disallowed algorithm: {alg!r}")

        if alg == "HS256":
            payload = jwt.decode(
                token,
                settings.supabase_jwt_secret,
                algorithms=["HS256"],
                audience="authenticated",
                leeway=_CLOCK_LEEWAY_SECONDS,
            )
        else:
            jwks = await _get_jwks()
            kid = header.get("kid")
            jwk_entry = next(
                (k for k in jwks.get("keys", []) if k.get("kid") == kid), None
            )
            if jwk_entry is None:
                raise ValueError(f"No matching JWKS key for kid={kid!r}")
            public_key = _public_key_from_jwk(jwk_entry, alg)
            payload = jwt.decode(
                token,
                public_key,
                algorithms=[alg],
                audience="authenticated",
                leeway=_CLOCK_LEEWAY_SECONDS,
            )
        return payload
    except ExpiredSignatureError:
        raise TokenExpired("Token expired")
    except InvalidTokenError as e:
        raise ValueError(f"Invalid token: {e}")


# A signed JWT outlives sign-out: the signature and expiry still check out for
# up to an hour after the session behind it is deleted. So every request also
# asks the database whether the token's session still exists (test ATK-007,
# migration 045). A live answer is reused for a few seconds, so a page that
# fires several requests at once asks once; an ended session never comes back,
# so that answer is kept until the cache is trimmed.
_SESSION_LIVE_TTL = 5.0
_SESSION_CACHE_MAX = 10_000
_session_cache: dict[str, tuple[bool, float]] = {}


async def _session_is_active(session_id: str) -> bool:
    from sqlalchemy import text
    from app.db.session import engine

    async with engine.connect() as conn:
        return bool(
            await conn.scalar(
                text("SELECT private.session_is_active(:sid)"), {"sid": session_id}
            )
        )


async def _session_still_open(session_id: str | None) -> bool:
    if not isinstance(session_id, str) or not session_id:
        return False
    now = time.monotonic()
    cached = _session_cache.get(session_id)
    if cached is not None:
        active, at = cached
        if not active or now - at < _SESSION_LIVE_TTL:
            return active
    active = await _session_is_active(session_id)
    if len(_session_cache) >= _SESSION_CACHE_MAX:
        _session_cache.clear()
    _session_cache[session_id] = (active, now)
    return active


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> dict:
    try:
        payload = await _verify_jwt(credentials.credentials)
    except TokenExpired:
        note_denial(request, "expired_token")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")
    except ValueError:
        # Why it failed stays here. The library's wording, and the kid or alg
        # it quotes back from the caller's own token, tell a prober which
        # checks ran and in what order (test API-002).
        note_denial(request, "invalid_token")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    if not await _session_still_open(payload.get("session_id")):
        # Same answer as a forged token: whether the session ended or never
        # existed is nothing the caller needs.
        note_denial(request, "ended_session", payload.get("sub"))
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    return payload


async def require_admin(request: Request, user: dict = Depends(get_current_user)) -> dict:
    """Gate for the admin dashboard (feedback list, user/plan management) —
    no roles table, just a comma-separated allowlist in settings.admin_emails
    checked against the JWT's email claim.

    The email must also be vouched for by Google. Supabase's email/password
    sign-up is reachable with the public key, and depending on project
    settings it can issue a token for an address nobody has proven they own.
    Google has verified every address it signs in, so an admin must have
    signed in through Google at least once."""
    admin_emails = {e.strip().lower() for e in settings.admin_emails.split(",") if e.strip()}
    if (user.get("email") or "").lower() not in admin_emails:
        note_denial(request, "not_admin", user.get("sub"))
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    providers = (user.get("app_metadata") or {}).get("providers") or []
    if "google" not in providers:
        note_denial(request, "admin_without_google", user.get("sub"))
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user


async def get_optional_user_email(request) -> str | None:
    """Best-effort email extraction from a bearer token, used only by
    app.main's admin_only_restriction_middleware. Returns None for any
    missing/invalid token instead of raising — every real auth boundary
    still goes through get_current_user/require_admin, which verify
    properly and reject bad tokens with 401."""
    auth_header = request.headers.get("authorization", "")
    if not auth_header.lower().startswith("bearer "):
        return None
    try:
        payload = await _verify_jwt(auth_header[7:])
    except ValueError:
        return None
    return payload.get("email")


def is_admin_only_email(email: str | None) -> bool:
    if not email:
        return False
    admin_only_emails = {e.strip().lower() for e in settings.admin_only_emails.split(",") if e.strip()}
    return email.strip().lower() in admin_only_emails
