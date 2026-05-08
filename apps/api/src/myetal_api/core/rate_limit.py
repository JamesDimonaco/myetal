"""Single shared slowapi `Limiter` instance.

slowapi keeps an in-memory counter per (key, route, window). That is the
reason DEPLOY.md mandates a single uvicorn worker — each worker has its own
counter, so 5/min across 4 workers is effectively 20/min.
"""

from __future__ import annotations

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

# Per-IP key. When we put this behind Caddy we rely on Caddy forwarding the
# real client IP via X-Forwarded-For; uvicorn translates that into the request
# scope `client` tuple when started with --proxy-headers (see DEPLOY.md).
limiter = Limiter(key_func=get_remote_address)


def authed_user_key(request: Request) -> str:
    """Per-user key for rate limits on bearer-authed routes.

    Falls back to the remote IP for anonymous requests so misconfigurations
    don't disable the limit entirely. Routes opt in via
    ``@limiter.limit("...", key_func=authed_user_key)``.

    The auth dep stashes the resolved user on ``request.state.user`` (see
    ``api.deps.get_current_user``) — that's the value we read here.
    """
    user = getattr(request.state, "user", None)
    if user is not None:
        user_id = getattr(user, "id", None)
        if user_id is not None:
            return f"user:{user_id}"
    return get_remote_address(request)


# Anonymous read of public share endpoints. Cloudflare is DNS-only on
# api.myetal.app (no proxy / no edge rate limiting), so this is the sole
# defence against scraping. 60/min/IP is generous enough for legitimate
# scroll-and-explore traffic and tight enough that a scraper can't pull the
# whole corpus in an afternoon.
ANON_READ_LIMIT = "60/minute"

# Take-down/abuse reports — anon allowed but heavily limited because the
# admin queue is the dev's inbox. Per discovery ticket D16 + smaller-finding.
REPORT_LIMIT = "3/hour"

# User feedback (feature requests + bug reports) — per user-feedback-system
# ticket. 5/hour is generous for legitimate feedback but caps spam.
FEEDBACK_LIMIT = "5/hour"

# Public share search — tighter than ANON_READ_LIMIT because search hits
# GiST indexes across the whole published corpus, making it more expensive
# than a single-share lookup.  20/min/IP caps scraping while allowing
# generous browse-and-refine sessions.  Per public-share-search ticket.
SEARCH_LIMIT = "20/minute"

# Public browse endpoint — returns the same trending/recent data for everyone
# and is aggressively cached, so the rate limit is more generous than search.
# Per browse-popular-collections ticket.
BROWSE_LIMIT = "30/minute"

# Tag autocomplete (and the related popular-tags endpoint) — these fire on
# every keystroke in the share editor's tag input, so the limit needs to be
# much more generous than BROWSE_LIMIT.  The tag table is tiny and the queries
# are GIN/usage-count index lookups, so even at 120/min the load is trivial.
TAG_AUTOCOMPLETE_LIMIT = "120/minute"
