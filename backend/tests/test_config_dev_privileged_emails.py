"""The development sign-in privilege allow-list must never default to open.

A public development provider can be reached by anyone who knows the URL, so
elevated fields are honoured only for exact synthetic identities listed by
``AUTH_DEV_PRIVILEGED_EMAILS``. The wildcard exists solely for the non-public
pytest environment.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager

import pytest
from pydantic import ValidationError

from app.core.config import Settings

KEYS = ("ENVIRONMENT", "DATABASE_URL", "AUTH_DEV_PRIVILEGED_EMAILS")


@contextmanager
def clean_environment(environment: str) -> Iterator[None]:
    saved = {key: os.environ.get(key) for key in KEYS}
    for key in KEYS:
        os.environ.pop(key, None)
    os.environ["ENVIRONMENT"] = environment
    try:
        yield
    finally:
        for key, value in saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def _settings(**overrides: object) -> Settings:
    return Settings(_env_file=None, **overrides)


def test_comma_separated_allow_list_is_normalised() -> None:
    with clean_environment("development"):
        os.environ["AUTH_DEV_PRIVILEGED_EMAILS"] = (
            "SYNTH-Admin@datadiet.local, SYNTH-viewer@datadiet.local,,"
        )
        assert _settings().auth_dev_privileged_emails == frozenset(
            {
                "synth-admin@datadiet.local",
                "synth-viewer@datadiet.local",
            }
        )


def test_json_array_allow_list_is_supported() -> None:
    with clean_environment("development"):
        os.environ["AUTH_DEV_PRIVILEGED_EMAILS"] = '["SYNTH-a@datadiet.local"]'
        assert _settings().auth_dev_privileged_emails == frozenset(
            {"synth-a@datadiet.local"}
        )


def test_deployed_development_cannot_use_the_wildcard() -> None:
    with clean_environment("development"):
        os.environ["AUTH_DEV_PRIVILEGED_EMAILS"] = "*"
        with pytest.raises(ValidationError, match="only permitted in ENVIRONMENT=test"):
            _settings()


def test_test_environment_keeps_the_legacy_wildcard_default() -> None:
    with clean_environment("test"):
        assert _settings().auth_dev_privileged_emails == frozenset({"*"})
