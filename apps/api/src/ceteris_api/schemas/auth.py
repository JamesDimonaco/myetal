import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: str | None = Field(default=None, max_length=120)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class SessionResponse(BaseModel):
    """Public-safe view of a refresh-token row. Never exposes `token_hash`."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    issued_at: datetime
    expires_at: datetime
    revoked: bool
