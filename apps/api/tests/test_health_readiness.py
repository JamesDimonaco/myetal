"""/healthz, /health (alias), and /readyz behaviour."""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from ceteris_api.core.database import get_db
from ceteris_api.main import app


def test_healthz_always_200(api_client: TestClient) -> None:
    r = api_client.get("/healthz")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_legacy_health_alias_still_works(api_client: TestClient) -> None:
    r = api_client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_readyz_200_when_db_works(api_client: TestClient) -> None:
    r = api_client.get("/readyz")
    assert r.status_code == 200
    assert r.json()["status"] == "ready"


def test_readyz_503_when_db_down() -> None:
    """/readyz must return 503 (not crash) if SELECT 1 raises."""

    class _BrokenSession:
        async def execute(self, _stmt: object) -> object:
            raise RuntimeError("connection refused")

    async def _override() -> AsyncIterator[AsyncSession]:
        yield _BrokenSession()  # type: ignore[misc]

    app.dependency_overrides[get_db] = _override
    try:
        with TestClient(app) as client:
            r = client.get("/readyz")
        assert r.status_code == 503
        body = r.json()
        assert body["status"] == "unready"
        assert body["reason"] == "database"
        assert "connection refused" in body["error"]
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.fixture(autouse=True)
def _no_dep_leak() -> None:
    """Belt-and-braces: ensure no other test's overrides leak into these."""
    app.dependency_overrides.pop(get_db, None)
