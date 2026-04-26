FROM python:3.13-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:0.5.4 /uv /uvx /bin/

WORKDIR /app

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_DOWNLOADS=never

COPY pyproject.toml ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --no-dev --no-install-project

COPY src ./src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --no-dev


FROM python:3.13-slim

WORKDIR /app

RUN groupadd -r quire && useradd -r -g quire quire

COPY --from=builder --chown=quire:quire /app/.venv /app/.venv
COPY --from=builder --chown=quire:quire /app/src /app/src

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

USER quire

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health').read()" || exit 1

CMD ["uvicorn", "quire_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
