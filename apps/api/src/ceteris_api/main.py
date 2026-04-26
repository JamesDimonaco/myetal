from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from ceteris_api import __version__
from ceteris_api.api.routes import auth as auth_routes
from ceteris_api.api.routes import health as health_routes
from ceteris_api.api.routes import oauth as oauth_routes
from ceteris_api.api.routes import papers as papers_routes
from ceteris_api.api.routes import public as public_routes
from ceteris_api.api.routes import shares as shares_routes
from ceteris_api.core.config import settings
from ceteris_api.core.observability import (
    RequestIDMiddleware,
    configure_logging,
    init_sentry,
)
from ceteris_api.core.rate_limit import limiter

# Order matters: configure logging + init Sentry BEFORE the FastAPI() call so
# any startup errors are captured and any import-time logs use the right format.
configure_logging()
init_sentry()

app = FastAPI(title="Ceteris API", version=__version__)

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

app.include_router(health_routes.router)
app.include_router(auth_routes.router)
app.include_router(oauth_routes.router)
app.include_router(shares_routes.router)
app.include_router(papers_routes.router)
app.include_router(public_routes.router)
