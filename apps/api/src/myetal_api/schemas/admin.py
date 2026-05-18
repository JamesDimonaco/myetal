"""Pydantic schemas for the admin dashboard (`/admin/*`).

Stages 1 (overview) and 2 (user management) per
`docs/tickets/to-do/admin-analytics-dashboard.md`. Stage 3+ schemas
live alongside the routes that ship them.

Naming: snake_case wire (FastAPI default, see ``apps/web/AGENTS.md``)
so the web/mobile types mirror these field-for-field.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

# ---- Overview (Stage 1) -----------------------------------------------------


class OverviewCounters(BaseModel):
    total_users: int
    new_users_7d: int
    new_users_30d: int
    total_published_shares: int
    total_draft_shares: int
    total_items: int
    views_7d: int
    views_30d: int


class DailyBucket(BaseModel):
    date: str  # ISO date YYYY-MM-DD
    count: int


class OverviewGrowth(BaseModel):
    daily_signups_30d: list[DailyBucket]
    daily_share_creates_30d: list[DailyBucket]


class TopOwner(BaseModel):
    user_id: uuid.UUID
    email: str | None
    name: str | None
    share_count: int


class TopShare(BaseModel):
    share_id: uuid.UUID
    short_code: str
    name: str
    view_count_30d: int


class TopTag(BaseModel):
    slug: str
    label: str
    usage_count: int


class OverviewTopLists(BaseModel):
    owners_by_shares: list[TopOwner]
    shares_by_views_30d: list[TopShare]
    tags_by_usage: list[TopTag]


class RecentSignup(BaseModel):
    user_id: uuid.UUID
    email: str | None
    name: str | None
    avatar_url: str | None
    created_at: datetime


class RecentFeedback(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID | None
    type: str
    title: str
    description_preview: str
    created_at: datetime


class RecentReport(BaseModel):
    report_id: uuid.UUID
    share_id: uuid.UUID
    share_short_code: str
    share_name: str
    reason: str
    status: str
    created_at: datetime


class OverviewRecent(BaseModel):
    signups: list[RecentSignup]
    feedback: list[RecentFeedback]
    reports: list[RecentReport]


class TableSize(BaseModel):
    table: str
    bytes: int | None


class OverviewStorage(BaseModel):
    r2_pdf_count: int
    r2_pdf_bytes: int
    table_sizes: list[TableSize]
    trending_last_run_at: datetime | None
    similar_last_run_at: datetime | None
    orcid_sync_last_run_at: datetime | None


class OverviewResponse(BaseModel):
    counters: OverviewCounters
    growth: OverviewGrowth
    top_lists: OverviewTopLists
    recent: OverviewRecent
    storage: OverviewStorage
    generated_at: datetime


# ---- Users list + detail (Stage 2) -----------------------------------------


class AdminUserListItem(BaseModel):
    """Row shape for the `/admin/users` table."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str | None
    name: str | None
    avatar_url: str | None
    orcid_id: str | None
    is_admin: bool
    email_verified: bool
    created_at: datetime
    deleted_at: datetime | None
    share_count: int
    last_seen_at: datetime | None
    # CSV of provider ids (account.provider_id values) so the row can render
    # provider icons without a per-row JOIN — collapsed server-side.
    providers: list[str]


class AdminUserListResponse(BaseModel):
    items: list[AdminUserListItem]
    # Cursor of the LAST item in the page (created_at iso + id). Pass back as
    # ``cursor=...`` to fetch the next page. ``None`` when there are no more.
    next_cursor: str | None
    total: int


# Filter chips applied via `filter=` query param.
AdminUserFilter = Literal[
    "all",
    "has_orcid",
    "has_shares",
    "admin",
    "email_verified",
    "deleted",
]
AdminUserSort = Literal["created_desc", "created_asc", "last_seen_desc"]


class AdminActivityEvent(BaseModel):
    """One row in the user's activity tab.

    `kind` discriminates: signup | sign_in | share_create | share_publish |
    feedback_submit | report_submit | item_add. Use the discriminator to
    pick an icon on the client.
    """

    kind: str
    at: datetime
    detail: str | None = None
    # When the event has a destination link target on the admin UI:
    link: str | None = None


class AdminAuditEntry(BaseModel):
    id: uuid.UUID
    action: str
    admin_user_id: uuid.UUID
    admin_email: str | None
    target_user_id: uuid.UUID | None
    target_share_id: uuid.UUID | None
    details: dict[str, Any] | None
    created_at: datetime


class AdminUserShare(BaseModel):
    id: uuid.UUID
    short_code: str
    name: str
    is_public: bool
    published_at: datetime | None
    deleted_at: datetime | None
    created_at: datetime
    item_count: int


class AdminUserDetail(BaseModel):
    id: uuid.UUID
    email: str | None
    email_verified: bool
    name: str | None
    avatar_url: str | None
    orcid_id: str | None
    is_admin: bool
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None

    # Sidebar facts
    last_seen_at: datetime | None
    last_sign_in_ip: str | None
    session_count: int
    providers: list[str]  # account.provider_id list
    library_paper_count: int
    last_orcid_sync_at: datetime | None

    # Tabs
    shares: list[AdminUserShare]
    activity: list[AdminActivityEvent]
    audit: list[AdminAuditEntry]


class AdminActionResponse(BaseModel):
    """Generic envelope returned by write actions.

    Carries the audit-row id + a one-line human message the UI can drop
    into a sonner toast.
    """

    ok: bool = True
    audit_id: uuid.UUID
    message: str


class AdminToggleAdminQuery(BaseModel):
    value: bool = Field(..., description="The new is_admin value.")


class SimpleErrorResponse(BaseModel):
    detail: str


# ---- Shares list + detail (Stage 3) ----------------------------------------


class AdminShareListItem(BaseModel):
    """Row shape for the `/admin/shares` table.

    Wire shape is snake_case (FastAPI default) per ``apps/web/AGENTS.md``.
    `owner_email` etc. are denormalised at query time so the table doesn't
    JOIN twice for every row.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    short_code: str
    name: str
    type: str
    owner_user_id: uuid.UUID
    owner_email: str | None
    owner_name: str | None
    is_public: bool
    published_at: datetime | None
    deleted_at: datetime | None
    created_at: datetime
    item_count: int
    view_count_30d: int
    tag_slugs: list[str]


class AdminShareListResponse(BaseModel):
    items: list[AdminShareListItem]
    next_cursor: str | None
    total: int


# Filter chips applied via `filter=` query param.
AdminShareFilter = Literal[
    "all",
    "published",
    "draft",
    "tombstoned",
]
AdminShareSort = Literal["created_desc", "created_asc", "views_30d_desc"]
AdminShareAgeBucket = Literal["all", "7d", "30d", "90d", "older"]


class AdminShareItemOut(BaseModel):
    """Single item row inside a share, for admin detail.

    Surfaces fields that are admin-only (file_url for PDFs is the
    R2 link the admin needs to inspect a takedown target).
    """

    id: uuid.UUID
    kind: str
    title: str
    subtitle: str | None
    url: str | None
    doi: str | None
    authors: str | None
    year: int | None
    notes: str | None
    file_url: str | None
    file_size_bytes: int | None
    file_mime: str | None
    thumbnail_url: str | None
    copyright_ack_at: datetime | None


class AdminShareReport(BaseModel):
    id: uuid.UUID
    reporter_user_id: uuid.UUID | None
    reason: str
    details: str | None
    status: str
    created_at: datetime
    actioned_at: datetime | None
    actioned_by: uuid.UUID | None


class AdminSimilarShareSnapshot(BaseModel):
    similar_share_id: uuid.UUID
    short_code: str
    name: str
    papers_in_common: int
    refreshed_at: datetime


class AdminShareTag(BaseModel):
    slug: str
    label: str


class AdminShareDetail(BaseModel):
    id: uuid.UUID
    short_code: str
    name: str
    description: str | None
    type: str
    is_public: bool
    published_at: datetime | None
    deleted_at: datetime | None
    created_at: datetime
    updated_at: datetime
    owner_user_id: uuid.UUID
    owner_email: str | None
    owner_name: str | None
    item_count: int
    view_count_total: int
    view_count_7d: int
    view_count_30d: int

    items: list[AdminShareItemOut]
    tags: list[AdminShareTag]
    daily_views_90d: list[DailyBucket]
    reports: list[AdminShareReport]
    similar_snapshot: list[AdminSimilarShareSnapshot]
    audit: list[AdminAuditEntry]


class TombstoneRequest(BaseModel):
    """Body for `/admin/shares/{id}/tombstone` — reason is REQUIRED.

    Min length keeps the audit trail useful; a one-character "x" reason
    isn't an audit, it's noise. Max length keeps the JSONB column from
    accumulating multi-page rants — admins can always link to a
    separate ticket if the rationale needs more space.
    """

    reason: str = Field(..., min_length=3, max_length=500)


# ---- System metrics (Stage 4) ----------------------------------------------


class SystemRouteMetric(BaseModel):
    """Aggregated request-rate / error-rate for a single route prefix.

    Bucketed by ``RequestMetricsMiddleware`` per-minute and rolled up to
    24h windows for the dashboard read. ``error_count`` covers all 5xx;
    4xx is excluded since those are usually client error and would
    drown the signal.
    """

    route_prefix: str
    request_count: int
    error_count: int
    p_error: float  # error_count / max(1, request_count)


class SystemScriptRun(BaseModel):
    """Last-run summary for a cron-driven script.

    ``next_run_schedule`` is a free-form human-readable hint (e.g.
    "nightly 03:00 UTC") because the schedules live in the deployment
    crontab rather than the DB. Admins read this to confirm "yes the
    cron ran last night," not to drive scheduling decisions from the UI.
    """

    name: str
    last_run_at: datetime | None
    duration_ms: int | None
    row_count: int | None
    next_run_schedule: str
    last_status: str | None  # "ok" | "failed" | None


class SystemDbPool(BaseModel):
    in_use: int
    size: int
    overflow: int
    slow_query_count_1h: int | None  # None when not instrumented


class SystemR2Prefix(BaseModel):
    prefix: str
    object_count: int
    bytes: int


class SystemR2Storage(BaseModel):
    total_objects: int
    total_bytes: int
    by_prefix: list[SystemR2Prefix]
    fetched_at: datetime  # last LIST call
    cached: bool


class SystemAuthProvider(BaseModel):
    provider: str
    attempts_24h: int
    completions_24h: int


class SystemAuthHealth(BaseModel):
    providers: list[SystemAuthProvider]
    placeholder: bool  # true = data not wired yet, render placeholder card
    note: str | None


class SystemMetricsResponse(BaseModel):
    routes_24h: list[SystemRouteMetric]
    scripts: list[SystemScriptRun]
    db_pool: SystemDbPool
    r2: SystemR2Storage
    auth: SystemAuthHealth
    generated_at: datetime
