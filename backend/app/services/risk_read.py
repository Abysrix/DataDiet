"""Read models for stored risk assessments.

Scores are never recomputed here: the row in ``risk_assessments`` is the value
produced by :func:`app.services.risk.compute_risk` from the documented rule set.
This module only joins, filters and paginates those stored rows.
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.schemas.risk import (
    RiskAssessmentItem,
    RiskBandDescriptor,
    RiskRuleDescriptor,
    RiskRulesResponse,
)
from app.db.models import InventoryRecord, RiskAssessment
from app.services import risk

RISK_RULE_SET = "documented-risk-v1"

_RULES: tuple[RiskRuleDescriptor, ...] = (
    RiskRuleDescriptor(
        code="personal_data",
        label="Personal data present",
        points=30,
        condition="record contains personal data",
    ),
    RiskRuleDescriptor(
        code="sensitivity",
        label="Sensitivity level",
        points=30,
        condition="restricted (20 confidential, 10 internal, 0 public)",
    ),
    RiskRuleDescriptor(
        code="duplicate",
        label="Duplicate candidate",
        points=10,
        condition="record is flagged as a duplicate candidate",
    ),
    RiskRuleDescriptor(
        code="past_retention_review",
        label="Past retention review date",
        points=20,
        condition="record has a review date in the past",
    ),
    RiskRuleDescriptor(
        code="unmanaged_source",
        label="Source not actively managed",
        points=10,
        condition="source system is not actively managed",
    ),
)


def describe_rules() -> RiskRulesResponse:
    """Return the deterministic rule table the API is contractually bound to."""
    bands = [
        RiskBandDescriptor(band="critical", minimum=75, maximum=100),
        RiskBandDescriptor(band="high", minimum=50, maximum=74),
        RiskBandDescriptor(band="moderate", minimum=25, maximum=49),
        RiskBandDescriptor(band="low", minimum=0, maximum=24),
    ]
    return RiskRulesResponse(
        rule_set=RISK_RULE_SET,
        maximum_score=risk.MAX_SCORE,
        bands=bands,
        rules=list(_RULES),
    )


def list_assessments(
    db: Session,
    *,
    page: int,
    per_page: int,
    institution_id: int | None,
    band: str | None = None,
    search: str | None = None,
) -> tuple[list[RiskAssessmentItem], int]:
    """Return one page of stored assessments and the total count in scope."""
    base = (
        select(RiskAssessment, InventoryRecord)
        .join(InventoryRecord, InventoryRecord.id == RiskAssessment.record_id)
        .order_by(RiskAssessment.score.desc(), RiskAssessment.id.desc())
    )
    count = (
        select(func.count(RiskAssessment.id))
        .join(InventoryRecord, InventoryRecord.id == RiskAssessment.record_id)
    )
    if institution_id is not None:
        base = base.where(InventoryRecord.institution_id == institution_id)
        count = count.where(InventoryRecord.institution_id == institution_id)
    if band:
        base = base.where(RiskAssessment.band == band)
        count = count.where(RiskAssessment.band == band)
    if search:
        term = f"%{search}%"
        condition = InventoryRecord.title.ilike(term) | InventoryRecord.external_id.ilike(term)
        base = base.where(condition)
        count = count.where(condition)

    total = int(db.execute(count).scalar() or 0)
    rows = db.execute(base.limit(per_page).offset((page - 1) * per_page)).all()
    items = [
        RiskAssessmentItem(
            id=row.id,
            asset_id=asset.id,
            asset_title=asset.title,
            external_id=asset.external_id,
            institution_id=asset.institution_id,
            rule_set=row.rule_set,
            score=row.score,
            band=row.band,
            indicators=row.indicators or [],
            assessed_at=row.assessed_at,
        )
        for row, asset in rows
    ]
    return items, total
