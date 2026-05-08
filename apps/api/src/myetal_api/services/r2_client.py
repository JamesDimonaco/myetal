"""Cloudflare R2 client wrapper (S3-compatible).

Per feedback-round-2 §1 (PR-C): user-uploaded PDFs land in the R2
bucket via presigned POST policies issued by FastAPI. Web + mobile
both POST multipart/form-data straight to R2 (no SDK on the client
side — R2 is S3-compatible).

Architecture:

* Backend issues a 5-minute presigned POST policy with a baked-in
  ``content-length-range`` condition (so R2 enforces the 25 MB cap at
  upload time, not just on record-call).
* Client uploads directly to R2.
* Client tells the backend "I'm done" via ``record-pdf-upload`` →
  backend downloads, validates the first 8 bytes, generates a
  thumbnail, promotes the object from ``pending/<uuid>.pdf`` to
  ``shares/<share_id>/items/<uuid>.pdf``, persists URLs.

This module is a thin wrapper around boto3's S3 client. The client is
lazy-initialised on first call (``_get_client``) so:

* importing the module never touches the network or env vars,
* tests that monkey-patch ``boto3.client`` work without an autouse
  fixture, and
* the prod server pays the boto3 client-construction cost once per
  process (single uvicorn worker per the deploy doc).
"""

from __future__ import annotations

from typing import Any

import boto3

from myetal_api.core import config as _config_module

_client: Any = None


def _settings() -> Any:
    """Return the live ``settings`` singleton.

    We re-resolve via the config module rather than capturing the
    import-time object so test code that reloads ``myetal_api.core.config``
    (the dev-secret-in-prod guard test does this) doesn't leave us
    pointing at a stale instance. Cheap — single attribute lookup.
    """
    return _config_module.settings


def _get_client() -> Any:
    """Lazy module-level boto3 S3 client pointed at the R2 endpoint.

    R2 is S3-compatible, so we use the standard ``s3`` client with
    ``endpoint_url`` overridden. ``region_name='auto'`` is the R2
    convention (R2 doesn't expose AWS regions but boto3 demands a
    region for SigV4).
    """
    global _client
    if _client is None:
        _client = boto3.client(
            "s3",
            endpoint_url=_settings().r2_endpoint,
            aws_access_key_id=_settings().r2_access_key_id,
            aws_secret_access_key=_settings().r2_secret_access_key.get_secret_value(),
            region_name="auto",
        )
    return _client


def _reset_client_for_tests() -> None:
    """Clear the cached client. Used by the test suite to swap in a
    mock between tests."""
    global _client
    _client = None


def presign_upload(
    key: str,
    content_type: str,
    max_size_bytes: int,
    expires_in: int = 300,
) -> dict[str, Any]:
    """Generate a presigned POST policy for direct-from-client uploads.

    The returned ``{url, fields}`` dict is what the client uses as the
    ``action`` URL and form fields of a ``multipart/form-data`` POST.
    Conditions:

    * ``content-length-range`` — R2 rejects bodies outside this range
      at upload time, so a malicious client can't post a 1 GB file
      regardless of what they claimed at presign time.
    * ``Content-Type`` equality — the client must send the same
      content-type they declared. This is informational (the
      authoritative MIME check is the server-side first-8-byte sniff
      after upload, per Q3) but it's free defence-in-depth.

    ``expires_in`` defaults to 300 s (5 min) — long enough for slow
    mobile uploads, short enough that an issued presign can't be
    replayed for hours.
    """
    s3 = _get_client()
    return s3.generate_presigned_post(
        Bucket=_settings().r2_bucket,
        Key=key,
        Fields={"Content-Type": content_type},
        Conditions=[
            ["content-length-range", 0, max_size_bytes],
            ["eq", "$Content-Type", content_type],
        ],
        ExpiresIn=expires_in,
    )


def public_url(key: str) -> str:
    """Build the public R2 URL for ``key`` (used by clients to fetch
    the stored PDF / thumbnail). The ``R2_PUBLIC_URL`` setting is the
    bucket's public host — currently the rate-limited ``pub-*.r2.dev``
    domain in dev, swappable to a custom domain later."""
    return f"{_settings().r2_public_url.rstrip('/')}/{key}"


def download(key: str) -> bytes:
    """Read the object at ``key`` into memory.

    Used at record-pdf-upload time to (a) sniff the first 8 bytes for
    the ``%PDF-`` magic and (b) feed the bytes to ``pdf2image`` for
    thumbnail extraction. PDFs are capped at 25 MB so loading into RAM
    on a single-worker FastAPI is fine.
    """
    s3 = _get_client()
    obj = s3.get_object(Bucket=_settings().r2_bucket, Key=key)
    return obj["Body"].read()


def upload_bytes(key: str, body: bytes, content_type: str) -> None:
    """Put ``body`` at ``key`` with the given content-type.

    Used to store the generated thumbnail JPEG. The thumb is small
    (~50 KB at 800px / quality 80) so a single put_object is fine.
    """
    s3 = _get_client()
    s3.put_object(
        Bucket=_settings().r2_bucket,
        Key=key,
        Body=body,
        ContentType=content_type,
    )


def move_object(src_key: str, dst_key: str) -> None:
    """Promote an object from ``src_key`` to ``dst_key``.

    Used to move a successfully-validated upload from
    ``pending/<uuid>.pdf`` to its permanent
    ``shares/<share_id>/items/<uuid>.pdf`` location. R2 supports the
    S3 ``copy_object`` + ``delete_object`` pair; there's no native
    move. The two calls are not atomic — if delete fails after copy,
    the lifecycle rule on ``pending/`` cleans the source within 24 h.

    Defence-in-depth (PR-C fix-up): only objects under ``pending/`` are
    a valid source. The 24 h lifecycle rule on that prefix is what
    keeps abandoned uploads from accumulating; promoting from anywhere
    else risks deleting a final object. Any future caller that wants
    to move a final → final object must use a separate primitive.
    """
    if not src_key.startswith("pending/"):
        raise ValueError(
            f"move_object refuses to move from a non-pending key: {src_key!r} "
            "(must start with 'pending/')"
        )
    s3 = _get_client()
    s3.copy_object(
        Bucket=_settings().r2_bucket,
        Key=dst_key,
        CopySource={"Bucket": _settings().r2_bucket, "Key": src_key},
    )
    s3.delete_object(Bucket=_settings().r2_bucket, Key=src_key)


def delete(key: str) -> None:
    """Delete ``key`` from the bucket. Used to clean up a pending PDF
    when validation fails on the record call."""
    s3 = _get_client()
    s3.delete_object(Bucket=_settings().r2_bucket, Key=key)
