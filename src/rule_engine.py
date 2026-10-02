"""
V1 rule engine for the Street-Tree Site Capacity Tool.

Rules are read from sources/06_rules.json at import time and executed in file
order. Behaviour is driven by two independent properties of each rule:

  status      - controls automation (active, conditional, reference_only,
                unresolved, out_of_scope). Read from rules["rule_statuses"].
  conditions  - if present, must be satisfied for the rule to apply to the
                current record, regardless of status.

The engine returns an *evaluation envelope*:

    {
      "record":          schema-valid site record (inputs + derived fields),
      "rule_results":    one entry per rule, in file order,
      "warnings":        eligibility and consistency warnings,
      "unresolved":      unresolved source relationships and specification gaps,
      "manual_review":   conditions that a person must confirm (R10),
      "reference_info":  reference_only rule content, never judged,
      "trace":           derived field -> rule, inputs and their provenance,
      "interpretation":  result labels (e.g. R20 design benchmark),
      "soil_volume_summary": required / credited / gap and R12 relation,
      "scenario":        present only for evaluate_scenario results,
    }

Only "record" is validated against 06_data_schema.json. Traceability lives in
"trace" so that field wrappers stay limited to value / provenance / status.
"""
import copy
import json
import pathlib
import re
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

from . import calculations as calc
from .schema_validation import (DERIVED_FIELDS, WRAPPED_FIELDS, assert_valid_record,
                                derived_field, field, get_field, is_usable, unknown_field,
                                usable_value, validate_record)

ROOT = pathlib.Path(__file__).resolve().parents[1]
RULES_PATH = ROOT / "sources" / "06_rules.json"


def load_rules(path: pathlib.Path = RULES_PATH) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


RULES: Dict[str, Any] = load_rules()
RULE_LIST: List[Dict[str, Any]] = RULES["rules"]
RULE_INDEX: Dict[str, Dict[str, Any]] = {r["rule_id"]: r for r in RULE_LIST}
RULE_STATUSES: Dict[str, str] = RULES["rule_statuses"]
GLOBAL_GUARDRAILS: List[str] = RULES["global_guardrails"]

# --------------------------------------------------------------------------
# R17 (rules 1.3): Table 9-3 lookup, reference only. Never writes target_tree_class.
# --------------------------------------------------------------------------
_TABLE_9_3: Optional[Dict[str, Any]] = None
TABLE_9_3_SPELLING = {"LAVALLEEI": "LAVALLEI"}   # Table 9-3 prints 'lavalleei'; the City register spells 'lavallei'


def _species_word(text: Optional[str]) -> str:
    words = [w for w in (text or "").replace("\u00d7", " ").replace("'", " ' ").split() if w.upper() != "X" and w != "'"]
    return words[0].upper() if words else ""


def load_table_9_3(path: Optional[pathlib.Path] = None) -> Dict[str, Any]:
    """Rows of Table 9-3 keyed for lookup: (genus, species-word or None, cultivar or None) -> entry."""
    global _TABLE_9_3
    if _TABLE_9_3 is not None and path is None:
        return _TABLE_9_3
    src = path or (ROOT / RULE_INDEX["R17"].get("lookup_source", "sources/12_species_table_9-3.json"))
    with open(src, "r", encoding="utf-8") as fh:
        table = json.load(fh)
    keyed: Dict[Any, Dict[str, Any]] = {}
    for row in table["rows"]:
        for col in ("Small", "Medium", "Large"):
            cell = row.get(col)
            if not cell:
                continue
            latin = cell["latin"]
            genus = latin.split()[0].upper()
            cultivar = latin.split("'")[1].upper() if "'" in latin else None
            rest = latin.split("'")[0].split(None, 1)[1] if len(latin.split("'")[0].split()) > 1 else ""
            species = _species_word(rest) or None
            species = TABLE_9_3_SPELLING.get(species, species)
            if genus == "AMELANCHIER":
                cultivar = None          # the two cultivars are named in the common name; the City rows carry none
            keyed[(genus, species, cultivar)] = {"class": col, "common": cell["common"], "latin": latin, "row": row["row"], "page": row["page"]}
    out = {"keyed": keyed, "source": table.get("source", {}), "usage_text": table.get("usage_text", [])}
    if path is None:
        _TABLE_9_3 = out
    return out


def table_9_3_lookup(genus: Optional[str], species: Optional[str], cultivar: Optional[str]) -> Dict[str, Any]:
    """Reference lookup only (R17, rules 1.3): the column a species stands in, or not listed. Never Columnar."""
    t = load_table_9_3()
    g = (genus or "").upper().strip()
    sp = _species_word(species) or None
    cu = (cultivar or "").upper().strip() or None
    if cu == "NONE":
        cu = None
    hit = None
    for key in ((g, sp, cu), (g, sp, None), (g, None, cu)):
        if key in t["keyed"] and (key[2] is None or key[2] == cu):
            hit = (key, t["keyed"][key])
            break
    if hit is None:
        return {"listed": False, "class": None, "message": f"{g} {sp or ''}".strip() + " is not in Table 9-3; no class inferred (R16 / R17)"}
    key, e = hit
    return {"listed": True, "class": e["class"], "table_9_3_name": e["common"], "latin_as_printed": e["latin"],
            "cite": f"EDM 2026 §9.3.4.1 Table 9-3 p.{e['page']}, row {e['row']}, column {e['class']} Trees",
            "matched_on": {"genus": key[0], "species": key[1], "cultivar": key[2]},
            "message": f"listed {e['class']} in Table 9-3 ({e['common']}); shown beside the target-class knob, never applied"}


def protection_barrier_distance(dbh_cm: Optional[float]) -> Dict[str, Any]:
    """Reference lookup only (R32, rules 1.4): By-law 9958 Schedule A distance for a trunk diameter at 1.4 m.
    A construction protection radius, never a root extent; never applied to the record."""
    rule = RULE_INDEX["R32"]
    table = sorted((float(k), float(v)) for k, v in rule["schedule_a_m"].items())
    if dbh_cm is None:
        return {"applies": None, "distance_m": None, "message": "trunk diameter unknown; Schedule A not looked up"}
    d = float(dbh_cm)
    if d < table[0][0]:
        return {"applies": False, "distance_m": None, "dbh_cm": d, "row_cm": None,
                "cite": "By-law 9958 §2.2: the By-law does not apply to a tree under 20 cm (except a replacement tree or a hedge)",
                "message": f"{d:g} cm at 1.4 m: below the 20 cm threshold; no Schedule A distance"}
    for row_cm, dist in table:
        if d <= row_cm:
            return {"applies": True, "distance_m": dist, "dbh_cm": d, "row_cm": row_cm,
                    "cite": f"By-law 9958 Schedule A: {row_cm:g} cm → {dist} m (barrier measured 1.4 m above grade, parallel to the curb)",
                    "offsets_m": rule["boulevard_offsets_m"],
                    "message": f"protection radius {dist} m for a {d:g} cm trunk (Schedule A row {row_cm:g} cm); a construction protection distance, not a root extent"}
    row_cm, dist = table[-1]
    return {"applies": True, "distance_m": dist, "dbh_cm": d, "row_cm": row_cm, "beyond_table": True,
            "cite": f"By-law 9958 Schedule A ends at {row_cm:g} cm → {dist} m; the last row is reported",
            "offsets_m": rule["boulevard_offsets_m"],
            "message": f"protection radius {dist} m (Schedule A last row, trunk {d:g} cm is beyond the table); not a root extent"}

# Rule outcomes recorded in rule_results
EXECUTED = "executed"
SKIPPED_CONDITION = "skipped_condition_not_met"
BLOCKED_MISSING = "blocked_missing_inputs"
SKIPPED_OUTPUT_SUPPLIED = "skipped_output_pre_supplied"
NOT_AUTOMATED = "not_automated"           # reference_only / automation false
UNRESOLVED = "unresolved"
NOT_TRIGGERED = "not_triggered"           # unresolved rule whose subject is absent
OUT_OF_SCOPE = "out_of_scope"
MANUAL_REVIEW = "manual_review"
EXTERNAL = "applied_by_external_module"   # rule with executed_by: applied outside the engine (trace supplied)

# Operations whose purpose is to act on UNKNOWN or optional inputs. They run once
# their conditions are met; their other schema_inputs need not be KNOWN.
#   R19 unknown_guardrail: soil_geometry is expected to be UNKNOWN.
#   R22 generate_exploration_prompt: site/soil geometry only refine the prompt.
UNKNOWN_TOLERANT_OPERATIONS = {"unknown_guardrail", "generate_exploration_prompt"}

# Metric coordinate context accepted by evaluate_site(coordinate_units=...)
METRIC_UNITS = "m"

# Measured areas may be supplied directly from confirmed site data or user input
# instead of being derived from geometry: R05 declares soil_area_m2 as a schema_input,
# the schema's Round 1.1 revision note makes soil_geometry an optional upstream source
# via R04, and 05_tool_spec lists soil geometry as "user input or confirmed site geometry".
DIRECT_INPUT_ALLOWED = {"soil_area_m2", "planting_area_m2"}
DIRECT_INPUT_PROVENANCE = {"CONFIRMED_SITE_DATA", "USER_INPUT", "DESIGN_ASSUMPTION"}

_CONDITION_RE = re.compile(r"^\s*(\w+)\s*(==|!=|<=|>=|<|>)\s*(\S+)\s*$")


class RuleEngineError(RuntimeError):
    pass


# --------------------------------------------------------------------------
# Envelope
# --------------------------------------------------------------------------

def _new_envelope(record: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "record": record,
        "rule_results": [],
        "warnings": [],
        "unresolved": [],
        "manual_review": [],
        "reference_info": [],
        "trace": {},
        "interpretation": [],
        "missing_inputs": [],
        "soil_volume_summary": {},
        "global_guardrails": list(GLOBAL_GUARDRAILS),
    }


def _result(env: Dict[str, Any], rule: Dict[str, Any], outcome: str, message: str = "",
            inputs: Optional[Dict[str, Any]] = None, outputs: Optional[List[str]] = None,
            missing: Optional[List[str]] = None) -> Dict[str, Any]:
    entry = {
        "rule_id": rule["rule_id"],
        "name": rule["name"],
        "status": rule["status"],
        "status_meaning": RULE_STATUSES.get(rule["status"]),
        "automation": rule.get("automation", False),
        "outcome": outcome,
        "message": message,
        "inputs": inputs or {},
        "outputs": outputs or [],
        "missing": missing or [],
    }
    env["rule_results"].append(entry)
    return entry


def _warn(env, rule_id, message, **extra):
    env["warnings"].append(dict(rule_id=rule_id, message=message, **extra))


def _unresolved(env, rule_id, message, classification="SOURCE_GAP", **extra):
    env["unresolved"].append(dict(rule_id=rule_id, classification=classification,
                                  message=message, **extra))


def _set_derived(env: Dict[str, Any], rule: Dict[str, Any], name: str, value: Any,
                 input_names: List[str], status: str = "KNOWN", note: str = "") -> None:
    """Write a derived field into the record and its trace into the envelope."""
    rec = env["record"]
    inputs = {}
    depends_on_assumption = False
    for n in input_names:
        f = get_field(rec, n)
        inputs[n] = {"value": f["value"], "provenance": f["provenance"], "status": f["status"]}
        if f["provenance"] == "DESIGN_ASSUMPTION" or env["trace"].get(n, {}).get("depends_on_design_assumption"):
            depends_on_assumption = True
        if f["status"] == "REVIEW_REQUIRED" and status == "KNOWN":
            status = "REVIEW_REQUIRED"
            note = (note + "; " if note else "") + f"{n} is REVIEW_REQUIRED"
    rec[name] = derived_field(value, status)
    env["trace"][name] = {
        "rule_id": rule["rule_id"],
        "operation": rule.get("operation"),
        "formula": rule.get("formula"),
        "inputs": inputs,
        "source_reference": rule.get("source_reference"),
        "depends_on_design_assumption": depends_on_assumption,
        "note": note,
    }


def _reconcile_supplied(env, rule, name, computed, input_names) -> Tuple[str, str]:
    """
    Adjustment 5: when a derived field was pre-supplied and we can recompute it,
    the recomputed value wins. A disagreement is flagged REVIEW_REQUIRED.
    Returns (status, note) for the derived field.
    """
    rec = env["record"]
    supplied = rec.get(name)
    if supplied is None or supplied.get("value") is None:
        return "KNOWN", ""
    if calc.values_close(supplied["value"], computed):
        return "KNOWN", f"pre-supplied value {supplied['value']} confirmed by recomputation"
    msg = (f"{name}: pre-supplied value {supplied['value']} ({supplied['provenance']}) disagrees with "
           f"value {computed} recomputed by {rule['rule_id']} from {input_names}; recomputed value kept, "
           f"status REVIEW_REQUIRED")
    _warn(env, rule["rule_id"], msg, field=name, supplied=supplied["value"], recomputed=computed)
    return "REVIEW_REQUIRED", msg


# --------------------------------------------------------------------------
# Conditions
# --------------------------------------------------------------------------

def _coerce(literal: str) -> Any:
    try:
        return float(literal)
    except ValueError:
        return literal


def _compare(actual: Any, op: str, expected: Any) -> bool:
    if op == "==":
        return actual == expected
    if op == "!=":
        return actual != expected
    try:
        return {"<": actual < expected, ">": actual > expected,
                "<=": actual <= expected, ">=": actual >= expected}[op]
    except TypeError:
        return False


def _r04_conditions(env: Dict[str, Any], rule: Dict[str, Any]) -> Tuple[Optional[bool], List[str], str]:
    """
    R04's conditions are prose. Reading applied:
      'soil_geometry must be confirmed or explicitly user-defined' -> provenance is
      CONFIRMED_SITE_DATA, USER_INPUT or DESIGN_ASSUMPTION (never CITY_DATA or UNKNOWN).
      'must represent qualifying soil' -> satisfied by the schema definition of the
      soil_geometry field (qualifying soil footprint); it cannot be checked further here.
    """
    rec = env["record"]
    if not is_usable(rec, "soil_geometry"):
        return None, ["soil_geometry"], "soil_geometry not KNOWN"
    prov = get_field(rec, "soil_geometry")["provenance"]
    if prov in ("CONFIRMED_SITE_DATA", "USER_INPUT", "DESIGN_ASSUMPTION"):
        return True, [], f"soil_geometry provenance {prov} accepted as confirmed or user-defined"
    return False, [], f"soil_geometry provenance {prov} is not confirmed or explicitly user-defined"


PROSE_CONDITION_HANDLERS: Dict[str, Callable] = {"R04": _r04_conditions}


def _evaluate_conditions(env: Dict[str, Any], rule: Dict[str, Any]) -> Tuple[Optional[bool], List[str], str]:
    """
    Returns (met, missing_fields, message).
    met is None when a condition field is not KNOWN (applicability cannot be decided).
    """
    conditions = rule.get("conditions")
    if not conditions:
        return True, [], ""
    rec = env["record"]
    missing: List[str] = []
    messages: List[str] = []
    for cond in conditions:
        m = _CONDITION_RE.match(cond)
        if not m:
            handler = PROSE_CONDITION_HANDLERS.get(rule["rule_id"])
            if handler is None:
                return None, [], f"condition {cond!r} is not machine-checkable and no handler is defined"
            met, miss, msg = handler(env, rule)
            if met is None:
                return None, miss, msg
            if met is False:
                return False, [], msg
            messages.append(msg)
            continue
        name, op, literal = m.groups()
        if not is_usable(rec, name):
            missing.append(name)
            continue
        actual = usable_value(rec, name)
        if not _compare(actual, op, _coerce(literal)):
            return False, [], f"condition {cond!r} not met ({name} = {actual!r})"
        messages.append(f"condition {cond!r} met")
    if missing:
        return None, missing, f"cannot decide conditions; not KNOWN: {missing}"
    return True, [], "; ".join(messages)


# --------------------------------------------------------------------------
# Input availability
# --------------------------------------------------------------------------

def _missing_inputs(rec: Dict[str, Any], names: List[str]) -> List[str]:
    return [n for n in names if not is_usable(rec, n)]


def _value_outputs(rule: Dict[str, Any]) -> List[str]:
    return [o for o in (rule.get("schema_outputs") or []) if o != "missing_inputs"]


def _outputs_pre_supplied(rec: Dict[str, Any], rule: Dict[str, Any]) -> bool:
    outs = _value_outputs(rule)
    return bool(outs) and all(is_usable(rec, o) for o in outs)


def _report_missing(env: Dict[str, Any], missing: List[str]) -> None:
    """Non-derived missing inputs are reported; derived ones are reported by their own rule."""
    for n in missing:
        if n in DERIVED_FIELDS:
            continue
        if n not in env["missing_inputs"]:
            env["missing_inputs"].append(n)


# --------------------------------------------------------------------------
# Operation handlers (active / conditional rules with automation: true)
# --------------------------------------------------------------------------

def _op_lookup(env, rule):
    rec = env["record"]
    cls = usable_value(rec, "target_tree_class")
    cond = usable_value(rec, "planting_condition")
    value = calc.lookup(rule["lookup_table_m3"], cls, cond)
    if value is None:
        raise RuleEngineError(f"R01 lookup has no entry for {cls!r} / {cond!r}")
    out = rule["schema_outputs"][0]
    status, note = _reconcile_supplied(env, rule, out, value, rule["schema_inputs"])
    _set_derived(env, rule, out, value, rule["schema_inputs"], status,
                 note or f"Table 9-2 {cls} / {cond} benchmark")
    return f"Table 9-2 benchmark for {cls} / {cond} = {value} m3 (soil-volume benchmark only)"


def _op_measure_polygon_area(env, rule):
    rec = env["record"]
    units = env.get("_coordinate_units")
    out = rule["schema_outputs"][0]
    if units != METRIC_UNITS:
        # Adjustment 4: no CRS / unit context established -> do not compute m2.
        rec[out] = field(None, "UNKNOWN", "REVIEW_REQUIRED") if not is_usable(rec, out) else rec[out]
        _unresolved(env, rule["rule_id"], (
            "soil_geometry is present but the coordinate units / CRS of the geometry are not "
            "established by the specification; planar area in m2 was not computed. Supply "
            "coordinate_units='m' with metric geometry, or supply soil_area_m2 directly."),
            classification="MISSING_SPECIFICATION", field=out)
        return "geometry present; area not measured because coordinate units are not established"
    geom = usable_value(rec, "soil_geometry")
    area = calc.planar_polygon_area(geom)
    if area is None:
        _warn(env, rule["rule_id"], f"soil_geometry type {geom.get('type')!r} has no area; soil_area_m2 left as is")
        return "geometry is not areal"
    status, note = _reconcile_supplied(env, rule, out, area, rule["schema_inputs"])
    _set_derived(env, rule, out, area, rule["schema_inputs"], status,
                 note or "planar area of metric soil_geometry (derived geometric value, not regulatory)")
    return f"soil_area_m2 = {area}"


def _op_multiply(env, rule):
    a, b = rule["schema_inputs"]
    rec = env["record"]
    value = calc.multiply(usable_value(rec, a), usable_value(rec, b))
    out = rule["schema_outputs"][0]
    status, note = _reconcile_supplied(env, rule, out, value, rule["schema_inputs"])
    _set_derived(env, rule, out, value, rule["schema_inputs"], status, note)
    return f"{out} = {usable_value(rec, a)} x {usable_value(rec, b)} = {value} (physical geometric volume)"


def _op_multiply_by_factor(env, rule):
    rec = env["record"]
    src = "physical_soil_volume_m3"
    value = calc.multiply_by_factor(usable_value(rec, src), rule["factor"])
    out = rule["schema_outputs"][0]
    status, note = _reconcile_supplied(env, rule, out, value, rule["schema_inputs"])
    _set_derived(env, rule, out, value, rule["schema_inputs"], status,
                 note or f"factor {rule['factor']} from {rule['rule_id']}")
    return f"{out} = {usable_value(rec, src)} x {rule['factor']} = {value}"


def _op_copy_value(env, rule):
    rec = env["record"]
    src = "physical_soil_volume_m3"
    value = calc.copy_value(usable_value(rec, src))
    out = rule["schema_outputs"][0]
    status, note = _reconcile_supplied(env, rule, out, value, rule["schema_inputs"])
    _set_derived(env, rule, out, value, rule["schema_inputs"], status,
                 note or rule.get("notes", ""))
    return f"{out} = {value} (native soil physical volume used directly)"


def _op_subtract(env, rule):
    a, b = rule["schema_inputs"]
    rec = env["record"]
    value = calc.subtract(usable_value(rec, a), usable_value(rec, b))
    out = rule["schema_outputs"][0]
    status, note = _reconcile_supplied(env, rule, out, value, rule["schema_inputs"])
    _set_derived(env, rule, out, value, rule["schema_inputs"], status, note)
    interp = rule.get("interpretation", {})
    relation = "positive" if value > 0 else ("zero" if value == 0 else "negative")
    env["soil_volume_summary"] = {
        "required_soil_volume_m3": usable_value(rec, b),
        "credited_soil_volume_m3": usable_value(rec, a),
        "soil_volume_gap_m3": value,
        "relation": relation,
        "meaning": interp.get(relation),
        "note": "soil-volume comparison against the selected Table 9-2 benchmark only; "
                "not a complete site verdict",
    }
    return f"{out} = {usable_value(rec, a)} - {usable_value(rec, b)} = {value} ({interp.get(relation)})"


def _op_eligibility_check(env, rule):
    rec = env["record"]
    state = usable_value(rec, "site_state")
    soil = usable_value(rec, "soil_type")
    if state in rule.get("eligible_site_states", []):
        msg = (f"{soil} for site_state {state}: within the source restriction to new-tree "
               f"installation. This does not constitute City approval.")
        _warn(env, rule["rule_id"], msg, level="info", site_state=state, soil_type=soil)
        return msg
    if state in rule.get("ineligible_or_unconfirmed_site_states", []):
        msg = (f"{soil} for site_state {state}: the source limits this method to new trees. "
               f"It is not presented here as a generally permissible retrofit solution; any "
               f"credited value that relies on it is marked REVIEW_REQUIRED.")
        _warn(env, rule["rule_id"], msg, level="restriction", site_state=state, soil_type=soil)
        # Adjustment 6: credited volume derived from this soil type is under review.
        cred = rec.get("credited_soil_volume_m3")
        if cred is not None and cred["status"] == "KNOWN" and cred["value"] is not None:
            cred["status"] = "REVIEW_REQUIRED"
            tr = env["trace"].get("credited_soil_volume_m3")
            if tr is not None:
                tr["note"] = (tr.get("note", "") + "; " if tr.get("note") else "") + \
                    f"{rule['rule_id']}: {soil} not confirmed as eligible for {state}"
        return msg
    raise RuleEngineError(f"{rule['rule_id']}: site_state {state!r} is in neither eligibility list")


def _op_unknown_guardrail(env, rule):
    # R19: existing tree, soil_geometry must stay UNKNOWN if not confirmed.
    rec = env["record"]
    if is_usable(rec, "soil_geometry"):
        return "soil_geometry is confirmed for this existing-tree site"
    if "soil_geometry" not in env["missing_inputs"]:
        env["missing_inputs"].append("soil_geometry")
    if rec.get("soil_geometry") is None:
        rec["soil_geometry"] = unknown_field()
    return ("existing-tree site: qualifying soil geometry is not confirmed and stays UNKNOWN; "
            "it is not inferred from tree coordinates or inventory data")


def _op_label_result_as_benchmark(env, rule):
    label = {
        "rule_id": rule["rule_id"],
        "label": "design benchmark / retrofit exploration result",
        "message": ("Existing-tree site: the Table 9-2 comparison is a design benchmark for "
                    "site-capacity and retrofit exploration. It is not a retrospective City "
                    "verdict on the existing tree."),
    }
    env["interpretation"].append(label)
    return label["label"]


CLASS_THRESHOLD_KEYS = {
    "return_classes_whose_solitary_benchmark_is_met": ("solitary_thresholds_m3", "solitary"),
    "return_classes_whose_shared_row_benchmark_is_met": ("shared_row_thresholds_m3", "shared_row"),
}


def _op_return_classes(env, rule):
    rec = env["record"]
    key, column = CLASS_THRESHOLD_KEYS[rule["operation"]]
    thresholds = rule[key]
    credited = usable_value(rec, "credited_soil_volume_m3")
    classes = calc.classes_meeting_threshold(credited, thresholds)
    out = rule["schema_outputs"][0]
    note = (f"{column} soil-volume benchmarks met; not a complete suitability judgement"
            + ("; per-tree reading of the Shared / Row column is a project interpretation (R26); R21 unresolved"
               if column == "shared_row" else ""))
    _set_derived(env, rule, out, classes, rule["schema_inputs"], "KNOWN", note)
    return f"{column} soil-volume benchmark met for classes {classes} (soil volume only)"


def _op_generate_exploration_prompt(env, rule):
    rec = env["record"]
    gap = usable_value(rec, "soil_volume_gap_m3")
    prompts = [
        f"Credited soil volume is {abs(gap)} m3 below the selected Table 9-2 benchmark.",
        "Additional qualifying soil volume could be explored through the soil footprint, "
        "soil depth, or soil method; which component to change is a design decision.",
    ]
    if is_usable(rec, "site_geometry") or is_usable(rec, "soil_geometry"):
        prompts.append("Confirmed site / soil geometry is available to locate where extra growing "
                       "space could be explored.")
    else:
        prompts.append("No confirmed site / soil geometry is available to locate the deficit spatially.")
    prompts.append("These are design exploration prompts, not spatial solutions required by the Manual.")
    _set_derived(env, rule, rule["schema_outputs"][0], prompts, rule["schema_inputs"], "KNOWN",
                 "exploration prompt; project interpretation, not a City requirement")
    return "design exploration prompts generated for soil-volume deficit"


def _op_enforce_provenance(env, rule):
    # R24 runs last: check wrappers, UNKNOWN handling, assumptions and traceability.
    rec = env["record"]
    original = env["_original_record"]
    problems = []
    for name in WRAPPED_FIELDS:
        f = rec.get(name)
        if f is None:
            continue
        if set(f.keys()) != {"value", "provenance", "status"}:
            problems.append(f"{name}: wrapper keys {sorted(f.keys())}")
        if f["provenance"] == "UNKNOWN" and f["value"] is not None:
            problems.append(f"{name}: provenance UNKNOWN but value {f['value']!r}")
        if f["status"] == "UNKNOWN" and f["value"] is not None:
            problems.append(f"{name}: status UNKNOWN but value {f['value']!r}")
        orig = original.get(name)
        if orig is not None and orig["provenance"] == "DESIGN_ASSUMPTION" and f["provenance"] != "DESIGN_ASSUMPTION":
            problems.append(f"{name}: DESIGN_ASSUMPTION relabelled as {f['provenance']}")
        if orig is not None and orig["provenance"] in ("CITY_DATA", "USER_INPUT", "CONFIRMED_SITE_DATA") \
                and name not in DERIVED_FIELDS and f != orig:
            problems.append(f"{name}: input field altered by the engine")
        if f["provenance"] == "DERIVED_CALCULATION" and f["value"] is not None and name != "missing_inputs":
            pre = original.get(name)
            if name not in env["trace"] and not (pre is not None and pre.get("provenance") == "DERIVED_CALCULATION"):
                problems.append(f"{name}: DERIVED_CALCULATION without trace")
    if problems:
        raise RuleEngineError("R24 provenance enforcement failed: " + "; ".join(problems))
    return "all wrapped fields retain provenance and status; UNKNOWN and DESIGN_ASSUMPTION preserved"


OPERATION_HANDLERS: Dict[str, Callable[[Dict[str, Any], Dict[str, Any]], str]] = {
    "lookup": _op_lookup,
    "measure_polygon_area": _op_measure_polygon_area,
    "multiply": _op_multiply,
    "multiply_by_factor": _op_multiply_by_factor,
    "copy_value": _op_copy_value,
    "subtract": _op_subtract,
    "eligibility_check": _op_eligibility_check,
    "unknown_guardrail": _op_unknown_guardrail,
    "label_result_as_benchmark": _op_label_result_as_benchmark,
    "return_classes_whose_solitary_benchmark_is_met": _op_return_classes,
    "return_classes_whose_shared_row_benchmark_is_met": _op_return_classes,
    "generate_exploration_prompt": _op_generate_exploration_prompt,
    "enforce_provenance": _op_enforce_provenance,
}


# --------------------------------------------------------------------------
# Unresolved-rule triggers (rules with operation null): does the subject appear?
# --------------------------------------------------------------------------

def _trigger_r11(env):
    return usable_value(env["record"], "soil_type") == "soil_cell"


def _trigger_r17(env):
    rec = env["record"]
    return (not is_usable(rec, "target_tree_class")) and any(is_usable(rec, n) for n in ("genus", "species", "cultivar"))


def _trigger_r21(env):
    return usable_value(env["record"], "planting_condition") == "shared_row"


UNRESOLVED_TRIGGERS: Dict[str, Callable[[Dict[str, Any]], bool]] = {
    "R11": _trigger_r11, "R21": _trigger_r21,
}

UNRESOLVED_MESSAGES = {
    "R11": "soil_cell: the reviewed source gives no numeric soil-cell credit factor; "
           "credited_soil_volume_m3 stays UNKNOWN (no factor assumed, including 1.0).",
    "R21": "shared_row: Table 9-2 Shared / Row value is returned for the selected class only. Whether it "
           "applies per tree, per continuous shared soil system, or otherwise is UNRESOLVED; it is not "
           "multiplied or divided by tree count.",
    "R25": "soil_type = other: no source-supported crediting rule is defined; credited_soil_volume_m3 stays "
           "UNKNOWN and no default credit factor is assigned.",
}


# --------------------------------------------------------------------------
# Rule dispatch
# --------------------------------------------------------------------------

def _trace_mentions(trace_entry: Optional[Dict[str, Any]], rule_id: str) -> bool:
    if not trace_entry:
        return False
    return trace_entry.get("rule_id") == rule_id or rule_id in (trace_entry.get("also_applied") or [])


def _run_rule(env: Dict[str, Any], rule: Dict[str, Any]) -> None:
    rec = env["record"]
    status = rule["status"]
    rid = rule["rule_id"]
    inputs_snapshot = {n: usable_value(rec, n) for n in rule.get("schema_inputs", [])}

    if status not in RULE_STATUSES:
        raise RuleEngineError(f"{rid}: unknown rule status {status!r}")

    # Conditions apply regardless of status (adjustment 2).
    met, cond_missing, cond_msg = _evaluate_conditions(env, rule)

    if status == "out_of_scope":
        _result(env, rule, OUT_OF_SCOPE, "; ".join(rule.get("guardrails", [])), inputs_snapshot)
        return

    if status == "reference_only":
        info = {k: rule[k] for k in ("reference_table_m", "reference_values_cm", "excluded_locations", "notes")
                if k in rule}
        if rule.get("operation") == "lookup_table_9_3" and any(is_usable(rec, n) for n in ("genus", "species", "cultivar")):
            info["table_9_3"] = table_9_3_lookup(usable_value(rec, "genus"), usable_value(rec, "species"), usable_value(rec, "cultivar"))
        if rule.get("operation") == "lookup_protection_barrier" and is_usable(rec, "inventory_diameter"):
            info["protection_barrier"] = protection_barrier_distance(usable_value(rec, "inventory_diameter"))
        env["reference_info"].append({
            "rule_id": rid, "name": rule["name"], "category": rule.get("category"),
            "source_reference": rule.get("source_reference"), "guardrails": rule.get("guardrails", []),
            "inputs_present": {n: is_usable(rec, n) for n in rule.get("schema_inputs", [])},
            "content": info,
            "note": "reference information only; V1 does not judge this rule",
        })
        _result(env, rule, NOT_AUTOMATED, "retained as reference information; no compliance check performed",
                inputs_snapshot)
        return

    if status == "unresolved":
        if met is False:
            _result(env, rule, SKIPPED_CONDITION, cond_msg, inputs_snapshot)
            return
        trigger = UNRESOLVED_TRIGGERS.get(rid)
        applies = (met is True) if rule.get("conditions") else (trigger(env) if trigger else False)
        if not applies:
            _result(env, rule, NOT_TRIGGERED, "subject of this unresolved rule is not present in the record",
                    inputs_snapshot)
            return
        msg = UNRESOLVED_MESSAGES.get(rid, rule["name"] + " is unresolved")
        _unresolved(env, rid, msg, guardrails=rule.get("guardrails", []),
                    outputs_left_unknown=rule.get("schema_outputs", []))
        _result(env, rule, UNRESOLVED, msg, inputs_snapshot, missing=cond_missing)
        return

    if rule.get("executed_by"):
        # Applied outside the engine (src/block_face.py) before evaluation; the module supplies
        # the trace of the fields it wrote via evaluate_site(pre_trace=...). The engine only
        # records whether that happened; it never re-derives the geometry.
        if met is False:
            _result(env, rule, SKIPPED_CONDITION, cond_msg, inputs_snapshot)
            return
        outs = rule.get("schema_outputs", [])
        applied = [o for o in outs if _trace_mentions(env["trace"].get(o), rid)]
        if applied:
            _result(env, rule, EXTERNAL, f"applied by {rule['executed_by']}; see trace of {applied}",
                    inputs_snapshot, applied)
        else:
            _result(env, rule, NOT_TRIGGERED, f"not applied in this evaluation (executed by {rule['executed_by']} only)",
                    inputs_snapshot)
        return

    # active / conditional
    inputs = rule.get("schema_inputs", [])
    if rule.get("automation", False) and inputs and _outputs_pre_supplied(rec, rule) \
            and all(not is_usable(rec, n) for n in inputs):
        # Output was pre-supplied and none of the upstream inputs are known: it cannot be
        # recomputed here. Applicability conditions cannot be decided either, so the rule
        # neither runs nor reports its inputs as missing (adjustment 5).
        for out in _value_outputs(rule):
            f = rec[out]
            accepted = f["provenance"] == "DERIVED_CALCULATION" or \
                (out in DIRECT_INPUT_ALLOWED and f["provenance"] in DIRECT_INPUT_PROVENANCE)
            if not accepted:
                f["status"] = "REVIEW_REQUIRED"
                _warn(env, rid, f"{out} supplied with provenance {f['provenance']} and cannot be "
                                f"recomputed (inputs {inputs} unknown); not treated as authoritative, "
                                f"marked REVIEW_REQUIRED", field=out)
            env["trace"].setdefault(out, {
                "rule_id": rid, "operation": "pre_supplied", "inputs": {},
                "note": f"pre-supplied {f['provenance']} value; upstream inputs {inputs} unknown",
                "depends_on_design_assumption": f["provenance"] == "DESIGN_ASSUMPTION",
            })
        _result(env, rule, SKIPPED_OUTPUT_SUPPLIED,
                f"output already supplied; inputs {inputs} not KNOWN so not recomputed",
                inputs_snapshot, _value_outputs(rule), inputs)
        return

    if met is False:
        _result(env, rule, SKIPPED_CONDITION, cond_msg, inputs_snapshot)
        return
    if met is None:
        _report_missing(env, cond_missing)
        _result(env, rule, BLOCKED_MISSING, cond_msg, inputs_snapshot, missing=cond_missing)
        return

    if not rule.get("automation", False):
        # e.g. R10: conditions met, but a person must check the manual conditions.
        items = rule.get("manual_conditions", [])
        for item in items:
            env["manual_review"].append({"rule_id": rid, "condition": item, "status": "UNKNOWN",
                                         "note": "manual confirmation required; not judged by V1"})
        msg = (f"{len(items)} source conditions require manual confirmation; V1 does not claim they "
               f"are satisfied")
        _result(env, rule, MANUAL_REVIEW, msg, inputs_snapshot)
        return

    missing = _missing_inputs(rec, inputs)
    if rule.get("operation") in UNKNOWN_TOLERANT_OPERATIONS:
        missing = []
    if missing:
        _report_missing(env, missing)
        for out in _value_outputs(rule):
            if rec.get(out) is None:
                rec[out] = unknown_field()
        _result(env, rule, BLOCKED_MISSING, f"inputs not KNOWN: {missing}", inputs_snapshot,
                rule.get("schema_outputs", []), missing)
        return

    handler = OPERATION_HANDLERS.get(rule.get("operation"))
    if handler is None:
        raise RuleEngineError(f"{rid}: no handler for operation {rule.get('operation')!r}")
    msg = handler(env, rule)
    _result(env, rule, EXECUTED, msg, inputs_snapshot, rule.get("schema_outputs", []))


def _finalise(env: Dict[str, Any]) -> Dict[str, Any]:
    rec = env["record"]
    rec["missing_inputs"] = derived_field(sorted(env["missing_inputs"]))
    env["missing_inputs"] = sorted(env["missing_inputs"])
    env.pop("_coordinate_units", None)
    env.pop("_original_record", None)
    errors = validate_record(rec)
    if errors:
        raise RuleEngineError("evaluated record is not schema-valid: " + "; ".join(errors))
    return env


def evaluate_site(record: Dict[str, Any], coordinate_units: Optional[str] = None,
                  pre_trace: Optional[Dict[str, Dict[str, Any]]] = None) -> Dict[str, Any]:
    """
    Evaluate one site record against all rules in 06_rules.json.

    `coordinate_units` must be 'm' for R04 to measure soil_geometry; the schema does
    not define geometry units, so nothing is assumed when it is None.
    `pre_trace` carries the trace of DERIVED_CALCULATION fields that were written before
    evaluation by an external module (src/block_face.py, rules with executed_by). Its
    entries seed env["trace"], so depends_on_design_assumption propagates downstream and
    R24 sees a trace for every pre-supplied derived field.
    The input record is never mutated.
    """
    assert_valid_record(record)
    env = _new_envelope(copy.deepcopy(record))
    env["_coordinate_units"] = coordinate_units
    env["_original_record"] = copy.deepcopy(record)
    for name, entry in (pre_trace or {}).items():
        if name not in WRAPPED_FIELDS:
            raise RuleEngineError(f"pre_trace: {name!r} is not a wrapped field in 06_data_schema.json")
        env["trace"][name] = copy.deepcopy(entry)
    for rule in RULE_LIST:
        _run_rule(env, rule)
    return _finalise(env)


# --------------------------------------------------------------------------
# Design scenario re-test
# --------------------------------------------------------------------------

def downstream_fields(changed: Set[str]) -> Set[str]:
    """Derived fields that depend (transitively, via schema_inputs -> schema_outputs) on `changed`."""
    affected: Set[str] = set()
    frontier = set(changed)
    while frontier:
        new: Set[str] = set()
        for rule in RULE_LIST:
            if frontier & set(rule.get("schema_inputs", [])):
                for out in rule.get("schema_outputs", []):
                    if out in DERIVED_FIELDS and out not in affected and out != "missing_inputs":
                        new.add(out)
        affected |= new
        frontier = new
    return affected


def evaluate_scenario(record: Dict[str, Any], overrides: Dict[str, Any],
                      scenario_name: str = "design_scenario",
                      coordinate_units: Optional[str] = None) -> Dict[str, Any]:
    """
    Re-test a site under proposed changes. Each override becomes a DESIGN_ASSUMPTION
    field; derived fields downstream of the overrides are cleared and recomputed.
    The base record (confirmed / current condition) is deep-copied and never changed.
    """
    assert_valid_record(record)
    scenario = copy.deepcopy(record)
    for name, value in overrides.items():
        if name not in WRAPPED_FIELDS:
            raise KeyError(f"{name!r} is not a wrapped field in 06_data_schema.json")
        scenario[name] = field(value, "DESIGN_ASSUMPTION", "KNOWN")
    for name in downstream_fields(set(overrides)):
        scenario.pop(name, None)
    env = evaluate_site(scenario, coordinate_units=coordinate_units)
    env["scenario"] = {
        "name": scenario_name,
        "overrides": {n: {"value": v, "provenance": "DESIGN_ASSUMPTION"} for n, v in overrides.items()},
        "recomputed_fields": sorted(downstream_fields(set(overrides))),
        "based_on_design_assumption": True,
        "note": "Scenario values are design assumptions, not existing conditions or City requirements. "
                "The base record is unchanged.",
    }
    env["base_record"] = copy.deepcopy(record)
    return env
