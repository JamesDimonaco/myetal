from fastapi import FastAPI

from ceteris_api import __version__
from ceteris_api.api.routes import auth as auth_routes
from ceteris_api.api.routes import oauth as oauth_routes
from ceteris_api.api.routes import public as public_routes
from ceteris_api.api.routes import shares as shares_routes
from ceteris_api.core.config import settings

app = FastAPI(title="Ceteris API", version=__version__)

app.include_router(auth_routes.router)
app.include_router(oauth_routes.router)
app.include_router(shares_routes.router)
app.include_router(public_routes.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "env": settings.env, "version": __version__}
