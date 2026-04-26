from fastapi.testclient import TestClient

from myetal_api.main import app


def test_health_returns_ok() -> None:
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert "env" in body
    assert "version" in body


def test_dev_secret_rejected_in_prod(monkeypatch) -> None:
    import importlib

    from myetal_api.core import config as config_module

    monkeypatch.setenv("ENV", "production")
    monkeypatch.setenv("SECRET_KEY", "dev-secret-change-me-PLEASE-do-not-use-in-prod-XXXXXXXX")

    try:
        importlib.reload(config_module)
        raise AssertionError("Settings should have refused to load")
    except RuntimeError as exc:
        assert "SECRET_KEY" in str(exc)
    finally:
        monkeypatch.undo()
        importlib.reload(config_module)
