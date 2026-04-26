import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from ceteris_api.models import ShareType


class ShareItemCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    scholar_url: str | None = Field(default=None, max_length=2000)
    doi: str | None = Field(default=None, max_length=255)
    authors: str | None = None
    year: int | None = Field(default=None, ge=1500, le=2200)
    notes: str | None = None


class ShareCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    type: ShareType = ShareType.PAPER
    is_public: bool = True
    items: list[ShareItemCreate] = Field(default_factory=list)


class ShareUpdate(BaseModel):
    """All fields optional; items=None leaves items alone, items=[] clears them."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    type: ShareType | None = None
    is_public: bool | None = None
    items: list[ShareItemCreate] | None = None


class ShareItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    position: int
    title: str
    scholar_url: str | None
    doi: str | None
    authors: str | None
    year: int | None
    notes: str | None


class ShareResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    short_code: str
    name: str
    description: str | None
    type: ShareType
    is_public: bool
    created_at: datetime
    updated_at: datetime
    items: list[ShareItemResponse]


class PublicShareResponse(BaseModel):
    """What an anonymous QR-scan resolves to. Strips owner_id and audit fields."""

    short_code: str
    name: str
    description: str | None
    type: ShareType
    items: list[ShareItemResponse]
    owner_name: str | None
    updated_at: datetime
