"""A4 poster PDF for a share's QR code — the printable bridge from
physical (conference poster, slide, business card) to digital.

One fixed layout per the qr-poster-pdf ticket: centred QR (~12cm), share
name in a serif below, short URL in monospace, optional owner credit,
small wordmark footer. Generated in-memory on demand; the route's
``s-maxage`` header makes the CDN absorb repeat loads.

Fonts are reportlab's built-in Type1 faces (Times-Roman / Courier /
Helvetica) — zero bundling, but Latin-1 only, so every drawn string is
sanitized with replacement characters. Documented v1 limitation; bundle a
TTF if non-Latin titles become common.
"""

from __future__ import annotations

import io

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

_TITLE_MAX_CHARS = 80


def _latin1(text: str) -> str:
    """Built-in Type1 fonts can only encode Latin-1; degrade instead of 500."""
    return text.encode("latin-1", "replace").decode("latin-1")


def _truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def build_share_poster(
    *,
    qr_png: bytes,
    share_name: str,
    display_url: str,
    owner_name: str | None,
) -> bytes:
    """Compose the A4 portrait poster and return the PDF bytes."""
    buf = io.BytesIO()
    page_w, page_h = A4
    pdf = canvas.Canvas(buf, pagesize=A4)
    pdf.setTitle(_latin1(share_name))

    # Centred QR, 12cm square, upper-middle of the page.
    qr_size = 12 * cm
    qr_x = (page_w - qr_size) / 2
    qr_y = page_h - 4 * cm - qr_size
    pdf.drawImage(
        ImageReader(io.BytesIO(qr_png)),
        qr_x,
        qr_y,
        width=qr_size,
        height=qr_size,
        preserveAspectRatio=True,
    )

    # Share name — serif headline, shrink-to-fit a single centred line.
    title = _latin1(_truncate(share_name, _TITLE_MAX_CHARS))
    font_size = 28.0
    max_width = page_w - 4 * cm
    while font_size > 12 and pdf.stringWidth(title, "Times-Roman", font_size) > max_width:
        font_size -= 1
    pdf.setFont("Times-Roman", font_size)
    title_y = qr_y - 2 * cm
    pdf.drawCentredString(page_w / 2, title_y, title)

    # Short URL — monospace, the human-typable fallback to the QR.
    pdf.setFont("Courier", 14)
    pdf.drawCentredString(page_w / 2, title_y - 1.2 * cm, _latin1(display_url))

    # Owner credit, only when the share has a named owner.
    if owner_name:
        pdf.setFont("Helvetica", 12)
        pdf.setFillGray(0.35)
        pdf.drawCentredString(page_w / 2, title_y - 2.4 * cm, _latin1(f"by {owner_name}"))

    # Wordmark footer — small, grey, free distribution.
    pdf.setFont("Helvetica", 8)
    pdf.setFillGray(0.55)
    pdf.drawCentredString(page_w / 2, 1.5 * cm, "Built with myetal.app")

    pdf.showPage()
    pdf.save()
    return buf.getvalue()
