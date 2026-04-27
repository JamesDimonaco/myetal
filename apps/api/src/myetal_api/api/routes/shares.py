import uuid

from fastapi import APIRouter, HTTPException, Query, status

from myetal_api.api.deps import CurrentUser, DbSession
from myetal_api.schemas.share import ShareCreate, ShareResponse, ShareUpdate
from myetal_api.services import share as share_service

router = APIRouter(prefix="/shares", tags=["shares"])


@router.post("", response_model=ShareResponse, status_code=status.HTTP_201_CREATED)
async def create_share(body: ShareCreate, user: CurrentUser, db: DbSession) -> ShareResponse:
    share = await share_service.create_share(db, user.id, body)
    return ShareResponse.model_validate(share)


@router.get("", response_model=list[ShareResponse])
async def list_shares(
    user: CurrentUser,
    db: DbSession,
    include_deleted: bool = Query(
        default=False,
        description="Include tombstoned shares (for a future trash UI).",
    ),
) -> list[ShareResponse]:
    shares = await share_service.list_user_shares(db, user.id, include_deleted=include_deleted)
    return [ShareResponse.model_validate(s) for s in shares]


@router.get("/{share_id}", response_model=ShareResponse)
async def get_share(share_id: uuid.UUID, user: CurrentUser, db: DbSession) -> ShareResponse:
    """Owner can fetch their share even when tombstoned — the UI uses the
    `deleted_at` field on the response to render a banner. Per D-BL2."""
    share = await share_service.get_share_for_owner(db, share_id, user.id)
    if share is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="share not found")
    return ShareResponse.model_validate(share)


@router.patch("/{share_id}", response_model=ShareResponse)
async def update_share(
    share_id: uuid.UUID, body: ShareUpdate, user: CurrentUser, db: DbSession
) -> ShareResponse:
    share = await share_service.get_share_for_owner(db, share_id, user.id)
    if share is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="share not found")
    if share.deleted_at is not None:
        # D-BL2: don't let edits hit a tombstoned share. Restore-from-trash
        # would be a separate explicit endpoint, not silent un-delete via PATCH.
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="share has been deleted",
        )
    updated = await share_service.update_share(db, share, body)
    return ShareResponse.model_validate(updated)


@router.delete("/{share_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_share(share_id: uuid.UUID, user: CurrentUser, db: DbSession) -> None:
    """Tombstone the share (sets deleted_at = NOW()). Row is permanently
    GC'd 30 days later by a separate cron, giving crawlers time to drop
    the URL via 410 Gone responses. Per D14 + D-BL2.
    """
    share = await share_service.get_share_for_owner(db, share_id, user.id)
    if share is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="share not found")
    if share.deleted_at is not None:
        # Already tombstoned — re-DELETE doesn't restore (that's a separate
        # endpoint we're not building in v1). Per D-BL2.
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="share has already been deleted",
        )
    await share_service.tombstone_share(db, share)


@router.post("/{share_id}/publish", response_model=ShareResponse)
async def publish_share(share_id: uuid.UUID, user: CurrentUser, db: DbSession) -> ShareResponse:
    """Opt the share into discovery surfaces (sitemap, similar-shares panel,
    'who else has this paper', future trending). Per D1.

    Idempotent: re-publishing an already-published share is a no-op (does not
    bump `published_at` to NOW). Use unpublish + publish to refresh the date.
    """
    share = await share_service.get_share_for_owner(db, share_id, user.id)
    if share is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="share not found")
    if share.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="share has been deleted")
    updated = await share_service.publish_share(db, share)
    return ShareResponse.model_validate(updated)


@router.delete("/{share_id}/publish", response_model=ShareResponse)
async def unpublish_share(share_id: uuid.UUID, user: CurrentUser, db: DbSession) -> ShareResponse:
    """Reverse of publish — keep URL alive but drop from discovery surfaces.
    Per D1. The share is excluded from the next nightly similar/trending
    refresh, so it can take up to 24h to vanish from precomputed surfaces.
    """
    share = await share_service.get_share_for_owner(db, share_id, user.id)
    if share is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="share not found")
    if share.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="share has been deleted")
    updated = await share_service.unpublish_share(db, share)
    return ShareResponse.model_validate(updated)
