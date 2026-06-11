"""Best-effort transactional email via Resend, plus the anti-abuse caps
for the anonymous "email me this collection" endpoint.

Mirrors the Telegram service's posture: if Resend is not configured or the
HTTP call fails, the error is logged but never propagated — the caller's
request succeeds regardless. The endpoint always returns 204 so probing
can't learn whether a send actually happened (no delivery oracle).

Why caps live here and not only in slowapi: the web app proxies anonymous
POSTs through Next.js (`/api/proxy/*`), so FastAPI sees one Vercel egress
IP for every web visitor and a per-IP limit is a blunt backstop at best.
The real abuse brakes are content-keyed: per-recipient and per-share
rolling-24h counters. In-memory is fine — DEPLOY.md mandates a single
uvicorn worker, the same tradeoff slowapi already makes.
"""

from __future__ import annotations

import html
import logging
import time
from collections import deque

import httpx

from myetal_api.core.config import settings

logger = logging.getLogger(__name__)

RESEND_API_URL = "https://api.resend.com/emails"

# Rolling-24h caps for the anonymous share-link emails. Conservative on
# purpose: a researcher emailing themselves a handful of collections at a
# conference never hits these; a spam cannon does immediately.
_WINDOW_SECONDS = 24 * 60 * 60
RECIPIENT_DAILY_CAP = 3
SHARE_DAILY_CAP = 50

# key -> deque of send timestamps within the window. Pruned on access, plus
# a periodic full sweep on write: one-off recipient/share keys are never
# re-accessed, so without the sweep they'd pin dict entries forever under
# anonymous traffic.
_send_log: dict[str, deque[float]] = {}
_SWEEP_EVERY = 256
_records_since_sweep = 0


def _sweep_expired(now: float) -> None:
    for key in list(_send_log):
        _prune_and_count(key, now)


def _prune_and_count(key: str, now: float) -> int:
    log = _send_log.get(key)
    if log is None:
        return 0
    while log and now - log[0] > _WINDOW_SECONDS:
        log.popleft()
    if not log:
        _send_log.pop(key, None)
        return 0
    return len(log)


def share_email_allowed(recipient: str, short_code: str) -> bool:
    """True when neither the recipient nor the share is over its 24h cap.

    Call with an already-normalized recipient (lowercased/stripped).
    """
    now = time.monotonic()
    if _prune_and_count(f"to:{recipient}", now) >= RECIPIENT_DAILY_CAP:
        return False
    if _prune_and_count(f"share:{short_code}", now) >= SHARE_DAILY_CAP:
        return False
    return True


def record_share_email(recipient: str, short_code: str) -> None:
    global _records_since_sweep
    now = time.monotonic()
    _records_since_sweep += 1
    if _records_since_sweep >= _SWEEP_EVERY:
        _records_since_sweep = 0
        _sweep_expired(now)
    _send_log.setdefault(f"to:{recipient}", deque()).append(now)
    _send_log.setdefault(f"share:{short_code}", deque()).append(now)


def reset_share_email_caps() -> None:
    """Test hook — clear the rolling counters."""
    global _records_since_sweep
    _send_log.clear()
    _records_since_sweep = 0


async def send_share_link_email(*, to: str, share_name: str, short_code: str) -> None:
    """Email a visitor the link to a public share. Best-effort — never raises.

    The body is fixed apart from the share name (already public content) and
    the short URL — no user-controlled free text, so the endpoint can't be
    used to deliver arbitrary messages.
    """
    api_key = settings.resend_api_key.get_secret_value()
    if not api_key:
        logger.warning(
            "Resend not configured (RESEND_API_KEY empty); skipping share-link email for %s",
            short_code,
        )
        return

    share_url = f"{settings.public_base_url.rstrip('/')}/c/{short_code}"
    safe_name = html.escape(share_name)
    payload = {
        "from": settings.email_from,
        "to": [to],
        "subject": f"Your saved collection: {share_name}",
        "html": (
            f'<p><a href="{share_url}">{safe_name}</a></p>'
            f"<p>Here's the collection you asked us to send you.</p>"
            '<p style="color:#6B6B66;font-size:12px">You received this because '
            "someone requested this link on myetal.app. No account was created "
            "and your address was not stored.</p>"
        ),
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                RESEND_API_URL,
                json=payload,
                headers={"Authorization": f"Bearer {api_key}"},
            )
        if resp.status_code >= 400:
            # Status + provider request-id only — the response body can echo
            # the payload (recipient address), which doesn't belong in logs.
            logger.error(
                "Resend rejected share-link email for %s: status=%s request_id=%s",
                short_code,
                resp.status_code,
                resp.headers.get("x-request-id"),
            )
    except httpx.HTTPError:
        logger.exception("Resend request failed for share-link email %s", short_code)
