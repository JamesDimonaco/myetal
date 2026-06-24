import io
import uuid
from typing import Annotated

import qrcode
from fastapi import APIRouter, Header, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr

from myetal_api.api.deps import DbSession, OptionalUser
from myetal_api.core.config import settings
from myetal_api.core.rate_limit import ANON_READ_LIMIT, SHARE_EMAIL_LIMIT, limiter
from myetal_api.models import Share
from myetal_api.schemas.share import PublicShareResponse, ShareItemResponse, TagOut
from myetal_api.services import email as email_service
from myetal_api.services import poster as poster_service
from myetal_api.services import share as share_service
from myetal_api.services import share_view as share_view_service

router = APIRouter(prefix="/public", tags=["public"])


def _qr_png_bytes(target_url: str) -> bytes:
    """One QR pipeline for qr.png, the user QR, and the poster PDF — keeps
    every rendering of the same URL byte-equivalent (defaults: error
    correction M, box_size 10, border 4)."""
    img = qrcode.make(target_url)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _get_live_share_or_raise(
    share: Share | None,
    was_tombstoned: bool,
) -> Share:
    """Shared 404/410 semantics for everything keyed on a short_code.

    Unpublished drafts deliberately 404 (not 410) per the K3 fix-up; only
    tombstoned shares get 410 so search engines drop them cleanly (D-BL2).
    """
    if share is None:
        if was_tombstoned:
            raise HTTPException(status_code=status.HTTP_410_GONE, detail="share has been deleted")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="share not found")
    return share


@router.get("/c/{short_code}", response_model=PublicShareResponse)
@limiter.limit(ANON_READ_LIMIT)
async def resolve_public_share(
    short_code: str,
    request: Request,
    db: DbSession,
    user: OptionalUser,
    x_view_token: Annotated[str | None, Header(alias="X-View-Token")] = None,
) -> PublicShareResponse:
    """Resolve a public share by short_code.

    Distinguishes 404 (never existed) from 410 (was tombstoned) per D-BL2 +
    D14 — search engines drop 410'd URLs from their index cleanly.

    Side-effect: records a view event (best-effort, never blocks) per D3.
    Owner self-views, bot UAs, and within-24h dedup'd views are skipped.
    `X-View-Token` is the mobile per-install dedup channel (D3.1).
    """
    share, was_tombstoned = await share_service.get_public_share_with_tombstone(db, short_code)
    share = _get_live_share_or_raise(share, was_tombstoned)

    # Best-effort view tracking. record_view never raises; it logs.
    # Logged-in users use viewer_user_id; mobile uses X-View-Token; anon-web
    # falls through to the in-process bloom-equivalent.
    await share_view_service.record_view(
        db,
        share,
        request,
        viewer_user_id=user.id if user else None,
        view_token=None if user else x_view_token,
    )

    # Fetch related and similar shares in parallel (both are cheap indexed
    # queries). Best-effort: if either fails the response still works.
    related_shares = await share_service.get_related_shares(db, share)
    similar_shares = await share_service.get_similar_shares(db, share)

    return PublicShareResponse(
        short_code=share.short_code,
        name=share.name,
        description=share.description,
        type=share.type,
        items=[ShareItemResponse.model_validate(i) for i in share.items],
        owner_name=share.owner.name if share.owner else None,
        owner_id=share.owner_user_id,
        owner_handle=share.owner.handle if share.owner else None,
        updated_at=share.updated_at,
        related_shares=related_shares,
        similar_shares=similar_shares,
        tags=[TagOut.model_validate(t) for t in share.tags],
    )


@router.get("/sitemap-shares")
@limiter.limit(ANON_READ_LIMIT)
async def list_sitemap_shares(
    request: Request,
    db: DbSession,
) -> list[dict[str, str]]:
    """Return `[{short_code, updated_at}]` for every discoverable share.

    Used by the Next.js frontend to build /sitemap.xml. No auth required;
    the data is already public on the share pages themselves. Rate-limited
    like any other anonymous read.
    """
    return await share_service.list_sitemap_shares(db)


@router.get(
    "/c/{short_code}/qr.png",
    responses={200: {"content": {"image/png": {}}}},
)
@limiter.limit(ANON_READ_LIMIT)
async def share_qr_png(short_code: str, request: Request, db: DbSession) -> Response:
    """Per D-BL2: also surfaces 410 vs 404 so a tombstoned share's QR
    endpoint stops serving before the share's URL stops resolving."""
    share, was_tombstoned = await share_service.get_public_share_with_tombstone(db, short_code)
    _get_live_share_or_raise(share, was_tombstoned)

    target_url = f"{settings.public_base_url.rstrip('/')}/c/{short_code}"
    return Response(
        content=_qr_png_bytes(target_url),
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.get(
    "/c/{short_code}/poster.pdf",
    responses={200: {"content": {"application/pdf": {}}}},
)
@limiter.limit(ANON_READ_LIMIT)
async def share_poster_pdf(short_code: str, request: Request, db: DbSession) -> Response:
    """Print-ready A4 poster: big QR, share name, short URL, owner credit.

    Same 404/410 semantics as ``qr.png``. Content is a pure function of
    (short_code, name, owner name), so the CDN edge can cache it for a day
    (``s-maxage`` per the qr-poster-pdf ticket).
    """
    share, was_tombstoned = await share_service.get_public_share_with_tombstone(db, short_code)
    share = _get_live_share_or_raise(share, was_tombstoned)

    base = settings.public_base_url.rstrip("/")
    pdf = poster_service.build_share_poster(
        qr_png=_qr_png_bytes(f"{base}/c/{short_code}"),
        share_name=share.name,
        display_url=f"{base.removeprefix('https://').removeprefix('http://')}/c/{short_code}",
        owner_name=share.owner.name if share.owner else None,
    )

    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Cache-Control": "public, s-maxage=86400",
            "Content-Disposition": f'inline; filename="{short_code}-poster.pdf"',
        },
    )


@router.get(
    "/u/{user_id}/qr.png",
    responses={200: {"content": {"image/png": {}}}},
)
@limiter.limit(ANON_READ_LIMIT)
async def user_qr_png(user_id: uuid.UUID, request: Request, db: DbSession) -> Response:
    """QR for a researcher's public page (`/u/{id}`) — the one code that
    follows them across talks and posters. 404 only when no such user
    exists (same semantics as ``/public/browse?owner_id=``: a user with
    zero published shares still resolves, so an already-printed business
    card never dead-ends)."""
    card = await share_service.get_user_public_card(db, user_id)
    if card is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user not found")

    target_url = f"{settings.public_base_url.rstrip('/')}/u/{user_id}"
    return Response(
        content=_qr_png_bytes(target_url),
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=86400"},
    )


class ShareEmailRequest(BaseModel):
    email: EmailStr


@router.post("/c/{short_code}/email", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit(SHARE_EMAIL_LIMIT)
async def email_share_link(
    short_code: str,
    body: ShareEmailRequest,
    request: Request,
    db: DbSession,
) -> Response:
    """\"Email me this collection\" — anonymous, no account, nothing stored.

    Always 204 once the input validates: whether the send happened, was
    cap-skipped, or failed at Resend is deliberately not observable (no
    delivery / recipient oracle). The body content is fixed apart from the
    share name, so the endpoint can't carry attacker-controlled text. The
    slowapi per-IP limit is a blunt backstop (web traffic arrives via one
    proxy egress IP); the real brakes are the per-recipient and per-share
    rolling caps in the email service.
    """
    share, was_tombstoned = await share_service.get_public_share_with_tombstone(db, short_code)
    share = _get_live_share_or_raise(share, was_tombstoned)

    recipient = body.email.strip().lower()
    if email_service.share_email_allowed(recipient, short_code):
        email_service.record_share_email(recipient, short_code)
        await email_service.send_share_link_email(
            to=recipient,
            share_name=share.name,
            short_code=short_code,
        )

    return Response(status_code=status.HTTP_204_NO_CONTENT)
