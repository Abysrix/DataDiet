"""SQL Server baseline for the schema MySQL received from 0001..0012.

Revision ID: 0015_mssql_baseline
Revises: 0014_external_identities
Create Date: 2026-11-26

Revisions ``0002``..``0012`` cannot replay on SQL Server: they contain
MySQL-only DDL such as unnamed-constraint drops, ``NOW()``, ``LIMIT`` and
``DROP DEFAULT``. This revision branches by dialect instead of rewriting
applied history:

* **MySQL/PostgreSQL**: a no-op. Those databases already hold the schema.
* **mssql**: creates the equivalent 0001..0012 schema once, as a baseline.

The DDL is frozen explicitly rather than generated from ``Base.metadata``, so a
later revision can never silently add a column here and then collide with its
own ``add_column``. ``0014_external_identities`` runs before this revision but
is a no-op on ``mssql`` (its ``app_users`` foreign key would reference a table
this baseline has not created yet), so the fresh-mssql path is:

    alembic stamp 0012_audit_platform_admin_reset
    alembic upgrade head

The stamp skips the MySQL-only replay; ``upgrade`` then applies ``0013`` (a
no-op on mssql), ``0014`` (a no-op on mssql) and ``0015`` (this baseline, which
includes ``external_identities``).
``0012``'s audit row is not inserted: a brand-new database has no revoked
platform-admin grants to record. The ``alembic_version.version_num`` widening
from ``0001`` is repeated here because a stamped database never ran ``0001``.

SQL Server does not allow ``ON DELETE RESTRICT`` and rejects multiple cascade
paths. Where MySQL/PostgreSQL use ``RESTRICT`` this baseline uses ``NO ACTION``
(the SQL Server equivalent). Self-references and version/policy pairs that
would create a second cascade path also use ``NO ACTION`` instead of
``SET NULL``, and ``retention_decisions.asset_id`` does not cascade directly
because ``inventory_records -> retention_assessments -> retention_decisions``
already provides that path. No destructive lifecycle action depends on these
actions; they are schema constraints only.

Downgrade deliberately refuses to run on mssql: reversing this baseline would
drop every table in the deployment, which no migration in this repository does
automatically. Roll back to ``0014`` and restore from a backup instead.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0015_mssql_baseline"
down_revision: Union[str, None] = "0014_external_identities"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

#: The revision a fresh SQL Server database must be stamped at before upgrading.
BASELINE_STAMP = "0012_audit_platform_admin_reset"


def _is_mssql() -> bool:
    return op.get_bind().dialect.name == "mssql"


def upgrade() -> None:
    """Create the baseline schema on SQL Server; do nothing anywhere else."""
    if not _is_mssql():
        return

    # Mirrors 0001's MySQL fix: Alembic's default VARCHAR(32) cannot hold this
    # project's revision ids, and a stamped database never ran 0001.
    op.alter_column(
        "alembic_version",
        "version_num",
        existing_type=sa.String(length=32),
        type_=sa.String(length=64),
        existing_nullable=False,
    )

    # --- identity and organization ------------------------------------------ #
    op.create_table(
        "app_users",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=200), nullable=False),
        sa.Column("is_platform_admin", sa.Boolean(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )
    op.create_table(
        "institutions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("code", sa.String(length=50), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
    )
    op.create_index("ix_institutions_code", "institutions", ["code"])
    op.create_table(
        "user_memberships",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("app_user_id", sa.Integer(), nullable=False),
        sa.Column("institution_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_by", sa.String(length=120), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(
            ["app_user_id"], ["app_users.id"], name="fk_user_memberships_app_user",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["institution_id"], ["institutions.id"],
            name="fk_user_memberships_institution", ondelete="NO ACTION",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("app_user_id", "institution_id", name="uq_user_membership"),
    )
    op.create_index("ix_user_memberships_institution", "user_memberships", ["institution_id"])

    # --- audit -------------------------------------------------------------- #
    op.create_table(
        "audit_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("actor", sa.String(length=120), nullable=False),
        sa.Column("event_type", sa.String(length=80), nullable=False),
        sa.Column("entity_type", sa.String(length=80), nullable=False),
        sa.Column("entity_id", sa.String(length=64), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_audit_events_event_type", "audit_events", ["event_type"])
    op.create_index("ix_audit_events_occurred_at", "audit_events", ["occurred_at"])

    # --- sources and inventory ---------------------------------------------- #
    op.create_table(
        "data_sources",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("institution_id", sa.Integer(), nullable=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("source_type", sa.String(length=50), nullable=False),
        sa.Column("connector_type", sa.String(length=50), nullable=True),
        sa.Column("root_key", sa.String(length=100), nullable=True),
        sa.Column("config", sa.JSON(), nullable=True),
        sa.Column("created_by", sa.String(length=120), nullable=False),
        sa.Column("last_validated_at", sa.DateTime(), nullable=True),
        sa.Column("last_validation_ok", sa.Boolean(), nullable=True),
        sa.Column("last_validation_message", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("actively_managed", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(
            ["institution_id"], ["institutions.id"],
            name="fk_data_sources_institution_id_institutions", ondelete="NO ACTION",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("institution_id", "name", name="uq_datasource_institution_name"),
    )
    op.create_index("ix_data_sources_institution_id", "data_sources", ["institution_id"])
    op.create_index("ix_data_sources_connector_type", "data_sources", ["connector_type"])

    op.create_table(
        "inventory_records",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("institution_id", sa.Integer(), nullable=True),
        sa.Column("data_source_id", sa.Integer(), nullable=False),
        sa.Column("external_id", sa.String(length=100), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("record_type", sa.String(length=100), nullable=False),
        sa.Column("category", sa.String(length=100), nullable=True),
        sa.Column("source_type", sa.String(length=50), nullable=True),
        sa.Column("file_name", sa.String(length=255), nullable=True),
        sa.Column("mime_type", sa.String(length=100), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("checksum_sha256", sa.String(length=64), nullable=True),
        sa.Column("sensitivity", sa.String(length=20), nullable=False),
        sa.Column("contains_personal_data", sa.Boolean(), nullable=False),
        sa.Column("duplicate_of_id", sa.Integer(), nullable=True),
        sa.Column("owner_team", sa.String(length=120), nullable=True),
        sa.Column("owner_email", sa.String(length=255), nullable=True),
        sa.Column("lifecycle_status", sa.String(length=30), nullable=False),
        sa.Column("last_reviewed", sa.Date(), nullable=True),
        sa.Column("source_created_at", sa.DateTime(), nullable=True),
        sa.Column("source_modified_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(
            ["data_source_id"], ["data_sources.id"], ondelete="NO ACTION"
        ),
        sa.ForeignKeyConstraint(
            ["duplicate_of_id"], ["inventory_records.id"], ondelete="NO ACTION"
        ),
        sa.ForeignKeyConstraint(
            ["institution_id"], ["institutions.id"],
            name="fk_inventory_records_institution_id_institutions", ondelete="NO ACTION",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("data_source_id", "external_id", name="uq_inventory_source_external"),
    )
    op.create_index(
        "ix_inventory_records_data_source_id", "inventory_records", ["data_source_id"]
    )
    op.create_index("ix_inventory_records_institution", "inventory_records", ["institution_id"])
    op.create_index("ix_inventory_records_category", "inventory_records", ["category"])
    op.create_index("ix_inventory_records_sensitivity", "inventory_records", ["sensitivity"])
    op.create_index(
        "ix_inventory_records_lifecycle_status", "inventory_records", ["lifecycle_status"]
    )
    op.create_index("ix_inventory_records_source_type", "inventory_records", ["source_type"])
    op.create_index("ix_inventory_records_title", "inventory_records", ["title"])

    # --- policies ----------------------------------------------------------- #
    # Created without current_version_id's foreign key; that edge is added once
    # policy_versions exists, exactly as 0003 does on MySQL.
    op.create_table(
        "retention_policies",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("institution_id", sa.Integer(), nullable=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("applicable_categories", sa.JSON(), nullable=True),
        sa.Column("retention_trigger", sa.String(length=30), nullable=True),
        sa.Column("retention_period_days", sa.Integer(), nullable=True),
        sa.Column("recommended_action", sa.String(length=30), nullable=True),
        sa.Column("scope_description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("version", sa.String(length=50), nullable=True),
        sa.Column("effective_from", sa.Date(), nullable=True),
        sa.Column("effective_to", sa.Date(), nullable=True),
        sa.Column("created_by", sa.String(length=120), nullable=True),
        sa.Column("current_version_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(
            ["institution_id"], ["institutions.id"],
            name="fk_retention_policies_institution_id", ondelete="NO ACTION",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", "version", name="uq_policy_name_version"),
    )
    op.create_index(
        "ix_retention_policies_institution", "retention_policies", ["institution_id"]
    )
    op.create_index("ix_retention_policies_status", "retention_policies", ["status"])

    op.create_table(
        "policy_versions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("policy_id", sa.Integer(), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("applicable_categories", sa.JSON(), nullable=True),
        sa.Column("retention_period_days", sa.Integer(), nullable=True),
        sa.Column("retention_trigger", sa.String(length=30), nullable=True),
        sa.Column("conditions", sa.JSON(), nullable=True),
        sa.Column("recommended_action", sa.String(length=30), nullable=True),
        sa.Column("effective_from", sa.Date(), nullable=True),
        sa.Column("effective_to", sa.Date(), nullable=True),
        sa.Column("created_by", sa.String(length=120), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("approved_by", sa.String(length=120), nullable=True),
        sa.Column("approved_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["policy_id"], ["retention_policies.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_policy_versions_policy_id", "policy_versions", ["policy_id"])
    op.create_index("ix_policy_versions_status", "policy_versions", ["status"])

    op.create_foreign_key(
        "fk_retention_policies_current_version_id",
        "retention_policies",
        "policy_versions",
        ["current_version_id"],
        ["id"],
        ondelete="NO ACTION",
    )

    # --- assessment, decision and lifecycle --------------------------------- #
    op.create_table(
        "retention_assessments",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("asset_id", sa.Integer(), nullable=False),
        sa.Column("institution_id", sa.Integer(), nullable=True),
        sa.Column("policy_id", sa.Integer(), nullable=True),
        sa.Column("policy_version_id", sa.Integer(), nullable=True),
        sa.Column("policy_version_number", sa.Integer(), nullable=True),
        sa.Column("rule_set", sa.String(length=50), nullable=False),
        sa.Column("assessed_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("recommendation", sa.String(length=50), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=False),
        sa.Column("findings", sa.JSON(), nullable=False),
        sa.Column("holds_active", sa.Integer(), nullable=False),
        sa.Column("unresolved_conditions", sa.JSON(), nullable=False),
        sa.Column("trigger_date", sa.Date(), nullable=True),
        sa.Column("retention_period_days", sa.Integer(), nullable=True),
        sa.Column("retention_deadline", sa.Date(), nullable=True),
        sa.ForeignKeyConstraint(["asset_id"], ["inventory_records.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["institution_id"], ["institutions.id"],
            name="fk_retention_assessments_institution_id", ondelete="NO ACTION",
        ),
        sa.ForeignKeyConstraint(["policy_id"], ["retention_policies.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["policy_version_id"], ["policy_versions.id"], ondelete="NO ACTION"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_retention_assessments_asset_id", "retention_assessments", ["asset_id"]
    )
    op.create_index(
        "ix_retention_assessments_institution", "retention_assessments", ["institution_id"]
    )
    op.create_index(
        "ix_retention_assessments_policy_id", "retention_assessments", ["policy_id"]
    )

    op.create_table(
        "retention_decisions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("assessment_id", sa.Integer(), nullable=False),
        sa.Column("asset_id", sa.Integer(), nullable=False),
        sa.Column("institution_id", sa.Integer(), nullable=True),
        sa.Column("policy_id", sa.Integer(), nullable=True),
        sa.Column("policy_version_id", sa.Integer(), nullable=True),
        sa.Column("recommendation_reviewed", sa.String(length=50), nullable=False),
        sa.Column("decision", sa.String(length=40), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("reviewer", sa.String(length=120), nullable=False),
        sa.Column("decided_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("supersedes_decision_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(
            ["assessment_id"], ["retention_assessments.id"], ondelete="CASCADE"
        ),
        # Inventory -> assessment -> decision is already one cascade path; a
        # direct inventory -> decision cascade would be a second one.
        sa.ForeignKeyConstraint(["asset_id"], ["inventory_records.id"], ondelete="NO ACTION"),
        sa.ForeignKeyConstraint(["institution_id"], ["institutions.id"], ondelete="NO ACTION"),
        sa.ForeignKeyConstraint(["policy_id"], ["retention_policies.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["policy_version_id"], ["policy_versions.id"], ondelete="NO ACTION"
        ),
        sa.ForeignKeyConstraint(
            ["supersedes_decision_id"], ["retention_decisions.id"],
            name="fk_retention_decisions_supersedes", ondelete="NO ACTION",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("assessment_id", name="uq_retention_decisions_assessment_id"),
        sa.UniqueConstraint("supersedes_decision_id", name="uq_retention_decisions_supersedes"),
    )
    op.create_index("ix_retention_decisions_asset_id", "retention_decisions", ["asset_id"])
    op.create_index(
        "ix_retention_decisions_institution", "retention_decisions", ["institution_id"]
    )

    op.create_table(
        "risk_assessments",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("record_id", sa.Integer(), nullable=False),
        sa.Column("assessed_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("rule_set", sa.String(length=50), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("band", sa.String(length=20), nullable=False),
        sa.Column("indicators", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["record_id"], ["inventory_records.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_risk_assessments_record_id", "risk_assessments", ["record_id"])

    op.create_table(
        "classification_results",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("asset_id", sa.Integer(), nullable=False),
        sa.Column("institution_id", sa.Integer(), nullable=True),
        sa.Column("rule_version", sa.String(length=50), nullable=False),
        sa.Column("outcome", sa.String(length=30), nullable=False),
        sa.Column("proposed_category", sa.String(length=100), nullable=True),
        sa.Column("proposed_sensitivity", sa.String(length=20), nullable=False),
        sa.Column("confidence", sa.String(length=20), nullable=False),
        sa.Column("confidence_meaning", sa.Text(), nullable=False),
        sa.Column("evidence", sa.JSON(), nullable=False),
        sa.Column("warnings", sa.JSON(), nullable=False),
        sa.Column("conflicts", sa.JSON(), nullable=False),
        sa.Column("input_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("created_by", sa.String(length=120), nullable=False),
        sa.Column(
            "classified_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False
        ),
        sa.ForeignKeyConstraint(["asset_id"], ["inventory_records.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["institution_id"], ["institutions.id"], ondelete="NO ACTION"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "asset_id", "rule_version", "input_fingerprint", name="uq_classification_fingerprint"
        ),
    )
    op.create_index("ix_classification_results_asset_id", "classification_results", ["asset_id"])
    op.create_index(
        "ix_classification_results_institution", "classification_results", ["institution_id"]
    )
    op.create_index(
        "ix_classification_results_rule_version", "classification_results", ["rule_version"]
    )
    op.create_index(
        "ix_classification_results_classified_at", "classification_results", ["classified_at"]
    )

    op.create_table(
        "retention_holds",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("institution_id", sa.Integer(), nullable=True),
        sa.Column("asset_id", sa.Integer(), nullable=True),
        sa.Column("asset_scope", sa.JSON(), nullable=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("hold_type", sa.String(length=50), nullable=True),
        sa.Column("legal_basis", sa.String(length=200), nullable=True),
        sa.Column("scope", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("created_by", sa.String(length=120), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("released_by", sa.String(length=120), nullable=True),
        sa.Column("released_at", sa.DateTime(), nullable=True),
        sa.Column("release_reason", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["asset_id"], ["inventory_records.id"],
            name="fk_retention_holds_asset_id", ondelete="NO ACTION",
        ),
        sa.ForeignKeyConstraint(
            ["institution_id"], ["institutions.id"],
            name="fk_retention_holds_institution_id", ondelete="NO ACTION",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_retention_holds_asset_id", "retention_holds", ["asset_id"])
    op.create_index("ix_retention_holds_institution", "retention_holds", ["institution_id"])
    op.create_index("ix_retention_holds_status", "retention_holds", ["status"])

    op.create_table(
        "lifecycle_actions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("record_id", sa.Integer(), nullable=False),
        sa.Column("policy_id", sa.Integer(), nullable=True),
        sa.Column("action_type", sa.String(length=30), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=False),
        sa.Column("requested_by", sa.String(length=120), nullable=False),
        sa.Column(
            "requested_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False
        ),
        sa.Column("decided_by", sa.String(length=120), nullable=True),
        sa.Column("decided_at", sa.DateTime(), nullable=True),
        sa.Column("decision_note", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["record_id"], ["inventory_records.id"], ondelete="NO ACTION"),
        sa.ForeignKeyConstraint(["policy_id"], ["retention_policies.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_lifecycle_actions_record_id", "lifecycle_actions", ["record_id"])

    # --- archive and retrieval ---------------------------------------------- #
    op.create_table(
        "archive_items",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("record_id", sa.Integer(), nullable=False),
        sa.Column("storage_provider", sa.String(length=50), nullable=False),
        sa.Column("archive_location", sa.String(length=500), nullable=False),
        sa.Column("manifest", sa.JSON(), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("archived_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("verified_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["record_id"], ["inventory_records.id"], ondelete="NO ACTION"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_archive_items_record_id", "archive_items", ["record_id"])

    op.create_table(
        "retrieval_requests",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("record_id", sa.Integer(), nullable=False),
        sa.Column("requested_by", sa.String(length=120), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("fulfilled_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["record_id"], ["inventory_records.id"], ondelete="NO ACTION"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_retrieval_requests_record_id", "retrieval_requests", ["record_id"])

    # --- scanning ----------------------------------------------------------- #
    op.create_table(
        "scan_jobs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("data_source_id", sa.Integer(), nullable=False),
        sa.Column("institution_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("batch_size", sa.Integer(), nullable=False),
        sa.Column("total_discovered", sa.Integer(), nullable=False),
        sa.Column("total_imported", sa.Integer(), nullable=False),
        sa.Column("total_skipped", sa.Integer(), nullable=False),
        sa.Column("total_errors", sa.Integer(), nullable=False),
        sa.Column("retried_from_job_id", sa.Integer(), nullable=True),
        sa.Column("requested_by", sa.String(length=120), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(
            ["data_source_id"], ["data_sources.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["institution_id"], ["institutions.id"], ondelete="NO ACTION"),
        sa.ForeignKeyConstraint(["retried_from_job_id"], ["scan_jobs.id"], ondelete="NO ACTION"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_scan_jobs_data_source_id", "scan_jobs", ["data_source_id"])
    op.create_index("ix_scan_jobs_institution", "scan_jobs", ["institution_id"])
    op.create_index("ix_scan_jobs_status", "scan_jobs", ["status"])

    op.create_table(
        "scan_results",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("scan_job_id", sa.Integer(), nullable=False),
        sa.Column("source_key", sa.String(length=512), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("record_type", sa.String(length=100), nullable=False),
        sa.Column("category", sa.String(length=100), nullable=True),
        sa.Column("file_name", sa.String(length=255), nullable=True),
        sa.Column("mime_type", sa.String(length=100), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("checksum_sha256", sa.String(length=64), nullable=True),
        sa.Column("sensitivity", sa.String(length=20), nullable=False),
        sa.Column("contains_personal_data", sa.Boolean(), nullable=False),
        sa.Column("imported_asset_id", sa.Integer(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(["scan_job_id"], ["scan_jobs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["imported_asset_id"], ["inventory_records.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("scan_job_id", "source_key", name="uq_scan_result_job_source"),
    )
    op.create_index("ix_scan_results_scan_job_id", "scan_results", ["scan_job_id"])
    op.create_index("ix_scan_results_status", "scan_results", ["status"])

    op.create_table(
        "scan_errors",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("scan_job_id", sa.Integer(), nullable=False),
        sa.Column("source_key", sa.String(length=512), nullable=True),
        sa.Column("path", sa.String(length=512), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=False),
        sa.Column("severity", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(["scan_job_id"], ["scan_jobs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_scan_errors_scan_job_id", "scan_errors", ["scan_job_id"])
    op.create_index("ix_scan_errors_severity", "scan_errors", ["severity"])

    op.create_table(
        "source_record_mappings",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("data_source_id", sa.Integer(), nullable=False),
        sa.Column("institution_id", sa.Integer(), nullable=True),
        sa.Column("source_key", sa.String(length=512), nullable=False),
        sa.Column("asset_id", sa.Integer(), nullable=True),
        sa.Column("checksum_sha256", sa.String(length=64), nullable=True),
        sa.Column("observation_count", sa.Integer(), nullable=False),
        sa.Column(
            "first_seen_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False
        ),
        sa.Column(
            "last_seen_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False
        ),
        sa.Column("source_modified_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(
            ["data_source_id"], ["data_sources.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["institution_id"], ["institutions.id"], ondelete="NO ACTION"),
        sa.ForeignKeyConstraint(["asset_id"], ["inventory_records.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("data_source_id", "source_key", name="uq_source_mapping"),
    )
    op.create_index(
        "ix_source_record_mappings_data_source_id",
        "source_record_mappings",
        ["data_source_id"],
    )
    op.create_index(
        "ix_source_record_mappings_institution", "source_record_mappings", ["institution_id"]
    )
    op.create_index(
        "ix_source_record_mappings_asset_id", "source_record_mappings", ["asset_id"]
    )

    # 0014 is a no-op on SQL Server (app_users does not exist before this
    # baseline), so the equivalent table belongs here. Its columns and
    # constraint names mirror 0014 exactly; only the timestamp default uses
    # T-SQL syntax.
    op.create_table(
        "external_identities",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("provider", sa.String(length=40), nullable=False),
        sa.Column("external_subject", sa.String(length=120), nullable=False),
        sa.Column("app_user_id", sa.Integer(), nullable=False),
        sa.Column("last_email", sa.String(length=255), nullable=True),
        sa.Column("bound_by", sa.String(length=40), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["app_user_id"],
            ["app_users.id"],
            name="fk_external_identities_app_user",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "provider", "external_subject", name="uq_external_identity_provider_subject"
        ),
    )
    op.create_index("ix_external_identities_app_user", "external_identities", ["app_user_id"])


def downgrade() -> None:
    """Refuse to undo the baseline instead of dropping the deployment's schema."""
    if _is_mssql():
        raise RuntimeError(
            "0015_mssql_baseline cannot be downgraded: reversing it means "
            "dropping every table in the database. The SQL Server history is "
            "forward-only. Use `alembic downgrade 0014_external_identities` and "
            "restore from a backup if the baseline itself must be removed."
        )
    # MySQL, PostgreSQL and other dialects: this revision created nothing, so
    # there is nothing to undo.
    pass
