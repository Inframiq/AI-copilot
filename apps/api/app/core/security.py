import json as _json
import time
import httpx
import jwt
from jwt.algorithms import RSAAlgorithm, ECAlgorithm
from jwt.exceptions import InvalidTokenError, ExpiredSignatureError
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.core.config import settings

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
        raise ValueError("Token expired")
    except InvalidTokenError as e:
        raise ValueError(f"Invalid token: {e}")


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> dict:
    try:
        return await _verify_jwt(credentials.credentials)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e))
