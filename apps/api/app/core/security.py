import httpx
from jose import jwt, JWTError, ExpiredSignatureError
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.core.config import settings

bearer_scheme = HTTPBearer()

# Cached JWKS (Supabase projects on the newer asymmetric signing keys sign
# tokens with ES256/RS256, not the legacy HS256 shared secret — those tokens
# must be verified against Supabase's published public keys instead).
_jwks_cache: dict | None = None


def _get_jwks() -> dict:
    global _jwks_cache
    if _jwks_cache is None:
        url = f"{settings.supabase_url}/auth/v1/.well-known/jwks.json"
        response = httpx.get(url, timeout=5.0)
        response.raise_for_status()
        _jwks_cache = response.json()
    return _jwks_cache


def verify_supabase_jwt(token: str, secret: str | None = None) -> dict:
    try:
        header = jwt.get_unverified_header(token)
        alg = header.get("alg", "HS256")

        if alg == "HS256":
            key = secret or settings.supabase_jwt_secret
        else:
            jwks = _get_jwks()
            kid = header.get("kid")
            key = next((k for k in jwks.get("keys", []) if k.get("kid") == kid), None)
            if key is None:
                raise ValueError(f"No matching JWKS key found for kid={kid!r}")

        payload = jwt.decode(token, key, algorithms=[alg], options={"verify_aud": False})
        return payload
    except ExpiredSignatureError:
        raise ValueError("Token expired")
    except JWTError as e:
        raise ValueError(f"Invalid token: {e}")

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> dict:
    try:
        return verify_supabase_jwt(credentials.credentials)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e))
