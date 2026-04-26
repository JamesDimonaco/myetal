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


async def test_delete_share_cascades_items(db_session: AsyncSession) -> None:
    from sqlalchemy import select

    from myetal_api.models import ShareItem

    user = await _make_user(db_session)
    share = await share_service.create_share(
        db_session,
        user.id,
        ShareCreate(name="x", items=[ShareItemCreate(title="a"), ShareItemCreate(title="b")]),
    )
    share_id = share.id
    await share_service.delete_share(db_session, share)

    remaining = await db_session.scalars(select(ShareItem).where(ShareItem.share_id == share_id))
    assert remaining.all() == []
