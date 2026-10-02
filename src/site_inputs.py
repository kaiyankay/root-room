"""
User / designer input layer for SITE records (Round 2B).

This module layers confirmed or user-entered values onto a SITE record that was
built from City data (Round 2A) without overwriting any City-derived field. It is
data layering only: no rule logic, no defaults, no inference.

Guards enforced by apply_user_inputs():
  - only fields listed in ALLOWED_INPUT_FIELDS may be supplied;
  - the target field on the record must currently be UNKNOWN (never overwrite
    CITY_DATA, DERIVED_CALCULATION or an earlier confirmed value);
  - provenance must be USER_INPUT or CONFIRMED_SITE_DATA (DESIGN_ASSUMPTION belongs
    in a scenario, not in the base record);
  - status must be KNOWN with a non-null value;
  - the merged record must validate against 06_data_schema.json.

Design scenarios are NOT applied here. They are passed to rule_engine.evaluate_scenario,
which wraps overrides as DESIGN_ASSUMPTION on a deep copy of the base record.
"""
import copy
import json
import pathlib
from typing import Any, Dict, List, Optional

from .schema_validation import FIELD_NAMES, assert_valid_record, field

ROOT = pathlib.Path(__file__).resolve().parents[1]
SITES_PATH = ROOT / "data/processed/king_edward_pilot_sites.json"

# The V1 user-input layer covers the inputs the rule engine needs for a soil-volume
# evaluation and that City data cannot supply (04 §5, 05 §3).
ALLOWED_INPUT_FIELDS = [
    "planting_condition",
    "soil_area_m2",
    "soil_depth_m",
    "soil_type",
    "target_tree_class",
]
ALLOWED_INPUT_PROVENANCE = ("USER_INPUT", "CONFIRMED_SITE_DATA")


class InputLayerError(ValueError):
    pass


def load_site_record(site_id: str, sites_path: pathlib.Path = SITES_PATH) -> Dict[str, Any]:
    """Return a deep copy of one Round 2A SITE record and its city_reference sidecar."""
    doc = json.loads(pathlib.Path(sites_path).read_text(encoding="utf-8"))
    for entry in doc["sites"]:
        if entry["record"]["site_id"] == site_id:
            return copy.deepcopy(entry)
    raise KeyError(f"site_id {site_id!r} not found in {sites_path}")


def load_input_layer(path: pathlib.Path) -> Dict[str, Any]:
    return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))


def inputs_for_site(layer: Dict[str, Any], site_id: str) -> Dict[str, Any]:
    for entry in layer["sites"]:
        if entry["site_id"] == site_id:
            return entry
    raise KeyError(f"site_id {site_id!r} has no entry in the input layer")


def apply_user_inputs(record: Dict[str, Any], inputs: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    """
    Return a new record = deep copy of `record` with `inputs` layered on.

    `inputs` maps field name -> wrapped field {value, provenance, status}.
    The input record is never mutated.
    """
    merged = copy.deepcopy(record)
    problems: List[str] = []
    for name, wrapped in inputs.items():
        if name not in ALLOWED_INPUT_FIELDS:
            problems.append(f"{name}: not an allowed user-input field {ALLOWED_INPUT_FIELDS}")
            continue
        if name not in FIELD_NAMES:
            problems.append(f"{name}: not a schema field")
            continue
        if not isinstance(wrapped, dict) or set(wrapped) != {"value", "provenance", "status"}:
            problems.append(f"{name}: input must be a wrapped field with value / provenance / status")
            continue
        if wrapped["provenance"] not in ALLOWED_INPUT_PROVENANCE:
            problems.append(f"{name}: provenance {wrapped['provenance']!r} not allowed; use one of {ALLOWED_INPUT_PROVENANCE}")
            continue
        if wrapped["status"] != "KNOWN" or wrapped["value"] is None:
            problems.append(f"{name}: user input must be KNOWN with a non-null value (leave the field out if unknown)")
            continue
        current = merged.get(name)
        if current is not None and current.get("status") != "UNKNOWN":
            problems.append(f"{name}: record already holds a {current['status']} {current['provenance']} value; "
                            f"user input may not overwrite it")
            continue
        merged[name] = field(wrapped["value"], wrapped["provenance"], "KNOWN")
    if problems:
        raise InputLayerError("user-input layer rejected:\n  - " + "\n  - ".join(problems))
    assert_valid_record(merged)
    return merged


def diff_fields(before: Dict[str, Any], after: Dict[str, Any]) -> Dict[str, Dict[str, Optional[Any]]]:
    """Fields whose wrapper changed between two records (for reporting)."""
    out = {}
    for name in sorted(set(before) | set(after)):
        if before.get(name) != after.get(name):
            out[name] = {"before": before.get(name), "after": after.get(name)}
    return out
