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
