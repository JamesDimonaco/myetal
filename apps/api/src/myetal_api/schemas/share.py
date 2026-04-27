import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from myetal_api.models import ItemKind, ShareType


class ShareItemCreate(BaseModel):
    kind: ItemKind = ItemKind.PAPER
    title: str = Field(min_length=1, max_length=500)
    subtitle: str | None = Field(default=None, max_length=500)
    url: str | None = Field(default=None, max_length=2000)
    image_url: str | None = Field(default=None, max_length=2000)
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
    kind: ItemKind
    title: str
    subtitle: str | None
    url: str | None
    image_url: str | None
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
    # Discovery opt-in (D1). NULL = link-shareable but not in discovery surfaces;
    # non-null = the timestamp at which the owner published it.
    published_at: datetime | None
    # Tombstone marker (D14). Owner endpoints expose this so the UI can
    # render a "this share is deleted" banner; public endpoints filter on
    # deleted_at IS NULL and never return tombstoned rows.
    deleted_at: datetime | None
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


class DailyViewCount(BaseModel):
    date: str
    count: int


class ShareAnalyticsResponse(BaseModel):
    """Owner-facing analytics for a single share (D10)."""

    total_views: int
    views_last_7d: int
    views_last_30d: int
    daily_views: list[DailyViewCount]
