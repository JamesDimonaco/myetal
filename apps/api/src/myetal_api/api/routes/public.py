import io
from typing import Annotated

import qrcode
from fastapi import APIRouter, Header, HTTPException, Request, Response, status

from myetal_api.api.deps import DbSession, OptionalUser
from myetal_api.core.config import settings
from myetal_api.core.rate_limit import ANON_READ_LIMIT, limiter
from myetal_api.schemas.share import PublicShareResponse, ShareItemResponse, TagOut
from myetal_api.services import share as share_service
from myetal_api.services import share_view as share_view_service

router = APIRouter(prefix="/public", tags=["public"])


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
    if share is None:
        if was_tombstoned:
            raise HTTPException(
                status_code=status.HTTP_410_GONE,
                detail="share has been deleted",
            )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="share not found",
        )

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
    if share is None:
        if was_tombstoned:
            raise HTTPException(status_code=status.HTTP_410_GONE, detail="share has been deleted")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="share not found")

    target_url = f"{settings.public_base_url.rstrip('/')}/c/{short_code}"
    img = qrcode.make(target_url)
    buf = io.BytesIO()
    img.save(buf, format="PNG")

    return Response(
        content=buf.getvalue(),
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=86400"},
    )
