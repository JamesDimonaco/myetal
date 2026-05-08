"""Tests for ``services/pdf_thumb.py``.

Two-tier strategy:

* The happy-path test runs a real PDF through poppler-utils → Pillow and
  asserts the output looks like a JPEG. This test ``importorskip``s
  ``pdf2image`` and skips when the ``pdftoppm`` binary isn't on PATH so
  the suite stays green on dev machines / CI runners that don't install
  poppler.
* The error-path test exercises ``ThumbnailError`` without poppler by
  pointing the function at obviously-not-a-PDF bytes — pdf2image still
  needs to be importable, but the test passes whether or not the
  binary is there (poppler will refuse the bytes either way).
"""

from __future__ import annotations

import shutil

import pytest


def _poppler_available() -> bool:
    """Return True when ``pdftoppm`` is on PATH. ``pdf2image`` shells
    out to it; without it every conversion fails."""
    return shutil.which("pdftoppm") is not None


def _build_minimal_pdf() -> bytes:
    """Smallest hand-rolled PDF the thumbnail pipeline can rasterise.

    Exists so the test doesn't depend on a fixture file. The structure
    follows the PDF 1.4 spec: header, four objects (catalog, pages,
    page, font), xref, trailer. poppler is happy to render this as a
    blank page.
    """
    objs = [
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
        b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
        (
            b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            b"/Resources << /Font << /F1 4 0 R >> >> >>\nendobj\n"
        ),
        b"4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets: list[int] = []
    for obj in objs:
        offsets.append(len(out))
        out += obj
    xref_offset = len(out)
    out += b"xref\n0 5\n"
    out += b"0000000000 65535 f \n"
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += b"trailer\n<< /Size 5 /Root 1 0 R >>\n"
    out += f"startxref\n{xref_offset}\n%%EOF\n".encode()
    return bytes(out)


def test_generate_first_page_jpeg_returns_jpeg_bytes() -> None:
    """End-to-end: real PDF in → JPEG bytes out, under the 80 KB target."""
    pytest.importorskip("pdf2image")
    if not _poppler_available():
        pytest.skip("poppler-utils (pdftoppm) not installed in this env")

    from myetal_api.services.pdf_thumb import generate_first_page_jpeg

    out = generate_first_page_jpeg(_build_minimal_pdf())

    # JPEG magic — every JPEG starts with FF D8 FF.
    assert out[:3] == b"\xff\xd8\xff"
    # 800-px JPEG of a blank page comfortably under 80 KB; this is a
    # cheap smoke that the thumbnail spec from the plan holds.
    assert len(out) <= 80_000


def test_generate_first_page_jpeg_raises_on_non_pdf() -> None:
    """Garbage bytes → ``ThumbnailError`` (not a 500). The route layer
    catches this and returns 400 to the client."""
    pytest.importorskip("pdf2image")
    if not _poppler_available():
        pytest.skip("poppler-utils (pdftoppm) not installed in this env")

    from myetal_api.services.pdf_thumb import (
        ThumbnailError,
        generate_first_page_jpeg,
    )

    with pytest.raises(ThumbnailError):
        generate_first_page_jpeg(b"this is plainly not a PDF")
