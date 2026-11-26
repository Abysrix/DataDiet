"""Dashboard summary is derived from real rows and respects institution scope."""

from __future__ import annotations

from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db import models

API = "/api/v1"


def _seed_rows(db: Session) -> tuple[int, int]:
    institution = models.Institution(code="DASH-TEST", name="Dashboard test")
    db.add(institution)
    db.flush()
    source = models.DataSource(
        institution_id=institution.id,
        name="Dashboard source",
        source_type="synthetic",
        connector_type="synthetic",
    )
    db.add(source)
    db.flush()
    asset = models.InventoryRecord(
        institution_id=institution.id,
        data_source_id=source.id,
        external_id="DASH-ASSET-1",
        title="Dashboard asset",
        record_type="dataset",
        category="academic_records",
        sensitivity="restricted",
        contains_personal_data=True,
        lifecycle_status="under_review",
        last_reviewed=date.today(),
    )
    db.add(asset)
    db.flush()
    db.add(
        models.RiskAssessment(
            record_id=asset.id, rule_set="test-rules", score=80, band="critical", indicators=[]
        )
    )
    policy = models.RetentionPolicy(
        institution_id=institution.id, name="Dashboard policy", status="active", version="1"
    )
    db.add(policy)
    db.flush()
    db.add(
        models.RetentionHold(
            institution_id=institution.id,
            asset_id=asset.id,
            name="Dashboard hold",
            scope=[],
            status="active",
        )
    )
    assessment = models.RetentionAssessment(
        asset_id=asset.id,
        institution_id=institution.id,
        policy_id=policy.id,
        rule_set="test-rules",
        recommendation="REVIEW_REQUIRED",
        rationale="test",
        findings=[],
    )
    db.add(assessment)
    db.flush()
    db.add(
        models.RetentionDecision(
            assessment_id=assessment.id,
            asset_id=asset.id,
            institution_id=institution.id,
            policy_id=policy.id,
            recommendation_reviewed="REVIEW_REQUIRED",
            decision="retain",
            reason="test",
            reviewer="test",
        )
    )
    job = models.ScanJob(
        data_source_id=source.id, institution_id=institution.id, status="COMPLETED"
    )
    db.add(job)
    db.flush()
    db.add(
        models.ScanResult(
            scan_job_id=job.id,
            source_key="DASH-1",
            status="imported",
            title="Dashboard result",
            record_type="dataset",
            imported_asset_id=asset.id,
        )
    )
    db.commit()
    return int(institution.id), int(asset.id)


def test_summary_counts_real_rows(client: TestClient, db: Session) -> None:
    institution_id, _asset_id = _seed_rows(db)

    response = client.get(f"{API}/dashboard/summary", params={"institution_id": institution_id})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["institution_id"] == institution_id
    assert body["total_assets"] == 1
    assert body["lifecycle"]["under_review"] == 1
    assert body["lifecycle"]["active"] == 0
    assert body["sensitivity"]["restricted"] == 1
    assert body["risk_bands"]["critical"] == 1
    assert body["risk_bands"]["low"] == 0
    assert body["active_policies"] == 1
    assert body["active_holds"] == 1
    assert body["assessments"] == 1
    assert body["decisions"] == 1
    assert body["recommendations"]["REVIEW_REQUIRED"] == 1
    assert body["scan_jobs"]["COMPLETED"] == 1
    assert body["scanned_records"] == 1


def test_empty_summary_has_zeroed_distributions(client: TestClient) -> None:
    response = client.get(f"{API}/dashboard/summary")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total_assets"] == 0
    assert set(body["risk_bands"]) == {"low", "moderate", "high", "critical"}
    assert all(value == 0 for value in body["risk_bands"].values())


def test_summary_requires_a_verified_identity(anonymous_client: TestClient) -> None:
    assert anonymous_client.get(f"{API}/dashboard/summary").status_code == 401


def test_scoped_account_is_limited_to_its_institution(
    client: TestClient, db: Session, scoped_client
) -> None:
    institution_id, _ = _seed_rows(db)
    scoped = scoped_client(institution_id, role="viewer")

    own = scoped.get(
        f"{API}/dashboard/summary", params={"institution_id": institution_id}
    )
    assert own.status_code == 200, own.text
    assert own.json()["total_assets"] == 1

    other = scoped.get(f"{API}/dashboard/summary", params={"institution_id": institution_id + 99})
    assert other.status_code == 404
