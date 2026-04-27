"""24-hour rolling in-process dedup for anonymous-no-token share views.

Per discovery ticket D3 + D-S-Iss10. The cookie path was rejected to avoid
PECR/EDPB consent-banner exposure, and persisted IP hashes were rejected
to avoid GDPR personal-data-at-rest. What's left for anonymous web visitors
without a logged-in session and without an X-View-Token header (typically
fresh links from social media): hold the dedup key in memory, let it
expire, and accept that a process restart resets the counter.

What this is, mechanically: a dict keyed on `sha256(ip || ua || accept-language || share_id)`,
with a stored timestamp per key. Calls to `seen_recently` check the age;
calls to `mark_seen` overwrite. Periodic GC keeps the dict bounded.

What it's NOT: a real Bloom filter. The discovery ticket framed the
implementation as "a bloom filter" because the privacy property was the
goal (no PII at rest, in-memory only, dies on restart). A SHA-256-keyed
dict gives the same property. We can swap in `pybloom-live` if memory
becomes a concern; at the expected scale (< 100k unique anon viewer-share
pairs per 24h) a dict is well within budget.

Logged-in dedup goes through SQL on `share_views` instead — see
`services/share_view.py:record_view`.
"""

from __future__ import annotations

import threading
import time
from typing import Final

# 24h window per discovery ticket D3.
_WINDOW_SECONDS: Final = 86_400

# Periodic-cleanup trigger. We GC inline on `mark_seen` whenever the dict
# exceeds this many entries — bounded latency cost, no background thread.
_GC_THRESHOLD: Final = 50_000

_lock = threading.Lock()
_seen: dict[str, float] = {}  # opaque hash key -> seen_at unix epoch seconds


def seen_recently(key: str) -> bool:
    """Has this key been recorded within the rolling 24h window?"""
    with _lock:
        seen_at = _seen.get(key)
        if seen_at is None:
            return False
        return (time.time() - seen_at) < _WINDOW_SECONDS


def mark_seen(key: str) -> None:
    """Record this key as seen now. Overwrites any prior timestamp."""
    with _lock:
        _seen[key] = time.time()
        if len(_seen) > _GC_THRESHOLD:
            _gc_locked()


def _gc_locked() -> None:
    cutoff = time.time() - _WINDOW_SECONDS
    expired = [k for k, t in _seen.items() if t < cutoff]
    for k in expired:
        del _seen[k]


def _reset_for_tests() -> None:
    """Test-only: clear the cache between cases so tests don't leak state."""
    with _lock:
        _seen.clear()
