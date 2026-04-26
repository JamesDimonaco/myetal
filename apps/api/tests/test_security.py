import uuid
from datetime import timedelta

import pytest

from ceteris_api.core.security import (
    TokenError,
    create_access_token,
    decode_access_token,
    generate_refresh_token,
    generate_short_code,
    hash_password,
    hash_refresh_token,
    verify_password,
)


def test_password_round_trip() -> None:
    h = hash_password("hunter2")
    assert verify_password("hunter2", h) is True
    assert verify_password("wrong", h) is False


def test_password_hashes_are_unique() -> None:
    assert hash_password("hunter2") != hash_password("hunter2")  # salted


def test_access_token_round_trip() -> None:
    user_id = uuid.uuid4()
    token = create_access_token(user_id)
    assert decode_access_token(token) == user_id


def test_access_token_rejects_tampered() -> None:
    token = create_access_token(uuid.uuid4())
    with pytest.raises(TokenError):
        decode_access_token(token + "x")


def test_access_token_rejects_expired() -> None:
    token = create_access_token(uuid.uuid4(), expires_in=timedelta(seconds=-1))
    with pytest.raises(TokenError):
        decode_access_token(token)


def test_refresh_token_hash_is_deterministic() -> None:
    raw, digest = generate_refresh_token()
    assert hash_refresh_token(raw) == digest
    assert len(digest) == 64  # sha256 hex


def test_refresh_tokens_are_unique() -> None:
    a, _ = generate_refresh_token()
    b, _ = generate_refresh_token()
    assert a != b


def test_short_code_format() -> None:
    code = generate_short_code()
    assert len(code) == 6
    assert "0" not in code and "O" not in code  # no confusable glyphs
    assert "1" not in code and "l" not in code and "I" not in code
