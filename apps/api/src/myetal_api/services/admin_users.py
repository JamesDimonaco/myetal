"""Stage 2 admin user-management read + action services.

Per `docs/tickets/to-do/admin-analytics-dashboard.md` Stage 2.

The list endpoint is search + paginate + filter (chips) + sort. The
detail endpoint surfaces tabs (Shares / Library / Activity / Audit) +
sidebar facts. Both are read-only — the write actions live in
`api/routes/admin_users.py` and call this module's lookup helpers
before mutating.

Cursor design: ``"<created_at_iso>|<uuid>"`` for stable descending
order on (created_at, id). The trailing id breaks ties between rows
that share a millisecond, which can happen when the test fixture or a
data-import script inserts in batch. ``base64`` would obscure the
shape without buying anything; we keep it human-debuggable.
"""

from __future__ import annotations

import base64
import binascii
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from myetal_api.models import (
    Account,
    AdminAudit,
    Feedback,
    OrcidSyncRun,
    Session,
    Share,
    ShareItem,
    ShareReport,
    ShareView,
    User,
    UserPaper,
)

PAGE_SIZE = 50


# ---- Cursor encoding --------------------------------------------------------


def _encode_cursor(created_at: datetime, user_id: uuid.UUID) -> str:
    """Encode (created_at, id) into an opaque pagination cursor.

    Stored as ``"<iso_no_micros>|<uuid>"`` then base64'd. We drop the
    microseconds explicitly so the cursor round-trip is stable across
    dialects — Postgres TIMESTAMPTZ keeps microseconds in the row but the
    SQLite test dialect doesn't, and a mismatched microsecond on the
    anchor confuses the lex-comparison fallback path SQLite uses for
    TIMESTAMP-typed columns.
    """
    truncated = created_at.replace(microsecond=0)
    raw = f"{truncated.isoformat()}|{user_id}"
    return base64.urlsafe_b64encode(raw.encode()).rstrip(b"=").decode()


def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID] | None:
    try:
        padding = "=" * (-len(cursor) % 4)
        raw = base64.urlsafe_b64decode(cursor + padding).decode()
        iso, sep, uid = raw.partition("|")
        if not sep:
            return None
        return datetime.fromisoformat(iso), uuid.UUID(uid)
    except (binascii.Error, ValueError, UnicodeDecodeError):
        return None


# ---- List endpoint ----------------------------------------------------------


async def list_users(
    db: AsyncSession,
    *,
    q: str | None = None,
    filter_: str = "all",
    cursor: str | None = None,
    sort: str = "created_desc",
    limit: int = PAGE_SIZE,
) -> dict[str, Any]:
    """Search/filter/paginate the user list."""
    # `share_count` aggregate computed via a correlated subquery so
    # rows with zero shares still appear (LEFT JOIN+GROUP BY would
    # also work but reads heavier on PG's planner for large tables).
    share_count_sub = (
        select(func.count(Share.id))
        .where(
            Share.owner_user_id == User.id,
            Share.deleted_at.is_(None),
        )
        .correlate(User)
        .scalar_subquery()
    )
    last_seen_sub = (
        select(func.max(Session.updated_at))
        .where(Session.user_id == User.id)
        .correlate(User)
        .scalar_subquery()
    )

    stmt = select(
        User,
        share_count_sub.label("share_count"),
        last_seen_sub.label("last_seen_at"),
    )

    # ---- search ----
    if q:
        term = q.strip()
        like = f"{term.lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(User.email).like(like),
                func.lower(User.name).like(like),
                func.lower(User.orcid_id).like(like),
            )
        )

    # ---- filter chips ----
    if filter_ == "has_orcid":
        stmt = stmt.where(User.orcid_id.is_not(None))
    elif filter_ == "has_shares":
        stmt = stmt.where(share_count_sub > 0)
    elif filter_ == "admin":
        stmt = stmt.where(User.is_admin.is_(True))
    elif filter_ == "email_verified":
        stmt = stmt.where(User.email_verified.is_(True))
    elif filter_ == "deleted":
        # The User model has no `deleted_at` column today; soft-delete adds it
        # in this stage. The migration adds a NULL-default column, so this
        # filter is a no-op until at least one user is soft-deleted.
        stmt = stmt.where(_has_deleted_at(User))

    # ---- cursor (descending by created_at, tie-broken by id) ----
    if cursor:
        decoded = _decode_cursor(cursor)
        if decoded is not None:
            anchor_dt, anchor_id = decoded
            # Strictly-less: keep moving forward through the dataset on each
            # page. (created_at, id) is the implicit ordering key.
            stmt = stmt.where(
                or_(
                    User.created_at < anchor_dt,
                    (User.created_at == anchor_dt) & (User.id < anchor_id),
                )
            )

    # ---- sort ----
    if sort == "created_asc":
        stmt = stmt.order_by(User.created_at.asc(), User.id.asc())
    elif sort == "last_seen_desc":
        # Nulls last — users who never signed in slip to the bottom.
        stmt = stmt.order_by(desc(last_seen_sub).nulls_last(), User.id.desc())
    else:
        stmt = stmt.order_by(User.created_at.desc(), User.id.desc())

    stmt = stmt.limit(limit + 1)

    rows = (await db.execute(stmt)).all()
    have_more = len(rows) > limit
    rows = rows[:limit]

    items: list[dict[str, Any]] = []
    for r in rows:
        user: User = r[0]
        share_count = int(r.share_count or 0)
        last_seen = r.last_seen_at
        # Provider names — collapsed in one query per user. The list pages
        # at 50, so 50 extra queries is acceptable; if it ever bites,
        # promote to a single subquery aggregation.
        providers = await _list_providers(db, user.id)
        items.append(
            {
                "id": user.id,
                "email": user.email,
                "name": user.name,
                "avatar_url": user.avatar_url or user.image,
                "orcid_id": user.orcid_id,
                "is_admin": user.is_admin,
                "email_verified": user.email_verified,
                "created_at": user.created_at,
                "deleted_at": _get_deleted_at(user),
                "share_count": share_count,
                "last_seen_at": last_seen,
                "providers": providers,
            }
        )

    next_cursor: str | None = None
    if have_more and items:
        last = items[-1]
        next_cursor = _encode_cursor(last["created_at"], last["id"])

    # Total — separate COUNT keeping the same filter set (without cursor),
    # so the UI can say "57 users."
    count_stmt = select(func.count()).select_from(User)
    if q:
        term = q.strip()
        like = f"{term.lower()}%"
        count_stmt = count_stmt.where(
            or_(
                func.lower(User.email).like(like),
                func.lower(User.name).like(like),
                func.lower(User.orcid_id).like(like),
            )
        )
    if filter_ == "has_orcid":
        count_stmt = count_stmt.where(User.orcid_id.is_not(None))
    elif filter_ == "admin":
        count_stmt = count_stmt.where(User.is_admin.is_(True))
    elif filter_ == "email_verified":
        count_stmt = count_stmt.where(User.email_verified.is_(True))
    # has_shares + deleted aren't reflected in total (the join would be
    # expensive); the page-level item count is sufficient for those.
    total = int(await db.scalar(count_stmt) or 0)

    return {"items": items, "next_cursor": next_cursor, "total": total}


async def _list_providers(db: AsyncSession, user_id: uuid.UUID) -> list[str]:
    rows = await db.scalars(
        select(Account.provider_id).where(Account.user_id == user_id)
    )
    return sorted({r for r in rows.all() if r})


def _has_deleted_at(model_cls: type[User]):
    """Helper that returns a SQL expression true if `users.deleted_at` exists.

    The Better Auth User model doesn't carry `deleted_at` in the base
    schema; we add it in this stage's migration. The model attribute may
    not exist at import time on a stale checkout — return ``False`` so
    the filter silently no-ops rather than 500ing.
    """
    return getattr(model_cls, "deleted_at", None) is not None and model_cls.deleted_at.is_not(None)


def _get_deleted_at(user: User) -> datetime | None:
    """Read `deleted_at` if the column exists, otherwise ``None``."""
    return getattr(user, "deleted_at", None)


# ---- Detail endpoint --------------------------------------------------------


async def get_user_detail(db: AsyncSession, user_id: uuid.UUID) -> dict[str, Any] | None:
    user = await db.get(User, user_id)
    if user is None:
        return None

    # Sidebar facts ---------------------------------------------------------
    providers = await _list_providers(db, user_id)

    sessions = (
        await db.execute(
            select(Session.updated_at, Session.ip_address)
            .where(Session.user_id == user_id)
            .order_by(Session.updated_at.desc())
        )
    ).all()
    session_count = len(sessions)
    last_seen_at = sessions[0].updated_at if sessions else None
    last_sign_in_ip = sessions[0].ip_address if sessions else None

    library_paper_count = int(
        await db.scalar(
            select(func.count())
            .select_from(UserPaper)
            .where(
                UserPaper.user_id == user_id,
                UserPaper.hidden_at.is_(None),
            )
        )
        or 0
    )

    # Tabs ------------------------------------------------------------------
    share_rows = (
        await db.execute(
            select(Share)
            .where(Share.owner_user_id == user_id)
            .order_by(Share.created_at.desc())
        )
    ).scalars().all()
    shares: list[dict[str, Any]] = []
    for s in share_rows:
        item_count = int(
            await db.scalar(
                select(func.count()).select_from(ShareItem).where(ShareItem.share_id == s.id)
            )
            or 0
        )
        shares.append(
            {
                "id": s.id,
                "short_code": s.short_code,
                "name": s.name,
                "is_public": s.is_public,
                "published_at": s.published_at,
                "deleted_at": s.deleted_at,
                "created_at": s.created_at,
                "item_count": item_count,
            }
        )

    activity = await _activity_timeline(db, user_id)

    audit_rows = (
        await db.execute(
            select(AdminAudit, User.email.label("admin_email"))
            .join(User, User.id == AdminAudit.admin_user_id)
            .where(AdminAudit.target_user_id == user_id)
            .order_by(AdminAudit.created_at.desc())
            .limit(50)
        )
    ).all()
    audit: list[dict[str, Any]] = []
    for row in audit_rows:
        a: AdminAudit = row[0]
        audit.append(
            {
                "id": a.id,
                "action": a.action,
                "admin_user_id": a.admin_user_id,
                "admin_email": row.admin_email,
                "target_user_id": a.target_user_id,
                "target_share_id": a.target_share_id,
                "details": a.details,
                "created_at": a.created_at,
            }
        )

    return {
        "id": user.id,
        "email": user.email,
        "email_verified": user.email_verified,
        "name": user.name,
        "avatar_url": user.avatar_url or user.image,
        "orcid_id": user.orcid_id,
        "is_admin": user.is_admin,
        "created_at": user.created_at,
        "updated_at": user.updated_at,
        "deleted_at": _get_deleted_at(user),
        "last_seen_at": last_seen_at,
        "last_sign_in_ip": last_sign_in_ip,
        "session_count": session_count,
        "providers": providers,
        "library_paper_count": library_paper_count,
        "last_orcid_sync_at": user.last_orcid_sync_at,
        "shares": shares,
        "activity": activity,
        "audit": audit,
    }


async def _activity_timeline(
    db: AsyncSession, user_id: uuid.UUID, limit: int = 50
) -> list[dict[str, Any]]:
    """Merge the user's recent events from several tables.

    Cheap because each leg is index-friendly + bounded:
    * signup (1 row from users.created_at)
    * sign-ins (Session.created_at top N)
    * share creates (Share.created_at top N)
    * share publishes (Share.published_at top N)
    * feedback (Feedback.created_at top N)
    * reports submitted (ShareReport.created_at top N where reporter=user)
    Stage 2's activity tab caps at 50 mixed; we pull 50 from each leg
    so the merge is comfortably oversized, then truncate.
    """
    user = await db.get(User, user_id)
    events: list[dict[str, Any]] = []

    if user is not None:
        events.append(
            {
                "kind": "signup",
                "at": user.created_at,
                "detail": "Account created",
                "link": None,
            }
        )

    # Sign-ins (session.created_at)
    sign_ins = (
        await db.execute(
            select(Session.created_at, Session.ip_address)
            .where(Session.user_id == user_id)
            .order_by(Session.created_at.desc())
            .limit(limit)
        )
    ).all()
    for s in sign_ins:
        events.append(
            {
                "kind": "sign_in",
                "at": s.created_at,
                "detail": f"Sign-in from {s.ip_address}" if s.ip_address else "Sign-in",
                "link": None,
            }
        )

    # Share creates + publishes
    shares = (
        await db.execute(
            select(Share)
            .where(Share.owner_user_id == user_id)
            .order_by(Share.created_at.desc())
            .limit(limit)
        )
    ).scalars().all()
    for s in shares:
        events.append(
            {
                "kind": "share_create",
                "at": s.created_at,
                "detail": s.name,
                "link": f"/c/{s.short_code}",
            }
        )
        if s.published_at:
            events.append(
                {
                    "kind": "share_publish",
                    "at": s.published_at,
                    "detail": s.name,
                    "link": f"/c/{s.short_code}",
                }
            )

    # Feedback
    feedback = (
        await db.execute(
            select(Feedback)
            .where(Feedback.user_id == user_id)
            .order_by(Feedback.created_at.desc())
            .limit(limit)
        )
    ).scalars().all()
    for f in feedback:
        events.append(
            {
                "kind": "feedback_submit",
                "at": f.created_at,
                "detail": f.title,
                "link": None,
            }
        )

    # Reports submitted
    reports = (
        await db.execute(
            select(ShareReport, Share.short_code, Share.name)
            .join(Share, Share.id == ShareReport.share_id)
            .where(ShareReport.reporter_user_id == user_id)
            .order_by(ShareReport.created_at.desc())
            .limit(limit)
        )
    ).all()
    for row in reports:
        rep: ShareReport = row[0]
        events.append(
            {
                "kind": "report_submit",
                "at": rep.created_at,
                "detail": (
                    rep.reason.value if hasattr(rep.reason, "value") else str(rep.reason)
                ),
                "link": f"/c/{row.short_code}",
            }
        )

    # Sort merged events newest first, truncate to limit.
    # SQLite stores TIMESTAMPTZ as naive strings → some legs return naive
    # datetimes; Better Auth's Session table uses server-default `func.now()`
    # which Postgres types as aware. Normalise so the sort comparison is
    # consistent across dialects.
    def _key(ev: dict[str, Any]) -> datetime:
        at = ev["at"]
        if at.tzinfo is None:
            at = at.replace(tzinfo=UTC)
        return at

    events.sort(key=_key, reverse=True)
    return events[:limit]


# ---- Actions ----------------------------------------------------------------


async def revoke_user_sessions(db: AsyncSession, user_id: uuid.UUID) -> int:
    """Force-sign-out: delete every Session row for the user.

    Returns the number of rows revoked. Doesn't touch `account` or
    `verification` (per ticket): we only revoke the long-lived BA
    session state. Existing JWTs stay valid until expiry (typically
    15min), which is the intentional trade-off documented in the
    `require_admin` dep — short JWT TTL is the answer to "what about
    in-flight tokens?" rather than a server-side revocation list.
    """
    sessions = (
        await db.scalars(select(Session).where(Session.user_id == user_id))
    ).all()
    count = len(sessions)
    for s in sessions:
        await db.delete(s)
    return count


async def soft_delete_user(db: AsyncSession, user: User) -> None:
    """Mark the user as deleted + cascade-tombstone their shares.

    Sets `users.deleted_at = NOW()` (column added in migration 0018).
    All the user's non-deleted shares are also tombstoned in the same
    transaction so the public surface drops them immediately. Reversible
    by NULLing both columns; see `restore_user` (not implemented in v1 —
    the spec calls out restore as a future ticket, but the data shape
    supports it).
    """
    now = datetime.now(UTC)
    user.deleted_at = now

    # Cascade-tombstone shares (per ticket: "tombstones all their shares").
    shares = (
        await db.scalars(
            select(Share).where(
                Share.owner_user_id == user.id,
                Share.deleted_at.is_(None),
            )
        )
    ).all()
    for s in shares:
        s.deleted_at = now


# ---- Unused-import guard ---------------------------------------------------
# The imports below are used in detail/list helpers above; keep them
# explicit so the lint tooling doesn't strip them.
_ = (Feedback, ShareReport, ShareView, OrcidSyncRun, UserPaper, ShareItem)
