FROM python:3.13-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:0.5.4 /uv /uvx /bin/

WORKDIR /app

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_DOWNLOADS=never

COPY pyproject.toml uv.lock ./
# No --mount=type=cache here: Railway's Metal builder requires a specific
# cacheKey prefix on the id that other builders don't need. Easier to drop
# the cache mount entirely; uv sync from a frozen lockfile is fast enough.
RUN uv sync --no-dev --no-install-project --frozen

COPY src ./src
RUN uv sync --no-dev --frozen


FROM python:3.13-slim

WORKDIR /app

# poppler-utils provides `pdftoppm`, the binary `pdf2image` shells out to
# when rasterising the first page of an uploaded PDF for the share-item
# thumbnail (feedback-round-2 §1, PR-C). Required at runtime; the Python
# `pdf2image` package is just a wrapper. `--no-install-recommends` keeps
# the image slim (~10 MB delta).
RUN apt-get update \
    && apt-get install -y --no-install-recommends poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# Non-root runtime user. Renamed from quire -> myetal to match the project rename.
RUN groupadd -r myetal && useradd -r -g myetal myetal

COPY --from=builder --chown=myetal:myetal /app/.venv /app/.venv
COPY --from=builder --chown=myetal:myetal /app/src /app/src

# Bundle the cleanup script into the image so cron/host can invoke it via
# `docker exec myetal-api python -m scripts.cleanup_refresh_tokens`.
COPY --chown=myetal:myetal scripts /app/scripts

# Bundle alembic config + migrations so `alembic upgrade head` works at startup
# without bind-mounts (dev compose mounts these from the host instead).
COPY --chown=myetal:myetal alembic /app/alembic
COPY --chown=myetal:myetal alembic.ini /app/alembic.ini

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app

USER myetal

EXPOSE 8000

# JSON-form CMD invoking `sh -c` so we still get $PORT expansion AND
# satisfy buildkit's JSON-args linter (signal handling is now sh -> exec
# uvicorn, which keeps SIGTERM routing to the Python process).
#
# Railway sets $PORT to a random value at boot and routes external
# traffic to it. The `:-8000` fallback covers the Pi compose stack
# where the port is fixed in env. Alembic runs first so a migration
# drift never serves traffic; `exec` after `&&` replaces the shell with
# uvicorn so SIGTERM reaches Python cleanly. `--workers 1` keeps
# slowapi's per-process rate-limit counter coherent.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn myetal_api.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --proxy-headers --forwarded-allow-ips '*' --log-level info"]
