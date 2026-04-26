"""Single shared slowapi `Limiter` instance.

slowapi keeps an in-memory counter per (key, route, window). That is the
reason DEPLOY.md mandates a single uvicorn worker — each worker has its own
counter, so 5/min across 4 workers is effectively 20/min.
"""

from __future__ import annotations

from slowapi import Limiter
from slowapi.util import get_remote_address

# Per-IP key. When we put this behind Caddy we rely on Caddy forwarding the
# real client IP via X-Forwarded-For; uvicorn translates that into the request
# scope `client` tuple when started with --proxy-headers (see DEPLOY.md).
limiter = Limiter(key_func=get_remote_address)

# Default rule for sensitive auth endpoints — applied via decorator on each
# route, NOT here, so the routes' intent is visible at the call site.
AUTH_LIMIT = "5/minute"
