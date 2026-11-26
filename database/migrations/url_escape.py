"""Alembic INI escaping for SQLAlchemy URLs (ADR-0026).

Alembic stores ``sqlalchemy.url`` in an INI file parsed by ConfigParser. Azure
SQL usernames are ``user@server`` and must be percent-encoded in the URL
(``user%40server``); an unescaped ``%`` is an interpolation marker and makes
every Alembic command fail before it connects. Doubling each ``%`` here
round-trips back to the original URL when Alembic reads the option.
"""


def escape_alembic_url(url: str) -> str:
    """Return the value safe to pass to ``Config.set_main_option``."""
    return url.replace("%", "%%")
