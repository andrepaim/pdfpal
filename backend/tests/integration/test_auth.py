"""Integration tests for auth.py JWT helpers."""

import time
from auth import create_session_token, verify_session_token, SESSION_SECRET
from jose import jwt


def test_create_session_token_returns_string():
    token = create_session_token({"email": "test@example.com", "name": "Test"})
    assert isinstance(token, str)
    assert len(token) > 10


def test_verify_session_token_roundtrip():
    user = {"email": "test@example.com", "name": "Test User", "picture": "http://pic.url"}
    token = create_session_token(user)
    decoded = verify_session_token(token)
    assert decoded is not None
    assert decoded["email"] == "test@example.com"
    assert decoded["name"] == "Test User"
    assert decoded["picture"] == "http://pic.url"


def test_verify_session_token_contains_exp():
    token = create_session_token({"email": "a@b.com"})
    decoded = verify_session_token(token)
    assert "exp" in decoded
    assert decoded["exp"] > time.time()


def test_verify_session_token_expired():
    payload = {
        "email": "expired@example.com",
        "name": "",
        "picture": "",
        "exp": int(time.time()) - 100,  # already expired
    }
    token = jwt.encode(payload, SESSION_SECRET, algorithm="HS256")
    result = verify_session_token(token)
    assert result is None


def test_verify_session_token_invalid():
    result = verify_session_token("not.a.valid.token")
    assert result is None


def test_verify_session_token_wrong_secret():
    payload = {
        "email": "wrong@example.com",
        "exp": int(time.time()) + 3600,
    }
    token = jwt.encode(payload, "wrong-secret-key", algorithm="HS256")
    result = verify_session_token(token)
    assert result is None
