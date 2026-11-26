"""Read-only risk assessment endpoints (ADR-0032 showcase phase).

The scores and explanations come from rows written by the documented rule set.
Nothing here recalculates a score, accepts a client-supplied number, or performs
a lifecycle action.
"""

from __future__ import annotations

import math

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.schemas.risk import RiskAssessmentList, RiskRulesResponse
from app.core.auth import (
    PERMISSION_INVENTORY_READ,
    CurrentUser,
    require_permission,
    resolve_institution_scope,
)
from app.db.session import get_db
from app.services.risk_read import describe_rules, list_assessments

router = APIRouter(prefix="/risk", tags=["risk"])


@router.get("/assessments", response_model=RiskAssessmentList)
def risk_assessments(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    band: str | None = Query(default=None),
    search: str | None = Query(default=None),
    institution_id: int | None = Query(default=None),
    current: CurrentUser = Depends(require_permission(PERMISSION_INVENTORY_READ)),
    db: Session = Depends(get_db),
) -> RiskAssessmentList:
    scope = resolve_institution_scope(current, institution_id)
    items, total = list_assessments(
        db,
        page=page,
        per_page=per_page,
        institution_id=scope,
        band=band,
        search=search,
    )
    return RiskAssessmentList(
        items=items,
        total=total,
        page=page,
        per_page=per_page,
        pages=math.ceil(total / per_page),
    )


@router.get("/rules", response_model=RiskRulesResponse)
def risk_rules(
    _current: CurrentUser = Depends(require_permission(PERMISSION_INVENTORY_READ)),
) -> RiskRulesResponse:
    return describe_rules()
