"""Sentry init + structlog request-id middleware tests."""

from __future__ import annotations

import importlib

from fastapi.testclient import TestClient

from myetal_api.core import observability
from myetal_api.core.observability import REQUEST_ID_HEADER, init_sentry
from myetal_api.main import app


def test_init_sentry_noop_when_dsn_empty(monkeypatch) -> None:
    """The whole point of `SENTRY_DSN=""` defaulting is that prod-ready code
    can ship without a DSN and not blow up. init_sentry must report False."""
    from myetal_api.core import config as config_module

    monkeypatch.setattr(config_module.settings, "sentry_dsn", "")
    importlib.reload(observability)
    assert observability.init_sentry() is False


def test_init_sentry_reports_true_when_dsn_present(monkeypatch) -> None:
    from myetal_api.core import config as config_module

    # Sentry's DSN parser accepts this synthetic format without trying to
    # contact the network. We're testing the branch in init_sentry, not Sentry.
    fake_dsn = "https://public@sentry.example.com/1"
    monkeypatch.setattr(config_module.settings, "sentry_dsn", fake_dsn)
    importlib.reload(observability)
    try:
        assert observability.init_sentry() is True
    finally:
        # Tear back down so no real client is left configured for later tests
        import sentry_sdk

        sentry_sdk.get_client().close()
        monkeypatch.setattr(config_module.settings, "sentry_dsn", "")
        importlib.reload(observability)
        # Re-init should now be a no-op again
        assert init_sentry() is False


def test_request_id_header_echoed_on_response() -> None:
    client = TestClient(app)
    r = client.get("/healthz", headers={"X-Request-ID": "test-rid-12345"})
    assert r.status_code == 200
    assert r.headers.get(REQUEST_ID_HEADER) == "test-rid-12345"


def test_request_id_generated_when_missing() -> None:
    client = TestClient(app)
    r = client.get("/healthz")
    rid = r.headers.get(REQUEST_ID_HEADER)
    assert rid is not None and len(rid) >= 16
