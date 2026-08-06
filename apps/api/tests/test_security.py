import pytest
import time
import jwt as pyjwt
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
