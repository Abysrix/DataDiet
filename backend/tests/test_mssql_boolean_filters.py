"""SQL Server guards for boolean filters.

SQLAlchemy renders ``column.is_(True)`` as ``IS 1``; SQL Server has no
``IS <number>`` predicate. Active-only filters must compile as equality on every
supported dialect.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest
from sqlalchemy import select, true
from sqlalchemy.dialects import mssql, mysql, postgresql

from app.db.models import AppUser, UserMembership

APP_DIR = Path(__file__).resolve().parents[1] / "app"
REPO_ROOT = APP_DIR.parents[1]


def _boolean_is_calls() -> list[tuple[str, int]]:
    """Find ``column.is_(True/False)`` calls in application code."""
    offenders: list[tuple[str, int]] = []
    for path in APP_DIR.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8-sig"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
                continue
            if node.func.attr != "is_":
                continue
            if any(
                isinstance(arg, ast.Constant) and isinstance(arg.value, bool)
                for arg in node.args
            ):
                offenders.append((str(path.relative_to(REPO_ROOT)), node.lineno))
    return offenders


def test_no_boolean_is_predicates_in_application_code() -> None:
    assert _boolean_is_calls() == []


@pytest.mark.parametrize(
    "column",
    [UserMembership.is_active, AppUser.is_active, AppUser.is_platform_admin],
)
@pytest.mark.parametrize(
    "dialect",
    [mssql.dialect(), mysql.dialect(), postgresql.dialect()],
    ids=["mssql", "mysql", "postgresql"],
)
def test_true_filter_compiles_as_equality_everywhere(column, dialect) -> None:
    sql = str(select(column).where(column == true()).compile(dialect=dialect))
    assert "IS 1" not in sql
    assert "IS true" not in sql
    assert "= 1" in sql or "= true" in sql
