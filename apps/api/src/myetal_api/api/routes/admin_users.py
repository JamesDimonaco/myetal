"""/admin/users/* — Stage 2 user management.

Per `docs/tickets/to-do/admin-analytics-dashboard.md` Stage 2. Every
write endpoint records an audit row in the same transaction as the
underlying change (see `services/admin_audit.py`).

Safety rails baked into the routes themselves rather than the UI alone:
* `toggle-admin` rejects self-toggle (admin can't unmake themselves)
* `soft-delete` is reversible (`users.deleted_at` flip, not a row drop)
* `force-sign-out` revokes only `session` rows; `account` + BA core
  resources are untouched
* `send-password-reset` proxies to Better Auth's `/api/auth/forget-password`
  rather than minting a token directly — the rate-limit / audit chain
  in BA stays intact (no short-circuit per ticket safety rules)
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Query, Request, status

from myetal_api.api.deps import AdminUser, DbSession
from myetal_api.api.routes.admin import reset_overview_cache
from myetal_api.core.config import settings
from myetal_api.core.rate_limit import authed_user_key, limiter
from myetal_api.models import User
from myetal_api.schemas.admin import (
    AdminActionResponse,
    AdminUserDetail,
    AdminUserListResponse,
)
from myetal_api.services import admin_audit as admin_audit_service
from myetal_api.services import admin_users as admin_users_service

logger = logging.getLogger(__name__)

# Same admin rate-limit as the rest of /admin/*. 600/min is generous
# enough for a real human clicking around + tight enough that a stolen
# admin token can't iterate the user table at scraping speed.
ADMIN_LIMIT = "600/minute"

router = APIRouter(prefix="/admin/users", tags=["admin-users"])


# ---- Read endpoints --------------------------------------------------------


@router.get("", response_model=AdminUserListResponse)
@limiter.limit(ADMIN_LIMIT, key_func=authed_user_key)
async def list_users(
    request: Request,
    _admin: AdminUser,
    db: DbSession,
    q: str | None = Query(default=None, max_length=200),
    filter_: str = Query(default="all", alias="filter"),
    cursor: str | None = Query(default=None, max_length=200),
    sort: str = Query(default="created_desc"),
) -> dict[str, Any]:
    """List users with search + filter chips + cursor pagination."""
    return await admin_users_service.list_users(
        db,
        q=q,
        filter_=filter_,
        cursor=cursor,
        sort=sort,
    )


@router.get("/{user_id}", response_model=AdminUserDetail)
@limiter.limit(ADMIN_LIMIT, key_func=authed_user_key)
async def get_user_detail(
    request: Request,
    user_id: uuid.UUID,
    _admin: AdminUser,
    db: DbSession,
) -> dict[str, Any]:
    detail = await admin_users_service.get_user_detail(db, user_id)
    if detail is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="user not found"
        )
    return detail


# ---- Write endpoints -------------------------------------------------------


async def _load_target(db: DbSession, user_id: uuid.UUID) -> User:
    """Common 404 path for every write endpoint."""
    target = await db.get(User, user_id)
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="user not found"
        )
    return target


@router.post("/{user_id}/sign-out", response_model=AdminActionResponse)
@limiter.limit(ADMIN_LIMIT, key_func=authed_user_key)
async def force_sign_out(
    request: Request,
    user_id: uuid.UUID,
    admin: AdminUser,
    db: DbSession,
) -> AdminActionResponse:
    """Revoke every `session` row for this user.

    Doesn't touch `account` (federated identity) or `verification`
    (pending email-verify / password-reset tokens). Existing short-lived
    BA JWTs the user already has stay valid until expiry — by design,
    revocation lists weren't worth the complexity (DEPLOY.md). 15-min
    JWT TTL is the bound.

    Self-sign-out is rejected — an admin's session cookie is what's
    keeping their tab usable. The UI also disables the button when
    `target.id === currentUser.id`, but the backend is the source of
    truth so a forged request still 400s.
    """
    if admin.id == user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="cannot force-sign-out your own account",
        )
    target = await _load_target(db, user_id)
    count = await admin_users_service.revoke_user_sessions(db, target.id)
    audit = await admin_audit_service.record_action(
        db,
        admin_user_id=admin.id,
        action="force_sign_out",
        target_user_id=target.id,
        details={"sessions_revoked": count},
    )
    await db.commit()
    # The /admin/overview counters/lists may now be stale (user changed
    # underneath them). Cheaper to bust the cache than to invalidate
    # selectively — overview hits are infrequent and the recompute is
    # ~8 quick queries.
    reset_overview_cache()
    return AdminActionResponse(
        audit_id=audit.id,
        message=f"Revoked {count} session{'s' if count != 1 else ''}.",
    )


@router.post("/{user_id}/admin", response_model=AdminActionResponse)
@limiter.limit(ADMIN_LIMIT, key_func=authed_user_key)
async def toggle_admin(
    request: Request,
    user_id: uuid.UUID,
    admin: AdminUser,
    db: DbSession,
    value: bool = Query(..., description="New is_admin value."),
) -> AdminActionResponse:
    """Flip `users.is_admin`.

    Self-toggle is forbidden — an admin cannot unmake themselves.
    Without this, an accidental click would lock a single-admin
    deployment out of /admin/* permanently. Promotion requires another
    admin or an env-var allowlist redeploy (see `require_admin` notes).
    """
    if admin.id == user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="cannot toggle your own admin status",
        )
    target = await _load_target(db, user_id)
    previous = target.is_admin
    target.is_admin = value
    audit = await admin_audit_service.record_action(
        db,
        admin_user_id=admin.id,
        action="toggle_admin",
        target_user_id=target.id,
        details={"from": previous, "to": value},
    )
    await db.commit()
    # The /admin/overview counters/lists may now be stale (user changed
    # underneath them). Cheaper to bust the cache than to invalidate
    # selectively — overview hits are infrequent and the recompute is
    # ~8 quick queries.
    reset_overview_cache()
    return AdminActionResponse(
        audit_id=audit.id,
        message=f"Admin set to {value}.",
    )


@router.post("/{user_id}/verify-email", response_model=AdminActionResponse)
@limiter.limit(ADMIN_LIMIT, key_func=authed_user_key)
async def verify_email(
    request: Request,
    user_id: uuid.UUID,
    admin: AdminUser,
    db: DbSession,
) -> AdminActionResponse:
    """Force-set `email_verified = true`.

    Useful for users stuck on bouncing email. Idempotent — calling on
    an already-verified user is a no-op (but still records an audit row
    so the action is auditable).
    """
    target = await _load_target(db, user_id)
    previous = target.email_verified
    target.email_verified = True
    audit = await admin_audit_service.record_action(
        db,
        admin_user_id=admin.id,
        action="verify_email",
        target_user_id=target.id,
        details={"from": previous, "to": True},
    )
    await db.commit()
    # The /admin/overview counters/lists may now be stale (user changed
    # underneath them). Cheaper to bust the cache than to invalidate
    # selectively — overview hits are infrequent and the recompute is
    # ~8 quick queries.
    reset_overview_cache()
    return AdminActionResponse(audit_id=audit.id, message="Email marked verified.")


@router.post("/{user_id}/soft-delete", response_model=AdminActionResponse)
@limiter.limit(ADMIN_LIMIT, key_func=authed_user_key)
async def soft_delete(
    request: Request,
    user_id: uuid.UUID,
    admin: AdminUser,
    db: DbSession,
) -> AdminActionResponse:
    """Soft-delete the user + tombstone their shares.

    Reversible: NULL `users.deleted_at` back to restore. Hard delete is
    NOT exposed in v1 (GDPR ticket later). Self-soft-delete is rejected
    for the same reason as self-toggle-admin — accidental click =
    lockout.
    """
    if admin.id == user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="cannot soft-delete your own account",
        )
    target = await _load_target(db, user_id)
    if getattr(target, "deleted_at", None) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="user already soft-deleted",
        )
    await admin_users_service.soft_delete_user(db, target)
    audit = await admin_audit_service.record_action(
        db,
        admin_user_id=admin.id,
        action="soft_delete_user",
        target_user_id=target.id,
        details={"at": datetime.now(UTC).isoformat()},
    )
    await db.commit()
    # The /admin/overview counters/lists may now be stale (user changed
    # underneath them). Cheaper to bust the cache than to invalidate
    # selectively — overview hits are infrequent and the recompute is
    # ~8 quick queries.
    reset_overview_cache()
    return AdminActionResponse(
        audit_id=audit.id,
        message="User soft-deleted; shares tombstoned.",
    )


@router.post("/{user_id}/send-password-reset", response_model=AdminActionResponse)
@limiter.limit(ADMIN_LIMIT, key_func=authed_user_key)
async def send_password_reset(
    request: Request,
    user_id: uuid.UUID,
    admin: AdminUser,
    db: DbSession,
) -> AdminActionResponse:
    """Trigger Better Auth's password-reset flow for the target user.

    Per ticket safety rules: DO NOT short-circuit by minting a token
    server-side. Instead we POST to BA's `/api/auth/forget-password`
    with the user's email; BA mints the verification row + sends the
    Resend email. This keeps BA's rate limit + audit chain intact.

    Returns 200 + audit row even if BA's email-send fails silently —
    the action *was* attempted; whether the email lands isn't visible
    from here. Network errors against BA bubble up as a 502.
    """
    target = await _load_target(db, user_id)
    if not target.email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="user has no email on file",
        )

    ba_url = settings.better_auth_url.rstrip("/")
    forget_url = f"{ba_url}/api/auth/forget-password"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                forget_url,
                json={"email": target.email},
                headers={"Content-Type": "application/json"},
            )
        # BA returns 200 + `{ status: true }` on success, or 200 + a
        # generic message if the email isn't registered (it intentionally
        # doesn't leak existence). Treat anything that isn't a network
        # error as success — we already validated the email exists locally.
        ba_ok = resp.is_success
    except Exception as exc:  # noqa: BLE001 — defensive catch around external call
        # Catching `Exception` (not just httpx.HTTPError) because SSL /
        # socket-level failures that don't inherit HTTPError would
        # previously bubble before the audit row was staged. We still
        # want the attempt logged even if the network primitive blew
        # up unexpectedly.
        logger.warning("send_password_reset: BA proxy failed %s", exc)
        ba_ok = False

    # Drop `email` from details (already reachable via target_user_id;
    # the admin_audit model docstring explicitly says not to duplicate
    # PII into details).
    audit = await admin_audit_service.record_action(
        db,
        admin_user_id=admin.id,
        action="send_password_reset",
        target_user_id=target.id,
        details={"ba_ok": ba_ok},
    )
    await db.commit()
    # The /admin/overview counters/lists may now be stale (user changed
    # underneath them). Cheaper to bust the cache than to invalidate
    # selectively — overview hits are infrequent and the recompute is
    # ~8 quick queries.
    reset_overview_cache()

    if not ba_ok:
        # Audit row already committed: the attempt is logged whether or
        # not the email landed. Surface the failure so the admin can
        # retry; details.ba_ok=false is the durable record of the
        # failed try.
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Better Auth refused or was unreachable; please retry.",
        )

    return AdminActionResponse(
        audit_id=audit.id,
        message=f"Reset email triggered to {target.email}.",
    )
