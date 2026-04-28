"""
VedaDB ORM — Type system.

Maps between Python types, VedaDB's FieldType enum, and VedaQL DDL strings.
Provides cast_value / format_value for row hydration and SQL generation.
"""

import json
import uuid
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from enum import Enum
from typing import Any, Dict, List, Type


class FieldType(Enum):
    """Supported column / field types in VedaDB."""

    INT = "INT"
    FLOAT = "FLOAT"
    STRING = "STRING"
    BOOL = "BOOL"
    TIMESTAMP = "TIMESTAMP"
    DOCUMENT = "DOCUMENT"
    VECTOR = "VECTOR"
    POINT = "POINT"
    UUID = "UUID"
    DATE = "DATE"
    DECIMAL = "DECIMAL"
    ARRAY = "ARRAY"
    JSON = "JSON"
    BYTES = "BYTES"


# FieldType  ->  Python type used when hydrating rows.
VEDADB_TO_PYTHON: Dict[FieldType, Type] = {
    FieldType.INT: int,
    FieldType.FLOAT: float,
    FieldType.STRING: str,
    FieldType.BOOL: bool,
    FieldType.TIMESTAMP: datetime,
    FieldType.DOCUMENT: dict,
    FieldType.VECTOR: List[float],
    FieldType.POINT: tuple,
    FieldType.UUID: uuid.UUID,
    FieldType.DATE: date,
    FieldType.DECIMAL: Decimal,
    FieldType.ARRAY: list,
    FieldType.JSON: dict,
    FieldType.BYTES: bytes,
}

# FieldType  ->  VedaQL DDL type string.
PYTHON_TO_VEDAQL: Dict[FieldType, str] = {
    FieldType.INT: "INT",
    FieldType.FLOAT: "FLOAT",
    FieldType.STRING: "STRING",
    FieldType.BOOL: "BOOL",
    FieldType.TIMESTAMP: "TIMESTAMP",
    FieldType.DOCUMENT: "DOCUMENT",
    FieldType.VECTOR: "VECTOR",
    FieldType.POINT: "POINT",
    FieldType.UUID: "UUID",
    FieldType.DATE: "DATE",
    FieldType.DECIMAL: "DECIMAL",
    FieldType.ARRAY: "ARRAY",
    FieldType.JSON: "JSON",
    FieldType.BYTES: "BYTES",
}


def cast_value(value: Any, field_type: FieldType) -> Any:
    """Convert a raw value (typically a string from a result row) into the
    appropriate Python type dictated by *field_type*.

    Returns ``None`` unchanged.
    """
    if value is None:
        return None

    try:
        if field_type == FieldType.INT:
            return int(value)
        if field_type == FieldType.FLOAT:
            return float(value)
        if field_type == FieldType.STRING:
            return str(value)
        if field_type == FieldType.BOOL:
            if isinstance(value, bool):
                return value
            if isinstance(value, str):
                return value.lower() in ("true", "1", "yes")
            return bool(value)
        if field_type == FieldType.TIMESTAMP:
            if isinstance(value, datetime):
                return value
            return datetime.fromisoformat(str(value))
        if field_type == FieldType.DATE:
            if isinstance(value, date):
                return value
            return date.fromisoformat(str(value))
        if field_type == FieldType.DOCUMENT or field_type == FieldType.JSON:
            if isinstance(value, dict):
                return value
            return json.loads(str(value))
        if field_type == FieldType.VECTOR:
            if isinstance(value, list):
                return [float(v) for v in value]
            return [float(v) for v in json.loads(str(value))]
        if field_type == FieldType.POINT:
            if isinstance(value, (tuple, list)):
                return tuple(float(v) for v in value)
            parsed = json.loads(str(value))
            return tuple(float(v) for v in parsed)
        if field_type == FieldType.UUID:
            if isinstance(value, uuid.UUID):
                return value
            return uuid.UUID(str(value))
        if field_type == FieldType.DECIMAL:
            if isinstance(value, Decimal):
                return value
            return Decimal(str(value))
        if field_type == FieldType.ARRAY:
            if isinstance(value, list):
                return value
            return json.loads(str(value))
        if field_type == FieldType.BYTES:
            if isinstance(value, bytes):
                return value
            return bytes.fromhex(str(value))
    except (ValueError, TypeError, InvalidOperation, json.JSONDecodeError):
        return value

    return value


def format_value(value: Any, field_type: FieldType) -> str:
    """Format a Python value into a VedaQL-safe literal string for use inside
    SQL statements.

    Returns the *unquoted* SQL token (e.g. ``'hello'`` already includes the
    surrounding single-quotes).
    """
    if value is None:
        return "NULL"

    if field_type == FieldType.BOOL:
        return "TRUE" if value else "FALSE"

    if field_type in (FieldType.INT, FieldType.FLOAT, FieldType.DECIMAL):
        return str(value)

    if field_type == FieldType.STRING:
        escaped = str(value).replace("'", "''")
        return f"'{escaped}'"

    if field_type == FieldType.TIMESTAMP:
        if isinstance(value, datetime):
            return f"'{value.isoformat()}'"
        return f"'{value}'"

    if field_type == FieldType.DATE:
        if isinstance(value, date):
            return f"'{value.isoformat()}'"
        return f"'{value}'"

    if field_type == FieldType.UUID:
        return f"'{value}'"

    if field_type in (FieldType.DOCUMENT, FieldType.JSON, FieldType.ARRAY, FieldType.VECTOR):
        return f"'{json.dumps(value)}'"

    if field_type == FieldType.POINT:
        if isinstance(value, (tuple, list)) and len(value) >= 2:
            return f"POINT({value[0]}, {value[1]})"
        return f"'{value}'"

    if field_type == FieldType.BYTES:
        if isinstance(value, bytes):
            return f"X'{value.hex()}'"
        return f"X'{value}'"

    # Fallback — treat as string.
    escaped = str(value).replace("'", "''")
    return f"'{escaped}'"
