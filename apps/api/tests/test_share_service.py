from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from myetal_api.models import ItemKind, ShareType
from myetal_api.schemas.share import ShareCreate, ShareItemCreate, ShareUpdate
from myetal_api.services import auth as auth_service
from myetal_api.services import share as share_service


async def _make_user(db: AsyncSession, email: str = "researcher@example.com"):
    user, _, _ = await auth_service.register_with_password(db, email, "hunter22", "Researcher")
    return user


async def test_create_share_with_items(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    payload = ShareCreate(
        name="My recent work",
        description="Papers from 2025-2026",
        type=ShareType.COLLECTION,
        is_public=True,
        items=[
            ShareItemCreate(title="First paper", scholar_url="https://scholar.google.com/1"),
            ShareItemCreate(title="Second paper", doi="10.1234/abc"),
        ],
    )
    share = await share_service.create_share(db_session, user.id, payload)

    assert share.name == "My recent work"
    assert share.type == ShareType.COLLECTION
    assert share.is_public is True
    assert len(share.short_code) == 6
    assert len(share.items) == 2
    assert share.items[0].position == 0
    assert share.items[0].title == "First paper"
    assert share.items[1].position == 1
    assert share.items[1].doi == "10.1234/abc"


async def test_short_codes_are_unique_across_shares(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    payload = ShareCreate(name="x")
    codes = set()
    for _ in range(20):
        share = await share_service.create_share(db_session, user.id, payload)
        codes.add(share.short_code)
    assert len(codes) == 20


async def test_list_only_returns_user_own_shares(db_session: AsyncSession) -> None:
    alice = await _make_user(db_session, "alice@example.com")
    bob = await _make_user(db_session, "bob@example.com")
    await share_service.create_share(db_session, alice.id, ShareCreate(name="alice 1"))
    await share_service.create_share(db_session, alice.id, ShareCreate(name="alice 2"))
    await share_service.create_share(db_session, bob.id, ShareCreate(name="bob 1"))

    alice_shares = await share_service.list_user_shares(db_session, alice.id)
    assert {s.name for s in alice_shares} == {"alice 1", "alice 2"}


async def test_get_share_for_owner_rejects_other_user(db_session: AsyncSession) -> None:
    alice = await _make_user(db_session, "alice@example.com")
    bob = await _make_user(db_session, "bob@example.com")
    share = await share_service.create_share(db_session, alice.id, ShareCreate(name="x"))

    assert await share_service.get_share_for_owner(db_session, share.id, alice.id) is not None
    assert await share_service.get_share_for_owner(db_session, share.id, bob.id) is None


async def test_public_share_resolution(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    public = await share_service.create_share(
        db_session, user.id, ShareCreate(name="public", is_public=True)
    )
    private = await share_service.create_share(
        db_session, user.id, ShareCreate(name="private", is_public=False)
    )

    assert (await share_service.get_public_share(db_session, public.short_code)) is not None
    assert (await share_service.get_public_share(db_session, private.short_code)) is None
    assert (await share_service.get_public_share(db_session, "nope42")) is None


async def test_update_share_metadata(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    share = await share_service.create_share(db_session, user.id, ShareCreate(name="orig"))
    updated = await share_service.update_share(
        db_session,
        share,
        ShareUpdate(name="new name", is_public=False),
    )
    assert updated.name == "new name"
    assert updated.is_public is False


async def test_update_share_items_replaces_them(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    share = await share_service.create_share(
        db_session,
        user.id,
        ShareCreate(
            name="x", items=[ShareItemCreate(title="old 1"), ShareItemCreate(title="old 2")]
        ),
    )
    updated = await share_service.update_share(
        db_session,
        share,
        ShareUpdate(items=[ShareItemCreate(title="new only")]),
    )
    assert [i.title for i in updated.items] == ["new only"]


async def test_update_with_items_none_leaves_items_alone(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    share = await share_service.create_share(
        db_session,
        user.id,
        ShareCreate(name="x", items=[ShareItemCreate(title="keep me")]),
    )
    updated = await share_service.update_share(db_session, share, ShareUpdate(name="renamed"))
    assert [i.title for i in updated.items] == ["keep me"]


async def test_create_item_with_repo_kind_round_trips(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    payload = ShareCreate(
        name="Project page",
        type=ShareType.PROJECT,
        items=[
            ShareItemCreate(
                kind=ItemKind.REPO,
                title="myetal/api",
                subtitle="Backend API",
                url="https://github.com/myetal/api",
                image_url="https://avatars.githubusercontent.com/u/1?v=4",
            ),
        ],
    )
    share = await share_service.create_share(db_session, user.id, payload)

    assert share.type == ShareType.PROJECT
    assert len(share.items) == 1
    item = share.items[0]
    assert item.kind == ItemKind.REPO
    assert item.title == "myetal/api"
    assert item.subtitle == "Backend API"
    assert item.url == "https://github.com/myetal/api"
    assert item.image_url == "https://avatars.githubusercontent.com/u/1?v=4"

    # Re-read to confirm persistence.
    fetched = await share_service.get_share_for_owner(db_session, share.id, user.id)
    assert fetched is not None
    assert fetched.items[0].kind == ItemKind.REPO
    assert fetched.items[0].url == "https://github.com/myetal/api"


async def test_default_item_kind_is_paper(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    share = await share_service.create_share(
        db_session,
        user.id,
        ShareCreate(name="x", items=[ShareItemCreate(title="legacy paper")]),
    )
    assert share.items[0].kind == ItemKind.PAPER
    assert share.items[0].subtitle is None
    assert share.items[0].url is None
    assert share.items[0].image_url is None


async def test_share_type_project_is_accepted(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    share = await share_service.create_share(
        db_session, user.id, ShareCreate(name="proj", type=ShareType.PROJECT)
    )
    assert share.type == ShareType.PROJECT


async def test_public_share_response_includes_new_fields(
    api_client: TestClient, db_session: AsyncSession
) -> None:
    user = await _make_user(db_session)
    share = await share_service.create_share(
        db_session,
        user.id,
        ShareCreate(
            name="proj",
            type=ShareType.PROJECT,
            is_public=True,
            items=[
                ShareItemCreate(
                    kind=ItemKind.LINK,
                    title="Lab page",
                    subtitle="Group website",
                    url="https://example.org/lab",
                    image_url="https://example.org/og.png",
                ),
            ],
        ),
    )

    r = api_client.get(f"/public/c/{share.short_code}")
    assert r.status_code == 200
    body = r.json()
    assert body["type"] == "project"
    assert len(body["items"]) == 1
    item = body["items"][0]
    assert item["kind"] == "link"
    assert item["subtitle"] == "Group website"
    assert item["url"] == "https://example.org/lab"
    assert item["image_url"] == "https://example.org/og.png"


async def test_tombstone_share_marks_deleted_at_keeps_items(
    db_session: AsyncSession,
) -> None:
    """Per D14: delete is now soft. Row stays, items stay, deleted_at is set.
    The 30-day GC cron permanently drops rows via the existing CASCADE."""
    from sqlalchemy import select

    from myetal_api.models import Share, ShareItem

    user = await _make_user(db_session)
    share = await share_service.create_share(
        db_session,
        user.id,
        ShareCreate(name="x", items=[ShareItemCreate(title="a"), ShareItemCreate(title="b")]),
    )
    share_id = share.id

    await share_service.tombstone_share(db_session, share)

    # The share row is still present, with deleted_at populated.
    refreshed = await db_session.scalar(select(Share).where(Share.id == share_id))
    assert refreshed is not None
    assert refreshed.deleted_at is not None

    # Items remain (cascade only fires on real delete, which is the cron's job).
    remaining = await db_session.scalars(select(ShareItem).where(ShareItem.share_id == share_id))
    assert len(list(remaining.all())) == 2


async def test_get_public_share_excludes_tombstoned(db_session: AsyncSession) -> None:
    """Per D-BL2: get_public_share filters out tombstoned shares — returns None."""
    user = await _make_user(db_session)
    share = await share_service.create_share(
        db_session,
        user.id,
        ShareCreate(name="x", items=[ShareItemCreate(title="a")]),
    )
    short_code = share.short_code

    # Live share resolves.
    found = await share_service.get_public_share(db_session, short_code)
    assert found is not None

    # Tombstone it; the public lookup returns None.
    await share_service.tombstone_share(db_session, share)
    after = await share_service.get_public_share(db_session, short_code)
    assert after is None


async def test_get_public_share_with_tombstone_distinguishes_404_vs_410(
    db_session: AsyncSession,
) -> None:
    """Per D-BL2: helper returns (None, True) for tombstoned vs (None, False)
    for never-existed, so the route can return 410 vs 404 cleanly."""
    user = await _make_user(db_session)
    share = await share_service.create_share(
        db_session,
        user.id,
        ShareCreate(name="x", items=[ShareItemCreate(title="a")]),
    )
    short_code = share.short_code

    # Tombstone it.
    await share_service.tombstone_share(db_session, share)

    found, was_tombstoned = await share_service.get_public_share_with_tombstone(
        db_session, short_code
    )
    assert found is None
    assert was_tombstoned is True

    # Never-existed short_code returns (None, False).
    found, was_tombstoned = await share_service.get_public_share_with_tombstone(
        db_session, "nonexistent-code"
    )
    assert found is None
    assert was_tombstoned is False


async def test_publish_unpublish_share(db_session: AsyncSession) -> None:
    """Per D1: publish_share sets published_at; unpublish clears it."""
    user = await _make_user(db_session)
    share = await share_service.create_share(
        db_session,
        user.id,
        ShareCreate(name="x"),
    )
    assert share.published_at is None

    published = await share_service.publish_share(db_session, share)
    assert published.published_at is not None

    # Idempotent — re-publishing doesn't bump the timestamp.
    first_at = published.published_at
    again = await share_service.publish_share(db_session, share)
    assert again.published_at == first_at

    unpublished = await share_service.unpublish_share(db_session, share)
    assert unpublished.published_at is None


async def test_list_user_shares_excludes_tombstoned_by_default(
    db_session: AsyncSession,
) -> None:
    """Per D-BL2: list_user_shares hides tombstoned shares unless asked."""
    user = await _make_user(db_session)
    a = await share_service.create_share(db_session, user.id, ShareCreate(name="a"))
    await share_service.create_share(db_session, user.id, ShareCreate(name="b"))

    # Tombstone the first one.
    await share_service.tombstone_share(db_session, a)

    visible = await share_service.list_user_shares(db_session, user.id)
    assert {s.name for s in visible} == {"b"}

    all_including = await share_service.list_user_shares(db_session, user.id, include_deleted=True)
    assert {s.name for s in all_including} == {"a", "b"}
