"""
Read-only web API for the V1 interface (Round 3).

This module adapts the existing project logic for a browser client. It adds no
rule logic, no defaults and no inference:

  corridor_summary()  - the 104 King Edward boulevard SITE records as a corridor
                        index (chainage, side, City taxonomy) plus corridor metadata
                        from the pilot extraction.
  site_detail(id)     - one SITE record with its city_reference sidecar, its
                        same-side neighbours (real chainage from City tree points),
                        the schema's input vocabularies and, when present, the
                        illustrative input layer entry from data/inputs.
  evaluate(...)       - layer the five USER_INPUT fields onto the Round 2A record
                        with src.site_inputs (all guards apply), evaluate with
                        src.rule_engine.evaluate_site, and re-test each design
                        scenario with src.rule_engine.evaluate_scenario.

Only the fields the interface needs are returned; the full envelope structure is
unchanged in the engine. Values are never rounded here.
"""
import copy
import json
import pathlib
from typing import Any, Dict, List, Optional

from . import rule_engine as engine
from . import site_inputs as si
from .schema_validation import SCHEMA, field

ROOT = pathlib.Path(__file__).resolve().parents[1]
SITES_PATH = ROOT / "data/processed/king_edward_pilot_sites.json"
CORRIDOR_PATH = ROOT / "data/interim/king_edward_pilot_corridor.geojson"
INPUTS_PATH = ROOT / "data/inputs/king_edward_pilot_user_inputs.json"

CITY_FIELDS = ["tree_id", "genus", "species", "cultivar", "install_date", "inventory_height",
               "inventory_diameter", "location_notes", "tree_point"]
DERIVED_SITE_FIELDS = ["site_state", "street_name"]
UNKNOWN_SITE_FIELDS = ["boulevard_width_m", "site_geometry", "planting_area_geometry", "planting_area_m2",
                       "soil_geometry", "utility_conflict", "aboveground_conflict", "target_scenario"]
RESULT_FIELDS = ["physical_soil_volume_m3", "credited_soil_volume_m3", "required_soil_volume_m3",
                 "soil_volume_gap_m3", "soil_volume_benchmark_classes", "design_response", "missing_inputs"]

_SITES_DOC: Optional[Dict[str, Any]] = None
_CORRIDOR: Optional[Dict[str, Any]] = None
_INPUT_LAYER: Optional[Dict[str, Any]] = None


class ApiError(ValueError):
    """A client error (bad site id or rejected inputs)."""


def _sites_doc() -> Dict[str, Any]:
    global _SITES_DOC
    if _SITES_DOC is None:
        _SITES_DOC = json.loads(SITES_PATH.read_text(encoding="utf-8"))
    return _SITES_DOC


def _corridor_meta() -> Dict[str, Any]:
    global _CORRIDOR
    if _CORRIDOR is None:
        _CORRIDOR = json.loads(CORRIDOR_PATH.read_text(encoding="utf-8"))["pilot_metadata"]
    return _CORRIDOR


def _input_layer() -> Dict[str, Any]:
    global _INPUT_LAYER
    if _INPUT_LAYER is None:
        _INPUT_LAYER = json.loads(INPUTS_PATH.read_text(encoding="utf-8")) if INPUTS_PATH.exists() else {"sites": []}
    return _INPUT_LAYER


def _enum(def_name: str) -> List[str]:
    for part in SCHEMA["$defs"][def_name]["allOf"]:
        props = part.get("properties", {})
        if "value" in props:
            for alt in props["value"]["anyOf"]:
                if "enum" in alt:
                    return list(alt["enum"])
    return []


def input_vocabulary() -> Dict[str, List[str]]:
    """Enumerated input values, read from 06_data_schema.json (never re-declared)."""
    return {
        "planting_condition": _enum("plantingConditionField"),
        "soil_type": _enum("soilTypeField"),
        "target_tree_class": _enum("treeClassField"),
    }


def _value(rec: Dict[str, Any], name: str) -> Any:
    f = rec.get(name)
    return None if f is None or f.get("status") != "KNOWN" else f.get("value")


def _index_entry(entry: Dict[str, Any]) -> Dict[str, Any]:
    rec, cr = entry["record"], entry["city_reference"]
    hint = cr.get("px_position_hint_geometric")
    return {
        "site_id": rec["site_id"],
        "tree_id": _value(rec, "tree_id"),
        "chainage_m": cr.get("px_chainage_from_heather_m"),
        "side": {"north_side": "north", "south_side": "south"}.get(hint, hint),
        "dist_centreline_m": cr.get("px_dist_ke_centreline_m"),
        "block": cr.get("px_notes_block"),
        "genus": _value(rec, "genus"),
        "species": _value(rec, "species"),
        "cultivar": _value(rec, "cultivar"),
        "common_name": cr.get("common_name"),
        "install_date": _value(rec, "install_date"),
        "inventory_height": _value(rec, "inventory_height"),
        "inventory_diameter": _value(rec, "inventory_diameter"),
        "address": cr.get("address"),
        "confidence": cr.get("px_confidence"),
        "flags": cr.get("px_flags"),
        "nearest_cross_street": cr.get("px_nearest_cross_street"),
        "tree_point": _value(rec, "tree_point"),
        "has_example_inputs": any(s["site_id"] == rec["site_id"] for s in _input_layer()["sites"]),
    }


def corridor_summary() -> Dict[str, Any]:
    doc = _sites_doc()
    meta = _corridor_meta()
    sites = sorted((_index_entry(e) for e in doc["sites"]), key=lambda s: (s["chainage_m"] or 0))
    return {
        "corridor": {
            "name": meta["corridor"],
            "length_m": meta["corridor_length_m"],
            "cross_streets": meta["cross_street_chainage_m"],
            "hblocks": meta["corridor_hblocks"],
        },
        "site_count": doc["site_count"],
        "sites": sites,
        "notes": {
            "site_id": doc["site_id_note"],
            "provenance": doc["provenance_note"],
            "out_of_scope": doc["out_of_scope_note"],
            "selection": doc["selection"],
            "built_on": doc["built_on"],
        },
    }


def _neighbours(site_id: str) -> Dict[str, Any]:
    """Same-side neighbours along the corridor, from the City tree points (chainage is DERIVED_CALCULATION)."""
    sites = corridor_summary()["sites"]
    me = next(s for s in sites if s["site_id"] == site_id)
    same = [s for s in sites if s["side"] == me["side"] and s["chainage_m"] is not None]
    same.sort(key=lambda s: s["chainage_m"])
    idx = next(i for i, s in enumerate(same) if s["site_id"] == site_id)
    window = [s for s in same if abs(s["chainage_m"] - me["chainage_m"]) <= 40 and s["site_id"] != site_id]
    prev_s = same[idx - 1] if idx > 0 else None
    next_s = same[idx + 1] if idx + 1 < len(same) else None
    return {
        "same_side_window_40m": [{"site_id": s["site_id"], "offset_m": round(s["chainage_m"] - me["chainage_m"], 1),
                                  "genus": s["genus"]} for s in window],
        "previous_same_side": None if prev_s is None else {"site_id": prev_s["site_id"], "spacing_m": round(me["chainage_m"] - prev_s["chainage_m"], 1)},
        "next_same_side": None if next_s is None else {"site_id": next_s["site_id"], "spacing_m": round(next_s["chainage_m"] - me["chainage_m"], 1)},
        "provenance": "DERIVED_CALCULATION from CITY_DATA tree points (±1–2 m); along-corridor chainage only",
    }


def site_detail(site_id: str) -> Dict[str, Any]:
    try:
        entry = si.load_site_record(site_id, SITES_PATH)
    except KeyError as exc:
        raise ApiError(str(exc)) from exc
    example = None
    for s in _input_layer()["sites"]:
        if s["site_id"] == site_id:
            example = {
                "inputs": {k: v["value"] for k, v in s["inputs"].items()},
                "provenance": {k: v["provenance"] for k, v in s["inputs"].items()},
                "design_scenarios": s.get("design_scenarios", []),
                "entered_by": s.get("entered_by"),
                "entered_on": s.get("entered_on"),
                "evidence": s.get("evidence"),
                "input_notes": s.get("input_notes", {}),
                "illustrative_note": _input_layer().get("illustrative_note"),
            }
    return {
        "index": _index_entry(entry),
        "record": entry["record"],
        "city_reference": entry["city_reference"],
        "neighbours": _neighbours(site_id),
        "allowed_input_fields": list(si.ALLOWED_INPUT_FIELDS),
        "input_vocabulary": input_vocabulary(),
        "example_inputs": example,
        "field_groups": {"city": CITY_FIELDS, "derived": DERIVED_SITE_FIELDS, "unknown_in_v1": UNKNOWN_SITE_FIELDS},
    }


def _compact_trace(trace: Dict[str, Any]) -> Dict[str, Any]:
    out = {}
    for name, t in trace.items():
        out[name] = {
            "rule_id": t.get("rule_id"),
            "operation": t.get("operation"),
            "formula": t.get("formula"),
            "depends_on_design_assumption": t.get("depends_on_design_assumption", False),
            "inputs": {k: {"value": v.get("value"), "provenance": v.get("provenance")} for k, v in (t.get("inputs") or {}).items()},
            "source_reference": t.get("source_reference"),
            "note": t.get("note"),
        }
    return out


def summarise(env: Dict[str, Any]) -> Dict[str, Any]:
    rec = env["record"]
    fields = {}
    for name in si.ALLOWED_INPUT_FIELDS + RESULT_FIELDS:
        fields[name] = copy.deepcopy(rec.get(name))
    return {
        "fields": fields,
        "missing_inputs": env["missing_inputs"],
        "warnings": env["warnings"],
        "unresolved": env["unresolved"],
        "manual_review": env["manual_review"],
        "interpretation": env["interpretation"],
        "reference_info": [{"rule_id": r["rule_id"], "name": r["name"], "content": r.get("content"),
                            "source_reference": r.get("source_reference"), "inputs_present": r.get("inputs_present")}
                           for r in env["reference_info"]],
        "soil_volume_summary": env["soil_volume_summary"],
        "rule_results": [{"rule_id": r["rule_id"], "name": r["name"], "status": r["status"],
                          "outcome": r["outcome"], "message": r["message"], "missing": r["missing"]}
                         for r in env["rule_results"]],
        "trace": _compact_trace(env["trace"]),
        "scenario": env.get("scenario"),
    }


def evaluate(site_id: str, inputs: Optional[Dict[str, Any]] = None,
             scenarios: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """
    inputs:    {field: value} for any subset of the five allowed fields (null = leave UNKNOWN).
    scenarios: [{id, name, overrides: {field: value}}] applied as DESIGN_ASSUMPTION over the
               completed base record.
    """
    try:
        entry = si.load_site_record(site_id, SITES_PATH)
    except KeyError as exc:
        raise ApiError(str(exc)) from exc
    base_record = entry["record"]
    wrapped = {}
    for name, value in (inputs or {}).items():
        if value is None or value == "":
            continue
        if name not in si.ALLOWED_INPUT_FIELDS:
            raise ApiError(f"{name}: not one of the five V1 user-input fields {si.ALLOWED_INPUT_FIELDS}")
        wrapped[name] = field(value, "USER_INPUT", "KNOWN")
    try:
        completed = si.apply_user_inputs(base_record, wrapped)
        base_env = engine.evaluate_site(completed)
    except (si.InputLayerError, engine.RuleEngineError, ValueError) as exc:
        raise ApiError(str(exc)) from exc
    result = {"site_id": site_id, "base": summarise(base_env), "scenarios": []}
    for sc in scenarios or []:
        overrides = {k: v for k, v in (sc.get("overrides") or {}).items() if v is not None and v != ""}
        for name in overrides:
            if name not in si.ALLOWED_INPUT_FIELDS:
                raise ApiError(f"{name}: scenario overrides are limited to the five V1 user-input fields")
        try:
            env = engine.evaluate_scenario(completed, overrides, sc.get("name") or "design_scenario")
        except (engine.RuleEngineError, ValueError, KeyError) as exc:
            raise ApiError(f"scenario {sc.get('name')!r}: {exc}") from exc
        s = summarise(env)
        s["id"] = sc.get("id")
        s["name"] = sc.get("name")
        result["scenarios"].append(s)
    return result


# ---------------------------------------------------------------------------------------------
# Round 5: factual plan context for one site (UI adapter only; no rule logic, no defaults).
#
# Everything below is DERIVED_CALCULATION from CITY_DATA files in data/raw and data/processed:
# a local metric frame centred on the site's tree point (equirectangular, +-0.1 % over 200 m),
# street centrelines, tree points, 1 m contours (City, 2002 orthophotos, "approximate"), the
# ground profile along the section cut, and the nearest right-of-way width record.
# ---------------------------------------------------------------------------------------------
import math

STREETS_PATH = ROOT / "data/raw/public-streets.geojson"
TREES_PATH = ROOT / "data/processed/king_edward_pilot_trees.geojson"
CONTOURS_PATH = ROOT / "data/raw/elevation-contour-lines-1-metre-contours__king_edward_window.geojson"
ROW_PATH = ROOT / "data/raw/right-of-way-widths__king_edward_window.geojson"
MAP_LAYER_PATHS = {   # City map layers drawn in the plan (site-map legibility); none is read by a rule
    "blocks": ROOT / "data/raw/block-outlines__king_edward_window.geojson",
    "buildings": ROOT / "data/raw/building-footprints-2015__king_edward_window.geojson",
    "parcels": ROOT / "data/raw/property-parcel-polygons__king_edward_window.geojson",
    "lanes": ROOT / "data/raw/lanes__king_edward_window.geojson",
}
WINDOW_M = 110.0          # half-size of the analysis window around the tree (metres)
MAP_WINDOW_M = 260.0      # half-size of the plan map window (buildings, parcels, blocks, lanes, streets)
CUT_FROM_M, CUT_TO_M = -14.0, 30.0   # section cut extent: negative = toward the property, positive = toward the road

_STREETS = _TREES = _CONTOURS = _ROW = None


def _load(path):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def _streets():
    global _STREETS
    if _STREETS is None:
        _STREETS = _load(STREETS_PATH)
    return _STREETS


def _trees():
    global _TREES
    if _TREES is None:
        _TREES = _load(TREES_PATH)
    return _TREES


def _contours():
    global _CONTOURS
    if _CONTOURS is None:
        _CONTOURS = _load(CONTOURS_PATH)
    return _CONTOURS


def _row():
    global _ROW
    if _ROW is None:
        _ROW = _load(ROW_PATH)
    return _ROW


def _frame(lon0, lat0):
    kx = math.cos(math.radians(lat0)) * 111320.0
    ky = 110574.0
    return lambda lon, lat: ((lon - lon0) * kx, (lat - lat0) * ky)


def _lines(geom):
    if geom["type"] == "LineString":
        return [geom["coordinates"]]
    if geom["type"] == "MultiLineString":
        return list(geom["coordinates"])
    return []


def _clip_runs(pts, half):
    """Split a polyline into runs of points inside the square window (no new vertices invented)."""
    runs, cur = [], []
    for x, y in pts:
        if abs(x) <= half and abs(y) <= half:
            cur.append([round(x, 2), round(y, 2)])
        elif cur:
            runs.append(cur); cur = []
    if cur:
        runs.append(cur)
    return [r for r in runs if len(r) >= 2]


def _seg_intersect(p, q, a, b):
    """Parameter t along p->q where segment pq crosses segment ab, else None."""
    (x1, y1), (x2, y2), (x3, y3), (x4, y4) = p, q, a, b
    d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3)
    if abs(d) < 1e-12:
        return None
    t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d
    u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d
    if 0 <= t <= 1 and 0 <= u <= 1:
        return t
    return None


_MAP_LAYERS: Dict[str, Any] = {}


def _map_layer(name):
    if name not in _MAP_LAYERS:
        _MAP_LAYERS[name] = _load(MAP_LAYER_PATHS[name])
    return _MAP_LAYERS[name]


def _rings(geom):
    """Outer ring(s) of a Polygon / MultiPolygon as lists of coordinates (holes dropped for drawing)."""
    if geom["type"] == "Polygon":
        return [geom["coordinates"][0]]
    if geom["type"] == "MultiPolygon":
        return [poly[0] for poly in geom["coordinates"]]
    return []


def map_layers(to, half: float) -> Dict[str, Any]:
    """City map layers in local metres, whole features whose vertices touch the window."""
    out: Dict[str, Any] = {}
    for name in ("blocks", "buildings", "parcels"):
        doc = _map_layer(name)
        feats = []
        for f in (doc or {"features": []})["features"]:
            for ring in _rings(f["geometry"]):
                pts = [to(*c[:2]) for c in ring]
                if any(abs(x) <= half and abs(y) <= half for x, y in pts):
                    feats.append([[round(x, 2), round(y, 2)] for x, y in pts])
        out[name] = {"available": doc is not None, "polygons": feats}
    doc = _map_layer("lanes")
    lanes = []
    for f in (doc or {"features": []})["features"]:
        for line in _lines(f["geometry"]):
            pts = [to(*c[:2]) for c in line]
            if any(abs(x) <= half and abs(y) <= half for x, y in pts):
                lanes.append([[round(x, 2), round(y, 2)] for x, y in pts])
    out["lanes"] = {"available": doc is not None, "lines": lanes}
    out["source"] = "City of Vancouver Open Data: block-outlines, building-footprints-2015, property-parcel-polygons, lanes (spatial window, features unmodified)"
    return out


def site_context(site_id: str) -> Dict[str, Any]:
    try:
        entry = si.load_site_record(site_id, SITES_PATH)
    except KeyError as exc:
        raise ApiError(str(exc)) from exc
    rec, cr = entry["record"], entry["city_reference"]
    lon0, lat0 = rec["tree_point"]["value"]["coordinates"]
    to = _frame(lon0, lat0)
    half = WINDOW_M

    # --- street centrelines in the window; King Edward segments carry the bearing --------------
    streets, ke_dirs = [], []
    for f in (_streets() or {"features": []})["features"]:
        hb = f["properties"].get("hblock") or ""
        for line in _lines(f["geometry"]):
            pts = [to(*c[:2]) for c in line]
            if not any(abs(x) <= MAP_WINDOW_M and abs(y) <= MAP_WINDOW_M for x, y in pts):
                continue
            is_ke = "KING EDWARD" in hb
            streets.append({"hblock": hb, "use": f["properties"].get("streetuse"), "king_edward": is_ke,
                            "runs": [[[round(x, 2), round(y, 2)] for x, y in pts]]})
            if not any(abs(x) <= half and abs(y) <= half for x, y in pts):
                continue
            if is_ke:
                for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
                    ke_dirs.append((math.hypot(x2 - x1, y2 - y1), math.atan2(y2 - y1, x2 - x1), (x1, y1), (x2, y2)))
    # bearing of King Edward at the tree: direction of the nearest KE segment (east-pointing)
    bearing = 0.0
    if ke_dirs:
        def dist_to_seg(s):
            _, _, (x1, y1), (x2, y2) = s
            dx, dy = x2 - x1, y2 - y1
            t = max(0.0, min(1.0, (-(x1) * dx - y1 * dy) / (dx * dx + dy * dy))) if dx or dy else 0.0
            return math.hypot(x1 + t * dx, y1 + t * dy)
        seg = min(ke_dirs, key=dist_to_seg)
        bearing = seg[1]
        if math.cos(bearing) < 0:
            bearing += math.pi
    ux, uy = math.cos(bearing), math.sin(bearing)          # along the street, eastward
    side = cr.get("px_position_hint_geometric")
    # across-street unit vector pointing from the tree toward the road centreline
    nx, ny = (uy, -ux) if side == "north_side" else (-uy, ux)

    # --- tree points (all pilot records in the window; boulevard sites vs median context) -------
    trees = []
    for f in (_trees() or {"features": []})["features"]:
        x, y = to(*f["geometry"]["coordinates"][:2])
        if abs(x) <= half and abs(y) <= half:
            p = f["properties"]
            trees.append({"asset_id": p.get("asset_id"), "site_id": f"KE-{p.get('asset_id')}", "x": round(x, 2), "y": round(y, 2),
                          "along_m": round(x * ux + y * uy, 2), "across_m": round(x * nx + y * ny, 2),
                          "position": p.get("px_position_hint_geometric"), "genus": p.get("genus_name"),
                          "species": p.get("species_name"), "selected_in_pilot": p.get("px_status") == "SELECTED"})

    # --- contours ---------------------------------------------------------------------------
    contours, cdoc = [], _contours()
    for f in (cdoc or {"features": []})["features"]:
        for line in _lines(f["geometry"]):
            pts = [to(*c[:2]) for c in line]
            for run in _clip_runs(pts, MAP_WINDOW_M):
                contours.append({"elevation_m": f["properties"].get("elevation"), "pts": run})

    # --- ground profile along the section cut (perpendicular to the street through the tree) ---
    p0 = (nx * CUT_FROM_M, ny * CUT_FROM_M)
    p1 = (nx * CUT_TO_M, ny * CUT_TO_M)
    profile = []
    for f in (cdoc or {"features": []})["features"]:
        z = f["properties"].get("elevation")
        for line in _lines(f["geometry"]):
            pts = [to(*c[:2]) for c in line]
            for a, b in zip(pts, pts[1:]):
                t = _seg_intersect(p0, p1, a, b)
                if t is not None:
                    profile.append({"offset_m": round(CUT_FROM_M + t * (CUT_TO_M - CUT_FROM_M), 2), "elevation_m": z})
    profile.sort(key=lambda p: p["offset_m"])
    # elevation at the tree by linear interpolation between the bracketing crossings, if any
    z_tree = None
    below = [p for p in profile if p["offset_m"] <= 0]
    above = [p for p in profile if p["offset_m"] >= 0]
    if below and above:
        a, b = below[-1], above[0]
        z_tree = a["elevation_m"] if b["offset_m"] == a["offset_m"] else a["elevation_m"] + (b["elevation_m"] - a["elevation_m"]) * (0 - a["offset_m"]) / (b["offset_m"] - a["offset_m"])

    # --- right-of-way width: nearest City record on King Edward -------------------------------
    row = None
    rdoc = _row()
    if rdoc:
        best = None
        for f in rdoc["features"]:
            x, y = to(*f["geometry"]["coordinates"][:2])
            across = x * nx + y * ny; along = x * ux + y * uy
            # records sit on the centreline; accept those roughly on this street within the block
            if abs(along) <= 70 and 5 <= across <= 40:
                d = math.hypot(along, across - (cr.get("px_dist_ke_centreline_m") or 0))
                if best is None or d < best[0]:
                    best = (d, f["properties"].get("width"), round(along, 1), round(across, 1))
        if best:
            row = {"width_as_published": best[1], "unit_published": None,
                   "width_m_if_feet": round(float(best[1]) * 0.3048, 2) if best[1] not in (None, "") else None,
                   "record_offset_along_m": best[2], "record_offset_across_m": best[3],
                   "note": "legal property-line-to-property-line width of the right-of-way; not curb-to-curb, not boulevard width; unit not stated in the City metadata"}

    return {
        "site_id": site_id,
        "frame": {"origin_lonlat": [lon0, lat0], "along_unit": [round(ux, 6), round(uy, 6)], "across_unit_to_road": [round(nx, 6), round(ny, 6)],
                  "bearing_deg_from_east": round(math.degrees(bearing), 2), "side": side, "window_half_m": half,
                  "note": "local equirectangular metres centred on the City tree point; x east, y north; DERIVED_CALCULATION"},
        "dist_centreline_m": cr.get("px_dist_ke_centreline_m"),
        "streets": streets,
        "trees": trees,
        "contours": {"available": bool(cdoc), "interval_m": 1 if cdoc else None, "lines": contours,
                     "source": "City of Vancouver Open Data, elevation-contour-lines-1-metre-contours (2002 orthophotos; City: approximate, not updated)" if cdoc else None},
        "cut": {"from_m": CUT_FROM_M, "to_m": CUT_TO_M, "profile": profile, "elevation_at_tree_m": None if z_tree is None else round(z_tree, 2),
                "note": "offsets along the section cut, negative toward the property line, positive toward the road; elevations where the cut crosses City contour lines"},
        "right_of_way": row,
        "map_layers": map_layers(to, MAP_WINDOW_M),
    }


def rules_doc() -> Dict[str, Any]:
    """The rules file as it is (read-only), so the Source Logic tab quotes the project's own rule text."""
    return copy.deepcopy(engine.load_rules())


# ---- block-face engine file (round 12 interface) ---------------------------------------------------------------
import re as _re

BLOCK_FACE_DIR = ROOT / "data/processed"
_SITE_ID = _re.compile(r"(?:KE|V)-\d{1,8}")


def block_face_path(site_id: str) -> pathlib.Path:
    if not _SITE_ID.fullmatch(site_id or ""):
        raise ApiError(f"bad site id {site_id!r}")
    return BLOCK_FACE_DIR / f"block_face_{site_id}.json"


def block_face_result(site_id: str) -> Dict[str, Any]:
    """The engine's block-face file for a site exactly as scripts/run_block_face.py wrote it.

    Read-only: the interface draws and prints what is in the file and never re-derives a value
    from it. When the file does not exist the client shows a placeholder (interface rule 2026-09-24).
    """
    path = block_face_path(site_id)
    if not path.exists():
        raise ApiError(f"no engine file for {site_id}: run  python3 scripts/run_block_face.py --site {site_id} …")
    return json.loads(path.read_text(encoding="utf-8"))


# ---- round 12: evaluate (wraps scripts/run_block_face.py), model summary, section SVG --------------------------
import importlib.util as _ilu
import os as _os
import subprocess as _sp
import sys as _sys

SCRIPTS = ROOT / "scripts"
MODEL_DIR = ROOT / "data/processed"
_EXPORTER = None


def _exporter():
    """scripts/export_rhino_model.py as a module (it is a script, not a package); only its section_svg is used here."""
    global _EXPORTER
    if _EXPORTER is None:
        spec = _ilu.spec_from_file_location("export_rhino_model", SCRIPTS / "export_rhino_model.py")
        mod = _ilu.module_from_spec(spec)
        spec.loader.exec_module(mod)
        _EXPORTER = mod
    return _EXPORTER


def _run(args: List[str], what: str) -> str:
    proc = _sp.run([_sys.executable] + args, cwd=str(ROOT), capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout or "").strip().splitlines()
        raise ApiError(f"{what} failed (exit {proc.returncode}): " + " | ".join(tail[-6:]))
    return proc.stdout


def model_path(site_id: str) -> pathlib.Path:
    block_face_path(site_id)          # validates the id
    return MODEL_DIR / f"rhino_model_{site_id}.json"


def export_model(site_id: str) -> Dict[str, Any]:
    """Run scripts/export_rhino_model.py for the site's engine file (the same call the README's step 3 makes)."""
    if not block_face_path(site_id).exists():
        raise ApiError(f"no engine file for {site_id}")
    _run([str(SCRIPTS / "export_rhino_model.py"), "--site", site_id], "exporter")
    return json.loads(model_path(site_id).read_text(encoding="utf-8"))


def model_doc(site_id: str) -> Dict[str, Any]:
    """The exporter's model JSON, regenerated when it is missing or older than the engine file."""
    bp, mp = block_face_path(site_id), model_path(site_id)
    if not bp.exists():
        raise ApiError(f"no engine file for {site_id}: run  python3 scripts/run_block_face.py --site {site_id} …")
    if not mp.exists() or mp.stat().st_mtime < bp.stat().st_mtime:
        return export_model(site_id)
    return json.loads(mp.read_text(encoding="utf-8"))


def model_summary(site_id: str) -> Dict[str, Any]:
    """What the page shows from the model: the READOUT lines the exporter composed, the sheet's missing list, layout report."""
    m = model_doc(site_id)
    sec = m["sheets"]["BSB_SECTION_AA"]
    return {"site_id": m["site_id"], "run_tag": m.get("run_tag"), "built_on": m.get("built_on"), "standard_version": m.get("standard_version"),
            "readout": sec["readout"], "missing": sec.get("missing", []), "knobs_line": sec.get("knobs"), "notes": sec.get("notes"),
            "layout_report": m.get("layout_report", {}).get("BSB_SECTION_AA"), "truncate": (m.get("layout") or {}).get("truncate")}


def section_svg(site_id: str, frame_px: Optional[float] = None) -> str:
    """frame_px: the on-screen width the page will give the sheet; annotation sizes scale so 1.7 mm mono text
    reads >= 11 px (export_rhino_model.section_svg text_scale). Without it the sheet renders at page proportions."""
    k = 1.0
    if frame_px:
        px_per_mm = float(frame_px) / (_exporter().SVG_VIEW[2] - _exporter().SVG_VIEW[0])
        k = 11.0 / (1.4 * 1.7 * px_per_mm)
    return _exporter().section_svg(model_doc(site_id), text_scale=k)


# ---- round 12 D: source anchors for the why panel, Rhino captures for the strip --------------------------------
ANCHORS_PATH = ROOT / ".claude/skills/boulevard-soil-band/references/source_anchors.md"
RHINO_CAPTURES = ROOT / "reports/screens/rhino"
_CAPTURE_NAME = _re.compile(r"(KE-\d+)_(plan|section_aa|axo)_(curb[0-9.]+)_(\d{4}-\d{2}-\d{2})\.png")


def source_anchors() -> Dict[str, Any]:
    """The anchors file parsed row by row: {section: [{anchor, text, used_by}]}; the page quotes these and nothing else."""
    if not ANCHORS_PATH.exists():
        raise ApiError("source_anchors.md not found")
    out: Dict[str, List[Dict[str, str]]] = {}
    section = None
    for line in ANCHORS_PATH.read_text(encoding="utf-8").splitlines():
        if line.startswith("## "):
            section = line[3:].strip()
            out.setdefault(section, [])
            continue
        if section is None or not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 3 or cells[0] in ("Anchor", "Dataset") or set(cells[0]) <= {"-"}:
            continue
        out[section].append({"anchor": cells[0].replace("`", ""), "text": cells[1], "used_by": cells[2]})
    return {"file": str(ANCHORS_PATH.relative_to(ROOT)), "sections": out}


def rhino_captures(site_id: str, run_tag: Optional[str]) -> Dict[str, Any]:
    """Latest three Rhino captures for the site and curb tag (one per view when available), newest first."""
    block_face_path(site_id)
    files = []
    for f in RHINO_CAPTURES.glob("*.png"):
        m = _CAPTURE_NAME.fullmatch(f.name)
        if m and m.group(1) == site_id:
            files.append({"name": f.name, "view": m.group(2), "tag": m.group(3), "date": m.group(4), "mtime": f.stat().st_mtime})
    same = [f for f in files if run_tag and f["tag"] == run_tag]
    same.sort(key=lambda f: (f["date"], f["mtime"]), reverse=True)
    picked, seen = [], set()
    for f in same:
        if f["view"] not in seen:
            picked.append(f); seen.add(f["view"])
    picked = picked[:3]
    for f in sorted(same, key=lambda f: (f["date"], f["mtime"]), reverse=True):
        if len(picked) >= 3:
            break
        if f not in picked:
            picked.append(f)
    order = {"plan": 0, "section_aa": 1, "axo": 2}
    picked.sort(key=lambda f: order[f["view"]])
    return {"site_id": site_id, "run_tag": run_tag, "captures": [{k: v for k, v in f.items() if k != "mtime"} for f in picked],
            "available_tags": sorted({f["tag"] for f in files}), "dir": "reports/screens/rhino/"}


def capture_path(name: str) -> pathlib.Path:
    if not _CAPTURE_NAME.fullmatch(name or ""):
        raise ApiError(f"not a capture name: {name!r}")
    return RHINO_CAPTURES / name


_KNOB_CHOICES = {"target": ("Small", "Medium", "Large", "Columnar"), "soil": ("native_soil", "structural_soil", "soil_cell", "other"),
                 "land_use": ("residential_detached", "residential_low_rise", "residential_mid_high_rise_ftn_greenway", "commercial_mixed_use"),
                 "width_level": ("constrained", "minimum", "preferred"), "existing_provenance": ("USER_INPUT", "CONFIRMED_SITE_DATA")}


def _num(v, name, lo, hi):
    if v is None or v == "":
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        raise ApiError(f"{name}: not a number ({v!r})")
    if not (lo <= x <= hi):
        raise ApiError(f"{name}: {x} outside {lo}–{hi}")
    return x


def evaluate_block_face(site_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """Wrap scripts/run_block_face.py with the page's knobs, write data/processed/block_face_<site>.json, then run the
    exporter, and return both files' contents the page needs. The page sends exactly what the CLI takes; nothing is
    defaulted here beyond the CLI's own defaults."""
    block_face_path(site_id)
    args = [str(SCRIPTS / "run_block_face.py"), "--site", site_id]
    curb = _num(params.get("curb"), "curb", 0.5, 60)
    depth = _num(params.get("depth"), "depth", 0.05, 5)
    if curb is not None:
        args += ["--curb", f"{curb:g}"]
    if depth is not None:
        args += ["--depth", f"{depth:g}"]
    for key, flag in (("target", "--target"), ("soil", "--soil"), ("land_use", "--land-use"), ("width_level", "--width-level")):
        v = params.get(key)
        if v:
            if v not in _KNOB_CHOICES[key]:
                raise ApiError(f"{key}: {v!r} is not one of {_KNOB_CHOICES[key]}")
            args += [flag, v]
    ex = params.get("existing")
    if ex:
        w = _num(ex.get("width"), "existing width", 0.05, 30)
        d = _num(ex.get("depth"), "existing depth", 0.05, 5)
        if w is not None:
            args += ["--existing-width", f"{w:g}"]
        if d is not None:
            args += ["--existing-depth", f"{d:g}"]
        if ex.get("soil"):
            if ex["soil"] not in _KNOB_CHOICES["soil"]:
                raise ApiError(f"existing soil: {ex['soil']!r}")
            args += ["--existing-soil", ex["soil"]]
        prov = ex.get("provenance") or "USER_INPUT"
        if prov not in _KNOB_CHOICES["existing_provenance"]:
            raise ApiError(f"existing provenance: {prov!r}")
        args += ["--existing-provenance", prov]
        if ex.get("evidence"):
            args += ["--existing-evidence", str(ex["evidence"])[:200]]
        if ex.get("utility_note"):
            args += ["--utility-note", str(ex["utility_note"])[:300]]
    if params.get("fixture_main_u") not in (None, ""):
        args += ["--fixture-main-u", f"{_num(params['fixture_main_u'], 'fixture main u', -500, 500):g}"]
    stdout = _run(args, "engine")
    result = block_face_result(site_id)
    export_model(site_id)
    return {"block_face": result, "model": model_summary(site_id), "engine_stdout": stdout.strip().splitlines()[-3:], "args": args[1:]}
