"""Showcase seeding is guarded, labeled, and idempotent (ADR-0032).

The tests run against the same temporary SQLite database the API fixtures use,
so they exercise the real ORM path without touching Azure SQL.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import models
from app.services import risk

SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from seed_showcase import (  # noqa: E402
    ASSET_SPECS,
    LABEL,
    RISK_RULE_SET,
    _safe_target,
    main,
    require_confirmation,
    seed_showcase,
)


def _count(db: Session, model: object) -> int:
    return int(db.execute(select(func.count()).select_from(model)).scalar() or 0)


def test_seed_creates_labeled_fictional_rows(client: TestClient, db: Session) -> None:
    summary = seed_showcase(db, actor="ops:showcase-test")

    assert summary.institution_id > 0
    assert summary.users == 3
    assert summary.assets == len(ASSET_SPECS)
    assert summary.policies == 1
    assert summary.holds == 1
    assert summary.assessments > 0
    assert summary.risks > 0
    assert summary.classifications > 0

    institution = db.get(models.Institution, summary.institution_id)
    assert institution is not None
    assert institution.code == "SHOWCASE-DEMO"
    assert institution.name.startswith(LABEL)

    assets = db.execute(
        select(models.InventoryRecord).where(
            models.InventoryRecord.institution_id == summary.institution_id
        )
    ).scalars().all()
    assert len(assets) > len(ASSET_SPECS)  # the real synthetic scan also imported rows
    assert all(asset.title.startswith(LABEL) for asset in assets)
    assert all(asset.institution_id == summary.institution_id for asset in assets)

    risks = db.execute(select(models.RiskAssessment)).scalars().all()
    assert risks
    assert all(row.rule_set == RISK_RULE_SET for row in risks)
    assert all(0 <= row.score <= 100 for row in risks)
    assert all(row.band == risk.band_for_score(row.score) for row in risks)
    assert any(row.score >= 75 for row in risks)  # documented critical band is reachable

    audit_events = db.execute(
        select(models.AuditEvent).where(models.AuditEvent.event_type == "showcase.seeded")
    ).scalars().all()
    assert audit_events
    assert all(event.payload.get("fictional") is True for event in audit_events)


def test_rerun_is_idempotent(client: TestClient, db: Session) -> None:
    first = seed_showcase(db, actor="ops:showcase-test")
    counts_before = {
        model.__tablename__: _count(db, model)
        for model in (
            models.AppUser,
            models.DataSource,
            models.InventoryRecord,
            models.ScanJob,
            models.RetentionPolicy,
            models.PolicyVersion,
            models.RetentionHold,
            models.RetentionAssessment,
            models.RetentionDecision,
            models.ClassificationResult,
            models.RiskAssessment,
        )
    }

    second = seed_showcase(db, actor="ops:showcase-test")

    assert second.created_rows == 0
    counts_after = {
        model.__tablename__: _count(db, model)
        for model in (
            models.AppUser,
            models.DataSource,
            models.InventoryRecord,
            models.ScanJob,
            models.RetentionPolicy,
            models.PolicyVersion,
            models.RetentionHold,
            models.RetentionAssessment,
            models.RetentionDecision,
            models.ClassificationResult,
            models.RiskAssessment,
        )
    }
    assert counts_after == counts_before
    assert first.institution_id == second.institution_id


def test_write_confirmation_is_mandatory() -> None:
    with pytest.raises(Exception, match="confirm-showcase-write"):
        require_confirmation(False)
    require_confirmation(True)


def test_cli_refuses_when_showcase_mode_is_off(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SHOWCASE_MODE", raising=False)
    get_settings.cache_clear()
    try:
        assert main(["--actor", "ops:test", "--confirm-showcase-write"]) == 1
    finally:
        get_settings.cache_clear()


def test_cli_refuses_unconfirmed_write() -> None:
    assert main(["--actor", "ops:test"]) == 1


def test_diagnostic_target_never_prints_credentials() -> None:
    rendered = _safe_target(
        "mssql+pymssql://user:super-secret@host.example:1433/datadiet_demo?tds_version=7.4"
    )
    assert "super-secret" not in rendered
    assert "user:" not in rendered
    assert rendered.endswith("/datadiet_demo")
