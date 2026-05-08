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
    # K3 fix-up: public viewer requires published_at IS NOT NULL.
    await share_service.publish_share(db_session, public)

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

    # K3 fix-up: public viewer requires published_at IS NOT NULL.
    await share_service.publish_share(db_session, share)

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
    # K3 fix-up: public viewer requires published_at IS NOT NULL.
    await share_service.publish_share(db_session, share)
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


# ---------- tag attach/detach via PATCH /shares/{id} (PR-A) ----------


async def test_create_share_with_tags_attaches_them(
    api_client: TestClient, db_session: AsyncSession
) -> None:
    """POST /shares with `tags: ["virology", "microbiome"]` attaches both
    and reflects them on the response."""
    user = await _make_user(db_session)
    # Use the service directly for auth-free creation (route auth is
    # exercised elsewhere). Tags should round-trip into the response.
    from myetal_api.services import tags as tags_service

    share = await share_service.create_share(
        db_session,
        user.id,
        ShareCreate(name="x", tags=["virology", "microbiome"]),
    )
    attached = await tags_service.list_for_share(db_session, share.id)
    assert {t.slug for t in attached} == {"virology", "microbiome"}


async def test_update_share_with_tags_atomically_replaces(
    db_session: AsyncSession,
) -> None:
    """PATCH-equivalent service call replaces (does not append) tags."""
    user = await _make_user(db_session)
    from myetal_api.services import tags as tags_service

    share = await share_service.create_share(
        db_session,
        user.id,
        ShareCreate(name="x", tags=["virology", "microbiome"]),
    )
    # Replace with a single different tag.
    await share_service.update_share(db_session, share, ShareUpdate(tags=["genomics"]))
    after = await tags_service.list_for_share(db_session, share.id)
    assert {t.slug for t in after} == {"genomics"}


async def test_update_share_with_empty_tags_clears(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    from myetal_api.services import tags as tags_service

    share = await share_service.create_share(
        db_session, user.id, ShareCreate(name="x", tags=["virology"])
    )
    await share_service.update_share(db_session, share, ShareUpdate(tags=[]))
    after = await tags_service.list_for_share(db_session, share.id)
    assert after == []


async def test_update_share_with_tags_none_leaves_alone(
    db_session: AsyncSession,
) -> None:
    user = await _make_user(db_session)
    from myetal_api.services import tags as tags_service

    share = await share_service.create_share(
        db_session, user.id, ShareCreate(name="x", tags=["virology"])
    )
    await share_service.update_share(db_session, share, ShareUpdate(name="renamed"))
    after = await tags_service.list_for_share(db_session, share.id)
    assert {t.slug for t in after} == {"virology"}


async def test_create_share_unknown_slug_auto_creates_tag(
    db_session: AsyncSession,
) -> None:
    """Q9-C hybrid: free-form unknown slugs are created on attach, not
    rejected with 400."""
    user = await _make_user(db_session)
    from myetal_api.services import tags as tags_service

    await share_service.create_share(
        db_session,
        user.id,
        ShareCreate(name="x", tags=["a-totally-fresh-tag"]),
    )
    fresh = await tags_service.get_or_create_tag(db_session, "a-totally-fresh-tag")
    assert fresh.usage_count == 1


async def test_create_share_too_many_tags_rejected_at_schema(
    api_client: TestClient,
) -> None:
    """Schema cap of 5 — Pydantic Field(max_length=5) rejects 6 tags
    with 422 before the service ever runs.

    Auth: stub a user via direct registration + login flow, then POST.
    """
    # Register + login to get a bearer token.
    r = api_client.post(
        "/auth/register",
        json={"email": "capper@example.com", "password": "hunter22", "name": "Cap"},
    )
    assert r.status_code in (200, 201)
    body = r.json()
    token = body.get("access_token") or body.get("token")
    headers = {"Authorization": f"Bearer {token}"} if token else {}

    payload = {
        "name": "x",
        "tags": ["a-tag", "b-tag", "c-tag", "d-tag", "e-tag", "f-tag"],
    }
    r = api_client.post("/shares", json=payload, headers=headers)
    # 422 (schema) or 400 (service) both acceptable; assert it's not 201.
    assert r.status_code in (400, 422)


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


# ---------- PR-C fix-up tests ----------


async def test_share_item_create_rejects_pdf_kind() -> None:
    """K1 fix-up: ShareItemCreate must reject ``kind=pdf`` so a malicious
    PATCH /shares/{id} payload can't forge a PDF item pointing at any URL.

    Pydantic raises ValidationError on the model_validator; route layer
    surfaces this as 422.
    """
    import pytest
    from pydantic import ValidationError

    with pytest.raises(ValidationError) as ei:
        ShareItemCreate(kind=ItemKind.PDF, title="forged")
    msg = str(ei.value)
    assert "record-pdf-upload" in msg


async def test_patch_share_with_pdf_kind_in_items_returns_422(
    api_client: TestClient, db_session: AsyncSession
) -> None:
    """K1: PATCH /shares/{id} with ``kind=pdf`` items in the body must
    fail at validation (422) before any DB write."""
    # Register + login.
    r = api_client.post(
        "/auth/register",
        json={"email": "k1@example.com", "password": "hunter22", "name": "K1"},
    )
    assert r.status_code in (200, 201)
    token = r.json().get("access_token") or r.json().get("token")
    headers = {"Authorization": f"Bearer {token}"}

    r = api_client.post("/shares", json={"name": "x"}, headers=headers)
    assert r.status_code == 201
    share_id = r.json()["id"]

    # Forged PDF item — schema rejects it.
    r = api_client.patch(
        f"/shares/{share_id}",
        json={
            "items": [
                {
                    "kind": "pdf",
                    "title": "Evil",
                    "file_url": "https://attacker.com/evil.exe",
                }
            ]
        },
        headers=headers,
    )
    assert r.status_code == 422


async def test_patch_share_round_trips_existing_pdf_item(
    db_session: AsyncSession,
) -> None:
    """K1: when the editor PATCHes the full items array, an existing PDF
    item identified by id is preserved (server-managed PDF fields are
    NOT overwritten with client-supplied values — they aren't accepted
    on input at all)."""
    user = await _make_user(db_session)
    share = await share_service.create_share(
        db_session,
        user.id,
        ShareCreate(name="x", items=[ShareItemCreate(title="non-pdf")]),
    )

    # Seed a PDF row directly (mimics what record_pdf_upload would
    # produce). Bypassing the route keeps the test focused on the
    # service-layer round-trip semantics.
    from datetime import UTC, datetime

    from myetal_api.models import ShareItem

    pdf_row = ShareItem(
        share_id=share.id,
        position=1,
        kind=ItemKind.PDF,
        title="My poster",
        file_url="https://r2.example/shares/x/items/pdf-uuid.pdf",
        file_size_bytes=12345,
        file_mime="application/pdf",
        thumbnail_url="https://r2.example/shares/x/items/pdf-uuid-thumb.jpg",
        copyright_ack_at=datetime.now(UTC),
    )
    db_session.add(pdf_row)
    await db_session.commit()
    pdf_id = pdf_row.id

    # Async session caches the items collection from the original
    # ``create_share`` call. ``await session.refresh`` reloads it
    # without triggering lazy IO.
    await db_session.refresh(share, ["items"])
    assert any(i.kind == ItemKind.PDF for i in share.items)

    # Editor PATCH: round-trip both items, but the PDF entry omits the
    # PDF-only fields (which aren't on ShareItemCreate). The id is the
    # only signal the service uses to recognise an existing PDF row.
    payload = ShareUpdate(
        items=[
            ShareItemCreate(title="non-pdf", id=share.items[0].id),
            ShareItemCreate(id=pdf_id, title="My poster (renamed)"),
        ]
    )
    updated = await share_service.update_share(db_session, share, payload)

    pdf_after = next(i for i in updated.items if i.id == pdf_id)
    assert pdf_after.kind == ItemKind.PDF
    assert pdf_after.title == "My poster (renamed)"
    # Server-managed fields preserved.
    assert pdf_after.file_url == "https://r2.example/shares/x/items/pdf-uuid.pdf"
    assert pdf_after.file_size_bytes == 12345
    assert pdf_after.file_mime == "application/pdf"
    assert pdf_after.thumbnail_url == ("https://r2.example/shares/x/items/pdf-uuid-thumb.jpg")
    assert pdf_after.copyright_ack_at is not None


async def test_unpublished_public_share_not_resolvable_via_short_code(
    api_client: TestClient, db_session: AsyncSession
) -> None:
    """K3: ``/c/{short_code}`` must 404 for an ``is_public=True`` share
    that hasn't been published — drafts must not leak via the public
    viewer (e.g. uploaded PDFs visible to anonymous visitors).
    """
    user = await _make_user(db_session)
    share = await share_service.create_share(
        db_session,
        user.id,
        ShareCreate(name="draft", is_public=True),
    )
    # Don't publish.
    r = api_client.get(f"/public/c/{share.short_code}")
    assert r.status_code == 404

    # After publishing, the same code resolves.
    await share_service.publish_share(db_session, share)
    r = api_client.get(f"/public/c/{share.short_code}")
    assert r.status_code == 200


async def test_post_share_with_empty_items_succeeds(
    api_client: TestClient,
) -> None:
    """Empty share save (Option A): the editor needs to be able to save a
    share before any items are attached so the PDF-upload tab can run with
    a real share_id. POST /shares with ``items=[]`` returns 201.
    """
    r = api_client.post(
        "/auth/register",
        json={"email": "empty@example.com", "password": "hunter22", "name": "Empty"},
    )
    assert r.status_code in (200, 201)
    token = r.json().get("access_token") or r.json().get("token")
    headers = {"Authorization": f"Bearer {token}"}

    r = api_client.post(
        "/shares",
        json={"name": "Untitled", "items": []},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["id"]
    assert body["items"] == []
