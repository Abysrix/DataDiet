"""Versioned API router aggregation."""

from fastapi import APIRouter

from app.api.routes import (
    assets,
    auth,
    classification,  # noqa: F401
    connectors,
    dashboard,
    governance,
    health,
    retention,
    risk,
    users,
)

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(dashboard.router, tags=["dashboard"])
api_router.include_router(auth.router, tags=["authentication"])
api_router.include_router(users.router, tags=["users"])
api_router.include_router(assets.router, tags=["assets"])
api_router.include_router(retention.router, tags=["retention"])
api_router.include_router(connectors.router, tags=["sources-and-scans"])
api_router.include_router(classification.router, tags=["classification"])
api_router.include_router(governance.router, tags=["governance"])
api_router.include_router(risk.router, tags=["risk"])
