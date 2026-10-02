"""
Schema validation and field-wrapper helpers for V1 site records.

The schema of record is sources/06_data_schema.json. It is loaded here and
validated with the standard `jsonschema` package (Draft 2020-12). Nothing in
this module duplicates schema content; enums and field lists are read from the
file so the schema stays the single source of truth.

A site record is a flat object whose fields (other than site_id) are wrapped:

    {"value": ..., "provenance": <provenance enum>, "status": <status enum>}

Evaluation metadata (traces, warnings, unresolved items) is NOT stored in the
record because the schema uses additionalProperties: false. See rule_engine.
"""
import copy
import json
import pathlib
from typing import Any, Dict, List, Optional

from jsonschema import Draft202012Validator, FormatChecker

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "sources" / "06_data_schema.json"


def load_schema(path: pathlib.Path = SCHEMA_PATH) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


SCHEMA: Dict[str, Any] = load_schema()
Draft202012Validator.check_schema(SCHEMA)
_VALIDATOR = Draft202012Validator(SCHEMA, format_checker=FormatChecker())

# Vocabulary taken from the schema, not re-declared.
PROVENANCE: List[str] = list(SCHEMA["$defs"]["provenance"]["enum"])
STATUS: List[str] = list(SCHEMA["$defs"]["status"]["enum"])
FIELD_NAMES: List[str] = list(SCHEMA["properties"].keys())
REQUIRED_FIELDS: List[str] = list(SCHEMA["required"])
FIELD_LOGIC: Dict[str, List[str]] = SCHEMA["x-v1-field-logic"]
DERIVED_FIELDS: List[str] = list(FIELD_LOGIC["derived_fields"])
REFERENCE_ONLY_FIELDS: List[str] = list(FIELD_LOGIC["display_or_reference_only_in_v1"])
# Wrapped fields = every schema property except the bare site_id string.
WRAPPED_FIELDS: List[str] = [n for n in FIELD_NAMES if n != "site_id"]


class SchemaValidationError(ValueError):
    """Raised when a site record does not validate against 06_data_schema.json."""

    def __init__(self, errors: List[str]):
        self.errors = errors
        super().__init__("Site record failed schema validation:\n  - " + "\n  - ".join(errors))


def validate_record(record: Dict[str, Any]) -> List[str]:
    """Return a list of human-readable validation errors (empty when valid)."""
    errors = []
    for err in sorted(_VALIDATOR.iter_errors(record), key=lambda e: list(e.absolute_path)):
        path = "/".join(str(p) for p in err.absolute_path) or "<root>"
        errors.append(f"{path}: {err.message}")
    return errors


def is_valid_record(record: Dict[str, Any]) -> bool:
    return not validate_record(record)


def assert_valid_record(record: Dict[str, Any]) -> None:
    errors = validate_record(record)
    if errors:
        raise SchemaValidationError(errors)


# --------------------------------------------------------------------------
# Field-wrapper helpers
# --------------------------------------------------------------------------

def field(value: Any, provenance: str, status: str) -> Dict[str, Any]:
    """Build a wrapped field. Vocabulary is checked against the schema enums."""
    if provenance not in PROVENANCE:
        raise ValueError(f"provenance {provenance!r} not in schema enum {PROVENANCE}")
    if status not in STATUS:
        raise ValueError(f"status {status!r} not in schema enum {STATUS}")
    return {"value": value, "provenance": provenance, "status": status}


def unknown_field() -> Dict[str, Any]:
    """The canonical UNKNOWN wrapper: null value, UNKNOWN provenance, UNKNOWN status."""
    return field(None, "UNKNOWN", "UNKNOWN")


def known_field(value: Any, provenance: str) -> Dict[str, Any]:
    if value is None:
        raise ValueError("a KNOWN field cannot hold a null value; use unknown_field()")
    return field(value, provenance, "KNOWN")


def derived_field(value: Any, status: str = "KNOWN") -> Dict[str, Any]:
    return field(value, "DERIVED_CALCULATION", status)


def get_field(record: Dict[str, Any], name: str) -> Dict[str, Any]:
    """Return the wrapped field, or a fresh UNKNOWN wrapper when the field is absent."""
    if name == "site_id":
        return known_field(record["site_id"], "USER_INPUT")
    f = record.get(name)
    if f is None:
        return unknown_field()
    return f


def is_known(record: Dict[str, Any], name: str) -> bool:
    f = get_field(record, name)
    return f.get("status") == "KNOWN" and f.get("value") is not None


def value_of(record: Dict[str, Any], name: str) -> Any:
    """Value when the field is KNOWN, otherwise None."""
    return get_field(record, name)["value"] if is_known(record, name) else None


USABLE_STATUSES = ("KNOWN", "REVIEW_REQUIRED")


def is_usable(record: Dict[str, Any], name: str) -> bool:
    """
    A field can feed a calculation when it holds a value with status KNOWN or
    REVIEW_REQUIRED. A REVIEW_REQUIRED input propagates that status to outputs.
    UNKNOWN and NOT_APPLICABLE fields are never usable.
    """
    f = get_field(record, name)
    return f.get("status") in USABLE_STATUSES and f.get("value") is not None


def usable_value(record: Dict[str, Any], name: str) -> Any:
    return get_field(record, name)["value"] if is_usable(record, name) else None


def new_record(site_id: str,
               site_state: Optional[str] = None,
               street_name: Optional[str] = None,
               site_state_provenance: str = "USER_INPUT",
               street_name_provenance: str = "CITY_DATA") -> Dict[str, Any]:
    """Minimal schema-valid record. Fields not supplied stay UNKNOWN."""
    rec: Dict[str, Any] = {
        "site_id": site_id,
        "site_state": known_field(site_state, site_state_provenance) if site_state else unknown_field(),
        "street_name": known_field(street_name, street_name_provenance) if street_name else unknown_field(),
        "missing_inputs": derived_field([]),
    }
    return rec


def with_fields(record: Dict[str, Any], **fields: Dict[str, Any]) -> Dict[str, Any]:
    """Return a copy of `record` with the given wrapped fields set."""
    out = copy.deepcopy(record)
    for name, wrapped in fields.items():
        if name not in FIELD_NAMES:
            raise KeyError(f"{name!r} is not a field in 06_data_schema.json")
        out[name] = wrapped
    return out
