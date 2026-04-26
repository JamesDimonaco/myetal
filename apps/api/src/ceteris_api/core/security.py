import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from ceteris_api.core.config import settings

ACCESS_TOKEN_TTL = timedelta(minutes=15)
REFRESH_TOKEN_TTL = timedelta(days=30)
JWT_ALGORITHM = "HS256"

_password_hasher = PasswordHasher()


# ---------- passwords ----------


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        _password_hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False
    return True


# ---------- access tokens (JWT) ----------


class TokenError(Exception):
    pass


def create_access_token(user_id: uuid.UUID, expires_in: timedelta = ACCESS_TOKEN_TTL) -> str:
    now = datetime.now(UTC)
    payload: dict[str, str | int] = {
        "sub": str(user_id),
        "iat": int(now.timestamp()),
        "exp": int((now + expires_in).timestamp()),
        "type": "access",
    }
    return jwt.encode(
        payload,
        settings.secret_key.get_secret_value(),
        algorithm=JWT_ALGORITHM,
    )


def decode_access_token(token: str) -> uuid.UUID:
    try:
        payload = jwt.decode(
            token,
            settings.secret_key.get_secret_value(),
            algorithms=[JWT_ALGORITHM],
        )
    except jwt.PyJWTError as exc:
        raise TokenError(f"invalid token: {exc}") from exc
    if payload.get("type") != "access":
        raise TokenError("not an access token")
    sub = payload.get("sub")
    if not isinstance(sub, str):
        raise TokenError("missing sub")
    try:
        return uuid.UUID(sub)
    except ValueError as exc:
        raise TokenError("malformed sub") from exc


# ---------- refresh tokens (opaque, hashed at rest) ----------


def generate_refresh_token() -> tuple[str, str]:
    """Generate a fresh opaque refresh token.

    Returns (raw_token_to_send_to_client, sha256_hash_to_store_in_db).
    """
    raw = secrets.token_urlsafe(48)
    return raw, hash_refresh_token(raw)


def hash_refresh_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def refresh_token_expiry() -> datetime:
    return datetime.now(UTC) + REFRESH_TOKEN_TTL


# ---------- short codes (for shares) ----------

_SHORT_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"


def generate_short_code(length: int = 6) -> str:
    """URL-safe short code with no easily-confused glyphs (no 0/O/1/l/I)."""
    return "".join(secrets.choice(_SHORT_CODE_ALPHABET) for _ in range(length))


# ---------- placeholder type alias for callers ----------

TokenType = Literal["access", "refresh"]
