from fastapi import FastAPI

from quire_api import __version__
from quire_api.core.config import settings

app = FastAPI(title="Quire API", version=__version__)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "env": settings.env, "version": __version__}
