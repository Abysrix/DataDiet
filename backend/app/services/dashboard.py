"""Aggregates for the dashboard, computed only from persisted rows.

These are counts, not scores or priorities. Every figure is derived with a
grouped SQL query against the same tables the rest of the API reads, and is
filtered by the caller's resolved institution scope. An empty mapping is filled
with explicit zeroes so the UI can render a stable distribution.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import TypeVar

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.schemas.connectors import ScanStatus
from app.api.schemas.dashboard import DashboardSummary
from app.api.schemas.retention import Recommendation
from app.db.models import (
    InventoryRecord,
    RetentionAssessment,
    RetentionDecision,
    RetentionHold,
    RetentionPolicy,
    RiskAssessment,
    ScanJob,
    ScanResult,
)

K = TypeVar("K")
LIFECYCLE_KEYS = ("active", "under_review", "archived", "pending_disposal")
SENSITIVITY_KEYS = ("public", "internal", "confidential", "restricted", "unknown")
RISK_BAND_KEYS = ("low", "moderate", "high", "critical")
RECOMMENDATION_KEYS = tuple(Recommendation.__args__)  # type: ignore[attr-defined]
SCAN_STATUS_KEYS = tuple(ScanStatus.__args__)  # type: ignore[attr-defined]


def _zeroed(keys: Iterable[K]) -> dict[K, int]:
    return {key: 0 for key in keys}


def _count(db: Session, query) -> int:
    return int(db.execute(query).scalar() or 0)


def build_summary(db: Session, institution_id: int | None) -> DashboardSummary:
    """Return lifecycle, sensitivity, risk and workflow counts in scope."""

    asset_scope: list[object] = (
        [] if institution_id is None else [InventoryRecord.institution_id == institution_id]
    )

    total_assets = _count(
        db,
        select(func.count(InventoryRecord.id)).where(*asset_scope),
    )

    lifecycle = _zeroed(LIFECYCLE_KEYS)
    for value, count in db.execute(
        select(InventoryRecord.lifecycle_status, func.count(InventoryRecord.id))
        .where(*asset_scope)
        .group_by(InventoryRecord.lifecycle_status)
    ).all():
        if value in lifecycle:
            lifecycle[value] = int(count)

    sensitivity = _zeroed(SENSITIVITY_KEYS)
    for value, count in db.execute(
        select(InventoryRecord.sensitivity, func.count(InventoryRecord.id))
        .where(*asset_scope)
        .group_by(InventoryRecord.sensitivity)
    ).all():
        if value in sensitivity:
            sensitivity[value] = int(count)

    risk_bands = _zeroed(RISK_BAND_KEYS)
    risk_query = (
        select(RiskAssessment.band, func.count(func.distinct(RiskAssessment.record_id)))
        .join(InventoryRecord, InventoryRecord.id == RiskAssessment.record_id)
        .group_by(RiskAssessment.band)
    )
    if institution_id is not None:
        risk_query = risk_query.where(InventoryRecord.institution_id == institution_id)
    for value, count in db.execute(risk_query).all():
        if value in risk_bands:
            risk_bands[value] = int(count)

    policies_query = select(func.count(RetentionPolicy.id)).where(
        RetentionPolicy.status == "active"
    )
    holds_query = select(func.count(RetentionHold.id)).where(RetentionHold.status == "active")
    assessments_query = select(func.count(RetentionAssessment.id))
    decisions_query = select(func.count(RetentionDecision.id))
    recommendations_query = select(
        RetentionAssessment.recommendation, func.count(RetentionAssessment.id)
    ).group_by(RetentionAssessment.recommendation)
    scan_jobs_query = select(ScanJob.status, func.count(ScanJob.id)).group_by(ScanJob.status)
    scanned_query = (
        select(func.count(ScanResult.id))
        .join(ScanJob, ScanJob.id == ScanResult.scan_job_id)
    )
    if institution_id is not None:
        policies_query = policies_query.where(
            RetentionPolicy.institution_id == institution_id
        )
        holds_query = holds_query.where(RetentionHold.institution_id == institution_id)
        assessments_query = assessments_query.where(
            RetentionAssessment.institution_id == institution_id
        )
        decisions_query = decisions_query.where(
            RetentionDecision.institution_id == institution_id
        )
        recommendations_query = recommendations_query.where(
            RetentionAssessment.institution_id == institution_id
        )
        scan_jobs_query = scan_jobs_query.where(ScanJob.institution_id == institution_id)
        scanned_query = scanned_query.where(ScanJob.institution_id == institution_id)

    recommendations = _zeroed(RECOMMENDATION_KEYS)
    for value, count in db.execute(recommendations_query).all():
        if value in recommendations:
            recommendations[value] = int(count)

    scan_jobs = _zeroed(SCAN_STATUS_KEYS)
    for value, count in db.execute(scan_jobs_query).all():
        if value in scan_jobs:
            scan_jobs[value] = int(count)

    return DashboardSummary(
        institution_id=institution_id,
        total_assets=total_assets,
        lifecycle=lifecycle,
        sensitivity=sensitivity,
        risk_bands=risk_bands,
        active_policies=_count(db, policies_query),
        active_holds=_count(db, holds_query),
        assessments=_count(db, assessments_query),
        decisions=_count(db, decisions_query),
        recommendations=recommendations,
        scan_jobs=scan_jobs,
        scanned_records=_count(db, scanned_query),
    )
