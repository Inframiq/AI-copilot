import pytest
import time
import jwt as pyjwt
from jose import jwk, jwt as jose_jwt
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization
from app.core import security
from app.core.security import verify_supabase_jwt

SECRET = "test-secret-at-least-32-chars-long!!"

def make_token(sub: str, secret: str = SECRET, exp_offset: int = 3600) -> str:
    payload = {"sub": sub, "email": "test@test.com", "exp": int(time.time()) + exp_offset}
    return pyjwt.encode(payload, secret, algorithm="HS256")

def test_valid_token_returns_payload():
    token = make_token("user-123")
    payload = verify_supabase_jwt(token, secret=SECRET)
    assert payload["sub"] == "user-123"

def test_expired_token_raises():
    token = make_token("user-123", exp_offset=-10)
    with pytest.raises(Exception, match="expired"):
        verify_supabase_jwt(token, secret=SECRET)

def test_wrong_secret_raises():
    token = make_token("user-123", secret="wrong-secret-padding-padding-!!!")
    with pytest.raises(Exception):
        verify_supabase_jwt(token, secret=SECRET)


def test_es256_token_verified_via_jwks(monkeypatch, httpx_mock):
    """Newer Supabase projects sign tokens with ES256 (asymmetric signing
    keys) instead of the legacy HS256 secret — these must be verified
    against Supabase's published JWKS, not the SUPABASE_JWT_SECRET."""
    monkeypatch.setattr(security, "_jwks_cache", None)
    monkeypatch.setattr(security.settings, "supabase_url", "https://fake-project.supabase.co")

    private_key = ec.generate_private_key(ec.SECP256R1())
    public_jwk = jwk.construct(
        private_key.public_key(), algorithm="ES256"
    ).to_dict()
    public_jwk["kid"] = "test-kid-1"

    httpx_mock.add_response(
        url="https://fake-project.supabase.co/auth/v1/.well-known/jwks.json",
        json={"keys": [public_jwk]},
    )

    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    token = jose_jwt.encode(
        {"sub": "user-es256", "exp": int(time.time()) + 3600},
        private_pem,
        algorithm="ES256",
        headers={"kid": "test-kid-1"},
    )

    payload = verify_supabase_jwt(token)
    assert payload["sub"] == "user-es256"
