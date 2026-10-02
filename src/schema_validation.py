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
import datetime
import json
import os
import pathlib
import re
from typing import Any, Dict, List, Optional

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "sources" / "06_data_schema.json"


def load_schema(path: pathlib.Path = SCHEMA_PATH) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


SCHEMA: Dict[str, Any] = load_schema()
_VALIDATOR = None   # the full Draft 2020-12 validator (jsonschema), built on first use: see _full()


def _full():
    """The jsonschema validator over the schema as written: the reference, and the source of every error message."""
    global _VALIDATOR
    if _VALIDATOR is None:
        from jsonschema import Draft202012Validator, FormatChecker
        Draft202012Validator.check_schema(SCHEMA)
        _VALIDATOR = Draft202012Validator(SCHEMA, format_checker=FormatChecker())
    return _VALIDATOR

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


# ---- the same validation, faster ------------------------------------------------------------------------------
# A valid record (every record the engine writes) is decided without jsonschema: the schema's local $refs are inlined once
# ({"$ref": X, ...} = {"allOf": [X], ...} in Draft 2020-12; none is recursive) and the dozen keywords the schema uses are
# checked as jsonschema checks them (_ok). The record's top level carries only type / required / additionalProperties /
# properties, so each property is decided on its own and remembered by its value: a run changes a few fields per record.
# Only when a record is invalid does jsonschema run, for its messages. tests/test_schema_fast.py compares the two.
KNOWN_KEYWORDS = {"type", "properties", "additionalProperties", "required", "allOf", "anyOf", "enum", "items", "minLength",
                  "minimum", "uniqueItems", "format", "description", "title"}
_RE_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$", re.ASCII)


def _inline(node: Any, defs: Dict[str, Any], seen: tuple = ()) -> Any:
    if isinstance(node, list):
        return [_inline(x, defs, seen) for x in node]
    if not isinstance(node, dict):
        return node
    out = {k: _inline(v, defs, seen) for k, v in node.items() if k not in ("$ref", "$defs", "$id", "$schema")}
    ref = node.get("$ref")
    if ref is not None:
        if not ref.startswith("#/$defs/") or ref in seen:
            raise ValueError(f"cannot inline {ref!r}")
        target = _inline(defs[ref[len("#/$defs/"):]], defs, seen + (ref,))
        out = dict(out); out["allOf"] = [target] + list(out.get("allOf", []))
    return out


def _is_type(x: Any, t: str) -> bool:
    if t == "null":
        return x is None
    if t == "string":
        return isinstance(x, str)
    if t == "object":
        return isinstance(x, dict)
    if t == "array":
        return isinstance(x, list)
    if t == "boolean":
        return isinstance(x, bool)
    if t == "number":
        return isinstance(x, (int, float)) and not isinstance(x, bool)
    if t == "integer":
        return (isinstance(x, int) and not isinstance(x, bool)) or (isinstance(x, float) and x.is_integer())
    raise ValueError(f"type {t!r}")


def _equal(a: Any, b: Any) -> bool:   # jsonschema's equality: a bool never equals a number
    if a is b:
        return True
    if isinstance(a, str) or isinstance(b, str):
        return a == b
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_equal(x, y) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(_equal(a[k], b[k]) for k in a)
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    return a == b


def _ok(s: Any, x: Any) -> bool:
    if s is True:
        return True
    if s is False:
        return False
    t = s.get("type")
    if t is not None and not any(_is_type(x, tt) for tt in (t if isinstance(t, list) else [t])):
        return False
    if "enum" in s and not any(_equal(x, e) for e in s["enum"]):
        return False
    if isinstance(x, dict):
        props = s.get("properties", {})
        if any(r not in x for r in s.get("required", ())):
            return False
        if s.get("additionalProperties") is False and any(k not in props for k in x):
            return False
        for k, sub in props.items():
            if k in x and not _ok(sub, x[k]):
                return False
    if isinstance(x, list):
        if "items" in s and not all(_ok(s["items"], v) for v in x):
            return False
        if s.get("uniqueItems") and any(_equal(x[i], x[j]) for i in range(len(x)) for j in range(i + 1, len(x))):
            return False
    if isinstance(x, str):
        if "minLength" in s and len(x) < s["minLength"]:
            return False
        if s.get("format") == "date":
            try:
                if not (_RE_DATE.fullmatch(x) and datetime.date.fromisoformat(x)):
                    return False
            except ValueError:
                return False
    if _is_type(x, "number") and "minimum" in s and x < s["minimum"]:
        return False
    if "allOf" in s and not all(_ok(sub, x) for sub in s["allOf"]):
        return False
    if "anyOf" in s and not any(_ok(sub, x) for sub in s["anyOf"]):
        return False
    return True


def _keywords(node: Any, out: set) -> set:
    if isinstance(node, dict):
        for k, v in node.items():
            out.add(k)
            if k == "properties":
                for sub in v.values():
                    _keywords(sub, out)
            elif k not in ("enum", "required", "description", "title"):
                _keywords(v, out)
    elif isinstance(node, list):
        for v in node:
            _keywords(v, out)
    return out


_FAST = None


def _fast():
    global _FAST
    if _FAST is None:
        top_keys = {k for k in SCHEMA if k not in ("$schema", "$id", "title", "description", "$defs") and not k.startswith("x-")}
        defs = SCHEMA.get("$defs", {})
        props = {k: _inline(v, defs) for k, v in SCHEMA["properties"].items()}
        top = {k: SCHEMA[k] for k in top_keys if k != "properties"}
        top["properties"] = {k: True for k in props}
        used = set(top)
        for sub in props.values():
            _keywords(sub, used)
        if top_keys - {"type", "required", "additionalProperties", "properties"} or used - KNOWN_KEYWORDS:
            _FAST = False                      # a keyword this check does not know: jsonschema decides every record
        else:
            _FAST = (top, props, {})
    return _FAST


def _valid_fast(record: Any) -> Optional[bool]:
    f = _fast()
    if not f:
        return None
    top, props, memo = f
    if not _ok(top, record):
        return False
    for name, val in record.items():
        sub = props.get(name)
        if sub is None:
            continue
        try:
            key = (name, json.dumps(val, sort_keys=True))
        except (TypeError, ValueError):
            key = None
        hit = memo.get(key) if key is not None else None
        if hit is None:
            hit = _ok(sub, val)
            if key is not None:
                if len(memo) > 50_000:
                    memo.clear()
                memo[key] = hit
        if not hit:
            return False
    return True


def _messages(record: Any) -> List[str]:
    out = []
    for err in sorted(_full().iter_errors(record), key=lambda e: list(e.absolute_path)):
        out.append(f"{'/'.join(str(p) for p in err.absolute_path) or '<root>'}: {err.message}")
    return out


def validate_record(record: Dict[str, Any]) -> List[str]:
    """Return a list of human-readable validation errors (empty when valid)."""
    v = _valid_fast(record)
    if v is True:
        return []
    if os.environ.get("ROOT_ROOM_FAST_ONLY") == "1":   # the browser's engine (and the build's check of it): no jsonschema to fall back on
        return ["<root>: the record does not validate against sources/06_data_schema.json"]
    try:
        return _messages(record)
    except ImportError:                    # a host without jsonschema (the browser's engine): the record is invalid all the same
        return ["<root>: the record does not validate against sources/06_data_schema.json"]


def validate_record_full(record: Dict[str, Any]) -> List[str]:
    """The same list from the full Draft 2020-12 validator over the schema as written (the reference for the fast path)."""
    return _messages(record)


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
