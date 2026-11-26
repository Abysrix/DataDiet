"""Schema for the real dashboard summary (showcase phase, ADR-0032)."""

from __future__ import annotations

from pydantic import BaseModel

from app.api.schemas.assets import LifecycleStatus, Sensitivity
from app.api.schemas.connectors import ScanStatus
from app.api.schemas.retention import Recommendation


class DashboardSummary(BaseModel):
    """Counts derived from stored rows; no figure is fabricated or cached.

    Every distribution mapping always contains all known keys, so an empty
    database renders zero bars rather than an absent category.
    """

    institution_id: int | None
    total_assets: int
    lifecycle: dict[LifecycleStatus, int]
    sensitivity: dict[Sensitivity, int]
    risk_bands: dict[str, int]
    active_policies: int
    active_holds: int
    assessments: int
    decisions: int
    recommendations: dict[Recommendation, int]
    scan_jobs: dict[ScanStatus, int]
    scanned_records: int
