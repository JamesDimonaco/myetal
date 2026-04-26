FROM python:3.13-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:0.5.4 /uv /uvx /bin/

WORKDIR /app

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_DOWNLOADS=never

COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --no-dev --no-install-project --frozen

COPY src ./src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --no-dev --frozen


FROM python:3.13-slim

WORKDIR /app

# Non-root runtime user. Renamed from quire -> ceteris to match the project rename.
RUN groupadd -r ceteris && useradd -r -g ceteris ceteris

COPY --from=builder --chown=ceteris:ceteris /app/.venv /app/.venv
COPY --from=builder --chown=ceteris:ceteris /app/src /app/src

# Bundle the cleanup script into the image so cron/host can invoke it via
# `docker exec ceteris-api python -m scripts.cleanup_refresh_tokens`.
COPY --chown=ceteris:ceteris scripts /app/scripts

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app

USER ceteris

EXPOSE 8000

# /healthz is the liveness probe — never touches the DB. /readyz exists for
# orchestration but Docker's HEALTHCHECK only cares "is the process alive".
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/healthz').read()" || exit 1

# Single worker — slowapi's in-memory rate limit counter is per-worker, so
# multi-worker deployments would multiply the effective limit. See DEPLOY.md.
# --proxy-headers makes uvicorn trust X-Forwarded-For from Caddy so slowapi
# rate-limits by the real client IP, not the loopback address.
CMD ["uvicorn", "ceteris_api.main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "1", \
     "--proxy-headers", \
     "--forwarded-allow-ips", "*"]
