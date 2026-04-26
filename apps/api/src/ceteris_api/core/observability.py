"""Sentry + structlog initialization. Imported once from main.py at startup.

Kept out of main.py so unit tests can exercise the init logic without booting
the whole FastAPI app — and so a missing SENTRY_DSN is provably a no-op.
"""

from __future__ import annotations

import logging
import sys
import uuid
from collections.abc import Awaitable, Callable

import sentry_sdk
import structlog
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from ceteris_api import __version__
from ceteris_api.core.config import settings

REQUEST_ID_HEADER = "x-request-id"


def init_sentry() -> bool:
    """Initialize the Sentry SDK if a DSN is configured.

    Returns True if Sentry was initialized, False if it was a no-op (empty DSN).
    Tests rely on the bool return value.
    """
    dsn = settings.sentry_dsn.strip()
    if not dsn:
        return False

    sentry_sdk.init(
        dsn=dsn,
        environment=settings.env,
        release=f"ceteris-api@{__version__}",
        traces_sample_rate=settings.sentry_traces_sample_rate,
        # FastApi + Starlette integrations are auto-enabled when the libs are
        # importable, but we list them explicitly to make intent visible.
        integrations=[StarletteIntegration(), FastApiIntegration()],
        # Don't send PII by default — request bodies can contain emails / refresh
        # tokens. Flip to True only if a future debugging session needs it.
        send_default_pii=False,
    )
    return True


def configure_logging() -> None:
    """Wire structlog so every log line is JSON in non-dev, pretty in dev.

    Also routes stdlib logging (uvicorn, sqlalchemy, etc.) through structlog
    so a single processor chain produces consistent output.
    """
    is_dev = settings.env == "dev"

    shared_processors: list[structlog.types.Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
    ]

    if is_dev:
        renderer: structlog.types.Processor = structlog.dev.ConsoleRenderer(colors=True)
    else:
        renderer = structlog.processors.JSONRenderer()

    structlog.configure(
        processors=[
            *shared_processors,
            structlog.processors.format_exc_info,
            renderer,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(file=sys.stdout),
        cache_logger_on_first_use=True,
    )

    # Also tame stdlib loggers so uvicorn access logs flow through the same
    # handler (single stream, single format). We use a basic handler — structlog
    # is the wrapper, but stdlib still owns level filtering for libraries.
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=logging.INFO,
        force=True,
    )


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Attach a per-request UUID into structlog contextvars so every log line
    inside the request handler carries `request_id`. Honours an inbound
    `X-Request-ID` header if present (useful when Caddy adds one)."""

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        request_id = request.headers.get(REQUEST_ID_HEADER) or uuid.uuid4().hex
        # bind_contextvars persists for the lifetime of this asyncio task —
        # i.e. exactly the one request. Cleared in `finally` to avoid leaks
        # if the worker is reused (BaseHTTPMiddleware shares the loop).
        structlog.contextvars.bind_contextvars(request_id=request_id)
        try:
            response = await call_next(request)
        finally:
            structlog.contextvars.clear_contextvars()
        response.headers[REQUEST_ID_HEADER] = request_id
        return response
