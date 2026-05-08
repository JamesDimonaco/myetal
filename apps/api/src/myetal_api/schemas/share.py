import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from myetal_api.models import ItemKind, ShareType

# ---------- tags ----------


class TagOut(BaseModel):
    """A tag as returned by autocomplete / popular endpoints and embedded
    on share responses. Per feedback-round-2 §2."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    slug: str
    label: str
    usage_count: int


class ShareItemCreate(BaseModel):
    """Item payload accepted by the bulk ``ShareCreate`` / ``ShareUpdate``
    routes. PDF items are NOT acceptable here — the only path that
    creates ``kind == ItemKind.PDF`` rows is ``POST /shares/{id}/items/
    record-pdf-upload``, which writes the four PDF-only columns
    server-side after validating the R2 upload (per K1 fix-up). Forging
    a PDF item via PATCH was the exploit; rejecting ``kind=pdf`` here
    closes it. The PDF-only fields (``file_url`` etc.) are intentionally
    absent from this schema — clients couldn't populate them anyway, and
    omitting them from input prevents trust on inbound PATCH bodies.

    For the editor round-trip case (existing PDF items already attached
    to a share that the editor PATCHes by re-sending all items), the
    service layer merges server-known PDF rows into the new items array
    by id — see ``share_service.update_share``.
    """

    # Optional id used by the editor to round-trip PDF items on PATCH.
    # When the client includes an ``id`` matching an existing PDF row,
    # the service preserves the row (and its server-managed PDF fields)
    # rather than re-creating it. None for newly-added items (the
    # default).
    id: uuid.UUID | None = None
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

    @model_validator(mode="after")
    def _reject_pdf_kind(self) -> "ShareItemCreate":
        # K1 (PR-C fix-up): PDF items must be created via the dedicated
        # record-pdf-upload route which validates the R2 upload, sniffs
        # the magic bytes, and writes the file_url server-side. Letting
        # a client claim ``kind=pdf`` in a bulk create/update body would
        # let them forge an item pointing at any URL.
        if self.kind == ItemKind.PDF:
            raise ValueError("PDF items must be created via /shares/{id}/items/record-pdf-upload")
        return self


class ShareCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    type: ShareType = ShareType.PAPER
    is_public: bool = True
    items: list[ShareItemCreate] = Field(default_factory=list)
    # Optional tag slugs. Slugs are canonicalised + auto-created server-side
    # (Q9-C hybrid: free-form allowed, owner doesn't need to pre-register).
    # Cap of 5 enforced in the service (Q10). None = leave unset; [] = no tags.
    tags: list[str] | None = Field(default=None, max_length=5)


class ShareUpdate(BaseModel):
    """All fields optional; items=None leaves items alone, items=[] clears them."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    type: ShareType | None = None
    is_public: bool | None = None
    items: list[ShareItemCreate] | None = None
    # Tag slugs. None = leave existing tags alone; [] = clear all tags;
    # [slugs...] = atomically replace the share's tag set with these
    # (creating any missing tags on the fly). Cap of 5 enforced in
    # service layer (Q10).
    tags: list[str] | None = Field(default=None, max_length=5)


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
    # PDF-only fields (feedback-round-2 §1, PR-C). Always serialised so
    # the public viewer can render a thumbnail card + download button
    # for ``kind == 'pdf'`` items (Q5-B). Null for every other kind.
    file_url: str | None = None
    file_size_bytes: int | None = None
    file_mime: str | None = None
    thumbnail_url: str | None = None


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
    tags: list[TagOut] = Field(default_factory=list)


class RelatedShareOut(BaseModel):
    """A share that has at least one paper in common with the viewed share."""

    short_code: str
    name: str
    papers_in_common: int


class SimilarShareOut(BaseModel):
    """A precomputed similar share (from the nightly `share_similar` cron)."""

    short_code: str
    name: str
    papers_in_common: int


class PublicShareResponse(BaseModel):
    """What an anonymous QR-scan resolves to. Strips owner_id and audit fields."""

    short_code: str
    name: str
    description: str | None
    type: ShareType
    items: list[ShareItemResponse]
    owner_name: str | None
    updated_at: datetime
    related_shares: list[RelatedShareOut] = Field(default_factory=list)
    similar_shares: list[SimilarShareOut] = Field(default_factory=list)
    tags: list[TagOut] = Field(default_factory=list)


class ShareSearchResult(BaseModel):
    """A single hit from public share search."""

    short_code: str
    name: str
    description: str | None
    type: ShareType
    owner_name: str | None
    item_count: int
    published_at: datetime
    updated_at: datetime
    preview_items: list[str]  # first 3 item titles
    tags: list[TagOut] = Field(default_factory=list)


class UserPublicOut(BaseModel):
    """Public-safe view of a user, used by:

    * ``/public/browse?owner_id=...`` (owner card on the response when the
      caller filters by owner — Q15-C punts ``/u/{handle}`` profile pages
      and routes owner-name links to ``/browse?owner_id=...`` instead).
    * ``/public/search`` user-search block (per feedback-round-2 §5).

    ``share_count`` is the number of currently-published, public,
    non-tombstoned shares — matches the privacy filter on user search
    (a user with zero published shares is never surfaced via search).
    """

    id: uuid.UUID
    name: str | None
    avatar_url: str | None
    share_count: int


# Alias for the user-search block — the shape is identical to
# ``UserPublicOut`` but the name documents intent at the call site.
UserSearchResult = UserPublicOut


class ShareSearchResponse(BaseModel):
    results: list[ShareSearchResult]
    has_more: bool
    # Per feedback-round-2 §5 (PR-B): user-search block. Only users with
    # at least one published share appear here (privacy default). Capped
    # at 5 best matches.
    users: list[UserSearchResult] = Field(default_factory=list)


class BrowseShareResult(BaseModel):
    """A single collection card on the browse page."""

    short_code: str
    name: str
    description: str | None
    type: ShareType
    owner_name: str | None
    item_count: int
    published_at: datetime
    updated_at: datetime
    preview_items: list[str]  # first 3 item titles
    view_count: int | None = None  # only populated for trending results
    tags: list[TagOut] = Field(default_factory=list)


class BrowseResponse(BaseModel):
    trending: list[BrowseShareResult]
    recent: list[BrowseShareResult]
    total_published: int
    # Populated only when the caller passed ``?owner_id=...`` (PR-B / Q15-C).
    # The frontend uses this to render an "owner card" header on the browse
    # page so the empty-state copy can still say "Alice has no published
    # shares yet" rather than just "no results".
    owner: UserPublicOut | None = None


class DailyViewCount(BaseModel):
    date: str
    count: int


class ShareAnalyticsResponse(BaseModel):
    """Owner-facing analytics for a single share (D10)."""

    total_views: int
    views_last_7d: int
    views_last_30d: int
    daily_views: list[DailyViewCount]


# ---------- PDF upload (PR-C) ----------


class PdfUploadUrlRequest(BaseModel):
    """Body for ``POST /shares/{id}/items/upload-url`` — the client tells
    us what they're about to upload, we return a presigned POST policy
    targeting R2 with a baked-in size cap. Per feedback-round-2 §1.

    The server treats ``mime_type`` and ``size_bytes`` as *claims* —
    the authoritative checks are R2's ``content-length-range`` at
    upload time and the first-8-byte ``%PDF-`` sniff on record. We
    still fail-fast here so the client gets a synchronous 4xx for
    obvious cases (e.g. 30 MB cap exceeded before any bytes leave the
    device).
    """

    filename: str = Field(min_length=1, max_length=255)
    mime_type: str = Field(min_length=1, max_length=128)
    size_bytes: int = Field(ge=1)


class PdfUploadUrlResponse(BaseModel):
    """Presigned POST policy returned to the client. The client posts a
    ``multipart/form-data`` body to ``upload_url`` containing every
    key/value in ``fields`` plus a final ``file`` part with the PDF
    bytes. ``file_key`` is what the client sends to the record-upload
    route once R2 returns 204."""

    upload_url: str
    fields: dict[str, str]
    file_key: str
    expires_at: datetime


class RecordPdfUploadRequest(BaseModel):
    """Body for ``POST /shares/{id}/items/record-pdf-upload`` after the
    client has finished the direct-to-R2 upload. ``copyright_ack`` must
    be literally ``True`` (Q6 — single-line legal-ish acknowledgement
    gating the upload). The exact disclaimer string the frontend
    surfaces is *"I have the right to make this file public."* — that
    copy lives on the frontend; we just enforce the boolean."""

    file_key: str = Field(min_length=1, max_length=512)
    copyright_ack: Literal[True]
    title: str = Field(min_length=1, max_length=500)
