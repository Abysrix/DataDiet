"""Offline guards for the SQL Server baseline migration (ADR-0026).

There is no disposable SQL Server in this environment, so this module does not
pretend to prove a live Azure SQL upgrade. What it does prove without a server:
the new revision leaves one Alembic head, its DDL stays on the mssql branch,
its defaults are T-SQL ``CURRENT_TIMESTAMP`` rather than MySQL ``now()``, and its
downgrade refuses to drop a deployment's schema.

A live check against Azure SQL is a separate operator action documented in
``docs/vercel-local-azure-sql.md``; these tests are not evidence of it.
"""

from __future__ import annotations

import configparser
import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory

REPO_ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS_DIR = REPO_ROOT / "database" / "migrations"
REVISION_FILE = MIGRATIONS_DIR / "versions" / "0015_mssql_baseline.py"
URL_ESCAPE_FILE = MIGRATIONS_DIR / "url_escape.py"
REVISIONS_DIR = MIGRATIONS_DIR / "versions"
HEAD = "0015_mssql_baseline"


def _load_revision_module(name: str = "0015_mssql_baseline"):
    path = REVISIONS_DIR / f"{name}.py"
    spec = importlib.util.spec_from_file_location(f"revision_{name}", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class RecordingOp:
    """Minimal ``op`` stand-in that records every DDL call."""

    def __init__(self, dialect: str) -> None:
        self.dialect = dialect
        self.calls: list[str] = []

    def get_bind(self):
        return SimpleNamespace(dialect=SimpleNamespace(name=self.dialect))

    def __getattr__(self, name: str):
        def record(*_args, **_kwargs):
            self.calls.append(name)

        return record


def test_the_repository_has_exactly_one_mssql_head() -> None:
    config = Config(str(REPO_ROOT / "backend" / "alembic.ini"))
    config.set_main_option("script_location", str(MIGRATIONS_DIR))

    assert ScriptDirectory.from_config(config).get_heads() == [HEAD]


def test_baseline_metadata_extends_the_portable_identity_revision() -> None:
    module = _load_revision_module()

    assert module.revision == HEAD
    assert module.down_revision == "0014_external_identities"
    assert module.BASELINE_STAMP == "0012_audit_platform_admin_reset"


@pytest.mark.parametrize("dialect", ["mysql", "postgresql"])
def test_baseline_issues_no_ddl_outside_sql_server(dialect: str) -> None:
    module = _load_revision_module()
    op = RecordingOp(dialect)
    module.op = op

    module.upgrade()

    assert module._is_mssql() is False
    assert op.calls == []

    module.downgrade()
    assert op.calls == []


def test_baseline_creates_the_schema_on_sql_server() -> None:
    module = _load_revision_module()
    op = RecordingOp("mssql")
    module.op = op

    module.upgrade()

    assert module._is_mssql() is True
    assert "alter_column" in op.calls
    assert op.calls.count("create_table") == 21
    assert "create_index" in op.calls
    assert "create_foreign_key" in op.calls


def test_0014_is_a_noop_on_sql_server_until_the_baseline_exists() -> None:
    """Its app_users foreign key cannot resolve before 0015 creates the table."""
    module = _load_revision_module("0014_external_identities")
    op = RecordingOp("mssql")
    module.op = op

    module.upgrade()
    assert module._is_mssql() is True
    assert op.calls == []

    module.downgrade()
    assert op.calls == []


def test_baseline_uses_tsql_timestamps_not_mysql_now() -> None:
    source = REVISION_FILE.read_text(encoding="utf-8")

    assert 'sa.text("now()")' not in source
    assert 'sa.text("CURRENT_TIMESTAMP")' in source


def test_baseline_does_not_emit_mysql_restrict_foreign_keys() -> None:
    """SQL Server rejects ``ON DELETE RESTRICT``; ``NO ACTION`` is equivalent."""
    source = REVISION_FILE.read_text(encoding="utf-8")

    assert 'ondelete="RESTRICT"' not in source
    assert 'ondelete="NO ACTION"' in source


def test_baseline_avoids_known_sql_server_multiple_cascade_paths() -> None:
    """Self/version references must not add a second cascading path."""
    normalized = "".join(REVISION_FILE.read_text(encoding="utf-8").split())
    forbidden = (
        '["duplicate_of_id"],["inventory_records.id"],ondelete="SETNULL"',
        '["current_version_id"],["id"],ondelete="SETNULL"',
        '["policy_version_id"],["policy_versions.id"],ondelete="SETNULL"',
        '["retried_from_job_id"],["scan_jobs.id"],ondelete="SETNULL"',
    )

    for pattern in forbidden:
        assert pattern not in normalized


def test_baseline_downgrade_refuses_on_sql_server() -> None:
    module = _load_revision_module()
    module.op = RecordingOp("mssql")

    with pytest.raises(RuntimeError, match="forward-only"):
        module.downgrade()


def test_alembic_url_escapes_percent_encoded_credentials() -> None:
    """A `%40` Azure SQL username must survive Alembic's INI interpolation."""
    spec = importlib.util.spec_from_file_location("url_escape", URL_ESCAPE_FILE)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)

    original = (
        "mssql+pymssql://datadiet_admin%40srv:p%21ss@srv.database.windows.net:1433/"
        "datadiet_demo?tds_version=7.4"
    )
    escaped = module.escape_alembic_url(original)

    parser = configparser.ConfigParser()
    parser.read_string(f"[alembic]\nurl = {escaped}\n")
    assert parser.get("alembic", "url") == original
