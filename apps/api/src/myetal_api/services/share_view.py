"""View tracking write path for public share resolution.

Per discovery ticket D3 + D3.1 + D-S-Iss3 + D-S-Iss8 + D-S-Iss10.

`record_view` is best-effort: it never raises, never blocks the response
the caller is about to return. Skips silently when:

  - Viewer is the share owner (D-S-Iss3 — total_views excludes self-clicks)
  - User-agent matches a known bot or social-preview fetcher (D-S-Iss8)
  - We've already recorded a view from this same dedup channel within 24h

Three dedup channels, mutually exclusive (CHECK constraint on share_views):

  1. **viewer_user_id**: logged-in user. SQL lookback against share_views.
  2. **view_token**: mobile X-View-Token header (per-install opaque token
     from expo-secure-store). SQL lookback against share_views.
  3. **anon-no-token**: in-process dedup keyed on (ip, ua, accept-language,
     share_id). Resets on process restart. The privacy-clean fallback after
     cookie + persisted-IP-hash were both rejected (D-S-Iss10).
"""

from __future__ import annotations

import hashlib
import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Final

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from myetal_api.models import Share, ShareView
from myetal_api.services import share_view_dedup

logger = logging.getLogger(__name__)

_DEDUP_WINDOW: Final = timedelta(hours=24)

# D-S-Iss8 + D15 WAF allowlist: substrings of UAs we explicitly do NOT
# count as user views. Match case-insensitive. The list is intentionally
# conservative — if Slack adds a new bot UA tomorrow we'll over-count
# for a day, which is the right failure mode.
_BOT_UA_SUBSTRINGS: Final[tuple[str, ...]] = (
    # Social preview fetchers
    "twitterbot",
    "facebookexternalhit",
    "slackbot-linkexpanding",
    "discordbot",
    "linkedinbot",
    "mastodon",
    "bluesky",
    "whatsapp",
    "telegrambot",
    # Search crawlers — they shouldn't inflate "human view" analytics
    "googlebot",
    "bingbot",
    "duckduckbot",
    "applebot",
    # Generic bot tells (broad — if a real browser UA contains "bot" we
    # under-count, but no real browser does)
    "spider",
    "crawler",
    "scrapy",
    "headlesschrome",
)


def _is_bot_ua(ua: str | None) -> bool:
    if not ua:
        # Missing UA = almost certainly a script. Don't count.
        return True
    lower = ua.lower()
    return any(needle in lower for needle in _BOT_UA_SUBSTRINGS)


def _hash_anon_key(ip: str, ua: str, accept_language: str, share_id: uuid.UUID) -> str:
    """Opaque dedup key for the anon-no-token path.

    SHA-256 keeps the in-memory dict keys uniform-length and removes the
    most obvious "this looks like an IP" surface from a memory dump.
    Not a security boundary — anyone with the running process can read
    the dict either way. Hashing is hygiene, not protection.
    """
    raw = f"{ip}|{ua}|{accept_language}|{share_id}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


async def record_view(
    db: AsyncSession,
    share: Share,
    request: Request,
    *,
    viewer_user_id: uuid.UUID | None = None,
    view_token: str | None = None,
) -> None:
    """Best-effort log a view event for `share`. Never raises.

    `viewer_user_id` and `view_token` must not both be set — the share_views
    CHECK constraint enforces it. The route layer is responsible for not
    passing both. (In practice: logged-in mobile users have viewer_user_id
    populated and view_token unset, because authenticated requests don't
    need anon-channel dedup.)
    """
    try:
        await _record_view_inner(
            db, share, request, viewer_user_id=viewer_user_id, view_token=view_token
        )
    except Exception:
        # Logging-only failure — view counts are nice-to-have, never block
        # the actual share response on a tracking error.
        logger.exception(
            "view tracking failed for share %s; user=%s token=%s",
            share.id,
            viewer_user_id,
            "set" if view_token else "unset",
        )


async def _record_view_inner(
    db: AsyncSession,
    share: Share,
    request: Request,
    *,
    viewer_user_id: uuid.UUID | None,
    view_token: str | None,
) -> None:
    # 1. Owner self-view exclusion
    if viewer_user_id is not None and viewer_user_id == share.owner_user_id:
        return

    # 2. Bot/preview-fetch exclusion
    ua = request.headers.get("user-agent")
    if _is_bot_ua(ua):
        return

    # 3. Dedup
    if viewer_user_id is not None:
        if await _saw_recently_in_db(db, share.id, viewer_user_id=viewer_user_id):
            return
    elif view_token is not None:
        if await _saw_recently_in_db(db, share.id, view_token=view_token):
            return
    else:
        # Anon-no-token path: in-process dedup
        ip = request.client.host if request.client else ""
        accept_lang = request.headers.get("accept-language", "")
        key = _hash_anon_key(ip, ua or "", accept_lang, share.id)
        if share_view_dedup.seen_recently(key):
            return
        share_view_dedup.mark_seen(key)

    # 4. Write the view event
    db.add(
        ShareView(
            share_id=share.id,
            viewer_user_id=viewer_user_id,
            view_token=view_token,
        )
    )
    await db.commit()


async def _saw_recently_in_db(
    db: AsyncSession,
    share_id: uuid.UUID,
    *,
    viewer_user_id: uuid.UUID | None = None,
    view_token: str | None = None,
) -> bool:
    cutoff = datetime.now(UTC) - _DEDUP_WINDOW
    stmt = select(ShareView.id).where(
        ShareView.share_id == share_id,
        ShareView.viewed_at > cutoff,
    )
    if viewer_user_id is not None:
        stmt = stmt.where(ShareView.viewer_user_id == viewer_user_id)
    elif view_token is not None:
        stmt = stmt.where(ShareView.view_token == view_token)
    else:
        # Defensive — this branch shouldn't be reached.
        return False
    return (await db.scalar(stmt.limit(1))) is not None
