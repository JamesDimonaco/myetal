import re
import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, field_validator

# ORCID iDs are 16 digits in 4 groups of 4 separated by hyphens; the final
# character is a MOD-11-2 checksum that may be ``X`` for value 10.  See
# https://info.orcid.org/ufaqs/what-is-an-orcid-id/ for the spec.
_ORCID_ID_RE = re.compile(r"^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$")


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str | None
    email: str | None
    # Soft email verification (Phase 4 mobile banner): exposed so the
    # mobile and web UIs can render an unverified-email reminder without
    # a second round-trip to Better Auth's session endpoint. Backed by
    # Better Auth's ``emailVerified`` core field on the ``users`` table.
    email_verified: bool
    is_admin: bool
    avatar_url: str | None
    orcid_id: str | None
    last_orcid_sync_at: datetime | None
    created_at: datetime


class UpdateMeRequest(BaseModel):
    """Partial profile update. Fields not supplied are left unchanged.

    ``orcid_id`` accepts ``null`` or an empty string to clear, or a valid
    ORCID iD string to set/replace. Format validation rejects malformed
    input before the route checks DB uniqueness.
    """

    orcid_id: str | None = None

    @field_validator("orcid_id", mode="before")
    @classmethod
    def _normalize_orcid_id(cls, value: Any) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("orcid_id must be a string or null")
        cleaned = value.strip().upper()
        if cleaned == "":
            return None
        if not _ORCID_ID_RE.match(cleaned):
            raise ValueError("orcid_id must match 0000-0000-0000-000X (16 digits, last may be X)")
        return cleaned
