"""Seed clearly labeled fictional showcase records into the configured database.

ADR-0032 allows a time-boxed hosted prototype in which every record is visibly
fictional sample data. This operator script is the *only* writer of that data:

* it uses ``DATABASE_URL`` exactly as the API does (never a browser fixture);
* it refuses to run without an explicit actor, an explicit write confirmation,
  and ``SHOWCASE_MODE=true`` on the backend;
* it is idempotent — rerunning creates no duplicate assets, policy versions,
  assessments, decisions, classifications, risk rows or scan jobs;
* it records its actions in the same audit trail the application uses.

No password, institutional system, personal record, lifecycle execution or fake
integration is involved. Running the script never deletes or disposes anything.

Usage (from ``backend/``)::

    $env:SHOWCASE_MODE = "true"
    ..\\.venv\\Scripts\\python.exe ..\\scripts\\seed_showcase.py `
        --actor "ops:your-name" --confirm-showcase-write

Printed diagnostics omit credentials from ``DATABASE_URL``.
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import urlsplit

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

# Allow running as a plain script from backend/ or the repo root.
_REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO_ROOT / "backend"))

from app.api.schemas.retention import (  # noqa: E402
    DecisionCreate,
    HoldCreate,
    PolicyCreate,
    PolicyVersionCreate,
)
from app.core.config import Settings  # noqa: E402
from app.db import models  # noqa: E402
from app.db.session import get_engine  # noqa: E402
from app.services import audit, classification, retention, risk, scan  # noqa: E402

LABEL = "[SHOWCASE SAMPLE]"
INSTITUTION_CODE = "SHOWCASE-DEMO"
SEED_ACTOR = "showcase:seed"
RISK_RULE_SET = "documented-risk-v1"

MANAGED_SOURCE_NAME = f"{LABEL} Fictional records library"
UNMANAGED_SOURCE_NAME = f"{LABEL} Legacy records (not actively managed)"

ADMIN_EMAIL = "SYNTH-showcase-admin@datadiet.local"
REVIEWER_EMAIL = "SYNTH-showcase-reviewer@datadiet.local"
VIEWER_EMAIL = "SYNTH-showcase-viewer@datadiet.local"


class ShowcaseError(RuntimeError):
    """A safe, operator-facing refusal or validation failure."""


@dataclass(frozen=True)
class ShowcaseSummary:
    """Counts of rows this run actually created (zeros on an idempotent rerun)."""

    institution_id: int
    users: int
    sources: int
    assets: int
    scan_jobs: int
    policies: int
    holds: int
    assessments: int
    decisions: int
    classifications: int
    risks: int

    @property
    def created_rows(self) -> int:
        return sum(
            (
                self.users,
                self.sources,
                self.assets,
                self.scan_jobs,
                self.policies,
                self.holds,
                self.assessments,
                self.decisions,
                self.classifications,
                self.risks,
            )
        )


@dataclass(frozen=True)
class _AssetSpec:
    external_id: str
    title: str
    description: str
    record_type: str
    category: str
    sensitivity: str
    contains_personal_data: bool
    file_name: str
    mime_type: str
    size_bytes: int
    owner_team: str
    lifecycle_status: str
    reviewed_days_ago: int
    source_index: int
    duplicate_index: int | None = None


# Sensitivity values are the four documented risk levels, so every score is
# produced by the documented rule table in ``app.services.risk``.
ASSET_SPECS: tuple[_AssetSpec, ...] = (
    _AssetSpec(
        "SHOWCASE-ASSET-001",
        f"{LABEL} Enrolment extract, autumn term",
        "Fictional student-enrolment dataset used only for the showcase.",
        "dataset",
        "academic_records",
        "restricted",
        True,
        "enrolment-autumn.csv",
        "text/csv",
        248_000,
        "Fictional Registrar Team",
        "under_review",
        40,
        0,
    ),
    _AssetSpec(
        "SHOWCASE-ASSET-002",
        f"{LABEL} Library access log",
        "Fictional access metadata; no real visitor is represented.",
        "log",
        "administrative",
        "confidential",
        False,
        "library-access.log",
        "text/plain",
        96_000,
        "Fictional Library Team",
        "active",
        10,
        0,
    ),
    _AssetSpec(
        "SHOWCASE-ASSET-003",
        f"{LABEL} Research survey responses",
        "Fictional survey export used to demonstrate overdue review.",
        "dataset",
        "research_data",
        "restricted",
        True,
        "survey-responses.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        512_000,
        "Fictional Research Office",
        "active",
        200,
        0,
    ),
    _AssetSpec(
        "SHOWCASE-ASSET-004",
        f"{LABEL} Facilities floor plan",
        "Fictional building diagram with no location data about any person.",
        "document",
        "administrative",
        "internal",
        False,
        "facilities-plan.pdf",
        "application/pdf",
        1_840_000,
        "Fictional Facilities Team",
        "active",
        30,
        1,
    ),
    _AssetSpec(
        "SHOWCASE-ASSET-005",
        f"{LABEL} Public course catalogue",
        "Fictional published catalogue, included as a low-sensitivity contrast.",
        "dataset",
        "academic_records",
        "public",
        False,
        "course-catalogue.csv",
        "text/csv",
        44_000,
        "Fictional Communications Team",
        "active",
        20,
        1,
    ),
    _AssetSpec(
        "SHOWCASE-ASSET-006",
        f"{LABEL} Legacy payroll archive",
        "Fictional historical payroll file from an unmanaged source.",
        "dataset",
        "administrative",
        "confidential",
        True,
        "legacy-payroll.csv",
        "text/csv",
        720_000,
        "Fictional Finance Archive",
        "under_review",
        400,
        1,
    ),
    _AssetSpec(
        "SHOWCASE-ASSET-007",
        f"{LABEL} Duplicate student contact sheet",
        "Fictional duplicate of asset 001, included to demonstrate sprawl signals.",
        "dataset",
        "academic_records",
        "confidential",
        True,
        "contact-sheet-copy.csv",
        "text/csv",
        132_000,
        "Fictional Registrar Team",
        "active",
        5,
        0,
        duplicate_index=0,
    ),
    _AssetSpec(
        "SHOWCASE-ASSET-008",
        f"{LABEL} Grants budget workbook",
        "Fictional budget workbook used to demonstrate internal classification.",
        "document",
        "research_data",
        "internal",
        False,
        "grants-budget.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        288_000,
        "Fictional Grants Office",
        "active",
        60,
        0,
    ),
)


def validate_actor(value: str) -> str:
    """Require an explicit, meaningful operator identity for the audit trail."""
    actor = value.strip()
    if not actor or actor == "offline_operator":
        raise ValueError("actor must identify the operator; it cannot be blank or a legacy default")
    if len(actor) > 120:
        raise ValueError("actor must be at most 120 characters")
    return actor


def _arg_actor(value: str) -> str:
    try:
        return validate_actor(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(str(exc)) from exc


def _safe_failure(exc: BaseException) -> str:
    """Return a concise failure description that cannot contain credentials."""
    if isinstance(exc, ShowcaseError):
        return str(exc)
    if isinstance(exc, ValidationError):
        return "configuration is invalid; check the backend environment"
    if isinstance(exc, SQLAlchemyError):
        return (
            f"database error ({type(exc).__name__}); check DATABASE_URL and connectivity"
        )
    return f"unexpected error ({type(exc).__name__})"


def _safe_target(url: str) -> str:
    """Render just the scheme, host and database path — never userinfo."""
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.hostname or '(unknown host)'}{parts.path}"


def _validation_error(exc: ValidationError) -> str:
    """Pydantic v2 compatibility alias used by tests and diagnostics."""
    return _safe_failure(exc)


def _get_or_create_institution(db: Session, actor: str) -> tuple[models.Institution, bool]:
    existing = db.execute(
        select(models.Institution).where(models.Institution.code == INSTITUTION_CODE)
    ).scalar_one_or_none()
    if existing is not None:
        return existing, False
    institution = models.Institution(
        code=INSTITUTION_CODE,
        name=f"{LABEL} Fictional Records Office",
        is_active=True,
    )
    db.add(institution)
    db.flush()
    audit.record_event(
        db,
        actor=actor,
        event_type="showcase.institution_created",
        entity_type="institution",
        entity_id=institution.id,
        payload={"label": LABEL, "code": INSTITUTION_CODE},
        commit=False,
    )
    return institution, True


def _get_or_create_users(
    db: Session, institution: models.Institution, actor: str
) -> tuple[list[models.AppUser], int]:
    accounts = (
        (ADMIN_EMAIL, f"{LABEL} Showcase Administrator", "admin", True),
        (REVIEWER_EMAIL, f"{LABEL} Showcase Reviewer", "reviewer", False),
        (VIEWER_EMAIL, f"{LABEL} Showcase Viewer", "viewer", False),
    )
    users: list[models.AppUser] = []
    created = 0
    for email, display_name, role, platform_admin in accounts:
        user = db.execute(
            select(models.AppUser).where(models.AppUser.email == email)
        ).scalar_one_or_none()
        if user is None:
            user = models.AppUser(
                email=email,
                display_name=display_name,
                is_platform_admin=platform_admin,
                is_active=True,
            )
            db.add(user)
            db.flush()
            created += 1
            audit.record_event(
                db,
                actor=actor,
                event_type="showcase.user_created",
                entity_type="app_user",
                entity_id=user.id,
                payload={"label": LABEL, "email": email, "role": role},
                commit=False,
            )
        membership = db.execute(
            select(models.UserMembership).where(
                models.UserMembership.app_user_id == user.id,
                models.UserMembership.institution_id == institution.id,
            )
        ).scalar_one_or_none()
        if membership is None:
            db.add(
                models.UserMembership(
                    app_user_id=user.id,
                    institution_id=institution.id,
                    role=role,
                    is_active=True,
                    created_by=actor,
                )
            )
            audit.record_event(
                db,
                actor=actor,
                event_type="showcase.membership_created",
                entity_type="user_membership",
                entity_id=f"{user.id}:{institution.id}",
                payload={"label": LABEL, "role": role},
                commit=False,
            )
        users.append(user)
    db.flush()
    return users, created


def _get_or_create_sources(
    db: Session, institution: models.Institution, actor: str
) -> tuple[list[models.DataSource], int]:
    specs = (
        (
            MANAGED_SOURCE_NAME,
            {"count": 6, "categories": ["academic_records"],
             "sensitivity_levels": ["confidential", "restricted"],
             "record_types": ["dataset"]},
            True,
        ),
        (UNMANAGED_SOURCE_NAME, {"count": 0}, False),
    )
    sources: list[models.DataSource] = []
    created = 0
    for name, config, managed in specs:
        source = db.execute(
            select(models.DataSource).where(
                models.DataSource.institution_id == institution.id,
                models.DataSource.name == name,
            )
        ).scalar_one_or_none()
        if source is None:
            source = models.DataSource(
                institution_id=institution.id,
                name=name,
                source_type="synthetic",
                connector_type="synthetic",
                config=config,
                created_by=actor,
                status="active",
                actively_managed=managed,
                last_validated_at=None,
            )
            db.add(source)
            db.flush()
            created += 1
            audit.record_event(
                db,
                actor=actor,
                event_type="showcase.source_created",
                entity_type="data_source",
                entity_id=source.id,
                payload={"label": LABEL, "connector_type": "synthetic"},
                commit=False,
            )
        sources.append(source)
    db.flush()
    return sources, created


def _run_showcase_scan(db: Session, source: models.DataSource) -> int:
    """Execute the real synthetic connector once for the managed source."""
    existing = db.execute(
        select(func.count(models.ScanJob.id)).where(
            models.ScanJob.data_source_id == source.id,
            models.ScanJob.requested_by == SEED_ACTOR,
        )
    ).scalar()
    if existing:
        return 0
    job = scan.create_job(db, source, requested_by=SEED_ACTOR, batch_size=6)
    scan.run_scan(db, job)
    # The connector's own titles are deterministic but generic; relabel the
    # imported rows so every user-visible title states that it is a sample.
    imported_ids = [
        int(row[0])
        for row in db.execute(
            select(models.ScanResult.imported_asset_id).where(
                models.ScanResult.scan_job_id == job.id,
                models.ScanResult.imported_asset_id.is_not(None),
            )
        ).all()
    ]
    for asset_id in imported_ids:
        asset = db.get(models.InventoryRecord, asset_id)
        if asset is not None and not asset.title.startswith(LABEL):
            asset.title = f"{LABEL} {asset.title}"
            asset.description = "Fictional metadata produced by the real synthetic connector."
            db.add(asset)
    db.flush()
    return 1


def _get_or_create_assets(
    db: Session,
    institution: models.Institution,
    sources: list[models.DataSource],
    actor: str,
) -> tuple[list[models.InventoryRecord], int]:
    created = 0
    by_external_id: dict[str, models.InventoryRecord] = {}
    for spec in ASSET_SPECS:
        asset = db.execute(
            select(models.InventoryRecord).where(
                models.InventoryRecord.external_id == spec.external_id,
                models.InventoryRecord.institution_id == institution.id,
            )
        ).scalar_one_or_none()
        if asset is None:
            asset = models.InventoryRecord(
                institution_id=institution.id,
                data_source_id=sources[spec.source_index].id,
                external_id=spec.external_id,
                title=spec.title,
                description=spec.description,
                record_type=spec.record_type,
                category=spec.category,
                source_type="showcase_sample",
                file_name=spec.file_name,
                mime_type=spec.mime_type,
                size_bytes=spec.size_bytes,
                checksum_sha256=None,
                sensitivity=spec.sensitivity,
                contains_personal_data=spec.contains_personal_data,
                owner_team=spec.owner_team,
                owner_email=None,
                lifecycle_status=spec.lifecycle_status,
                last_reviewed=date.today() - timedelta(days=spec.reviewed_days_ago),
            )
            db.add(asset)
            db.flush()
            created += 1
            audit.record_event(
                db,
                actor=actor,
                event_type="showcase.asset_created",
                entity_type="inventory_record",
                entity_id=asset.id,
                payload={"label": LABEL, "external_id": spec.external_id},
                commit=False,
            )
        by_external_id[spec.external_id] = asset

    for spec in ASSET_SPECS:
        if spec.duplicate_index is not None:
            asset = by_external_id[spec.external_id]
            original = by_external_id[ASSET_SPECS[spec.duplicate_index].external_id]
            if asset.duplicate_of_id != original.id:
                asset.duplicate_of_id = original.id
                db.add(asset)

    db.flush()
    scanned = db.execute(
        select(models.InventoryRecord).where(
            models.InventoryRecord.institution_id == institution.id,
            models.InventoryRecord.title.startswith(LABEL),
        )
    ).scalars().all()
    curated = list(by_external_id.values())
    curated_ids = {asset.id for asset in curated}
    assets = curated + [row for row in scanned if row.id not in curated_ids]
    return assets, created


def _get_or_create_policy(
    db: Session, institution: models.Institution, actor: str
) -> tuple[models.RetentionPolicy, int]:
    name = f"{LABEL} Fictional records retention"
    policy = db.execute(
        select(models.RetentionPolicy).where(
            models.RetentionPolicy.institution_id == institution.id,
            models.RetentionPolicy.name == name,
        )
    ).scalar_one_or_none()
    if policy is not None:
        return policy, 0

    policy = retention.create_policy(
        db,
        PolicyCreate(
            institution_id=institution.id,
            name=name,
            description="Fictional showcase policy; demonstrates versioning, not a real rule.",
            applicable_categories=["academic_records", "administrative", "research_data"],
            retention_trigger="last_reviewed",
            retention_period_days=365,
            recommended_action="review",
            scope_description=f"{LABEL} records in the fictional records office only.",
        ),
        created_by=SEED_ACTOR,
    )
    version = retention.create_policy_version(
        db,
        policy,
        PolicyVersionCreate(
            description=f"{LABEL} version 1 of the demonstration rule.",
            applicable_categories=["academic_records", "administrative", "research_data"],
            retention_trigger="last_reviewed",
            retention_period_days=365,
            recommended_action="review",
            conditions={"label": LABEL, "fictional": True},
        ),
    )
    retention.activate_policy_version(db, policy, version)
    audit.record_event(
        db,
        actor=actor,
        event_type="showcase.policy_activated",
        entity_type="retention_policy",
        entity_id=policy.id,
        payload={"label": LABEL, "version_id": version.id},
        commit=False,
    )
    return policy, 1


def _get_or_create_hold(
    db: Session,
    institution: models.Institution,
    asset: models.InventoryRecord,
    actor: str,
) -> int:
    name = f"{LABEL} Fictional audit hold"
    existing = db.execute(
        select(models.RetentionHold).where(
            models.RetentionHold.institution_id == institution.id,
            models.RetentionHold.name == name,
        )
    ).scalar_one_or_none()
    if existing is not None:
        return 0
    retention.create_hold(
        db,
        HoldCreate(
            institution_id=institution.id,
            asset_id=asset.id,
            asset_scope={"title": asset.title},
            name=name,
            hold_type="audit",
            legal_basis=f"{LABEL} demonstration only — no real legal claim.",
            scope=[{"title": asset.title}],
            reason=f"{LABEL} hold used to demonstrate blocked recommendations.",
        ),
        created_by=actor,
    )
    return 1


def _seed_risks(
    db: Session, assets: list[models.InventoryRecord], sources: list[models.DataSource]
) -> int:
    source_by_id = {source.id: source for source in sources}
    created = 0
    for asset in assets:
        existing = db.execute(
            select(func.count(models.RiskAssessment.id)).where(
                models.RiskAssessment.record_id == asset.id,
                models.RiskAssessment.rule_set == RISK_RULE_SET,
            )
        ).scalar()
        if existing:
            continue
        if asset.sensitivity == "unknown":
            continue
        features = risk.RecordRiskFeatures(
            record_id=asset.external_id,
            sensitivity=asset.sensitivity,  # type: ignore[arg-type]
            contains_personal_data=bool(asset.contains_personal_data),
            duplicate_candidate=asset.duplicate_of_id is not None,
            past_retention_review=asset.last_reviewed is not None
            and asset.last_reviewed < date.today(),
            source_managed=bool(source_by_id[asset.data_source_id].actively_managed),
        )
        result = risk.compute_risk(features)
        db.add(
            models.RiskAssessment(
                record_id=asset.id,
                rule_set=RISK_RULE_SET,
                score=result.score,
                band=result.band,
                indicators=[
                    {
                        "code": item.code,
                        "label": item.label,
                        "points": item.points,
                        "explanation": item.explanation,
                    }
                    for item in result.indicators
                ],
            )
        )
        created += 1
    db.flush()
    return created


def _seed_assessments_and_decisions(
    db: Session, institution: models.Institution, assets: list[models.InventoryRecord]
) -> tuple[int, int]:
    assessments = 0
    decisions = 0
    for index, asset in enumerate(assets):
        existing = db.execute(
            select(models.RetentionAssessment)
            .where(models.RetentionAssessment.asset_id == asset.id)
            .order_by(models.RetentionAssessment.id.desc())
            .limit(1)
        ).scalar_one_or_none()
        if existing is None:
            existing_model = retention.assess_asset(db, asset.id, institution.id)
            existing = db.get(models.RetentionAssessment, existing_model.id)
            assessments += 1
        # A single demonstration decision is enough to show append-only review
        # history. A second original decision would have ``supersedes_decision_id
        # = NULL``; SQL Server's UNIQUE constraint treats repeated NULLs as a
        # collision, while MySQL/PostgreSQL allow them. Keep the seeded dataset
        # portable instead of relying on dialect-specific NULL semantics.
        if existing is None or index >= 1:
            continue
        prior = db.execute(
            select(func.count(models.RetentionDecision.id)).where(
                models.RetentionDecision.assessment_id == existing.id
            )
        ).scalar()
        if prior:
            continue
        try:
            retention.create_decision(
                db,
                existing.id,
                DecisionCreate(
                    decision="retain",
                    reason=(
                        f"{LABEL} demonstration decision recorded against a fictional "
                        "assessment; no lifecycle action was executed."
                    ),
                    expected_assessed_at=existing.assessed_at,
                    expected_policy_version_id=existing.policy_version_id,
                    expected_holds_active=existing.holds_active,
                ),
                institution_id=institution.id,
                actor=SEED_ACTOR,
                reviewer=SEED_ACTOR,
            )
        except ValueError:
            # A hold blocks later-workflow approvals; a retain decision on the
            # first two fictional assets must still succeed. Never mask an
            # unexpected failure: only the documented blocked case is skipped.
            continue
        decisions += 1
    return assessments, decisions


def seed_showcase(db: Session, *, actor: str) -> ShowcaseSummary:
    """Create the fictional showcase dataset; safe to call repeatedly."""
    actor = validate_actor(actor)
    institution, _ = _get_or_create_institution(db, actor)
    users, user_count = _get_or_create_users(db, institution, actor)
    sources, source_count = _get_or_create_sources(db, institution, actor)
    # Run the real synthetic connector before collecting assets, so the rows it
    # imports receive risk, classification and assessment records on the first
    # run as well. Reruns see the existing job and skip it.
    job_count = _run_showcase_scan(db, sources[0])
    assets, asset_count = _get_or_create_assets(db, institution, sources, actor)
    policy, policy_count = _get_or_create_policy(db, institution, actor)
    hold_count = _get_or_create_hold(db, institution, assets[0], actor)
    risk_count = _seed_risks(db, assets, sources)

    classification_count = 0
    for asset in assets:
        try:
            _, created = classification.classify_and_persist(db, asset, created_by=SEED_ACTOR)
        except ValueError:
            # An asset without usable metadata honestly returns an
            # `unclassified` result rather than raising; keep the loop simple.
            created = False
        classification_count += int(created)

    assessment_count, decision_count = _seed_assessments_and_decisions(db, institution, assets)

    db.flush()
    audit.record_event(
        db,
        actor=actor,
        event_type="showcase.seeded",
        entity_type="institution",
        entity_id=institution.id,
        payload={
            "label": LABEL,
            "policy_id": policy.id,
            "users": len(users),
            "assets": len(assets),
            "fictional": True,
        },
        commit=False,
    )
    db.commit()
    return ShowcaseSummary(
        institution_id=institution.id,
        users=user_count,
        sources=source_count,
        assets=asset_count,
        scan_jobs=job_count,
        policies=policy_count,
        holds=hold_count,
        assessments=assessment_count,
        decisions=decision_count,
        classifications=classification_count,
        risks=risk_count,
    )


def require_confirmation(confirm: bool) -> None:
    """Refuse a write unless the operator passed the explicit flag."""
    if not confirm:
        raise ShowcaseError(
            "Refusing to write showcase rows without --confirm-showcase-write. "
            "No changes were made."
        )


def require_showcase_mode(settings: Settings) -> None:
    """Refuse a write unless the backend itself opted into showcase mode."""
    if not settings.showcase_mode:
        raise ShowcaseError(
            "SHOWCASE_MODE is not enabled on the backend. Set it explicitly, "
            "restart the service, then rerun. No changes were made."
        )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Seed fictional sample rows into the configured DataDiet database."
    )
    parser.add_argument(
        "--actor",
        required=True,
        type=_arg_actor,
        help="Required audit identity, for example 'ops:alice'.",
    )
    parser.add_argument(
        "--confirm-showcase-write",
        action="store_true",
        help="Required explicit confirmation that fictional rows may be inserted.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Run the CLI, returning a non-zero code on every refusal or failure."""
    parser = _build_parser()
    args = parser.parse_args(argv)
    try:
        require_confirmation(args.confirm_showcase_write)
        from app.core.config import get_settings

        settings = get_settings()
        require_showcase_mode(settings)
        print(f"Target database: {_safe_target(settings.database_url)}")
        engine = get_engine()
        factory = sessionmaker(bind=engine, expire_on_commit=False)
        with factory() as db:
            summary = seed_showcase(db, actor=args.actor)
    except (ShowcaseError, ValidationError, SQLAlchemyError) as exc:
        print(f"Showcase seed failed: {_safe_failure(exc)}", file=sys.stderr)
        return 1
    except Exception as exc:  # noqa: BLE001 - CLI boundary must never echo raw exceptions
        print(f"Showcase seed failed: {_safe_failure(exc)}", file=sys.stderr)
        return 1

    print(
        "Showcase seed complete "
        f"(created {summary.created_rows} rows; institution #{summary.institution_id})."
    )
    print("Every seeded record is fictional sample data; teardown remains a human action.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
