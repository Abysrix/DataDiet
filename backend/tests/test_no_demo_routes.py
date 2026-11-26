"""Synthetic demo endpoints must not be reachable in the installed application."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

DEMO_PATHS = [
    "/api/v1/demo/dashboard",
    "/api/v1/demo/inventory",
    "/api/v1/demo/risk",
    "/api/v1/demo/retention",
    "/api/v1/demo/connected-sources",
]


@pytest.mark.parametrize("path", DEMO_PATHS)
def test_synthetic_demo_endpoints_are_not_registered(
    client: TestClient, path: str
) -> None:
    """A removed route is a 404, not a disabled-but-present synthetic response."""
    response = client.get(path)

    assert response.status_code == 404, response.text
    assert "synthetic_demo_data" not in response.text
    assert "SYNTH-" not in response.text
