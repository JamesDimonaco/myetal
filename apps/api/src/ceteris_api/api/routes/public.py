import io

import qrcode
from fastapi import APIRouter, HTTPException, Response, status

from ceteris_api.api.deps import DbSession
from ceteris_api.core.config import settings
from ceteris_api.schemas.share import PublicShareResponse, ShareItemResponse
from ceteris_api.services import share as share_service

router = APIRouter(prefix="/public", tags=["public"])


@router.get("/c/{short_code}", response_model=PublicShareResponse)
async def resolve_public_share(short_code: str, db: DbSession) -> PublicShareResponse:
    share = await share_service.get_public_share(db, short_code)
    if share is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="share not found")
    return PublicShareResponse(
        short_code=share.short_code,
        name=share.name,
        description=share.description,
        type=share.type,
        items=[ShareItemResponse.model_validate(i) for i in share.items],
        owner_name=share.owner.name if share.owner else None,
        updated_at=share.updated_at,
    )


@router.get(
    "/c/{short_code}/qr.png",
    responses={200: {"content": {"image/png": {}}}},
)
async def share_qr_png(short_code: str, db: DbSession) -> Response:
    share = await share_service.get_public_share(db, short_code)
    if share is None:
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
