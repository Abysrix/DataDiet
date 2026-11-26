"""The risk API exposes stored, explainable scores and documented rules only."""

from __future__ import annotations

from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db import models
from app.services import risk as risk_rules

API = "/api/v1"


def _seed(db: Session, code: str, band: str, score: int) -> tuple[int, int]:
    institution = models.Institution(code=code, name=f"{code} office")
    db.add(institution)
    db.flush()
    source = models.DataSource(
        institution_id=institution.id,
        name=f"{code} source",
        source_type="synthetic",
        connector_type="synthetic",
    )
    db.add(source)
    db.flush()
    asset = models.InventoryRecord(
        institution_id=institution.id,
        data_source_id=source.id,
        external_id=f"{code}-ASSET",
        title=f"{code} fictional asset",
        record_type="dataset",
        sensitivity="confidential",
        contains_personal_data=True,
        lifecycle_status="active",
        last_reviewed=date.today(),
    )
    db.add(asset)
    db.flush()
    db.add(
        models.RiskAssessment(
            record_id=asset.id,
            rule_set="documented-risk-v1",
            score=score,
            band=band,
            indicators=[
                {
                    "code": "personal_data",
                    "label": "Personal data present",
                    "points": 30,
                    "explanation": "Record is flagged as containing personal data (+30).",
                }
            ],
        )
    )
    db.commit()
    return int(institution.id), int(asset.id)


def test_assessments_are_read_from_stored_rows_with_explanations(
    client: TestClient, db: Session
) -> None:
    institution_id, asset_id = _seed(db, "RISK-ONE", "high", 60)

    response = client.get(f"{API}/risk/assessments")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 1
    item = body["items"][0]
    assert item["id"] > 0
    assert item["asset_id"] == asset_id
    assert item["institution_id"] == institution_id
    assert item["external_id"] == "RISK-ONE-ASSET"
    assert item["score"] == 60
    assert item["band"] == "high"
    assert item["rule_set"] == "documented-risk-v1"
    assert item["indicators"][0]["code"] == "personal_data"
    assert "+30" in item["indicators"][0]["explanation"]


def test_assessments_are_ordered_by_score_and_filterable(client: TestClient, db: Session) -> None:
    _seed(db, "RISK-LOW", "low", 10)
    _seed(db, "RISK-HIGH", "high", 60)

    ordered = client.get(f"{API}/risk/assessments").json()["items"]
    assert [item["score"] for item in ordered] == [60, 10]

    filtered = client.get(f"{API}/risk/assessments", params={"band": "high"}).json()
    assert filtered["total"] == 1
    assert filtered["items"][0]["external_id"] == "RISK-HIGH-ASSET"

    searched = client.get(f"{API}/risk/assessments", params={"search": "risk-low"}).json()
    assert searched["total"] == 1
    assert searched["items"][0]["external_id"] == "RISK-LOW-ASSET"


def test_scoped_account_sees_only_its_own_assessments(
    client: TestClient, db: Session, scoped_client
) -> None:
    own_id, _ = _seed(db, "RISK-OWN", "critical", 90)
    other_id, _ = _seed(db, "RISK-OTHER", "low", 5)
    scoped = scoped_client(own_id, role="viewer")

    own = scoped.get(f"{API}/risk/assessments", params={"institution_id": own_id})
    assert own.status_code == 200, own.text
    assert own.json()["total"] == 1
    assert own.json()["items"][0]["external_id"] == "RISK-OWN-ASSET"

    other = scoped.get(f"{API}/risk/assessments", params={"institution_id": other_id})
    assert other.status_code == 404


def test_rules_endpoint_matches_the_documented_rule_table(client: TestClient) -> None:
    response = client.get(f"{API}/risk/rules")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["rule_set"] == "documented-risk-v1"
    assert body["maximum_score"] == risk_rules.MAX_SCORE == 100
    assert {band["band"] for band in body["bands"]} == {"low", "moderate", "high", "critical"}
    rules = {rule["code"]: rule["points"] for rule in body["rules"]}
    assert rules["personal_data"] == 30
    assert rules["sensitivity"] == 30
    assert rules["duplicate"] == 10
    assert rules["past_retention_review"] == 20
    assert rules["unmanaged_source"] == 10


def test_risk_requires_a_verified_identity(anonymous_client: TestClient) -> None:
    assert anonymous_client.get(f"{API}/risk/assessments").status_code == 401
    assert anonymous_client.get(f"{API}/risk/rules").status_code == 401
