from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from myetal_api import __version__
from myetal_api.api.routes import admin as admin_routes
from myetal_api.api.routes import admin_shares as admin_shares_routes
from myetal_api.api.routes import admin_system as admin_system_routes
from myetal_api.api.routes import admin_users as admin_users_routes
from myetal_api.api.routes import feedback as feedback_routes
from myetal_api.api.routes import health as health_routes
from myetal_api.api.routes import me as me_routes
from myetal_api.api.routes import papers as papers_routes
from myetal_api.api.routes import public as public_routes
from myetal_api.api.routes import reports as reports_routes
from myetal_api.api.routes import search as search_routes
from myetal_api.api.routes import shares as shares_routes
from myetal_api.api.routes import works as works_routes
from myetal_api.core.config import settings
from myetal_api.core.observability import (
    RequestIDMiddleware,
    configure_logging,
)
from myetal_api.core.rate_limit import limiter
from myetal_api.core.request_metrics import RequestMetricsMiddleware

# Configure logging BEFORE the FastAPI() call so import-time logs use the
# right format. (Sentry SDK removed — PostHog covers error tracking on the
# client; server logs go to Railway/Pi stdout.)
configure_logging()

app = FastAPI(title="MyEtAl API", version=__version__)

# slowapi binds to app.state.limiter and registers a 429 handler.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS — empty list (default) means no Access-Control-Allow-Origin headers
# are emitted, which is what we want when the API and web app live on different
# subdomains and the prod web app uses same-origin Vercel rewrites.
if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID"],
    )

# Request-ID middleware is added AFTER CORS so the ID exists before logging
# runs, but the response header is still set on the final response.
app.add_middleware(RequestIDMiddleware)
# Request-metrics middleware (Stage 4) — buckets per-minute request +
# error counts into the in-process aggregator; flushes to
# ``request_metrics`` once per minute. Operational hint, not audit;
# restart-loss is tolerated by design.
app.add_middleware(RequestMetricsMiddleware)

app.include_router(health_routes.router)
app.include_router(me_routes.router)
app.include_router(shares_routes.router)
app.include_router(papers_routes.router)
app.include_router(public_routes.router)
app.include_router(search_routes.router)
app.include_router(reports_routes.router)
app.include_router(works_routes.router)
app.include_router(feedback_routes.router)
app.include_router(admin_routes.router)
app.include_router(admin_users_routes.router)
app.include_router(admin_shares_routes.router)
app.include_router(admin_system_routes.router)
