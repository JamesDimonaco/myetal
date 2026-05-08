"""Per-share view-event log.

Per `docs/tickets/public-discovery-and-collaboration.md` D3 + D3.1 + D-S-Iss10
+ D-S-Iss7. The dedup story:

  - **Logged-in users**: dedup on `viewer_user_id`. One view per
    `(viewer_user_id, share_id)` per 24h, enforced application-side.
  - **Mobile (anon or logged-in)**: dedup on `view_token` from the
    `X-View-Token` header. The mobile app generates an opaque random
    install token on first launch and stores it in expo-secure-store.
  - **Anon web**: no cookie (PECR/EDPB exposure rejected — D-S-Iss10).
    Dedup is a transient 24h-rotating in-memory bloom filter keyed by
    `hash(ip || ua || accept-language)`. Rows are still written; only
    the dedup decision differs. No PII at rest.

`viewer_user_id` and `view_token` are mutually exclusive — a request is
either authenticated or not. The CHECK constraint enforces this.

Owner self-views are excluded at write time (D-S-Iss3) — the helper that
inserts skips when `request.user.id == share.owner_user_id`.

Bot/preview-fetch UAs (D-S-Iss8) are skipped at write time too. See
`services/share_view.py` (to be added in chunk D).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from myetal_api.models.base import Base

if TYPE_CHECKING:
    from myetal_api.models.better_auth import User
    from myetal_api.models.share import Share


class ShareView(Base):
    __tablename__ = "share_views"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    share_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("shares.id", ondelete="CASCADE"),
        nullable=False,
    )
    viewer_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Opaque mobile-install token from the X-View-Token header. NOT a cookie,
    # NOT a tracking identifier — a per-install token equivalent to an API
    # key. New install = new token; uninstall reset is acceptable.
    view_token: Mapped[str | None] = mapped_column(String(64), nullable=True)
    viewed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    share: Mapped[Share] = relationship()
    viewer: Mapped[User | None] = relationship()

    __table_args__ = (
        # Logged-in vs. anon-with-token are mutually exclusive.
        CheckConstraint(
            "viewer_user_id IS NULL OR view_token IS NULL",
            name="chk_share_views_viewer_xor_token",
        ),
    )
