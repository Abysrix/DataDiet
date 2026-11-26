"""Dashboard summary endpoint (ADR-0032 showcase phase).

Reads only. Every count is computed from the same scoped tables the inventory,
retention and source screens use; the response contains no synthetic figures and
no fabricated success state.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.schemas.dashboard import DashboardSummary
from app.core.auth import (
    PERMISSION_INVENTORY_READ,
    CurrentUser,
    require_permission,
    resolve_institution_scope,
)
from app.db.session import get_db
from app.services.dashboard import build_summary

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/summary", response_model=DashboardSummary)
def dashboard_summary(
    institution_id: int | None = Query(default=None),
    current: CurrentUser = Depends(require_permission(PERMISSION_INVENTORY_READ)),
    db: Session = Depends(get_db),
) -> DashboardSummary:
    scope = resolve_institution_scope(current, institution_id)
    return build_summary(db, scope)
