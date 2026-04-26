import uuid

from fastapi import APIRouter, HTTPException, status

from quire_api.api.deps import CurrentUser, DbSession
from quire_api.schemas.share import ShareCreate, ShareResponse, ShareUpdate
from quire_api.services import share as share_service

router = APIRouter(prefix="/shares", tags=["shares"])


@router.post("", response_model=ShareResponse, status_code=status.HTTP_201_CREATED)
async def create_share(body: ShareCreate, user: CurrentUser, db: DbSession) -> ShareResponse:
    share = await share_service.create_share(db, user.id, body)
    return ShareResponse.model_validate(share)


@router.get("", response_model=list[ShareResponse])
async def list_shares(user: CurrentUser, db: DbSession) -> list[ShareResponse]:
    shares = await share_service.list_user_shares(db, user.id)
    return [ShareResponse.model_validate(s) for s in shares]


@router.get("/{share_id}", response_model=ShareResponse)
async def get_share(share_id: uuid.UUID, user: CurrentUser, db: DbSession) -> ShareResponse:
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
    updated = await share_service.update_share(db, share, body)
    return ShareResponse.model_validate(updated)


@router.delete("/{share_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_share(share_id: uuid.UUID, user: CurrentUser, db: DbSession) -> None:
    share = await share_service.get_share_for_owner(db, share_id, user.id)
    if share is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="share not found")
    await share_service.delete_share(db, share)
