"""Server-side PDF thumbnail generation.

Per feedback-round-2 §1 (Q5-B): the public viewer renders a PDF item
as a first-page thumbnail card linking to the full file. Thumbnails are
generated synchronously inside the ``record-pdf-upload`` route after
the bytes have been validated.

Stack:
* ``pdf2image`` shells out to ``poppler-utils`` (``pdftoppm``) — added
  to ``apps/api/Dockerfile`` so the prod image has the binary.
* ``Pillow`` re-encodes to JPEG with the configured quality / max
  width.

Sizing: 800 px wide, JPEG quality 80 → ~50 KB per thumbnail. On the
Pi the conversion takes ~3-8 s for a 25 MB PDF; that's the cost of
keeping the v1 path synchronous (acknowledged in the plan §1).

K2 (PR-C fix-up): ``pdftoppm`` is invoked with ``timeout=30`` so a
crafted PDF (xref bombs, deep font nesting, malformed dictionaries)
can't hang the single-uvicorn-worker API. pdf2image surfaces a
``PDFPopplerTimeoutError`` (or any other exception) which we wrap in
``ThumbnailError`` for the route layer.
"""

from __future__ import annotations

import io

# Wall-clock cap on the pdftoppm subprocess. 30 s is enough to
# rasterise a healthy 25 MB PDF on the Pi (real-world ~3-8 s) but
# strict enough to block xref-bomb hangs that would otherwise tie up
# the single uvicorn worker indefinitely. Per K2 (PR-C fix-up).
THUMBNAIL_TIMEOUT_SECONDS = 30


class ThumbnailError(ValueError):
    """Raised when a PDF can't be rasterised (corrupt file, password-
    protected, timeout, no pages, etc.). The route layer maps this to a
    4xx so the client gets a clear error rather than a 500."""


def generate_first_page_jpeg(
    pdf_bytes: bytes,
    *,
    max_width: int = 800,
    quality: int = 80,
) -> bytes:
    """Return JPEG bytes of the first page of ``pdf_bytes``.

    ``size=(max_width, None)`` asks pdf2image / poppler to keep aspect
    ratio while constraining the long edge, so we don't squash
    portrait posters.

    Imports are deferred so the module can be imported (and unit-
    tested with mocked thumbs) on machines without poppler-utils.

    Raises ``ThumbnailError`` on any pdf2image / poppler failure
    (including the wall-clock timeout from K2).
    """
    # Defer so that route tests which mock this function don't need
    # poppler-utils on the test machine.
    from pdf2image import convert_from_bytes

    try:
        pages = convert_from_bytes(
            pdf_bytes,
            first_page=1,
            last_page=1,
            fmt="jpeg",
            size=(max_width, None),
            timeout=THUMBNAIL_TIMEOUT_SECONDS,
        )
    except Exception as exc:
        # pdf2image wraps poppler errors broadly. Includes
        # PDFPopplerTimeoutError (from the timeout above),
        # PDFInfoNotInstalledError (binary missing), PDFPageCountError,
        # PDFSyntaxError, etc. — every one becomes a 4xx via
        # ThumbnailError.
        raise ThumbnailError(f"could not rasterise PDF: {exc}") from exc

    if not pages:
        raise ThumbnailError("PDF has no pages")

    buf = io.BytesIO()
    pages[0].save(buf, format="JPEG", quality=quality, optimize=True)
    return buf.getvalue()
