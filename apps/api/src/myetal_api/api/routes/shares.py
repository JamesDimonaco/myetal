import logging
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, Query, Request, status

from myetal_api.api.deps import CurrentUser, DbSession
from myetal_api.core.rate_limit import authed_user_key, limiter
from myetal_api.models import ItemKind, ShareItem
from myetal_api.schemas.share import (
    PdfUploadUrlRequest,
    PdfUploadUrlResponse,
    RecordPdfUploadRequest,
    ShareAnalyticsResponse,
    ShareCreate,
    ShareItemResponse,
    ShareResponse,
    ShareUpdate,
)
from myetal_api.services import pdf_thumb, r2_client
from myetal_api.services import share as share_service
from myetal_api.services.tags import InvalidTagSlug, TooManyTags

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/shares", tags=["shares"])

# ── PDF upload constants (feedback-round-2 §1, Q2) ─────────────────────────
# Hard cap mirrored on the client and enforced by R2 (presigned POST
# policy ``content-length-range``) AND server-side on record-upload.
MAX_PDF_SIZE_BYTES = 25 * 1024 * 1024  # 25 MB
PDF_MIME = "application/pdf"
PDF_PRESIGN_TTL_SECONDS = 300  # 5 minutes — matches the presigned POST expiry
PDF_MAGIC = b"%PDF-"


# ── Presign cache (Bug 4 resolution from feedback-round-2 plan) ────────────
# In-memory dict mapping ``file_key`` → metadata so the record-upload route
# can verify the key was issued by us and is bound to the right (user,
# share, expiry). Single-worker uvicorn deploy means one process owns the
# cache; on API restart, in-flight uploads' record calls 400 with "presign
# expired" — acceptable per the plan ("user retries from the upload picker").
#
# Eviction strategy: opportunistic — every consumer call drops expired
# entries before checking. Combined with the 5-minute TTL the dict size is
# bounded by upload concurrency, not by uptime.
_presign_cache: dict[str, dict[str, object]] = {}


def _cache_presign(file_key: str, *, user_id: uuid.UUID, share_id: uuid.UUID) -> datetime:
    """Record an issued presign and return its absolute expiry. The
    expires_at value is also returned to the client in the response so
    the UI can show "your upload window closes at HH:MM"."""
    expires_at = datetime.now(UTC) + timedelta(seconds=PDF_PRESIGN_TTL_SECONDS)
    _presign_cache[file_key] = {
        "user_id": user_id,
        "share_id": share_id,
        "expires_at": expires_at,
    }
    return expires_at


# Sentinel for atomic pop-and-check (PR-C fix-up: race). ``dict.pop``
# is atomic under the GIL, so popping with a sentinel default lets two
# concurrent ``record-pdf-upload`` calls with the same ``file_key``
# race safely — exactly one observes a non-sentinel value and proceeds;
# the loser observes the sentinel and 4xx's. No asyncio.Lock needed.
_PRESIGN_SENTINEL: dict[str, object] = {}


def _consume_presign(file_key: str, *, user_id: uuid.UUID, share_id: uuid.UUID) -> bool:
    """Validate + remove a presign entry. Returns True iff the entry
    exists, matches (user_id, share_id), and has not expired. Drops the
    entry on success or stale; leaves mismatched entries alone (so a
    confused/malicious client can't evict another user's pending key).

    Atomic against concurrent calls with the same ``file_key`` (PR-C
    fix-up: race). ``dict.pop`` is GIL-protected in CPython, so two
    coroutines racing on the same key see exactly one non-sentinel
    return value — only that caller proceeds with download / move.

    Also opportunistically evicts every other expired entry so the dict
    can't grow without bound on a long-lived worker.
    """
    now = datetime.now(UTC)
    # Sweep stale entries (cheap — bounded by concurrent uploads).
    for k in [k for k, v in _presign_cache.items() if v["expires_at"] <= now]:  # type: ignore[operator]
        _presign_cache.pop(k, None)

    # Peek first so a mismatched (wrong-user) caller doesn't evict the
    # legitimate owner's entry. Fast-path the negative cases without
    # popping; only pop when we're committing to use the entry.
    entry = _presign_cache.get(file_key)
    if entry is None:
        return False
    if entry["user_id"] != user_id or entry["share_id"] != share_id:
        return False
    if entry["expires_at"] <= now:  # type: ignore[operator]
        _presign_cache.pop(file_key, None)
        return False

    # Atomic claim — if another coroutine already popped this key
    # between the get() above and here, we get the sentinel and lose
    # the race.
    popped = _presign_cache.pop(file_key, _PRESIGN_SENTINEL)
    if popped is _PRESIGN_SENTINEL:
        return False
    # Re-validate the popped entry — defence-in-depth in case state
    # changed between peek and pop (e.g. expiry tipped over the line).
    if popped["user_id"] != user_id or popped["share_id"] != share_id:  # type: ignore[index]
        return False
    if popped["expires_at"] <= now:  # type: ignore[operator,index]
        return False
    return True


@router.post("", response_model=ShareResponse, status_code=status.HTTP_201_CREATED)
async def create_share(body: ShareCreate, user: CurrentUser, db: DbSession) -> ShareResponse:
    try:
        share = await share_service.create_share(db, user.id, body)
    except (InvalidTagSlug, TooManyTags) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
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


@router.get("/{share_id}/analytics", response_model=ShareAnalyticsResponse)
async def get_share_analytics(
    share_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> ShareAnalyticsResponse:
    """Owner analytics for a share: total views, 7d, 30d, and daily breakdown.
    Per D10."""
    share = await share_service.get_share_for_owner(db, share_id, user.id)
    if share is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="share not found")
    return await share_service.get_share_analytics(db, share_id)


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
    try:
        updated = await share_service.update_share(db, share, body)
    except (InvalidTagSlug, TooManyTags) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
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


# ── PDF upload (feedback-round-2 §1, PR-C) ─────────────────────────────────


@router.post(
    "/{share_id}/items/upload-url",
    response_model=PdfUploadUrlResponse,
)
@limiter.limit("20/minute", key_func=authed_user_key)
async def create_pdf_upload_url(
    request: Request,
    share_id: uuid.UUID,
    body: PdfUploadUrlRequest,
    user: CurrentUser,
    db: DbSession,
) -> PdfUploadUrlResponse:
    """Issue a 5-minute presigned POST policy targeting Cloudflare R2.

    Validates the share belongs to the caller, the claimed mime is
    ``application/pdf`` (Q3 — informational; the authoritative sniff
    runs on record), and the claimed size is ≤ 25 MB (Q2). Generates a
    fresh ``pending/<uuid>.pdf`` key and binds it to (user, share)
    inside the in-memory presign cache so the record-upload call can
    confirm we issued it.

    Rate limit: 20/min/user (per ``authed_user_key`` — shared NAT
    doesn't penalise neighbours, see ``core.rate_limit``).
    """
    # Ownership check — same pattern as every other /shares/{id}/* route.
    share = await share_service.get_share_for_owner(db, share_id, user.id)
    if share is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="share not found")
    if share.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="share has been deleted")

    if body.mime_type != PDF_MIME:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"only {PDF_MIME} uploads are supported",
        )
    if body.size_bytes > MAX_PDF_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"file size {body.size_bytes} bytes exceeds the "
                f"{MAX_PDF_SIZE_BYTES // (1024 * 1024)} MB limit — "
                "try compressing the PDF"
            ),
        )

    file_key = f"pending/{uuid.uuid4()}.pdf"
    presigned = r2_client.presign_upload(
        key=file_key,
        content_type=PDF_MIME,
        max_size_bytes=MAX_PDF_SIZE_BYTES,
        expires_in=PDF_PRESIGN_TTL_SECONDS,
    )
    expires_at = _cache_presign(file_key, user_id=user.id, share_id=share_id)

    return PdfUploadUrlResponse(
        upload_url=presigned["url"],
        fields=presigned["fields"],
        file_key=file_key,
        required_content_type=PDF_MIME,
        expires_at=expires_at,
    )


@router.post(
    "/{share_id}/items/record-pdf-upload",
    response_model=ShareItemResponse,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("20/minute", key_func=authed_user_key)
async def record_pdf_upload(
    request: Request,
    share_id: uuid.UUID,
    body: RecordPdfUploadRequest,
    user: CurrentUser,
    db: DbSession,
) -> ShareItemResponse:
    """Promote a successful R2 upload into a ``ShareItem`` row.

    Steps (per feedback-round-2 §1):

    1. Verify share ownership.
    2. Verify the presign cache has an entry for ``file_key`` bound to
       (user, share). Missing/expired/mismatched → 400.
    3. ``r2_client.download(file_key)`` → bytes. The 25 MB cap means
       this fits in RAM on the Pi.
    4. Sniff first 8 bytes for ``%PDF-`` (Q3 authoritative MIME check)
       → 415 on miss.
    5. Defence-in-depth: actual size ≤ 25 MB (R2's
       ``content-length-range`` already enforced, but we re-verify
       so a buggy R2 config can't break the contract).
    6. Generate first-page JPEG via ``pdf_thumb.generate_first_page_jpeg``
       (~3-8 s on the Pi, acknowledged in plan).
    7. Move the PDF to ``shares/<share_id>/items/<uuid>.pdf`` and put
       the thumb at ``shares/<share_id>/items/<uuid>-thumb.jpg``.
    8. Insert a new ``ShareItem`` with ``kind='pdf'`` and the public
       URLs persisted.

    Any 4xx between steps 3 and 6 cleans up the pending object so we
    don't leave validated-but-rejected bytes in the bucket — the
    24 h lifecycle rule on ``pending/`` is the safety net for the
    happy-but-interrupted case.
    """
    share = await share_service.get_share_for_owner(db, share_id, user.id)
    if share is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="share not found")
    if share.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="share has been deleted")

    # copyright_ack is Literal[True] in the schema, so anything other
    # than literal true is a 422 from Pydantic before we get here. The
    # explicit check below is belt-and-braces against future schema
    # relaxation (and gives a clearer 400 message if the model is ever
    # widened to bool).
    if body.copyright_ack is not True:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="you must acknowledge that you have the right to share this file",
        )

    if not _consume_presign(body.file_key, user_id=user.id, share_id=share_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "upload session has expired or was not issued by this server — "
                "please re-pick the file and retry"
            ),
        )

    # Pull the bytes back from R2 for validation + thumbnail extraction.
    try:
        pdf_bytes = r2_client.download(body.file_key)
    except Exception as exc:
        # If R2 gave us a presign but the object isn't there (client
        # never finished the upload), surface 400 so the UI prompts a
        # retry. Pending key gets cleaned by the lifecycle rule.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="uploaded file is not available — please retry the upload",
        ) from exc

    if len(pdf_bytes) > MAX_PDF_SIZE_BYTES:
        # R2 should have rejected this at upload time via
        # content-length-range; defence in depth.
        r2_client.delete(body.file_key)
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"file exceeds the {MAX_PDF_SIZE_BYTES // (1024 * 1024)} MB limit — "
                "try compressing the PDF"
            ),
        )

    if not pdf_bytes.startswith(PDF_MAGIC):
        # First 8 bytes are not %PDF- — the upload claimed PDF but is
        # something else. Q3 mandates rejection here regardless of the
        # presign-time MIME claim.
        r2_client.delete(body.file_key)
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="uploaded file is not a PDF",
        )

    # Thumbnail (synchronous — ~3-8 s on the Pi for a 25 MB PDF, capped
    # at 30 s by pdf_thumb.THUMBNAIL_TIMEOUT_SECONDS per K2). Any
    # poppler error (corrupt, password-protected, timeout, missing
    # binary, etc.) becomes a 422 with a friendly detail so the user
    # can retry with a healthy file. We clean up the pending PDF on
    # failure.
    try:
        thumb_bytes = pdf_thumb.generate_first_page_jpeg(pdf_bytes)
    except pdf_thumb.ThumbnailError as exc:
        r2_client.delete(body.file_key)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                "Couldn't process this PDF — it may be malformed or "
                "password-protected. Please try a different file."
            ),
        ) from exc

    # ── Orphan-safe ordering (PR-C fix-up) ───────────────────────────
    # Worst-case classes:
    #
    # * Old order (move PDF → upload thumb → DB commit) had two orphan
    #   paths: thumbnail upload failure left a PDF at its FINAL R2 key
    #   with no DB row, and a DB commit failure left BOTH R2 objects
    #   at final keys with no DB row. Final keys aren't covered by the
    #   24 h ``pending/`` lifecycle rule — they would accumulate
    #   forever.
    #
    # * New order (this block):
    #     1. Generate thumb (already done above).
    #     2. Upload thumb to a PENDING key (sibling of pending PDF).
    #     3. Insert ShareItem with URLs pointing at the FINAL keys
    #        (which don't exist yet) and commit.
    #     4. Promote both PDF and thumb from pending → final.
    #
    #   Failure modes:
    #     - Step 2 fails → no DB row, both pending objects auto-GC'd
    #       in 24 h via the ``pending/`` lifecycle rule.
    #     - Step 3 (DB commit) fails → same: DB rolled back, pending
    #       R2 keys auto-GC.
    #     - Step 4 fails partway → DB row exists with URLs at the
    #       final keys, which 404 until either retry or manual
    #       cleanup. Acceptable trade-off vs the alternative (orphaned
    #       R2 storage that nothing can find).
    #
    #   The two keys share the same UUID prefix so an admin browsing
    #   the bucket can see the pair at a glance.
    item_uuid = uuid.uuid4()
    final_pdf_key = f"shares/{share_id}/items/{item_uuid}.pdf"
    final_thumb_key = f"shares/{share_id}/items/{item_uuid}-thumb.jpg"
    pending_thumb_key = f"pending/{item_uuid}-thumb.jpg"

    # Step 2: stage the thumbnail under pending/ so a later DB-commit
    # failure leaves both pending objects to be auto-GC'd.
    try:
        r2_client.upload_bytes(pending_thumb_key, thumb_bytes, content_type="image/jpeg")
    except Exception as exc:
        # Pending PDF stays under pending/ — the 24 h lifecycle rule
        # cleans it. Surface a 5xx so the client can retry; no DB row
        # was created.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="upload storage temporarily unavailable — please retry",
        ) from exc

    # Step 3: persist the ShareItem with URLs pointing at the FINAL
    # keys. Promotion happens after commit so a commit failure leaves
    # both R2 objects under pending/ for the lifecycle rule to clean.
    share = await share_service.get_share_for_owner(db, share_id, user.id)
    assert share is not None  # we already verified above
    next_position = (max((it.position for it in share.items), default=-1)) + 1

    new_item = ShareItem(
        id=item_uuid,
        share_id=share_id,
        position=next_position,
        kind=ItemKind.PDF,
        title=body.title,
        file_url=r2_client.public_url(final_pdf_key),
        file_size_bytes=len(pdf_bytes),
        file_mime=PDF_MIME,
        thumbnail_url=r2_client.public_url(final_thumb_key),
        # Audit (PR-C fix-up): persist the wall-clock timestamp at
        # which the user acknowledged the copyright disclaimer (Q6).
        # Required for takedown defensibility — the column is NULL on
        # every non-PDF row.
        copyright_ack_at=datetime.now(UTC),
    )
    db.add(new_item)
    await db.commit()
    await db.refresh(new_item)

    # Step 4: promote both pending → final. If either move fails the DB
    # row already references the final keys (which don't exist yet);
    # the row's URLs will 404 until either an admin re-runs a repair
    # job or the user re-uploads. Trade-off documented in the comment
    # above — preferable to the old orphan-class bug.
    try:
        r2_client.move_object(body.file_key, final_pdf_key)
        r2_client.move_object(pending_thumb_key, final_thumb_key)
    except Exception as exc:  # noqa: BLE001
        # Don't mask the success status from the client — the DB row
        # is committed. The 24 h lifecycle rule cleans whichever
        # pending key is still around. The row's URLs will 404 until
        # either an admin re-runs a repair sweep or the user re-uploads.
        # Trade-off documented in the round-2 plan as preferable to
        # the old orphan-class bug.
        logger.warning(
            "pdf_promote_failed",
            extra={
                "share_id": str(share.id),
                "file_key": body.file_key,
                "final_pdf_key": final_pdf_key,
                "error": repr(exc),
            },
        )

    return ShareItemResponse.model_validate(new_item)
