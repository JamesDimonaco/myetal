import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from myetal_api.core.security import generate_short_code
from myetal_api.models import Share, ShareItem
from myetal_api.schemas.share import ShareCreate, ShareItemCreate, ShareUpdate

_MAX_SHORT_CODE_ATTEMPTS = 10


class ShortCodeCollision(Exception):
    """Could not generate a unique short code after several attempts."""


async def create_share(
    db: AsyncSession,
    owner_id: uuid.UUID,
    payload: ShareCreate,
) -> Share:
    short_code = await _allocate_short_code(db)
    share = Share(
        owner_user_id=owner_id,
        short_code=short_code,
        name=payload.name,
        description=payload.description,
        type=payload.type,
        is_public=payload.is_public,
    )
    for index, item in enumerate(payload.items):
        share.items.append(_make_item(index, item))
    db.add(share)
    await db.commit()
    return await _reload_with_items(db, share.id)


async def list_user_shares(db: AsyncSession, owner_id: uuid.UUID) -> list[Share]:
    result = await db.scalars(
        select(Share)
        .options(selectinload(Share.items))
        .where(Share.owner_user_id == owner_id)
        .order_by(Share.created_at.desc())
    )
    return list(result.all())


async def get_share_for_owner(
    db: AsyncSession,
    share_id: uuid.UUID,
    owner_id: uuid.UUID,
) -> Share | None:
    return await db.scalar(
        select(Share)
        .options(selectinload(Share.items))
        .where(Share.id == share_id, Share.owner_user_id == owner_id)
    )


async def get_public_share(db: AsyncSession, short_code: str) -> Share | None:
    return await db.scalar(
        select(Share)
        .options(selectinload(Share.items), selectinload(Share.owner))
        .where(Share.short_code == short_code, Share.is_public.is_(True))
    )


async def update_share(db: AsyncSession, share: Share, payload: ShareUpdate) -> Share:
    if payload.name is not None:
        share.name = payload.name
    if payload.description is not None:
        share.description = payload.description
    if payload.type is not None:
        share.type = payload.type
    if payload.is_public is not None:
        share.is_public = payload.is_public

    if payload.items is not None:
        # Replace strategy: clear the collection (delete-orphan cascade will
        # remove the existing rows on flush), then append the new items.
        share.items.clear()
        for index, item in enumerate(payload.items):
            share.items.append(_make_item(index, item))

    await db.commit()
    return await _reload_with_items(db, share.id)


async def delete_share(db: AsyncSession, share: Share) -> None:
    await db.delete(share)
    await db.commit()


# ---------- internals ----------


async def _allocate_short_code(db: AsyncSession) -> str:
    for _ in range(_MAX_SHORT_CODE_ATTEMPTS):
        candidate = generate_short_code()
        existing = await db.scalar(select(Share).where(Share.short_code == candidate))
        if existing is None:
            return candidate
    raise ShortCodeCollision


def _make_item(position: int, payload: ShareItemCreate) -> ShareItem:
    return ShareItem(
        position=position,
        kind=payload.kind,
        title=payload.title,
        subtitle=payload.subtitle,
        url=payload.url,
        image_url=payload.image_url,
        scholar_url=payload.scholar_url,
        doi=payload.doi,
        authors=payload.authors,
        year=payload.year,
        notes=payload.notes,
    )


async def _reload_with_items(db: AsyncSession, share_id: uuid.UUID) -> Share:
    share = await db.scalar(
        select(Share).options(selectinload(Share.items)).where(Share.id == share_id)
    )
    assert share is not None  # we just inserted it
    return share
