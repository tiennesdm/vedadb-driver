"""
VedaDB ORM — Utility functions.

String escaping, identifier quoting, naming-convention converters, and
simple English pluralisation.
"""

import re
from typing import Any, Optional

from .types import FieldType, format_value


def escape_string(s: str) -> str:
    """Escape a string for safe inclusion inside a single-quoted SQL literal.

    Handles single quotes, backslashes, and semicolons (the latter prevents
    accidental multi-statement injection via the TCP protocol).
    """
    s = s.replace("\\", "\\\\")
    s = s.replace("'", "''")
    s = s.replace(";", "\\;")
    return s


def escape_identifier(name: str) -> str:
    """Validate and double-quote a SQL identifier (table / column name).

    Raises ``ValueError`` for names that contain characters outside the
    set ``[a-zA-Z0-9_]`` (after stripping existing quotes).
    """
    stripped = name.strip('"')
    if not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", stripped):
        raise ValueError(f"Invalid identifier: {name!r}")
    return f'"{stripped}"'


def snake_to_camel(s: str) -> str:
    """Convert ``snake_case`` to ``camelCase``."""
    parts = s.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


def camel_to_snake(s: str) -> str:
    """Convert ``CamelCase`` or ``camelCase`` to ``snake_case``."""
    result = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1_\2", s)
    result = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", result)
    return result.lower()


# Simple English pluralisation rules (good enough for table names).
_IRREGULAR: dict[str, str] = {
    "person": "people",
    "child": "children",
    "mouse": "mice",
    "goose": "geese",
    "man": "men",
    "woman": "women",
    "tooth": "teeth",
    "foot": "feet",
    "datum": "data",
    "index": "indices",
}


def pluralize(s: str) -> str:
    """Return a naively pluralised form of *s*.

    Handles common English suffixes and a small irregular-word table.
    """
    lower = s.lower()
    if lower in _IRREGULAR:
        # Preserve original casing of first char.
        plural = _IRREGULAR[lower]
        return s[0] + plural[1:] if s[0].isupper() else plural

    if lower.endswith(("s", "x", "z", "sh", "ch")):
        return s + "es"
    if lower.endswith("y") and len(s) > 1 and s[-2] not in "aeiou":
        return s[:-1] + "ies"
    if lower.endswith("f"):
        return s[:-1] + "ves"
    if lower.endswith("fe"):
        return s[:-2] + "ves"
    return s + "s"


def format_where_value(value: Any, field_type: Optional[FieldType] = None) -> str:
    """Format a value for a WHERE clause.

    If *field_type* is provided the typed formatter is used; otherwise we
    fall back to generic Python-value formatting.
    """
    if field_type is not None:
        return format_value(value, field_type)

    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        escaped = value.replace("'", "''")
        return f"'{escaped}'"
    if isinstance(value, (list, dict)):
        import json
        return f"'{json.dumps(value)}'"
    escaped = str(value).replace("'", "''")
    return f"'{escaped}'"
