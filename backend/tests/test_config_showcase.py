"""Showcase mode is an explicit, opt-in runtime switch (ADR-0032).

It must default off so ordinary development, CI and production builds keep the
ADR-0030 rule: no user-facing synthetic sample data. Deployed hosts supply flat
environment strings, so the common truthy spellings must be accepted too.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager

from app.core.config import Settings


@contextmanager
def _showcase_environment() -> Iterator[None]:
    saved = os.environ.get("SHOWCASE_MODE")
    os.environ.pop("SHOWCASE_MODE", None)
    try:
        yield
    finally:
        if saved is None:
            os.environ.pop("SHOWCASE_MODE", None)
        else:
            os.environ["SHOWCASE_MODE"] = saved


def _settings(**overrides: object) -> Settings:
    return Settings(_env_file=None, **overrides)


def test_showcase_mode_is_off_by_default() -> None:
    with _showcase_environment():
        assert _settings().showcase_mode is False


def test_showcase_mode_accepts_flat_truthy_environment_values() -> None:
    with _showcase_environment():
        for value in ("1", "true", "yes", "on"):
            os.environ["SHOWCASE_MODE"] = value
            assert _settings().showcase_mode is True, value


def test_showcase_mode_accepts_explicit_false() -> None:
    with _showcase_environment():
        os.environ["SHOWCASE_MODE"] = "false"
        assert _settings().showcase_mode is False
