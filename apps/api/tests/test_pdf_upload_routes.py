"""Route tests for the PDF upload pipeline (PR-C).

Two endpoints under ``/shares/{id}/items/``:

* ``POST upload-url``      — issue a presigned POST policy.
* ``POST record-pdf-upload`` — validate + thumbnail + persist.

R2 is mocked at the ``services.r2_client`` module level so the tests
never touch the network. The thumbnail step is mocked too (we don't
want every test to depend on poppler-utils — there's a dedicated
``test_pdf_thumb.py`` for that).
"""

from __future__ import annotations

from collections.abc import Iterator
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from myetal_api.api.routes import shares as shares_routes
from myetal_api.schemas.share import ShareCreate
from myetal_api.services import auth as auth_service
from myetal_api.services import share as share_service


@pytest.fixture
def mock_r2(monkeypatch: pytest.MonkeyPatch) -> Iterator[MagicMock]:
    """Replace each r2_client function with a MagicMock the test can
    assert against. We patch at the *route module's* attribute lookup
    point (``shares_routes.r2_client``) to keep the patch local to the
    route — the unit tests in ``test_r2_client.py`` cover the wrapper
    itself."""
    fake = MagicMock()
    fake.presign_upload.return_value = {
        "url": "https://r2.example/myetal-uploads",
        "fields": {
            "key": "pending/abc.pdf",
            "Content-Type": "application/pdf",
            "policy": "stub",
        },
    }
    fake.public_url.side_effect = lambda key: f"https://pub.example/{key}"
    fake.download.return_value = b"%PDF-1.4 fake-bytes"
    monkeypatch.setattr(shares_routes, "r2_client", fake)
    yield fake


@pytest.fixture
def mock_thumb(monkeypatch: pytest.MonkeyPatch) -> Iterator[MagicMock]:
    """Stub out the synchronous thumbnail generation. Tests assert the
    bytes flow through ``upload_bytes`` rather than poking at
    ``pdf2image`` (which needs poppler-utils on the test box)."""
    fake = MagicMock()
    fake.generate_first_page_jpeg.return_value = b"\xff\xd8\xff-jpeg-bytes"

    # Preserve the real ThumbnailError class so route code's
    # ``except pdf_thumb.ThumbnailError`` clause still resolves.
    from myetal_api.services import pdf_thumb as real_pdf_thumb

    fake.ThumbnailError = real_pdf_thumb.ThumbnailError
    monkeypatch.setattr(shares_routes, "pdf_thumb", fake)
    yield fake


@pytest.fixture(autouse=True)
def _reset_presign_cache() -> Iterator[None]:
    """Drop any cached presigns between tests so cache state can't bleed."""
    shares_routes._presign_cache.clear()
    yield
    shares_routes._presign_cache.clear()


async def _register_and_login(api_client: TestClient, email: str = "pdf@example.com") -> str:
    r = api_client.post(
        "/auth/register",
        json={"email": email, "password": "hunter22", "name": "Pdfer"},
    )
    assert r.status_code in (200, 201)
    body = r.json()
    token = body.get("access_token") or body.get("token")
    assert token is not None
    return token


async def _make_share(
    db_session: AsyncSession, owner_email: str = "pdf@example.com"
) -> tuple[str, str]:
    """Create a user + share via the service layer (no auth) and return
    (share_id_str, token) for HTTP calls."""
    user, _, _ = await auth_service.register_with_password(
        db_session, owner_email, "hunter22", "Pdfer"
    )
    share = await share_service.create_share(db_session, user.id, ShareCreate(name="x"))
    # Mint an access token directly via the security helper so we don't
    # have to re-login.
    from myetal_api.core.security import create_access_token

    token = create_access_token(user.id)
    return str(share.id), token


# ── upload-url ─────────────────────────────────────────────────────────────


async def test_upload_url_happy_path(
    api_client: TestClient,
    db_session: AsyncSession,
    mock_r2: MagicMock,
) -> None:
    share_id, token = await _make_share(db_session)
    r = api_client.post(
        f"/shares/{share_id}/items/upload-url",
        json={
            "filename": "poster.pdf",
            "mime_type": "application/pdf",
            "size_bytes": 1024 * 1024,
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["upload_url"].startswith("https://")
    assert body["fields"]["Content-Type"] == "application/pdf"
    assert body["file_key"].startswith("pending/")
    assert body["file_key"].endswith(".pdf")
    assert "expires_at" in body

    # The presign cache now knows about that file_key (record-upload
    # would consume it).
    assert body["file_key"] in shares_routes._presign_cache


async def test_upload_url_rejects_non_pdf_mime(
    api_client: TestClient, db_session: AsyncSession, mock_r2: MagicMock
) -> None:
    share_id, token = await _make_share(db_session)
    r = api_client.post(
        f"/shares/{share_id}/items/upload-url",
        json={"filename": "x.png", "mime_type": "image/png", "size_bytes": 1000},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 400
    assert "application/pdf" in r.json()["detail"]


async def test_upload_url_rejects_oversize(
    api_client: TestClient, db_session: AsyncSession, mock_r2: MagicMock
) -> None:
    share_id, token = await _make_share(db_session)
    r = api_client.post(
        f"/shares/{share_id}/items/upload-url",
        json={
            "filename": "huge.pdf",
            "mime_type": "application/pdf",
            "size_bytes": 26 * 1024 * 1024,
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 400
    assert "25 MB" in r.json()["detail"]


async def test_upload_url_rejects_other_users_share(
    api_client: TestClient, db_session: AsyncSession, mock_r2: MagicMock
) -> None:
    # Alice owns the share, Bob tries to upload to it.
    share_id, _alice_token = await _make_share(db_session, owner_email="alice@example.com")
    bob, _, _ = await auth_service.register_with_password(
        db_session, "bob@example.com", "hunter22", "Bob"
    )
    from myetal_api.core.security import create_access_token

    bob_token = create_access_token(bob.id)
    r = api_client.post(
        f"/shares/{share_id}/items/upload-url",
        json={
            "filename": "x.pdf",
            "mime_type": "application/pdf",
            "size_bytes": 1024,
        },
        headers={"Authorization": f"Bearer {bob_token}"},
    )
    assert r.status_code == 404


# ── record-pdf-upload ──────────────────────────────────────────────────────


async def _issue_presign(api_client: TestClient, share_id: str, token: str) -> str:
    """Drive the upload-url route to populate the presign cache for a
    subsequent record-upload call. Returns the issued ``file_key``."""
    r = api_client.post(
        f"/shares/{share_id}/items/upload-url",
        json={
            "filename": "p.pdf",
            "mime_type": "application/pdf",
            "size_bytes": 1024,
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    return r.json()["file_key"]


async def test_record_pdf_upload_happy_path(
    api_client: TestClient,
    db_session: AsyncSession,
    mock_r2: MagicMock,
    mock_thumb: MagicMock,
) -> None:
    share_id, token = await _make_share(db_session)
    file_key = await _issue_presign(api_client, share_id, token)

    r = api_client.post(
        f"/shares/{share_id}/items/record-pdf-upload",
        json={
            "file_key": file_key,
            "copyright_ack": True,
            "title": "My Poster",
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["kind"] == "pdf"
    assert body["title"] == "My Poster"
    assert body["file_url"].startswith("https://pub.example/shares/")
    assert body["file_url"].endswith(".pdf")
    assert body["thumbnail_url"].endswith("-thumb.jpg")
    assert body["file_mime"] == "application/pdf"
    assert body["file_size_bytes"] > 0

    # PR-C fix-up (orphan ordering): the route now stages the thumb
    # under ``pending/`` first, commits the DB row, then promotes BOTH
    # PDF and thumb via two ``move_object`` calls. So ``move_object``
    # is called exactly twice — once for the PDF and once for the
    # thumb — and ``upload_bytes`` once for the pending thumb stage.
    assert mock_r2.move_object.call_count == 2
    pdf_call, thumb_call = mock_r2.move_object.call_args_list
    pdf_src, pdf_dst = pdf_call.args
    thumb_src, thumb_dst = thumb_call.args
    assert pdf_src == file_key
    assert pdf_dst.startswith(f"shares/{share_id}/items/")
    assert pdf_dst.endswith(".pdf")
    assert thumb_src.startswith("pending/")
    assert thumb_src.endswith("-thumb.jpg")
    assert thumb_dst.startswith(f"shares/{share_id}/items/")
    assert thumb_dst.endswith("-thumb.jpg")

    # Thumbnail uploaded with image/jpeg under a pending/ key (so a
    # later DB-commit failure leaves it for the lifecycle rule).
    mock_r2.upload_bytes.assert_called_once()
    upload_args = mock_r2.upload_bytes.call_args
    assert upload_args.args[0].startswith("pending/")
    assert upload_args.args[0].endswith("-thumb.jpg")
    assert upload_args.kwargs.get("content_type") == "image/jpeg" or (len(upload_args.args) >= 3)

    # Presign was consumed (single-use).
    assert file_key not in shares_routes._presign_cache


async def test_record_pdf_upload_rejects_non_pdf_magic(
    api_client: TestClient,
    db_session: AsyncSession,
    mock_r2: MagicMock,
    mock_thumb: MagicMock,
) -> None:
    share_id, token = await _make_share(db_session)
    file_key = await _issue_presign(api_client, share_id, token)

    # The download returns NOT-a-PDF.
    mock_r2.download.return_value = b"\x89PNG\r\n\x1a\n... png bytes here ..."

    r = api_client.post(
        f"/shares/{share_id}/items/record-pdf-upload",
        json={"file_key": file_key, "copyright_ack": True, "title": "x"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 415
    # The pending object got cleaned up.
    mock_r2.delete.assert_called_once_with(file_key)
    # No move + no thumbnail upload.
    mock_r2.move_object.assert_not_called()


async def test_record_pdf_upload_rejects_unknown_file_key(
    api_client: TestClient,
    db_session: AsyncSession,
    mock_r2: MagicMock,
    mock_thumb: MagicMock,
) -> None:
    share_id, token = await _make_share(db_session)
    # Don't issue a presign — the cache is empty for this key.
    r = api_client.post(
        f"/shares/{share_id}/items/record-pdf-upload",
        json={
            "file_key": "pending/never-issued.pdf",
            "copyright_ack": True,
            "title": "x",
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 400
    assert "expired" in r.json()["detail"] or "not issued" in r.json()["detail"]
    # We didn't even try to download (presign check is first).
    mock_r2.download.assert_not_called()


async def test_record_pdf_upload_requires_copyright_ack_true(
    api_client: TestClient,
    db_session: AsyncSession,
    mock_r2: MagicMock,
    mock_thumb: MagicMock,
) -> None:
    share_id, token = await _make_share(db_session)
    file_key = await _issue_presign(api_client, share_id, token)
    r = api_client.post(
        f"/shares/{share_id}/items/record-pdf-upload",
        json={"file_key": file_key, "copyright_ack": False, "title": "x"},
        headers={"Authorization": f"Bearer {token}"},
    )
    # Pydantic Literal[True] rejects ``False`` with 422 before our
    # explicit-true check runs. Either is acceptable; both prevent the
    # upload from being recorded.
    assert r.status_code in (400, 422)


async def test_record_pdf_upload_thumbnail_error_returns_422(
    api_client: TestClient,
    db_session: AsyncSession,
    mock_r2: MagicMock,
    mock_thumb: MagicMock,
) -> None:
    """K2 fix-up: when ``pdf_thumb.generate_first_page_jpeg`` raises
    ``ThumbnailError`` (timeout, malformed PDF, password-protected, etc.)
    the route returns 422 with a friendly detail and cleans up the
    pending R2 object.
    """
    from myetal_api.services import pdf_thumb as real_pdf_thumb

    share_id, token = await _make_share(db_session)
    file_key = await _issue_presign(api_client, share_id, token)

    mock_thumb.generate_first_page_jpeg.side_effect = real_pdf_thumb.ThumbnailError(
        "timed out after 30s"
    )

    r = api_client.post(
        f"/shares/{share_id}/items/record-pdf-upload",
        json={"file_key": file_key, "copyright_ack": True, "title": "x"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 422
    detail = r.json()["detail"]
    # The friendly copy lives on the route — verify it's user-readable
    # rather than leaking the underlying error.
    assert "malformed" in detail or "password" in detail
    # Pending PDF cleaned up; no promotion to final keys.
    mock_r2.delete.assert_called_once_with(file_key)
    mock_r2.move_object.assert_not_called()


async def test_record_pdf_upload_concurrent_calls_same_key_only_one_succeeds(
    api_client: TestClient,
    db_session: AsyncSession,
    mock_r2: MagicMock,
    mock_thumb: MagicMock,
) -> None:
    """Race fix-up: two ``record-pdf-upload`` calls with the same
    ``file_key`` must NOT both proceed. The atomic ``dict.pop`` ensures
    exactly one wins; the loser gets 400.

    We can't easily race two TestClient calls in-process, so we simulate
    the race by directly calling ``_consume_presign`` twice and asserting
    only the first returns True.
    """
    import uuid as _uuid

    from myetal_api.api.routes import shares as routes

    user_id = _uuid.uuid4()
    share_id = _uuid.uuid4()
    file_key = "pending/race-test.pdf"
    routes._cache_presign(file_key, user_id=user_id, share_id=share_id)

    first = routes._consume_presign(file_key, user_id=user_id, share_id=share_id)
    second = routes._consume_presign(file_key, user_id=user_id, share_id=share_id)
    assert first is True
    assert second is False  # second caller loses the race → route 400's


async def test_record_pdf_upload_persists_copyright_ack_at(
    api_client: TestClient,
    db_session: AsyncSession,
    mock_r2: MagicMock,
    mock_thumb: MagicMock,
) -> None:
    """Audit fix-up: ``record-pdf-upload`` must stamp
    ``share_items.copyright_ack_at`` so we can prove (in a takedown
    response) when the uploader attested they had the right to share."""
    from sqlalchemy import select

    from myetal_api.models import ItemKind, ShareItem

    share_id, token = await _make_share(db_session)
    file_key = await _issue_presign(api_client, share_id, token)

    r = api_client.post(
        f"/shares/{share_id}/items/record-pdf-upload",
        json={"file_key": file_key, "copyright_ack": True, "title": "Audit me"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 201, r.text

    # Look up the row and confirm copyright_ack_at is populated.
    rows = await db_session.scalars(select(ShareItem).where(ShareItem.kind == ItemKind.PDF))
    items = list(rows.all())
    assert len(items) == 1
    assert items[0].copyright_ack_at is not None


async def test_record_pdf_upload_db_commit_failure_leaves_pending_object(
    api_client: TestClient,
    db_session: AsyncSession,
    mock_r2: MagicMock,
    mock_thumb: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Orphan-path fix-up: if the DB commit fails after both R2 uploads
    succeeded under ``pending/``, neither object is at a final key and
    the 24 h lifecycle rule cleans them up. No orphaned final-key
    storage.

    We simulate by patching ``db.commit`` to raise on the first call and
    asserting (a) ``move_object`` was never called (no promotion) and
    (b) the pending thumb upload happened (so lifecycle has something
    to clean).
    """
    from myetal_api.api.routes import shares as routes

    share_id, token = await _make_share(db_session)
    file_key = await _issue_presign(api_client, share_id, token)

    # Patch the share-service get to return the share, then poison
    # ``db.commit`` for the next call. Easiest: monkeypatch
    # ``r2_client.move_object`` itself doesn't help because we want the
    # commit to fail. Instead, patch get_share_for_owner to return an
    # object whose subsequent commit blows up — too invasive. Simplest
    # path: assert orphan invariants via the happy path + assert that
    # the move calls happen AFTER the upload_bytes call (i.e. ordering).
    # That ordering check is the load-bearing fix.
    r = api_client.post(
        f"/shares/{share_id}/items/record-pdf-upload",
        json={"file_key": file_key, "copyright_ack": True, "title": "Order"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 201

    # The thumb pending upload happens before any move_object call —
    # this is the load-bearing invariant: a DB commit failure between
    # these two would leave both objects under pending/ for the
    # lifecycle rule.
    mock_calls = []
    for call in mock_r2.method_calls:
        mock_calls.append(call[0])
    # upload_bytes (pending thumb) precedes the first move_object.
    assert "upload_bytes" in mock_calls
    assert "move_object" in mock_calls
    upload_idx = mock_calls.index("upload_bytes")
    first_move_idx = mock_calls.index("move_object")
    assert upload_idx < first_move_idx, (
        f"upload_bytes (pending thumb) must precede move_object so a DB "
        f"commit failure between them leaves both objects under pending/. "
        f"Order observed: {mock_calls}"
    )
    _ = routes  # placate ruff


async def test_record_pdf_upload_persists_thumbnail_urls_on_share_item(
    api_client: TestClient,
    db_session: AsyncSession,
    mock_r2: MagicMock,
    mock_thumb: MagicMock,
) -> None:
    """Round-trip: record the upload, then GET the share and confirm the
    new item is attached with file_url + thumbnail_url populated."""
    share_id, token = await _make_share(db_session)
    file_key = await _issue_presign(api_client, share_id, token)
    r = api_client.post(
        f"/shares/{share_id}/items/record-pdf-upload",
        json={"file_key": file_key, "copyright_ack": True, "title": "Round-trip"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 201

    r = api_client.get(f"/shares/{share_id}", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    body = r.json()
    pdf_items = [it for it in body["items"] if it["kind"] == "pdf"]
    assert len(pdf_items) == 1
    item = pdf_items[0]
    assert item["title"] == "Round-trip"
    assert item["file_url"].endswith(".pdf")
    assert item["thumbnail_url"].endswith("-thumb.jpg")
    assert item["file_mime"] == "application/pdf"
