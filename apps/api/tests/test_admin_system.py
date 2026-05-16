"""Tests for Stage 4 of the admin dashboard: /admin/system/metrics.

Per `docs/tickets/to-do/admin-analytics-dashboard.md` Stage 4.

Coverage:
* auth gating (401 non-auth / 403 non-admin / 200 admin)
* metrics endpoint shape (every section present)
* request_metrics middleware bucketing + idempotent flush
* script_runs surfaces last-run per known script
* R2 LIST is cached for 5 minutes
* DB pool snapshot has the expected shape
* auth health is placeholder=true honestly
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from myetal_api.api.routes.admin_system import reset_metrics_cache
from myetal_api.core.config import settings
from myetal_api.core.request_metrics import (
    _bucket_key,
    _reset_for_tests,
    _route_prefix,
)
from myetal_api.models import (
    Account,
    RequestMetric,
    ScriptRun,
    Session,
    User,
)
from myetal_api.services import admin_system as admin_system_service
from tests.conftest import make_user, signed_jwt


@pytest.fixture(autouse=True)
def _admin_allowlist(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setattr(settings, "admin_emails", ["admin@example.com"])
    reset_metrics_cache()
    admin_system_service._reset_r2_cache_for_tests()
    _reset_for_tests()
    yield
    reset_metrics_cache()
    admin_system_service._reset_r2_cache_for_tests()
    _reset_for_tests()


@pytest.fixture(autouse=True)
def _stub_r2(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Make the R2 LIST helper return an empty bucket by default.

    Tests that want a populated bucket override this. Without the stub
    boto3 reaches across the network and fails in the sandbox.
    """

    class _StubS3:
        def list_objects_v2(self, **kwargs: Any) -> dict[str, Any]:
            return {"Contents": [], "IsTruncated": False}

    from myetal_api.services import r2_client

    monkeypatch.setattr(r2_client, "_get_client", lambda: _StubS3())
    yield


def _admin_headers(admin: User) -> dict[str, str]:
    return {
        "Authorization": (
            f"Bearer {signed_jwt(admin.id, email=admin.email or '', is_admin=True)}"
        )
    }


async def _admin(db: AsyncSession) -> User:
    return await make_user(db, email="admin@example.com", name="Admin", is_admin=True)


# ---- Auth gating -----------------------------------------------------------


async def test_metrics_requires_auth(api_client: TestClient) -> None:
    r = api_client.get("/admin/system/metrics")
    assert r.status_code == 401


async def test_metrics_rejects_non_admin(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    rando = await make_user(db_session, email="rando@example.com")
    r = api_client.get(
        "/admin/system/metrics",
        headers={"Authorization": f"Bearer {signed_jwt(rando.id, email=rando.email or '')}"},
    )
    assert r.status_code == 403


async def test_metrics_returns_full_shape(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await _admin(db_session)
    r = api_client.get(
        "/admin/system/metrics", headers=_admin_headers(admin)
    )
    assert r.status_code == 200
    body = r.json()
    # Top-level sections per the spec.
    assert set(body.keys()) >= {
        "routes_24h",
        "scripts",
        "db_pool",
        "r2",
        "auth",
        "generated_at",
    }
    # Auth section honestly marks itself as placeholder.
    assert body["auth"]["placeholder"] is True
    # The four known scripts always appear (even with zero rows).
    script_names = {s["name"] for s in body["scripts"]}
    assert script_names == {
        "refresh_trending",
        "refresh_similar_shares",
        "gc_tombstoned_shares",
        "prune_share_views",
    }


# ---- Routes 24h aggregation -----------------------------------------------


async def test_routes_24h_aggregates_request_metrics_by_prefix(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await _admin(db_session)
    now = datetime.now(UTC).replace(second=0, microsecond=0)

    db_session.add_all(
        [
            RequestMetric(
                bucket_start=now,
                route_prefix="/admin",
                request_count=10,
                error_count=1,
                latency_ms_sum=500,
            ),
            RequestMetric(
                bucket_start=now - timedelta(minutes=1),
                route_prefix="/admin",
                request_count=5,
                error_count=0,
                latency_ms_sum=100,
            ),
            RequestMetric(
                bucket_start=now,
                route_prefix="/public",
                request_count=20,
                error_count=2,
                latency_ms_sum=2000,
            ),
        ]
    )
    await db_session.commit()

    r = api_client.get(
        "/admin/system/metrics", headers=_admin_headers(admin)
    )
    body = r.json()
    routes = {row["route_prefix"]: row for row in body["routes_24h"]}
    assert routes["/admin"]["request_count"] == 15
    assert routes["/admin"]["error_count"] == 1
    assert routes["/public"]["request_count"] == 20
    assert routes["/public"]["error_count"] == 2
    # p_error is a ratio.
    assert 0 < routes["/admin"]["p_error"] < 1


# ---- Scripts last-run -----------------------------------------------------


async def test_scripts_section_surfaces_latest_run(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await _admin(db_session)
    older = datetime.now(UTC) - timedelta(hours=2)
    newer = datetime.now(UTC)
    db_session.add_all(
        [
            ScriptRun(
                name="refresh_trending",
                started_at=older,
                finished_at=older,
                duration_ms=100,
                status="ok",
                row_count=42,
            ),
            ScriptRun(
                name="refresh_trending",
                started_at=newer,
                finished_at=newer,
                duration_ms=200,
                status="ok",
                row_count=99,
            ),
        ]
    )
    await db_session.commit()

    r = api_client.get(
        "/admin/system/metrics", headers=_admin_headers(admin)
    )
    body = r.json()
    by_name = {s["name"]: s for s in body["scripts"]}
    # Latest run wins — row_count from the `newer` row.
    assert by_name["refresh_trending"]["row_count"] == 99
    assert by_name["refresh_trending"]["last_status"] == "ok"
    # Scripts without runs show last_run_at=None instead of disappearing.
    assert by_name["gc_tombstoned_shares"]["last_run_at"] is None


# ---- DB pool snapshot ------------------------------------------------------


async def test_db_pool_section_has_expected_shape(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await _admin(db_session)
    r = api_client.get(
        "/admin/system/metrics", headers=_admin_headers(admin)
    )
    body = r.json()
    pool = body["db_pool"]
    # SQLite test pool may not expose all counters; we just verify the
    # shape contract holds (every key present, ints not floats).
    assert set(pool.keys()) >= {"in_use", "size", "overflow", "slow_query_count_1h"}
    assert isinstance(pool["in_use"], int)
    assert isinstance(pool["size"], int)
    assert isinstance(pool["overflow"], int)
    # Not yet instrumented — None is honest.
    assert pool["slow_query_count_1h"] is None


# ---- R2 storage ------------------------------------------------------------


async def test_r2_section_caches_for_5_minutes(
    db_session: AsyncSession, api_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    admin = await _admin(db_session)

    call_count = {"n": 0}

    class _CountingS3:
        def list_objects_v2(self, **kwargs: Any) -> dict[str, Any]:
            call_count["n"] += 1
            return {
                "Contents": [
                    {"Key": "shares/abc/items/x.pdf", "Size": 1024},
                    {"Key": "pending/foo.pdf", "Size": 512},
                ],
                "IsTruncated": False,
            }

    from myetal_api.services import r2_client

    monkeypatch.setattr(r2_client, "_get_client", lambda: _CountingS3())
    admin_system_service._reset_r2_cache_for_tests()

    # First call — populates the LIST cache (NOTE: route caches the
    # whole payload, so we bust both caches between calls).
    reset_metrics_cache()
    api_client.get("/admin/system/metrics", headers=_admin_headers(admin))
    assert call_count["n"] == 1

    # Reset only the route's cache, keep the R2-section cache warm.
    reset_metrics_cache()
    r2 = api_client.get(
        "/admin/system/metrics", headers=_admin_headers(admin)
    ).json()["r2"]
    # R2 LIST was NOT re-invoked — payload came from the 5-min cache.
    assert call_count["n"] == 1
    assert r2["cached"] is True
    assert r2["total_objects"] == 2
    assert r2["total_bytes"] == 1536
    # Prefix split correctly: 'shares/' + 'pending/'.
    prefixes = {p["prefix"] for p in r2["by_prefix"]}
    assert "shares/" in prefixes
    assert "pending/" in prefixes


# ---- Auth health placeholder ----------------------------------------------


async def test_auth_health_is_placeholder_with_session_approximation(
    db_session: AsyncSession, api_client: TestClient
) -> None:
    admin = await _admin(db_session)
    target = await make_user(db_session, email="google-user@example.com")
    db_session.add(
        Account(
            user_id=target.id,
            account_id="g-1",
            provider_id="google",
        )
    )
    db_session.add(
        Session(
            user_id=target.id,
            expires_at=datetime.now(UTC) + timedelta(days=1),
            token="t1",
            created_at=datetime.now(UTC),
        )
    )
    await db_session.commit()

    r = api_client.get(
        "/admin/system/metrics", headers=_admin_headers(admin)
    )
    body = r.json()["auth"]
    assert body["placeholder"] is True
    # Google provider appears.
    providers = {p["provider"]: p for p in body["providers"]}
    assert "google" in providers
    assert providers["google"]["completions_24h"] >= 1


# ---- Middleware unit tests ------------------------------------------------


def test_route_prefix_collapses_to_first_segment() -> None:
    assert _route_prefix("/admin/users/abc") == "/admin"
    assert _route_prefix("/me/library") == "/me"
    assert _route_prefix("/c/abc") == "/c"
    assert _route_prefix("/") == "/_root"
    assert _route_prefix("") == "/_root"


def test_bucket_key_floors_to_minute() -> None:
    dt = datetime(2026, 5, 11, 14, 23, 45, 678, tzinfo=UTC)
    key = _bucket_key(dt)
    # The floored value has zero seconds + microseconds.
    parsed = datetime.fromisoformat(key)
    assert parsed.second == 0
    assert parsed.microsecond == 0
    assert parsed.minute == 23


async def test_flush_now_writes_aggregator_to_db_and_is_idempotent(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Two calls to flush_now in a row should idempotent-add the second
    bucket's counts to the existing row, not duplicate it."""
    # Point the middleware's session factory at the test DB.
    from myetal_api.core import request_metrics as rm

    class _FactoryCtx:
        async def __aenter__(self) -> AsyncSession:
            return db_session

        async def __aexit__(self, *exc_info: object) -> bool:
            return False

    monkeypatch.setattr(rm, "SessionLocal", lambda: _FactoryCtx())

    _reset_for_tests()
    await rm._record("/admin", 200, 100)
    await rm._record("/admin", 500, 200)
    await rm._record("/public", 200, 50)

    written = await rm.flush_now()
    assert written == 2  # two distinct (bucket, prefix) keys

    rows = (await db_session.scalars(select(RequestMetric))).all()
    assert len(rows) == 2
    by_prefix = {r.route_prefix: r for r in rows}
    assert by_prefix["/admin"].request_count == 2
    assert by_prefix["/admin"].error_count == 1
    assert by_prefix["/public"].request_count == 1

    # Second flush with fresh increments — should UPSERT into the same
    # row rather than insert a duplicate.
    await rm._record("/admin", 200, 100)
    await rm.flush_now()

    rows = (await db_session.scalars(select(RequestMetric))).all()
    assert len(rows) == 2  # still 2 rows, no duplicate
    by_prefix = {r.route_prefix: r for r in rows}
    assert by_prefix["/admin"].request_count == 3  # 2 + 1


# ---- Script wrapper -------------------------------------------------------


async def test_script_wrapper_records_start_and_finish(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The wrapper inserts a row with status="running", then updates to
    "ok" with duration + row_count on success."""
    from sqlalchemy.ext.asyncio import (
        AsyncSession as _AsyncSession,
    )

    from scripts import _wrapper as wrapper_mod

    # Replace the wrapper's per-script engine with the in-test engine.
    class _Wrap:
        def __init__(self) -> None:
            self.SessionLocal = lambda: _Ctx()

    class _Ctx:
        async def __aenter__(self) -> _AsyncSession:
            return db_session

        async def __aexit__(self, *exc_info: object) -> bool:
            return False

    monkeypatch.setattr(
        wrapper_mod,
        "create_async_engine",
        lambda *_a, **_kw: type("E", (), {"dispose": lambda self: _Noop()})(),
    )

    class _Noop:
        def __await__(self):
            async def _r() -> None:
                return None

            return _r().__await__()

    monkeypatch.setattr(wrapper_mod, "async_sessionmaker", lambda *_a, **_kw: lambda: _Ctx())

    async def body() -> int:
        return 7

    result = await wrapper_mod.run_script("refresh_trending", body)
    assert result == 7

    rows = (await db_session.scalars(select(ScriptRun))).all()
    assert len(rows) == 1
    assert rows[0].name == "refresh_trending"
    assert rows[0].status == "ok"
    assert rows[0].row_count == 7
    assert rows[0].duration_ms is not None
