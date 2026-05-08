"""Tests for ``services/r2_client.py``.

The wrapper is a thin shim over ``boto3.client('s3')`` — these tests
exercise the wiring (right kwargs reach the right boto3 call) by
swapping the lazy module-level client for a ``MagicMock``. We don't
hit a real R2 bucket; that's covered by the route-level integration
tests (which also mock the client).
"""

from __future__ import annotations

from collections.abc import Iterator
from unittest.mock import MagicMock

import pytest

from myetal_api.services import r2_client


@pytest.fixture
def fake_s3() -> Iterator[MagicMock]:
    """Replace the lazy module-level boto3 client with a MagicMock for
    the duration of one test, then reset to None so the next test can
    install its own (or fall back to real boto3 — never used in unit
    tests because credentials default to empty)."""
    fake = MagicMock()
    r2_client._client = fake
    try:
        yield fake
    finally:
        r2_client._reset_client_for_tests()


def test_presign_upload_passes_correct_conditions(fake_s3: MagicMock) -> None:
    fake_s3.generate_presigned_post.return_value = {
        "url": "https://example.r2.cloudflarestorage.com/myetal-uploads",
        "fields": {"key": "pending/abc.pdf", "Content-Type": "application/pdf"},
    }

    result = r2_client.presign_upload(
        key="pending/abc.pdf",
        content_type="application/pdf",
        max_size_bytes=25 * 1024 * 1024,
        expires_in=300,
    )

    assert result["url"].startswith("https://")
    assert result["fields"]["Content-Type"] == "application/pdf"

    fake_s3.generate_presigned_post.assert_called_once()
    kwargs = fake_s3.generate_presigned_post.call_args.kwargs
    assert kwargs["Key"] == "pending/abc.pdf"
    assert kwargs["Fields"] == {"Content-Type": "application/pdf"}
    assert kwargs["ExpiresIn"] == 300
    # content-length-range condition baked in (Bug 5 — R2 enforces at
    # upload time so a malicious client can't post a 1GB body).
    assert ["content-length-range", 0, 25 * 1024 * 1024] in kwargs["Conditions"]
    # eq Content-Type condition pinned to the requested mime.
    assert ["eq", "$Content-Type", "application/pdf"] in kwargs["Conditions"]


def test_public_url_concatenates_settings_host(fake_s3: MagicMock) -> None:
    """``public_url`` reads from the live ``settings`` singleton at call
    time, so we mutate the attribute directly and restore on the way
    out. ``monkeypatch.setattr`` doesn't play nicely with pydantic-
    settings BaseSettings instances on every version, so we reach in
    by hand here."""
    from myetal_api.core.config import settings

    original = settings.r2_public_url
    try:
        settings.r2_public_url = "https://pub-xyz.r2.dev"
        assert r2_client.public_url("shares/abc/items/def.pdf") == (
            "https://pub-xyz.r2.dev/shares/abc/items/def.pdf"
        )

        # Trailing slash on host doesn't double up.
        settings.r2_public_url = "https://pub-xyz.r2.dev/"
        assert r2_client.public_url("foo.jpg") == "https://pub-xyz.r2.dev/foo.jpg"
    finally:
        settings.r2_public_url = original


def test_download_returns_bytes(fake_s3: MagicMock) -> None:
    fake_body = MagicMock()
    fake_body.read.return_value = b"%PDF-1.4 fake"
    fake_s3.get_object.return_value = {"Body": fake_body}

    out = r2_client.download("pending/abc.pdf")
    assert out == b"%PDF-1.4 fake"
    fake_s3.get_object.assert_called_once()
    assert fake_s3.get_object.call_args.kwargs["Key"] == "pending/abc.pdf"


def test_upload_bytes_calls_put_object(fake_s3: MagicMock) -> None:
    r2_client.upload_bytes("thumb.jpg", b"\xff\xd8\xff", content_type="image/jpeg")
    fake_s3.put_object.assert_called_once()
    kwargs = fake_s3.put_object.call_args.kwargs
    assert kwargs["Key"] == "thumb.jpg"
    assert kwargs["Body"] == b"\xff\xd8\xff"
    assert kwargs["ContentType"] == "image/jpeg"


def test_move_object_copies_then_deletes(fake_s3: MagicMock) -> None:
    r2_client.move_object("pending/x.pdf", "shares/abc/items/x.pdf")
    fake_s3.copy_object.assert_called_once()
    copy_kwargs = fake_s3.copy_object.call_args.kwargs
    assert copy_kwargs["Key"] == "shares/abc/items/x.pdf"
    assert copy_kwargs["CopySource"]["Key"] == "pending/x.pdf"

    fake_s3.delete_object.assert_called_once()
    assert fake_s3.delete_object.call_args.kwargs["Key"] == "pending/x.pdf"


def test_move_object_rejects_non_pending_src(fake_s3: MagicMock) -> None:
    """Defence-in-depth (PR-C fix-up): ``move_object`` must refuse to
    move from a final key. Only ``pending/`` sources are valid (they're
    the ones swept by the 24 h lifecycle rule). Future callers that try
    to e.g. relocate a final-key object hit a ValueError before any S3
    op runs."""
    import pytest

    with pytest.raises(ValueError) as ei:
        r2_client.move_object("shares/abc/items/x.pdf", "shares/def/items/y.pdf")
    assert "pending/" in str(ei.value)
    fake_s3.copy_object.assert_not_called()
    fake_s3.delete_object.assert_not_called()


def test_delete_calls_delete_object(fake_s3: MagicMock) -> None:
    r2_client.delete("pending/x.pdf")
    fake_s3.delete_object.assert_called_once()
    assert fake_s3.delete_object.call_args.kwargs["Key"] == "pending/x.pdf"


def test_lazy_client_init_does_not_run_at_import() -> None:
    """Importing ``r2_client`` must not construct a boto3 client — that
    would require valid credentials at import time and break any test
    env that hasn't set them. The fixture above asserts this implicitly
    (it sets ``_client`` directly without going through boto3) but make
    it explicit here too."""
    r2_client._reset_client_for_tests()
    assert r2_client._client is None
