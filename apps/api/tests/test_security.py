import json
import time

import jwt as pyjwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from jwt.algorithms import ECAlgorithm

from app.core import security

SECRET = "test-secret-at-least-32-chars-long!!"


def make_token(sub: str, secret: str = SECRET, exp_offset: int = 3600, aud: str | None = "authenticated") -> str:
    payload = {"sub": sub, "email": "test@test.com", "exp": int(time.time()) + exp_offset}
    if aud is not None:
        payload["aud"] = aud
    return pyjwt.encode(payload, secret, algorithm="HS256")


@pytest.fixture(autouse=True)
def _jwt_secret(monkeypatch):
    monkeypatch.setattr(security.settings, "supabase_jwt_secret", SECRET)


async def test_valid_token_returns_payload():
    token = make_token("user-123")
    payload = await security._verify_jwt(token)
    assert payload["sub"] == "user-123"


async def test_expired_token_raises():
    token = make_token("user-123", exp_offset=-120)
    with pytest.raises(ValueError, match="expired"):
        await security._verify_jwt(token)


async def test_wrong_secret_raises():
    token = make_token("user-123", secret="wrong-secret-padding-padding-!!!")
    with pytest.raises(ValueError):
        await security._verify_jwt(token)


async def test_missing_audience_raises():
    token = make_token("user-123", aud=None)
    with pytest.raises(ValueError):
        await security._verify_jwt(token)


async def test_es256_token_verified_via_jwks(monkeypatch, httpx_mock):
    """Newer Supabase projects sign tokens with ES256 (asymmetric signing
    keys) instead of the legacy HS256 secret — these must be verified
    against Supabase's published JWKS, not the SUPABASE_JWT_SECRET."""
    monkeypatch.setattr(security, "_jwks_cache", None)
    monkeypatch.setattr(security.settings, "supabase_url", "https://fake-project.supabase.co")

    private_key = ec.generate_private_key(ec.SECP256R1())
    public_jwk = {
        **json.loads(ECAlgorithm(ECAlgorithm.SHA256).to_jwk(private_key.public_key())),
        "kid": "test-kid-1",
    }

    httpx_mock.add_response(
        url="https://fake-project.supabase.co/auth/v1/.well-known/jwks.json",
        json={"keys": [public_jwk]},
    )

    token = pyjwt.encode(
        {"sub": "user-es256", "aud": "authenticated", "exp": int(time.time()) + 3600},
        private_key,
        algorithm="ES256",
        headers={"kid": "test-kid-1"},
    )

    payload = await security._verify_jwt(token)
    assert payload["sub"] == "user-es256"
