"""Tests for the health and readiness endpoints."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.api.routes import health as health_module
from app.core.config import get_settings


def test_health_returns_ok(client: TestClient) -> None:
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "DataDiet API"
    assert body["environment"] in {"development", "test", "production"}


def test_health_accepts_head_without_a_body(client: TestClient) -> None:
    """Monitoring probes use HEAD; it must be a bodyless 200, not a 405."""
    response = client.head("/api/v1/health")
    assert response.status_code == 200
    assert response.content == b""


def test_health_head_is_allowed_in_cors_preflight(client: TestClient) -> None:
    origin = get_settings().cors_origins[0]
    response = client.options(
        "/api/v1/health",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "HEAD",
        },
    )
    assert response.status_code == 200
    allowed = response.headers.get("access-control-allow-methods", "")
    assert "HEAD" in allowed


def test_health_docs_available(client: TestClient) -> None:
    response = client.get("/openapi.json")
    assert response.status_code == 200
    paths = response.json()["paths"]
    assert "/api/v1/health" in paths
    assert "/api/v1/health/ready" in paths


def test_readiness_degraded_when_database_unreachable(
    client: TestClient, monkeypatch
) -> None:
    """Without MySQL running, readiness must report degraded with HTTP 503."""
    monkeypatch.setattr(
        health_module,
        "check_database_connection",
        lambda: (False, "Connection refused (test simulation)"),
    )
    response = client.get("/api/v1/health/ready")
    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "degraded"
    assert body["database"]["reachable"] is False


def test_readiness_ready_when_database_reachable(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr(
        health_module,
        "check_database_connection",
        lambda: (True, "SELECT 1 succeeded"),
    )
    response = client.get("/api/v1/health/ready")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ready"
    assert body["database"]["reachable"] is True
