"""
SITE records for ANY City tree (phase 2 of 11_redefinition_2026-09-28.md §7a).

Generalises scripts/build_pilot_site_records.py (Round 2A), which only knew the King Edward
corridor. Given a window (centre + radius) this module turns every City public-trees record
inside it into a schema-valid SITE record with the same provenance rules:

  CITY_DATA            values read directly from a City field
  DERIVED_CALCULATION  values parsed from City data: street_name (from the tree's "nearest
                       address" string, or from the VanMap LOCATION_NOTES block sentence when
                       that layer was reachable), site_state, the geometric position hint
  UNKNOWN              every boulevard, soil, geometry, design and target field

Nothing about soil, boulevard width, species class or design is estimated. The site TYPE
(boulevard / median / park) is a user confirmation: this module only computes a hint.

Address resolution (§7a): an address string is matched against public-trees.address
("nearest address", as published) and, failing that, against the City property-addresses
points; the trees within ADDRESS_TREE_RADIUS_M of the address point are offered.
"""
import json
import math
import pathlib
import re
import urllib.parse
import urllib.request
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

from . import rule_engine as engine
from . import schema_validation as sv
from .schema_validation import known_field, unknown_field

ROOT = pathlib.Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
PROCESSED = ROOT / "data" / "processed"
TREES_PATH = RAW / "public-trees.geojson"
STREETS_PATH = RAW / "public-streets.geojson"
ADDRESSES_PATH = RAW / "property-addresses.geojson"
PARKS_PATH = RAW / "parks-polygon-representation.geojson"
VANMAP_TREES = "https://maps.vancouver.ca/server/rest/services/VanMapViewer/Environment/MapServer/32/query"

SITE_ID_PREFIX = "V-"
MEDIAN_MAX_M = 3.0             # tree within this distance of the centreline: geometric hint 'median'
ADDRESS_TREE_RADIUS_M = 40.0   # trees offered for an address resolved through property-addresses
NOTES_RE = re.compile(r"Block\s+(\S+)\s+(.+?)\.\s*Side\s*(\d+)\s*in cell\s*(\d+)", re.I)

UNKNOWN_FIELDS = [
    "boulevard_width_m", "site_geometry", "planting_area_geometry", "planting_area_m2",
    "planting_condition", "soil_geometry", "soil_area_m2", "soil_depth_m", "soil_type",
    "target_tree_class", "utility_conflict", "aboveground_conflict", "target_scenario",
]

_CACHE: Dict[str, Any] = {}


class SiteResolutionError(ValueError):
    pass


# --------------------------------------------------------------------------
# City files
# --------------------------------------------------------------------------

def _features(path: pathlib.Path) -> List[Dict[str, Any]]:
    key = str(path)
    if key not in _CACHE:
        if not path.exists():
            raise SiteResolutionError(f"City file missing: {path.relative_to(ROOT)} (fetch it first)")
        _CACHE[key] = json.loads(path.read_text(encoding="utf-8")).get("features", [])
    return _CACHE[key]


def _frame(lon0: float, lat0: float):
    kx = 111_320.0 * math.cos(math.radians(lat0))
    ky = 111_320.0
    return lambda lon, lat: ((lon - lon0) * kx, (lat - lat0) * ky)


def norm_street(text: Optional[str]) -> Optional[str]:
    """'2091 W 7TH AV' -> 'W 7TH AV' (public-streets hblock spelling). None when nothing is left."""
    if not text:
        return None
    a = text.upper().strip()
    a = re.sub(r"^\d+[A-Z]?\s+", "", a)          # civic number
    a = re.sub(r"\s+", " ", a).replace(" AVE", " AV").replace(" AVENUE", " AV").replace(" STREET", " ST")
    return a or None


# --------------------------------------------------------------------------
# Resolution: asset_id / address / point -> tree feature
# --------------------------------------------------------------------------

def tree_by_asset_id(asset_id: int) -> Dict[str, Any]:
    for f in _features(TREES_PATH):
        if int(f["properties"].get("asset_id") or -1) == int(asset_id):
            return f
    raise SiteResolutionError(f"asset_id {asset_id} not in {TREES_PATH.relative_to(ROOT)}")


def trees_near(lon: float, lat: float, radius_m: float) -> List[Tuple[float, Dict[str, Any]]]:
    to = _frame(lon, lat)
    out = []
    for f in _features(TREES_PATH):
        g = f.get("geometry")
        if not g or not g.get("coordinates"):
            continue
        x, y = to(*g["coordinates"][:2])
        d = math.hypot(x, y)
        if d <= radius_m:
            out.append((d, f))
    out.sort(key=lambda t: t[0])
    return out


def trees_by_address(address: str) -> Dict[str, Any]:
    """
    Resolve an address to candidate trees. Returns {"matched_by", "address", "candidates": [...]}.
    1. exact match on public-trees.address (the City's 'nearest address' per tree);
    2. else the property-addresses point for that civic number + street, then trees within
       ADDRESS_TREE_RADIUS_M of it.
    """
    a = re.sub(r"\s+", " ", address.upper().strip()).replace(" AVE", " AV").replace(" AVENUE", " AV").replace(" STREET", " ST")
    hits = [f for f in _features(TREES_PATH) if (f["properties"].get("address") or "").upper() == a]
    if hits:
        return {"matched_by": "public-trees.address (nearest address, as published)", "address": a,
                "candidates": [{"asset_id": f["properties"]["asset_id"], "distance_m": None, "properties": f["properties"]} for f in hits]}
    m = re.match(r"^(\d+)\s+(.+)$", a)
    if not m:
        raise SiteResolutionError(f"address {address!r}: no civic number")
    civic, street = int(m.group(1)), m.group(2)
    pts = [f for f in _features(ADDRESSES_PATH)
           if str(f["properties"].get("civic_number")) == str(civic) and (f["properties"].get("std_street") or "").upper() == street]
    if not pts:
        raise SiteResolutionError(f"address {address!r}: not in public-trees.address and not in property-addresses")
    lon, lat = pts[0]["geometry"]["coordinates"][:2]
    near = trees_near(lon, lat, ADDRESS_TREE_RADIUS_M)
    if not near:
        raise SiteResolutionError(f"address {address!r}: property point found but no City tree within {ADDRESS_TREE_RADIUS_M} m")
    return {"matched_by": "property-addresses point + nearest public-trees", "address": a,
            "address_point": [lon, lat],
            "candidates": [{"asset_id": f["properties"]["asset_id"], "distance_m": round(d, 1), "properties": f["properties"]} for d, f in near]}


# --------------------------------------------------------------------------
# Street name and position hint
# --------------------------------------------------------------------------

def vanmap_location_notes(asset_id: int, timeout: int = 20) -> Optional[Dict[str, Any]]:
    """LOCATION_NOTES / INSTALL_DATE / FULL_ADDR from the VanMap Trees layer, or None if unreachable."""
    q = urllib.parse.urlencode({"f": "json", "where": f"ASSET_ID={int(asset_id)}", "outFields": "ASSET_ID,LOCATION_NOTES,INSTALL_DATE,FULL_ADDR", "returnGeometry": "false"})
    try:
        with urllib.request.urlopen(VANMAP_TREES + "?" + q, timeout=timeout) as r:
            doc = json.loads(r.read())
    except Exception:
        return None
    feats = doc.get("features") or []
    if not feats:
        return None
    at = feats[0]["attributes"]
    ms = at.get("INSTALL_DATE")
    at["INSTALL_DATE_iso"] = date.fromtimestamp(ms / 1000).isoformat() if isinstance(ms, (int, float)) else None
    return at


def street_name_for(props: Dict[str, Any], notes: Optional[Dict[str, Any]]) -> Tuple[Optional[str], str]:
    """(street_name, how) — VanMap block sentence first, else the nearest-address string."""
    if notes and notes.get("LOCATION_NOTES"):
        m = NOTES_RE.search(notes["LOCATION_NOTES"])
        if m:
            return norm_street(m.group(2)), "VanMap Trees LOCATION_NOTES block sentence"
    return norm_street(props.get("address")), "public-trees.address (nearest address) with the civic number removed"


def position_hint(lon: float, lat: float, street_name: Optional[str]) -> Dict[str, Any]:
    """
    Geometric hint only (DERIVED_CALCULATION): distance to the nearest centreline segment of the
    named street, 'median' if within MEDIAN_MAX_M, otherwise which side (by compass). Park test
    against the City parks polygons. The user confirms the site type; this never decides it.
    """
    to = _frame(lon, lat)
    best = None
    if street_name:
        for f in _features(STREETS_PATH):
            hb = f["properties"].get("hblock") or ""
            if street_name not in hb:
                continue
            g = f["geometry"]
            lines = [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]
            for line in lines:
                pts = [to(*c[:2]) for c in line]
                for a, b in zip(pts, pts[1:]):
                    ax, ay = a; bx, by = b
                    dx, dy = bx - ax, by - ay
                    L2 = dx * dx + dy * dy
                    t = 0 if L2 == 0 else max(0.0, min(1.0, (-ax * dx - ay * dy) / L2))
                    cx, cy = ax + t * dx, ay + t * dy
                    d = math.hypot(cx, cy)
                    if best is None or d < best[0]:
                        cross = dx * (0 - ay) - dy * (0 - ax)   # tree relative to segment direction
                        bearing = math.degrees(math.atan2(dy, dx)) % 180
                        best = (d, hb, cross, bearing)
    in_park = False
    if PARKS_PATH.exists():
        for f in _features(PARKS_PATH):
            g = f.get("geometry") or {}
            rings = g.get("coordinates") if g.get("type") == "Polygon" else [r for p in (g.get("coordinates") or []) for r in p] if g.get("type") == "MultiPolygon" else []
            for ring in rings or []:
                if _point_in_ring(lon, lat, ring):
                    in_park = True
                    break
            if in_park:
                break
    if best is None:
        return {"hint": "unknown", "note": "no centreline segment of the named street found", "in_park_polygon": in_park}
    d, hb, cross, bearing = best
    hint = "median" if d <= MEDIAN_MAX_M else _side_name(cross, bearing)
    return {"hint": hint, "dist_centreline_m": round(d, 2), "nearest_hblock": hb, "in_park_polygon": in_park,
            "note": "geometric hint from public-streets; 'median' = within %.1f m of the centreline; site type is confirmed by the user" % MEDIAN_MAX_M}


def _side_name(cross: float, bearing_deg: float) -> str:
    # cross > 0: the point is to the left of the segment direction (a -> b)
    b = math.radians(bearing_deg)
    dx, dy = math.cos(b), math.sin(b)
    # make the direction east-pointing for E–W streets, north-pointing for N–S streets
    ew = bearing_deg < 45 or bearing_deg > 135
    if ew and dx < 0:
        dx, dy, cross = -dx, -dy, -cross
    if not ew and dy < 0:
        dx, dy, cross = -dx, -dy, -cross
    if ew:
        return "north_side" if cross > 0 else "south_side"
    return "west_side" if cross > 0 else "east_side"


def _point_in_ring(lon: float, lat: float, ring: List[List[float]]) -> bool:
    inside = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i][:2]
        x2, y2 = ring[(i + 1) % n][:2]
        if (y1 > lat) != (y2 > lat):
            x = x1 + (lat - y1) * (x2 - x1) / (y2 - y1)
            if x > lon:
                inside = not inside
    return inside


# --------------------------------------------------------------------------
# Records
# --------------------------------------------------------------------------

def _city_string(value):
    if value is None or (isinstance(value, str) and value.strip() == ""):
        return unknown_field()
    return known_field(value, "CITY_DATA")


def _city_number(value):
    return unknown_field() if value is None else known_field(value, "CITY_DATA")


def build_site_record(feature: Dict[str, Any], street_name: Optional[str], notes: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    p = feature["properties"]
    rec = {
        "site_id": f"{SITE_ID_PREFIX}{p['asset_id']}",
        "site_state": known_field("existing_tree", "DERIVED_CALCULATION"),
        "street_name": known_field(street_name, "DERIVED_CALCULATION") if street_name else unknown_field(),
        "tree_point": known_field(feature["geometry"], "CITY_DATA"),
        "tree_id": known_field(str(p["asset_id"]), "CITY_DATA"),
        "genus": _city_string(p.get("genus_name")),
        "species": _city_string(p.get("species_name")),
        "cultivar": _city_string(p.get("cultivar_name")),
        "install_date": _city_string(notes.get("INSTALL_DATE_iso") if notes else None),
        "inventory_height": _city_number(p.get("height_m")),
        "inventory_diameter": _city_number(p.get("diameter_cm")),
        "location_notes": _city_string(notes.get("LOCATION_NOTES") if notes else None),
        "missing_inputs": sv.derived_field([]),
    }
    for name in UNKNOWN_FIELDS:
        rec[name] = unknown_field()
    return rec


def build_window_sites(centre_lon: float, centre_lat: float, radius_m: float, window: str,
                       selected_asset_id: int, site_type: Optional[str], use_vanmap: bool = True) -> Tuple[pathlib.Path, Dict[str, Any]]:
    """
    Write data/processed/sites_<window>.json: one SITE record (+ city_reference sidecar) for every
    City tree within radius_m. The selected tree additionally gets the VanMap block sentence
    (when reachable) and the user's site-type confirmation in its sidecar.
    """
    entries = []
    selected_entry = None
    for d, f in trees_near(centre_lon, centre_lat, radius_m):
        p = f["properties"]
        asset = int(p["asset_id"])
        notes = vanmap_location_notes(asset) if (use_vanmap and asset == int(selected_asset_id)) else None
        street, how = street_name_for(p, notes)
        lon, lat = f["geometry"]["coordinates"][:2]
        hint = position_hint(lon, lat, street)
        rec = build_site_record(f, street, notes)
        sv.assert_valid_record(rec)
        sidecar = {"asset_id": asset, "common_name": p.get("common_name"), "address": p.get("address"),
                   "local_area": p.get("local_area"), "street_name_source": how,
                   "px_position_hint_geometric": hint["hint"], "position_hint": hint,
                   "px_dist_ke_centreline_m": hint.get("dist_centreline_m"),
                   "distance_from_window_centre_m": round(d, 1)}
        if notes:
            sidecar.update({"FULL_ADDR": notes.get("FULL_ADDR"), "LOCATION_NOTES": notes.get("LOCATION_NOTES")})
        if asset == int(selected_asset_id):
            sidecar["site_type_confirmed_by_user"] = site_type
            if site_type == "boulevard" and (hint.get("in_park_polygon") or hint["hint"] == "median"):
                sidecar["site_type_review"] = ("REVIEW_REQUIRED: user confirmed boulevard but the City geometry puts the tree "
                                               + ("inside a park polygon" if hint.get("in_park_polygon") else "within %.1f m of the centreline (median)" % MEDIAN_MAX_M))
            selected_entry = {"record": rec, "city_reference": sidecar}
        entries.append({"record": rec, "city_reference": sidecar})
    if selected_entry is None:
        raise SiteResolutionError(f"selected asset_id {selected_asset_id} is not within {radius_m} m of the window centre")
    doc = {
        "dataset": f"SITE records for window {window}",
        "schema": "sources/06_data_schema.json", "schema_version": sv.SCHEMA.get("version"),
        "rules": "sources/06_rules.json", "rules_version": engine.RULES["version"],
        "built_on": date.today().isoformat(), "built_by": "src/sites.py build_window_sites",
        "source_file": str(TREES_PATH.relative_to(ROOT)),
        "window": {"centre": [centre_lon, centre_lat], "radius_m": radius_m, "name": window},
        "selected_site_id": selected_entry["record"]["site_id"],
        "site_count": len(entries),
        "provenance_note": ("CITY_DATA read directly; street_name and the position hint are DERIVED_CALCULATION; "
                            "every boulevard, soil, geometry, class and design field is UNKNOWN; the site type is a user confirmation"),
        "sites": entries,
    }
    PROCESSED.mkdir(parents=True, exist_ok=True)
    out = PROCESSED / f"sites_{window}.json"
    out.write_text(json.dumps(doc, indent=1, ensure_ascii=False), encoding="utf-8")
    return out, doc
