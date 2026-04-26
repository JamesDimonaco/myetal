"""slowapi enforcement on the auth endpoints.

The configured limit is 5/minute per IP. The 6th call inside the window
must come back as HTTP 429 with a useful body. We use the TestClient,
which always presents itself as `testclient` to slowapi (single key).
"""

from __future__ import annotations

from fastapi.testclient import TestClient


def _login_payload(i: int) -> dict[str, str]:
    return {"email": f"nope{i}@example.com", "password": "wrong-password"}


def test_login_sixth_attempt_returns_429(api_client: TestClient) -> None:
    # First 5: each one hits the route and returns 401 (invalid credentials).
    for i in range(5):
        r = api_client.post("/auth/login", json=_login_payload(i))
        assert r.status_code == 401, f"call {i} unexpectedly {r.status_code}"

    # 6th call: blocked by slowapi BEFORE the route runs.
    r = api_client.post("/auth/login", json=_login_payload(99))
    assert r.status_code == 429
    body = r.json()
    # slowapi default body says "Rate limit exceeded: 5 per 1 minute"
    assert "rate limit" in str(body).lower() or "5 per 1 minute" in str(body)


def test_register_rate_limited_on_sixth_call(api_client: TestClient) -> None:
    # Each register attempt is unique — the rate limit is per IP, not per email.
    for i in range(5):
        r = api_client.post(
            "/auth/register",
            json={"email": f"u{i}@example.com", "password": "hunter22a"},
        )
        # 201 = success, 409 = duplicate. Either way, route ran and counted.
        assert r.status_code in (201, 409), f"call {i} got {r.status_code}"

    r = api_client.post(
        "/auth/register",
        json={"email": "blocked@example.com", "password": "hunter22a"},
    )
    assert r.status_code == 429


def test_oauth_start_rate_limited_on_sixth_call(api_client: TestClient) -> None:
    for i in range(5):
        r = api_client.get(
            "/auth/google/start",
            params={"return_to": f"/p{i}"},
            follow_redirects=False,
        )
        # 302 redirect to Google (or 503 if provider not configured — accept both).
        assert r.status_code in (302, 503), f"call {i} got {r.status_code}"

    r = api_client.get("/auth/google/start", follow_redirects=False)
    assert r.status_code == 429
