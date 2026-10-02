"""
Block-face band share — Round 8 (sources/08_redefinition_2026-09-22.md §2.4–2.7, §2.12).

Analysis unit: one BLOCK FACE = the boulevard on one side of a street between two cross
streets, treated as one continuous soil band. Per-tree share = band width × soil depth ×
measured same-side spacing (tributary length), compared with Table 9-2 Shared / Row and,
for comparison, Solitary. The apportioning is a PROJECT INTERPRETATION (R26); R21 stays
unresolved.

The module does three things and nothing else:

  1. build_block_face()      measures the face from City Open Data in a local metric frame:
                             street centreline and bearing, block outline (property line),
                             cross streets, same-side tree points and spacing, right-of-way
                             record, catch basins (curb hint only), and the six City utility
                             layers (plan position only; depth is not published). Everything
                             measured is DERIVED_CALCULATION from CITY_DATA. Nothing is
                             estimated where data is absent.
  2. apportion()             cuts the band into per-tree cells (R26) and applies utility
                             interruptions (R28: GRI p.18 qualifying condition + EDM Table 2-2
                             tree clearances). Pure interval arithmetic in the band frame.
  3. evaluate_block_face()   writes measured values and the four knobs into schema-valid site
                             records and hands them to rule_engine.evaluate_site(); the rule
                             file does the rest (R01 Table 9-2, R05–R07 volume and credit,
                             R08/R09 new-tree-only methods, R12 gap, R20 benchmark label,
                             R21 unresolved scaling, R27 Shared / Row classes). The existing-
                             state credit default (R29, GRI p.18) and the two grades of
                             designer input are layered here.

Knobs (four, and only four): curb offset from the centreline → band width; soil depth;
target tree class; soil type. Spacing is measured and cannot be changed.

Band frame: u along the street (east-pointing unit from the nearest centreline segment), v
across the street, POSITIVE TOWARD THE PROPERTY on the tree's side, origin at the selected
tree's City point. The centreline sits at v = -dist_centreline_m, the property line at
v = +property_line_offset_m. Both sides of a street therefore use the same sign convention.
"""
import copy
import glob
import json
import math
import pathlib
import re
from typing import Any, Dict, List, Optional, Sequence, Tuple

from . import rule_engine as engine
from . import site_inputs as si
from .schema_validation import assert_valid_record, derived_field, field, known_field, unknown_field

ROOT = pathlib.Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
STREETS_PATH = RAW / "public-streets.geojson"

R26 = engine.RULE_INDEX["R26"]
R27 = engine.RULE_INDEX["R27"]
R28 = engine.RULE_INDEX["R28"]
R29 = engine.RULE_INDEX["R29"]
R30 = engine.RULE_INDEX["R30"]
R31 = engine.RULE_INDEX["R31"]
LAND_USES: Tuple[str, ...] = tuple(R30["land_use_rows"])
WIDTH_LEVELS: Tuple[str, ...] = ("constrained", "minimum", "preferred")
CLEARANCES: Dict[str, Optional[float]] = {k: v["value"] for k, v in R28["clearance_from_trees_m"].items()}
CITY_UTILITY_KINDS: Dict[str, str] = dict(R28["city_datasets"])

TREE_LINE_TOLERANCE_M = 3.0      # trees within this across-street distance of the selected tree are on the same face
FRONTAGE_TOLERANCE_M = 2.5       # block-outline vertices within this distance of the property-line offset define the frontage
UTILITY_WINDOW_MARGIN_M = 5.0    # utilities are collected this far beyond the face (drawn, not necessarily interrupting)
DESIGNER_PROVENANCE = ("USER_INPUT", "CONFIRMED_SITE_DATA")
KNOB_PROVENANCE = ("USER_INPUT", "DESIGN_ASSUMPTION")
CURB_PROVENANCE = ("USER_INPUT", "DESIGN_ASSUMPTION", "CONFIRMED_SITE_DATA")   # the curb is a site fact: a measurement with evidence confirms it
EXTENSION_SIDES = ("property", "road")            # R31: beyond the sidewalk edge / beyond the back of curb
EXTENSION_SOIL_TYPES = ("native_soil", "structural_soil", "soil_cell", "other")
EXTENSION_PROVENANCE = ("USER_INPUT", "DESIGN_ASSUMPTION", "CONFIRMED_SITE_DATA")


class BlockFaceError(ValueError):
    pass


# --------------------------------------------------------------------------
# Geometry helpers (local equirectangular metres, as src/web_api.py)
# --------------------------------------------------------------------------

def _frame(lon0: float, lat0: float):
    kx = math.cos(math.radians(lat0)) * 111320.0
    ky = 110574.0
    return lambda lon, lat: ((lon - lon0) * kx, (lat - lat0) * ky)


def _lines(geom) -> List[List[Sequence[float]]]:
    if geom is None:
        return []
    if geom["type"] == "LineString":
        return [geom["coordinates"]]
    if geom["type"] == "MultiLineString":
        return list(geom["coordinates"])
    return []


def _rings(geom) -> List[List[Sequence[float]]]:
    if geom is None:
        return []
    if geom["type"] == "Polygon":
        return [geom["coordinates"][0]]
    if geom["type"] == "MultiPolygon":
        return [poly[0] for poly in geom["coordinates"]]
    return []


def _points(geom) -> List[Sequence[float]]:
    if geom is None:
        return []
    if geom["type"] == "Point":
        return [geom["coordinates"]]
    if geom["type"] == "MultiPoint":
        return list(geom["coordinates"])
    return []


def _nearest_on_segment(a, b) -> Tuple[float, float, float]:
    """(distance from origin, t, ...) of the closest point on segment a-b to the origin."""
    (x1, y1), (x2, y2) = a, b
    dx, dy = x2 - x1, y2 - y1
    l2 = dx * dx + dy * dy
    t = max(0.0, min(1.0, (-(x1) * dx - y1 * dy) / l2)) if l2 else 0.0
    px, py = x1 + t * dx, y1 + t * dy
    return math.hypot(px, py), px, py


def _vertical_hits(u: float, ring: List[Tuple[float, float]]) -> List[float]:
    """v-values where the vertical line at `u` crosses the ring's edges."""
    hits = []
    n = len(ring)
    for i in range(n):
        (u1, v1), (u2, v2) = ring[i], ring[(i + 1) % n]
        if u1 == u2:
            continue
        if (u1 <= u < u2) or (u2 <= u < u1):
            hits.append(v1 + (u - u1) * (v2 - v1) / (u2 - u1))
    return hits


def _clip_segment(a, b, rect) -> Optional[Tuple[Tuple[float, float], Tuple[float, float]]]:
    """Liang–Barsky clip of segment a-b to rect = (u0, u1, v0, v1). None when outside."""
    u0, u1, v0, v1 = rect
    (x1, y1), (x2, y2) = a, b
    dx, dy = x2 - x1, y2 - y1
    t0, t1 = 0.0, 1.0
    for p, q in ((-dx, x1 - u0), (dx, u1 - x1), (-dy, y1 - v0), (dy, v1 - y1)):
        if p == 0:
            if q < 0:
                return None
            continue
        r = q / p
        if p < 0:
            if r > t1:
                return None
            t0 = max(t0, r)
        else:
            if r < t0:
                return None
            t1 = min(t1, r)
    if t0 > t1:
        return None
    return (x1 + t0 * dx, y1 + t0 * dy), (x1 + t1 * dx, y1 + t1 * dy)


def _r(x: Optional[float], nd: int = 2) -> Optional[float]:
    return None if x is None else round(x, nd)


# --------------------------------------------------------------------------
# City data loading (whole features as served; the only filter is spatial)
# --------------------------------------------------------------------------

_CACHE: Dict[str, Any] = {}


def _layer(dataset_id: str) -> List[Dict[str, Any]]:
    """All features of a City dataset saved under data/raw (every window file), else []."""
    if dataset_id not in _CACHE:
        feats: List[Dict[str, Any]] = []
        if dataset_id == "public-streets":
            paths = [STREETS_PATH] if STREETS_PATH.exists() else []
        else:
            paths = [pathlib.Path(p) for p in sorted(glob.glob(str(RAW / f"{dataset_id}__*.geojson")))]
        seen = set()
        for p in paths:
            for f in json.loads(p.read_text(encoding="utf-8")).get("features", []):
                # windows overlap (the same City feature is exported into every window that contains it): keep one copy
                key = json.dumps([f.get("geometry"), f.get("properties")], sort_keys=True, default=str)
                if key in seen:
                    continue
                seen.add(key)
                feats.append(f)
        _CACHE[dataset_id] = feats
    return _CACHE[dataset_id]


def _sites_doc(sites_path: pathlib.Path) -> Dict[str, Any]:
    key = f"sites:{sites_path}"
    if key not in _CACHE:
        _CACHE[key] = json.loads(pathlib.Path(sites_path).read_text(encoding="utf-8"))
    return _CACHE[key]


# --------------------------------------------------------------------------
# 1. Measure the block face from City data
# --------------------------------------------------------------------------

def build_block_face(site_id: str, sites_path: pathlib.Path = si.SITES_PATH) -> Dict[str, Any]:
    """
    Measure the block face of one boulevard site. Every value is DERIVED_CALCULATION from
    CITY_DATA files; each entry says which dataset it was read from. Raises BlockFaceError
    when a required City layer is missing or the site cannot be placed on a block.
    """
    entry = si.load_site_record(site_id, sites_path)
    rec, cr = entry["record"], entry["city_reference"]
    if rec["street_name"]["status"] != "KNOWN":
        raise BlockFaceError(f"{site_id}: street_name is UNKNOWN; the face cannot be located")
    street_name = rec["street_name"]["value"]
    lon0, lat0 = rec["tree_point"]["value"]["coordinates"]
    to = _frame(lon0, lat0)

    # --- street centreline: nearest segment of the named street gives bearing and offset -----
    segs = []
    for f in _layer("public-streets"):
        hb = f["properties"].get("hblock") or ""
        if street_name not in hb:
            continue
        for line in _lines(f["geometry"]):
            pts = [to(*c[:2]) for c in line]
            for a, b in zip(pts, pts[1:]):
                d, px, py = _nearest_on_segment(a, b)
                if d <= 60:
                    segs.append((d, a, b, px, py, hb))
    if not segs:
        raise BlockFaceError(f"{site_id}: no {street_name!r} centreline segment within 60 m (public-streets)")
    d_cl, a, b, px, py, hblock = min(segs, key=lambda s: s[0])
    bearing = math.atan2(b[1] - a[1], b[0] - a[0])
    if math.cos(bearing) < 0:
        bearing += math.pi
    ux, uy = math.cos(bearing), math.sin(bearing)
    # left normal of u; v is signed so that the property side is positive
    w = -px * uy + py * ux
    sign = -1.0 if w > 0 else 1.0

    def uv(x: float, y: float) -> Tuple[float, float]:
        return (x * ux + y * uy, sign * (-x * uy + y * ux))

    def uv_lonlat(lon: float, lat: float) -> Tuple[float, float]:
        return uv(*to(lon, lat))

    def xy(u: float, v: float) -> Tuple[float, float]:
        return (u * ux - sign * v * uy, u * uy + sign * v * ux)

    # --- property line on the property side: first polygon edge the property-ward ray crosses --
    # Block outlines and parcel polygons both carry the property line; the nearest hit wins and
    # the dataset that supplied it is recorded. The frontage extent (band ends) comes from the
    # block outline when the ray hits one within 15 m, otherwise from the chain of parcel
    # frontage edges through the tree.
    rings: List[Tuple[str, List[Tuple[float, float]]]] = []
    for dataset in ("block-outlines", "property-parcel-polygons"):
        for f in _layer(dataset):
            for ring in _rings(f["geometry"]):
                loc = [uv_lonlat(*c[:2]) for c in ring]
                if any(abs(u) <= 200 and abs(v) <= 200 for u, v in loc):
                    rings.append((dataset, loc))

    def pl_hit(u: float) -> Optional[Tuple[float, str, List[Tuple[float, float]]]]:
        best = None
        for dataset, loc in rings:
            for v in _vertical_hits(u, loc):
                if v > 0.1 and (best is None or v < best[0]):
                    best = (v, dataset, loc)
        return best

    hit = pl_hit(0.0)
    if hit is None:
        raise BlockFaceError(f"{site_id}: no block outline or parcel edge on the property side (layers not loaded?)")
    pl_at_tree, pl_dataset, pl_ring = hit
    block_ring = pl_ring if pl_dataset == "block-outlines" else None
    if block_ring is None:
        for dataset, loc in rings:
            if dataset == "block-outlines":
                hits = [v for v in _vertical_hits(0.0, loc) if v > 0.1]
                if hits and min(hits) < 15.0:
                    block_ring = loc
                    break
    if block_ring is not None:
        front = [(u, v) for u, v in block_ring if v <= pl_at_tree + FRONTAGE_TOLERANCE_M]
        u_from, u_to = min(u for u, _ in front), max(u for u, _ in front)
        frontage_source = "block-outlines"
    else:
        # chain of parcel frontage edges (both ends near the property-line offset) through the tree
        edges = []
        for dataset, loc in rings:
            if dataset != "property-parcel-polygons":
                continue
            for (u1, v1), (u2, v2) in zip(loc, loc[1:] + loc[:1]):
                if abs(v1 - pl_at_tree) <= FRONTAGE_TOLERANCE_M and abs(v2 - pl_at_tree) <= FRONTAGE_TOLERANCE_M \
                        and abs(u2 - u1) > 0.5:
                    edges.append((min(u1, u2), max(u1, u2)))
        edges.sort()
        u_from = u_to = 0.0
        changed = True
        while changed:
            changed = False
            for a, b in edges:
                if a <= u_to + 1.0 and b >= u_from - 1.0 and (a < u_from or b > u_to):
                    u_from, u_to = min(u_from, a), max(u_to, b)
                    changed = True
        if u_to - u_from < 5.0:
            raise BlockFaceError(f"{site_id}: could not chain parcel frontage edges into a block face")
        frontage_source = "property-parcel-polygons (chained frontage edges; block outline not found)"

    def pl_offset_at(u: float) -> Optional[float]:
        h = pl_hit(u)
        return h[0] if h else None

    # --- cross streets: other streets crossing the tree line just beyond the frontage ---------
    crossings = []
    for f in _layer("public-streets"):
        hb = f["properties"].get("hblock") or ""
        if street_name in hb:
            continue
        for line in _lines(f["geometry"]):
            loc = [uv_lonlat(*c[:2]) for c in line]
            for (u1, v1), (u2, v2) in zip(loc, loc[1:]):
                if (v1 > 0) != (v2 > 0) and abs(v2 - v1) > 1.0:
                    u = u1 + (0 - v1) * (u2 - u1) / (v2 - v1)
                    if u_from - 60 <= u <= u_to + 60:
                        crossings.append((u, hb))
    west = max((c for c in crossings if c[0] <= u_from), default=None, key=lambda c: c[0])
    east = min((c for c in crossings if c[0] >= u_to), default=None, key=lambda c: c[0])

    def cross_name(c):
        if c is None:
            return None
        parts = c[1].split(" ", 1)
        return {"hblock": c[1], "name": parts[1] if len(parts) == 2 and parts[0].isdigit() else c[1],
                "centreline_u": _r(c[0])}

    # --- trees on the same face (boulevard sites of the pilot dataset) -------------------------
    trees = []
    for e in _sites_doc(sites_path)["sites"]:
        r = e["record"]
        if r["tree_point"]["status"] != "KNOWN":
            continue
        u, v = uv_lonlat(*r["tree_point"]["value"]["coordinates"])
        if u_from - 0.5 <= u <= u_to + 0.5 and abs(v) <= TREE_LINE_TOLERANCE_M:
            trees.append({"site_id": r["site_id"], "tree_id": r["tree_id"]["value"], "u": _r(u), "v": _r(v),
                          "genus": r["genus"]["value"], "species": r["species"]["value"],
                          "cultivar": r["cultivar"]["value"], "install_date": r["install_date"]["value"],
                          "height_m": r["inventory_height"]["value"], "diameter_cm": r["inventory_diameter"]["value"],
                          "property_line_offset_m": _r(pl_offset_at(u)),
                          "dist_centreline_m": _r(d_cl + v)})
    trees.sort(key=lambda t: t["u"])
    if not any(t["site_id"] == site_id for t in trees):
        raise BlockFaceError(f"{site_id}: selected tree not found on its own face (frontage {u_from:.1f}..{u_to:.1f})")
    for i, t in enumerate(trees):
        t["gap_west_m"] = _r(t["u"] - trees[i - 1]["u"]) if i > 0 else None
        t["gap_east_m"] = _r(trees[i + 1]["u"] - t["u"]) if i + 1 < len(trees) else None
    gaps = [t["gap_east_m"] for t in trees if t["gap_east_m"] is not None]

    # --- right-of-way record: nearest City point on this street's centreline within the block --
    row = None
    for f in _layer("right-of-way-widths"):
        for c in _points(f["geometry"]):
            u, v = uv_lonlat(*c[:2])
            if u_from - 5 <= u <= u_to + 5 and abs(v + d_cl) <= 3.0:
                if row is None or abs(u) < abs(row["u"]):
                    wtxt = f["properties"].get("width")
                    # the City field is text: usually a bare number in feet ("66"), Downtown sometimes "20(m)"; read the number, keep the text
                    m_w = re.match(r"^\s*([0-9]+(?:\.[0-9]+)?)\s*(\(m\)|m)?", str(wtxt)) if wtxt not in (None, "") else None
                    row = {"width_as_published": wtxt, "unit_published": ("m" if (m_w and m_w.group(2)) else None),
                           "width_m_if_feet": (_r(float(m_w.group(1))) if m_w.group(2) else _r(float(m_w.group(1)) * 0.3048)) if m_w else None,
                           "u": _r(u), "v": _r(v),
                           "note": ("legal property-line-to-property-line width; NOT curb-to-curb, NOT boulevard "
                                    "width; unit not stated in City metadata (values read as feet)")}

    # --- utilities: six City layers, plan position only ----------------------------------------
    win = (u_from - UTILITY_WINDOW_MARGIN_M, u_to + UTILITY_WINDOW_MARGIN_M,
           -d_cl - 1.0, pl_at_tree + UTILITY_WINDOW_MARGIN_M)
    utilities = []
    keep_props = ("diameter_mm", "material", "installation_date", "effluent_type", "wireset_type")
    for dataset_id, kind in CITY_UTILITY_KINDS.items():
        n_in_files = 0
        for f in _layer(dataset_id):
            n_in_files += 1
            g = f["geometry"]
            parts = [[uv_lonlat(*c[:2]) for c in line] for line in _lines(g)] + \
                    [[uv_lonlat(*c[:2])] for c in _points(g)]
            for pts in parts:
                if not any(win[0] <= u <= win[1] and win[2] <= v <= win[3] for u, v in pts):
                    continue
                utilities.append({
                    "dataset": dataset_id, "kind": kind, "clearance_m": CLEARANCES.get(kind),
                    "geometry": "point" if len(pts) == 1 else "line",
                    "local_uv": [[_r(u), _r(v)] for u, v in pts],
                    "properties": {k: f["properties"].get(k) for k in keep_props if k in f["properties"]},
                    "provenance": "CITY_DATA",
                    "note": "plan position as published; depth not published; catch basins 'location approximate'",
                })
        if n_in_files == 0:
            utilities.append({"dataset": dataset_id, "kind": kind, "clearance_m": CLEARANCES.get(kind),
                              "geometry": None, "local_uv": None, "provenance": "UNKNOWN",
                              "note": "dataset not present under data/raw for this location; not fetched"})

    # --- curb hint: catch basins on this side sit at the curb / gutter ('location approximate')
    cb = [d_cl + u_v[1] for x in utilities if x["dataset"] == "sewer-catch-basins" and x["local_uv"]
          for u_v in x["local_uv"] if u_from <= u_v[0] <= u_to and abs(u_v[1]) <= 4.0]
    curb_hint = {"catch_basin_offsets_from_centreline_m": sorted(_r(x) for x in cb),
                 "note": ("City sewer-catch-basins on this face; the City labels them 'location approximate'. "
                          "A hint for the curb knob only; the curb line itself is not in City Open Data.")}

    return {
        "site_id": site_id,
        "street_name": street_name,
        "hblock": hblock,
        "side": cr.get("px_position_hint_geometric"),
        "frame": {"origin_lonlat": [lon0, lat0], "bearing_deg_from_east": _r(math.degrees(bearing)),
                  "along_unit_xy": [round(ux, 6), round(uy, 6)],
                  "property_unit_xy": [round(-sign * uy, 6), round(sign * ux, 6)],
                  "note": ("local equirectangular metres at the selected tree's City point; u along the street "
                           "(east-pointing), v across, positive toward the property; DERIVED_CALCULATION")},
        "tree": {"u": 0.0, "v": 0.0, "dist_centreline_m": _r(d_cl), "property_line_offset_m": _r(pl_at_tree),
                 "property_line_from_centreline_m": _r(d_cl + pl_at_tree)},
        "block": {"u_from": _r(u_from), "u_to": _r(u_to), "length_m": _r(u_to - u_from),
                  "cross_street_west": cross_name(west), "cross_street_east": cross_name(east),
                  "outline_local_uv": [[_r(u), _r(v)] for u, v in block_ring] if block_ring else None,
                  "frontage_source": frontage_source, "property_line_source": pl_dataset,
                  "note": ("frontage extent on the property side (block-outline vertices within "
                           f"{FRONTAGE_TOLERANCE_M} m of the property-line offset, or chained parcel frontage "
                           "edges); the band runs between these ends")},
        "trees": trees,
        "row": {"count": len(trees), "gap_min_m": _r(min(gaps)) if gaps else None,
                "gap_max_m": _r(max(gaps)) if gaps else None,
                "gap_median_m": _r(sorted(gaps)[len(gaps) // 2]) if gaps else None},
        "right_of_way": row,
        "utilities": utilities,
        "curb_hint": curb_hint,
        "sources": {
            "trees": "City of Vancouver Open Data public-trees (pilot extract, boulevard sites)",
            "centreline": "public-streets", "property_line": "block-outlines",
            "right_of_way": "right-of-way-widths", "utilities": sorted(CITY_UTILITY_KINDS),
            "provenance": "CITY_DATA read as published; every measured distance is DERIVED_CALCULATION; "
                          "curb line, sidewalk, soil and utility depth are NOT in City data",
        },
        "_uv": uv, "_xy": xy, "_uv_lonlat": uv_lonlat, "_pl_offset_at": pl_offset_at,
    }


def public_face(face: Dict[str, Any]) -> Dict[str, Any]:
    """The face without its callables (JSON-serialisable)."""
    return {k: v for k, v in face.items() if not k.startswith("_")}


# --------------------------------------------------------------------------
# 2. Apportion the band and apply utility interruptions
# --------------------------------------------------------------------------

def utility_strips(face: Dict[str, Any], band: Dict[str, float],
                   extra_utilities: Optional[List[Dict[str, Any]]] = None,
                   include_city: bool = True) -> List[Dict[str, Any]]:
    """
    Convert utilities into interruption strips in the band frame (R28).

    A strip is the bounding box, in (u, v), of the part of a utility that lies within the
    band expanded by its Table 2-2 clearance, grown by that clearance and cut back to the
    band. A strip that spans the full band width is a CROSSING (it splits the band); any
    other strip is PARTIAL (it removes width on its u-range, on the far side of the tree).
    A utility whose kind has no tree clearance in Table 2-2 (street-lighting poles) is
    listed with applied = False.
    """
    u0, u1, v0, v1 = band["u_from"], band["u_to"], band["v_from"], band["v_to"]
    items: List[Dict[str, Any]] = []
    if include_city:
        items.extend(face["utilities"])
    for x in extra_utilities or []:
        if x.get("provenance") not in DESIGNER_PROVENANCE:
            raise BlockFaceError(f"extra utility {x.get('label')!r}: provenance must be one of {DESIGNER_PROVENANCE}")
        if x.get("kind") not in CLEARANCES:
            raise BlockFaceError(f"extra utility {x.get('label')!r}: kind must be one of {sorted(CLEARANCES)}")
        pts = x.get("local_uv") or [list(face["_uv_lonlat"](*c)) for c in x.get("lonlat", [])]
        items.append({"dataset": x.get("label", "designer-entered utility"), "kind": x["kind"],
                      "clearance_m": CLEARANCES[x["kind"]], "geometry": "point" if len(pts) == 1 else "line",
                      "local_uv": [[float(u), float(v)] for u, v in pts], "properties": {},
                      "provenance": x["provenance"], "note": x.get("note", "")})
    strips = []

    def box(inside: List[Tuple[float, float]], c: float) -> Optional[Tuple[float, float, float, float]]:
        su0 = max(u0, min(u for u, _ in inside) - c)
        su1 = min(u1, max(u for u, _ in inside) + c)
        sv0 = max(v0, min(v for _, v in inside) - c)
        sv1 = min(v1, max(v for _, v in inside) + c)
        return None if (su1 <= su0 or sv1 <= sv0) else (su0, su1, sv0, sv1)

    for it in items:
        c = it.get("clearance_m")
        pts = it.get("local_uv")
        if not pts:
            continue
        base = {"dataset": it["dataset"], "kind": it["kind"], "clearance_m": c, "provenance": it["provenance"],
                "properties": it.get("properties", {})}
        if c is None:
            strips.append(dict(base, applied=False, reason="Table 2-2 gives no clearance from trees for this kind"))
            continue
        grown = (u0 - c, u1 + c, v0 - c, v1 + c)
        if len(pts) == 1:
            (pu, pv), = pts
            parts = [[(pu, pv)]] if grown[0] <= pu <= grown[1] and grown[2] <= pv <= grown[3] else []
        else:
            parts = []
            for a, b in zip(pts, pts[1:]):
                seg = _clip_segment(tuple(a), tuple(b), grown)
                if seg:
                    parts.append(list(seg))
        inside = [p for part in parts for p in part]
        if not inside:
            strips.append(dict(base, applied=False, reason="outside the band and its clearance zone"))
            continue
        whole = box(inside, c)
        if whole is None:
            strips.append(dict(base, applied=False, reason="clearance zone does not overlap the band"))
            continue
        # crossing: the whole feature's clearance zone spans the band width -> one strip splits the band
        if whole[2] <= v0 + 1e-9 and whole[3] >= v1 - 1e-9:
            strips.append(dict(base, applied=True, type="crossing", u0=_r(whole[0]), u1=_r(whole[1]),
                               v0=_r(whole[2]), v1=_r(whole[3]),
                               reason="clearance zone spans the full band width: the band is split here"))
            continue
        # partial: one strip per segment, so the zone follows the pipe instead of its whole bounding box
        for part in parts:
            b = box(part, c)
            if b is None:
                continue
            strips.append(dict(base, applied=True, type="partial", u0=_r(b[0]), u1=_r(b[1]), v0=_r(b[2]), v1=_r(b[3]),
                               reason="removes band width on its u-range; soil beyond it counts only if still "
                                      "connected to the tree inside its cell"))
    return strips


def _segments(band: Dict[str, float], strips: List[Dict[str, Any]]) -> List[Dict[str, float]]:
    cuts = sorted((s["u0"], s["u1"]) for s in strips if s.get("applied") and s["type"] == "crossing")
    segs, cur = [], band["u_from"]
    for a, b in cuts:
        if a > cur:
            segs.append({"u_from": _r(cur), "u_to": _r(a)})
        cur = max(cur, b)
    if band["u_to"] > cur:
        segs.append({"u_from": _r(cur), "u_to": _r(band["u_to"])})
    return segs


def _free_intervals(v0: float, v1: float, blocks: List[Tuple[float, float]]) -> List[Tuple[float, float]]:
    """[v0, v1] minus the union of `blocks`, as a sorted list of open intervals with positive length."""
    out, cur = [], v0
    for a, b in sorted(blocks):
        if a > cur:
            out.append((cur, min(a, v1)))
        cur = max(cur, b)
        if cur >= v1:
            break
    if cur < v1:
        out.append((cur, v1))
    return [(a, b) for a, b in out if b - a > 1e-9]


def _pieces(cell_u0: float, cell_u1: float, v0: float, v1: float, u_tree: float, v_tree: float,
            strips: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], bool]:
    """
    Usable soil per u-piece of a tree's cell (R28). The cell is cut at every strip edge; in each
    piece the free v-intervals are the band minus the strips active there. Soil counts only if it
    is CONNECTED to the tree's own position without crossing a strip, inside the cell (GRI p.18:
    "directly adjacent to the tree and not interrupted"). Returns (pieces, conflict) where
    conflict is True when the tree point itself lies inside a strip.
    """
    conflict = any(s["u0"] <= u_tree <= s["u1"] and s["v0"] <= v_tree <= s["v1"] for s in strips)
    breaks = {cell_u0, cell_u1}
    for s in strips:
        for x in (s["u0"], s["u1"]):
            if cell_u0 < x < cell_u1:
                breaks.add(x)
    bs = sorted(breaks)
    pieces = []
    for a, b in zip(bs, bs[1:]):
        mid = (a + b) / 2
        active = [s for s in strips if s["u0"] <= mid <= s["u1"]]
        pieces.append({"u0": a, "u1": b, "free": _free_intervals(v0, v1, [(s["v0"], s["v1"]) for s in active]),
                       "strips": sorted({s["dataset"] for s in active})})
    # flood fill from the tree's own interval across adjacent pieces with overlapping free intervals
    reached = set()
    start = next((i for i, p in enumerate(pieces) if p["u0"] <= u_tree <= p["u1"]), None)
    if start is not None and not conflict:
        j0 = next((j for j, (lo, hi) in enumerate(pieces[start]["free"]) if lo - 1e-9 <= v_tree <= hi + 1e-9), None)
        if j0 is not None:
            frontier = [(start, j0)]
            reached.add((start, j0))
            while frontier:
                i, j = frontier.pop()
                lo, hi = pieces[i]["free"][j]
                for k in (i - 1, i + 1):
                    if 0 <= k < len(pieces):
                        for m, (lo2, hi2) in enumerate(pieces[k]["free"]):
                            if (k, m) not in reached and min(hi, hi2) - max(lo, lo2) > 1e-9:
                                reached.add((k, m))
                                frontier.append((k, m))
    out = []
    for i, p in enumerate(pieces):
        usable = [(lo, hi) for j, (lo, hi) in enumerate(p["free"]) if (i, j) in reached]
        width = sum(hi - lo for lo, hi in usable)
        out.append({"u0": _r(p["u0"]), "u1": _r(p["u1"]), "usable_v": [[_r(lo), _r(hi)] for lo, hi in usable],
                    "width_m": _r(width), "area_m2": round((p["u1"] - p["u0"]) * width, 4), "strips": p["strips"],
                    "disconnected_v": [[_r(lo), _r(hi)] for j, (lo, hi) in enumerate(p["free"]) if (i, j) not in reached]})
    return out, conflict


def apportion(face: Dict[str, Any], band: Dict[str, float], strips: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    R26 + R28: per-tree cells on the band. Tributary length = from the midpoint to the west
    neighbour (or the segment end) to the midpoint to the east neighbour (or the segment end).
    Crossing strips split the band into segments first; partial strips then remove width.
    """
    segs = _segments(band, strips)
    applied = [s for s in strips if s.get("applied")]
    partial = [s for s in applied if s["type"] == "partial"]
    crossing = [s for s in applied if s["type"] == "crossing"]
    cells = {}
    width = _r(band["v_to"] - band["v_from"])
    for seg in segs:
        inseg = [t for t in face["trees"] if seg["u_from"] <= t["u"] <= seg["u_to"]]
        for i, t in enumerate(inseg):
            u = t["u"]
            inner_w = (u - inseg[i - 1]["u"]) / 2 if i > 0 else None
            inner_e = (inseg[i + 1]["u"] - u) / 2 if i + 1 < len(inseg) else None
            # end-of-row cells are symmetric: the outer half equals the inner half, cut back to the
            # segment end when that is nearer; a lone tree is symmetric to the nearer segment end
            if inner_w is None and inner_e is None:
                half = min(u - seg["u_from"], seg["u_to"] - u)
                left, right = u - half, u + half
            else:
                left = u - inner_w if inner_w is not None else max(seg["u_from"], u - inner_e)
                right = u + inner_e if inner_e is not None else min(seg["u_to"], u + inner_w)
            outside = not (band["v_from"] - 1e-9 <= t["v"] <= band["v_to"] + 1e-9)
            pieces, conflict = _pieces(left, right, band["v_from"], band["v_to"], u, t["v"], applied)
            area = round(sum(p["area_m2"] for p in pieces), 4)
            cells[t["site_id"]] = {
                "segment": seg, "u_from": _r(left), "u_to": _r(right), "spacing_m": _r(right - left),
                "band_width_m": width, "pieces": pieces,
                "usable_area_m2": None if (conflict or outside) else area,
                "utility_conflict_at_tree": conflict, "tree_outside_band": outside,
                "interrupted": any(p["strips"] for p in pieces),
                "end_of_row": inner_w is None or inner_e is None,
                "note": ("tree lies inside a utility clearance strip; share not computed (REVIEW_REQUIRED)" if conflict
                         else "tree point lies outside the band; share not computed (REVIEW_REQUIRED)" if outside
                         else "usable area = Σ piece length × usable width, counting only soil connected to the tree"),
            }
    for t in face["trees"]:
        if t["site_id"] not in cells:
            cells[t["site_id"]] = {"segment": None, "u_from": None, "u_to": None, "spacing_m": None,
                                   "band_width_m": width, "pieces": [],
                                   "usable_area_m2": None, "utility_conflict_at_tree": True, "tree_outside_band": False,
                                   "interrupted": True, "end_of_row": False,
                                   "note": "tree lies inside a crossing clearance strip; share not computed (REVIEW_REQUIRED)"}
    return {"band": band, "segments": segs, "strips": strips, "crossing_count": len(crossing),
            "partial_count": len(partial), "cells": cells}


# --------------------------------------------------------------------------
# 3. Evaluate: records + rule engine
# --------------------------------------------------------------------------

def _designer_field(name: str, spec: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Existing-state designer input in two grades; CONFIRMED_SITE_DATA needs an evidence reference."""
    if spec is None or spec.get("value") is None:
        return unknown_field()
    prov = spec.get("provenance")
    if prov not in DESIGNER_PROVENANCE:
        raise BlockFaceError(f"existing {name}: provenance must be one of {DESIGNER_PROVENANCE}, got {prov!r}")
    if prov == "CONFIRMED_SITE_DATA" and not spec.get("evidence"):
        raise BlockFaceError(f"existing {name}: CONFIRMED_SITE_DATA requires an evidence reference")
    return known_field(spec["value"], prov)


def _trace(rule: Dict[str, Any], inputs: Dict[str, Any], note: str, depends: bool,
           also: Optional[List[str]] = None, formula: Optional[str] = None) -> Dict[str, Any]:
    return {"rule_id": rule["rule_id"], "operation": rule.get("operation"), "formula": formula or rule.get("formula"),
            "inputs": inputs, "source_reference": rule.get("source_reference"),
            "depends_on_design_assumption": depends, "note": note, "also_applied": also or []}


def _tree_record(face: Dict[str, Any], tree: Dict[str, Any], cell: Dict[str, Any], band: Dict[str, Any],
                 depth: Dict[str, Any], soil_type: Dict[str, Any], target: Dict[str, Any],
                 state: str, sites_path: pathlib.Path, replacement: bool = False) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    base = si.load_site_record(tree["site_id"], sites_path)["record"]
    rec = copy.deepcopy(base)
    pre: Dict[str, Any] = {}
    if replacement and state == "design":
        rec["site_state"] = known_field("vacant_replacement", "DESIGN_ASSUMPTION")
        pre["site_state"] = _trace(R31, {"assumed": "vacant_replacement"},
                                   "design as a NEW tree at this position (R08/R09 eligibility); the City tree that stands here is not judged", True)
    depends = any(f["provenance"] == "DESIGN_ASSUMPTION" for f in (depth, soil_type, band["provenance_field"]))
    n = len(face["trees"])
    rec["planting_condition"] = derived_field("shared_row" if n >= 2 else "solitary")
    pre["planting_condition"] = _trace(R26, {"trees_on_face": n}, "block-face mode: trees on one continuous band "
                                       "are a row (shared_row); a lone tree on its face is solitary", False)
    width = cell["band_width_m"]
    rec["boulevard_width_m"] = derived_field(width)
    pre["boulevard_width_m"] = _trace(R30 if band["kind"] == "design" else R26, {
        "property_line_offset_m": {"value": face["tree"]["property_line_offset_m"], "provenance": "DERIVED_CALCULATION",
                                   "source": face["block"]["property_line_source"]},
        "band_edge": band["edge_description"],
        "band_edge_provenance": band["provenance_field"]["provenance"],
        **band.get("width_inputs", {})}, band["width_note"], depends,
        also=["R26"] if band["kind"] == "design" else [],
        formula=(R30["formula"] if band["kind"] == "design" else
                 "boulevard_width_m = existing open-strip width (designer input)"))
    if cell["usable_area_m2"] is None:
        rec["soil_area_m2"] = field(None, "DERIVED_CALCULATION", "REVIEW_REQUIRED")
        if cell["utility_conflict_at_tree"]:
            rec["utility_conflict"] = field("conflict_confirmed", "DERIVED_CALCULATION", "REVIEW_REQUIRED")
            pre["utility_conflict"] = _trace(R28, {"strips_at_tree": [p["strips"] for p in cell["pieces"]]},
                                             "tree point lies within a Table 2-2 clearance of a utility (City plan "
                                             "position, approximate; depth unknown); share not computed", depends)
        note = cell["note"]
    else:
        rec["soil_area_m2"] = derived_field(cell["usable_area_m2"])
        note = (f"per-tree cell u {cell['u_from']}..{cell['u_to']} (tributary length {cell['spacing_m']} m) × "
                f"usable band width; " + ("interrupted by utility clearance strips (R28)" if cell["interrupted"]
                                          else "no utility interruption within the band (R28 checked)"))
    pre["soil_area_m2"] = _trace(R26, {
        "spacing_m": {"value": cell["spacing_m"], "provenance": "DERIVED_CALCULATION", "source": "public-trees"},
        "band_width_m": {"value": width, "provenance": "DERIVED_CALCULATION"},
        "pieces": cell["pieces"], "segment": cell["segment"]}, note, depends,
        also=["R28"] + (["R29"] if state == "existing" else []),
        formula="soil_area_m2 = Σ (piece length × usable width) over the tree's cell")
    rec["soil_depth_m"] = depth
    rec["soil_type"] = soil_type
    rec["target_tree_class"] = target
    assert_valid_record(rec)
    return rec, pre


def _summary(env: Dict[str, Any], cell: Dict[str, Any]) -> Dict[str, Any]:
    rec = env["record"]
    g = lambda n: rec.get(n) or unknown_field()  # noqa: E731
    cred, req, gap = g("credited_soil_volume_m3"), g("required_soil_volume_m3"), g("soil_volume_gap_m3")
    r08 = [w for w in env["warnings"] if w["rule_id"] in ("R08", "R09") and w.get("level") == "restriction"]
    conflict = bool(cell.get("utility_conflict_at_tree")) or bool(cell.get("tree_outside_band"))
    return {
        "planting_condition": g("planting_condition")["value"],
        "utility_conflict_at_tree": bool(cell.get("utility_conflict_at_tree")),
        "tree_outside_band": bool(cell.get("tree_outside_band")),
        "spacing_m": cell["spacing_m"], "band_width_m": cell["band_width_m"],
        "soil_area_m2": g("soil_area_m2")["value"], "soil_depth_m": g("soil_depth_m")["value"],
        "soil_type": g("soil_type")["value"],
        "physical_soil_volume_m3": g("physical_soil_volume_m3")["value"],
        "share_m3": cred["value"] if cred["status"] == "KNOWN" else None,
        "share_status": "REVIEW_REQUIRED" if conflict else cred["status"], "share_provenance": cred["provenance"],
        "required_m3": req["value"], "gap_m3": gap["value"] if gap["status"] == "KNOWN" else None,
        "gap_status": "REVIEW_REQUIRED" if conflict else gap["status"],
        "benchmark_classes": (g("soil_volume_benchmark_classes")["value"]
                              if g("soil_volume_benchmark_classes")["status"] == "KNOWN" else None),
        "refused": [w["message"] for w in r08],
        "missing_inputs": env["missing_inputs"],
        "unresolved": [u["rule_id"] for u in env["unresolved"]],
        "depends_on_design_assumption": any(t.get("depends_on_design_assumption") for t in env["trace"].values()),
    }


def _share_at_table_spacing(env: Dict[str, Any], cell: Dict[str, Any]) -> Dict[str, Any]:
    """
    R02 reference (round 10, step 5): the share the SAME band (same usable width, depth and credit factor) would give
    if the trees stood at the Table 9-2 average-spacing LOWER BOUND for the target class (Medium 8.0 m, not the
    9.0 m mid-point). R02 is reference_only in 06_rules.json, so this is DERIVED_CALCULATION reference information,
    not a judgement; the measured spacing stays the one that counts.
    """
    rec = env["record"]
    cred = rec.get("credited_soil_volume_m3") or unknown_field()
    cls = (rec.get("target_tree_class") or {}).get("value")
    rng = (engine.RULE_INDEX["R02"].get("reference_table_m") or {}).get(cls) if cls else None
    depth = (rec.get("soil_depth_m") or {}).get("value")
    phys = (rec.get("physical_soil_volume_m3") or {}).get("value")
    out = {
        "value": None, "status": "UNKNOWN", "provenance": "DERIVED_CALCULATION",
        "rule": "R02", "rule_status": engine.RULE_INDEX["R02"]["status"],
        "target_tree_class": cls,
        "table_9_2_spacing_range_m": [rng["min"], rng["max"]] if rng else None,
        "spacing_used_m": rng["min"] if rng else None,
        "spacing_bound": "min",
        "measured_spacing_m": cell.get("spacing_m"),
        "note": ("R02 reference, not a judgement: the same band width x depth x credit factor at the Table 9-2 LOWER spacing bound "
                 "for the target class (the lower bound, not the 9.0 m mid-point); the measured spacing is what the share uses"),
        "formula": "share_at_table_spacing = credit_factor x usable_width x depth x spacing_min",
    }
    if not rng or cred["status"] != "KNOWN" or cred["value"] is None or not cell.get("spacing_m") or not phys or depth is None:
        out["reason"] = "needs a KNOWN share, a Table 9-2 class range, a depth and a measured spacing"
        return out
    factor = cred["value"] / phys
    usable_w = cell["usable_area_m2"] / cell["spacing_m"]
    out["credit_factor"] = _r(factor, 4)
    out["usable_width_m"] = _r(usable_w, 3)
    out["value"] = _r(factor * usable_w * depth * rng["min"])
    out["status"] = "KNOWN"
    return out


def _what_closes_the_gap(env: Dict[str, Any], cell: Dict[str, Any], face: Dict[str, Any],
                         band: Dict[str, Any]) -> Dict[str, Any]:
    """Which knob, changed by how much, would meet the selected benchmark (arithmetic inversion only)."""
    rec = env["record"]
    req = (rec.get("required_soil_volume_m3") or {}).get("value")
    cred = rec.get("credited_soil_volume_m3") or unknown_field()
    depth = (rec.get("soil_depth_m") or {}).get("value")
    if req is None or cred["status"] != "KNOWN" or cred["value"] is None or not cell["spacing_m"]:
        return {"available": False, "reason": "needs a KNOWN credited share, a Table 9-2 benchmark and a spacing"}
    factor = cred["value"] / rec["physical_soil_volume_m3"]["value"] if rec["physical_soil_volume_m3"]["value"] else None
    usable_w = cell["usable_area_m2"] / cell["spacing_m"]           # mean usable width over the cell
    depth_needed = req / (factor * usable_w * cell["spacing_m"]) if factor and usable_w else None
    width_needed = req / (factor * depth * cell["spacing_m"]) if factor and depth else None
    pl_from_cl = face["tree"]["property_line_from_centreline_m"]
    wi = band.get("width_inputs", {})
    fixed = (wi.get("sidewalk_clear_width_m", {}).get("value", 0) + wi.get("back_boulevard_width_m", {}).get("value", 0)
             + wi.get("curb_width_m", {}).get("value", 0))          # widths between the band and the property line / curb face (R30)
    out = {
        "available": True,
        "benchmark_m3": req, "share_m3": cred["value"], "gap_m3": _r(cred["value"] - req),
        "credit_factor": factor,
        "spacing_m": cell["spacing_m"], "spacing_note": "measured; not a knob",
        "soil_depth_to_meet_m": _r(depth_needed, 3),
        "soil_depth_change_m": _r(depth_needed - depth, 3) if depth_needed is not None else None,
        "usable_band_width_to_meet_m": _r(width_needed, 3),
        "band_width_change_m": _r(width_needed - usable_w, 3) if width_needed is not None else None,
        "curb_offset_from_centreline_to_meet_m": (_r(pl_from_cl - fixed - width_needed, 3)
                                                  if width_needed is not None and band["kind"] == "design" and not cell["interrupted"] else None),
        "at_full_credit_share_m3": _r(rec["physical_soil_volume_m3"]["value"]) if factor and factor < 1 else None,
        "formulas": {
            "share": "share = credit_factor × usable_area × depth (R05, R06/R07)",
            "depth_to_meet": "depth = benchmark / (credit_factor × usable_width × spacing)",
            "width_to_meet": "usable_width = benchmark / (credit_factor × depth × spacing)",
            "curb_to_meet": "curb_offset = property_line_from_centreline - (sidewalk + back boulevard + curb, R30) - usable_width (only when no strip interrupts)",
        },
        "note": ("arithmetic inversion of the Table 9-2 comparison; a design exploration prompt (R22), "
                 "not a City requirement"),
    }
    return out


def front_boulevard(face: Dict[str, Any], curb_offset_from_centreline_m: float, land_use: str,
                    width_level: str) -> Dict[str, Any]:
    """
    R30: the design band is the FRONT BOULEVARD (EDM §8.4.6): from the back of curb to the
    sidewalk. Its width = (property line − curb face) − sidewalk clear width (Table 8-3, land-use
    row chosen by the user) − back boulevard (Table 8-4) − 0.15 m curb (Table 8-4 note 7).
    Returns the band edges in the tree frame and every width with its source.
    """
    if land_use not in LAND_USES:
        raise BlockFaceError(f"land_use must be one of {LAND_USES} (Table 8-3 rows); got {land_use!r}")
    if width_level not in WIDTH_LEVELS:
        raise BlockFaceError(f"width_level must be one of {WIDTH_LEVELS}; got {width_level!r}")
    row84 = R30["land_use_rows"][land_use]["table_8_4"]
    sidewalk = R30["sidewalk_clear_width_m"][land_use][width_level]
    back = R30["back_boulevard_width_m"][row84][width_level]
    curb_w = R30["curb_width_m"]
    d_cl = face["tree"]["dist_centreline_m"]
    pl = face["tree"]["property_line_offset_m"]
    curb_face = -(d_cl - float(curb_offset_from_centreline_m))          # v of the curb face
    if sidewalk is None:
        return {"available": False, "reason": R30["sidewalk_clear_width_m"][land_use].get("preferred_note", "table value not given"),
                "land_use": land_use, "width_level": width_level}
    v_from = curb_face + curb_w                                            # back of curb
    v_to = pl - back - sidewalk                                            # sidewalk edge (road side)
    width = round(v_to - v_from, 2)
    ref = R30["front_boulevard_reference_m"][row84]
    return {
        "available": True, "land_use": land_use, "table_8_3_row": R30["land_use_rows"][land_use]["table_8_3"],
        "table_8_4_row": row84, "width_level": width_level,
        "curb_face_v": _r(curb_face), "back_of_curb_v": _r(v_from), "sidewalk_road_edge_v": _r(v_to),
        "sidewalk_property_edge_v": _r(pl - back), "property_line_v": pl,
        "widths_m": {"property_line_to_curb_face": _r(pl - curb_face), "curb": curb_w, "sidewalk_clear": sidewalk,
                     "back_boulevard": back, "front_boulevard": width},
        "sources": {"curb": "EDM 2026 Table 8-4 note 7 p.256 (0.15 m)",
                    "sidewalk_clear": f"EDM 2026 Table 8-3 p.253, row '{R30['land_use_rows'][land_use]['table_8_3']}', {width_level}",
                    "back_boulevard": f"EDM 2026 Table 8-4 p.255, row '{row84}', {width_level}",
                    "front_boulevard": "derived (R30); composition is a PROJECT_INTERPRETATION"},
        "front_boulevard_reference_m": {k: ref[k] for k in WIDTH_LEVELS},
        "reference_note": (f"Table 8-4 front boulevard, {row84}: constrained {ref['constrained']} · minimum {ref['minimum']} · "
                           f"preferred {ref.get('preferred_note', ref['preferred'])} m; derived front boulevard here {width} m "
                           "(reference information, no verdict)"),
        "width_note": ("design band = front boulevard (EDM §8.4.6 p.255: between back of curb and sidewalk); "
                       f"width = (P/L − curb face {_r(pl - curb_face)}) − sidewalk {sidewalk} − back boulevard {back} − curb {curb_w} = {width} m; "
                       f"land use '{land_use}' chosen by the user, level '{width_level}'"),
    }


def evaluate_block_face(face: Dict[str, Any],
                        curb_offset_from_centreline_m: Optional[float],
                        soil_depth_m: Optional[float],
                        target_tree_class: Optional[str],
                        soil_type: Optional[str],
                        land_use: Optional[str] = None,
                        width_level: Optional[str] = None,
                        knob_provenance: str = "DESIGN_ASSUMPTION",
                        existing: Optional[Dict[str, Any]] = None,
                        extra_utilities: Optional[List[Dict[str, Any]]] = None,
                        include_city_utilities: bool = True,
                        sites_path: pathlib.Path = si.SITES_PATH,
                        extensions: Optional[List[Dict[str, Any]]] = None,
                        replacement: bool = False,
                        curb_provenance: Optional[str] = None,
                        curb_evidence: Optional[str] = None) -> Dict[str, Any]:
    """
    Evaluate the face in two states.

    curb_provenance / curb_evidence   the curb face is a site fact the City does not publish, so by default it carries the
             knob provenance (DESIGN_ASSUMPTION). A measured value is passed with curb_provenance CONFIRMED_SITE_DATA and
             an evidence reference (required); the band and every street edge derived from the curb inherit that grade.

    extensions   R31 (phase 3, 11_redefinition §8): zones of engineered soil the designer draws
                 beyond the front boulevard, each {"side": "property" | "road", "width_m", "soil_type",
                 "provenance", "depth_m" (optional, default = the design depth), "evidence" (needed for
                 CONFIRMED_SITE_DATA)}. "property" extends under the sidewalk toward the property line,
                 "road" under the curb and parking lane toward the centreline. Soil in a zone counts only
                 where it stays connected to the tree's cell (GRI p.18), with the crediting of its own
                 soil type: native soil under hardscape only when CONFIRMED_SITE_DATA (tested, R29),
                 structural soil 50 % (R06) and only for a new tree (R08), soil cells never yield a
                 number (R11, manual conditions R10). Zone shares are added to the band share (R31,
                 PROJECT_INTERPRETATION).
    replacement  design the position as a NEW tree (site_state vacant_replacement, DESIGN_ASSUMPTION)
                 instead of the existing one; this is what makes structural soil eligible (R08/R09).

    design   the four knobs: curb offset from the centreline, soil depth, target class, soil
             type, plus the land-use category (a Table 8-3 row, chosen by the user, not a
             numeric knob) and the width level (constrained / minimum / preferred, default
             minimum). The band is the front boulevard of R30. Knob provenance
             DESIGN_ASSUMPTION (default) or USER_INPUT. A missing knob stays UNKNOWN and the
             result says what is missing.
    existing designer inputs in two grades for the existing open planting strip: soil_width_m,
             soil_depth_m, soil_type (USER_INPUT = typed, or CONFIRMED_SITE_DATA + evidence),
             plus an optional utility_note. Default when nothing is supplied: GRI p.18 — only
             the open strip counts and its depth is UNKNOWN, so the existing share is UNKNOWN.

    City utilities interrupt both states; `extra_utilities` adds designer-entered ones.
    """
    if knob_provenance not in KNOB_PROVENANCE:
        raise BlockFaceError(f"knob_provenance must be one of {KNOB_PROVENANCE}")
    curb_prov = curb_provenance or knob_provenance
    if curb_prov not in CURB_PROVENANCE:
        raise BlockFaceError(f"curb_provenance must be one of {CURB_PROVENANCE}")
    if curb_prov == "CONFIRMED_SITE_DATA" and not curb_evidence:
        raise BlockFaceError("curb_provenance CONFIRMED_SITE_DATA requires an evidence reference (curb_evidence)")
    if target_tree_class is None:
        raise BlockFaceError("target_tree_class is required (Table 9-2 category chosen by the designer; not inferred)")
    target = known_field(target_tree_class, "USER_INPUT")
    pl = face["tree"]["property_line_offset_m"]
    d_cl = face["tree"]["dist_centreline_m"]
    level = width_level or R30["default_width_level"]
    knobs = {
        "curb_offset_from_centreline_m": {"value": curb_offset_from_centreline_m, "provenance": curb_prov,
                                          "evidence": curb_evidence, "hint": face["curb_hint"],
                                          "note": "a site fact the City does not publish: DESIGN_ASSUMPTION until a measurement with evidence confirms it"},
        "soil_depth_m": {"value": soil_depth_m, "provenance": knob_provenance},
        "target_tree_class": {"value": target_tree_class, "provenance": "USER_INPUT"},
        "soil_type": {"value": soil_type, "provenance": knob_provenance},
        "spacing": "measured from City tree points; not editable",
        "land_use": {"value": land_use, "provenance": "SOURCE_RULE",
                     "note": "Table 8-3 row chosen by the user (R30); a category, not a numeric knob", "options": list(LAND_USES)},
        "width_level": {"value": level, "provenance": "SOURCE_RULE",
                        "note": "Table 8-3 / 8-4 column applied to sidewalk and back boulevard; default 'minimum'", "options": list(WIDTH_LEVELS)},
        "extensions": {"value": _validate_extensions(extensions), "provenance": "USER_INPUT",
                       "note": "R31 engineered-soil zones beyond the front boulevard (fifth lever); each zone carries its own soil type and provenance"},
        "tree_state": {"value": "vacant_replacement" if replacement else "existing_tree",
                       "provenance": "DESIGN_ASSUMPTION" if replacement else "DERIVED_CALCULATION",
                       "note": "existing tree = the City tree as it stands (R20 benchmark); vacant_replacement = a new tree assumed at this position (R08/R09 eligibility)"},
    }
    result: Dict[str, Any] = {"site_id": face["site_id"], "face": public_face(face), "knobs": knobs,
                              "notes": list(R26.get("guardrails", [])) + list(R28.get("guardrails", [])) + list(R30.get("guardrails", []))}

    # ---- design state --------------------------------------------------------------------
    missing = [n for n, v in (("curb_offset_from_centreline_m", curb_offset_from_centreline_m), ("land_use", land_use)) if v is None]
    if missing:
        result["design"] = {"available": False, "missing": missing,
                            "note": "the curb line is not in City data and the land use is a user choice; both are needed to define the front boulevard"}
    else:
        fb = front_boulevard(face, curb_offset_from_centreline_m, land_use, level)
        if not fb["available"]:
            result["design"] = {"available": False, "missing": ["sidewalk clear width"], "front_boulevard": fb,
                                "note": f"Table 8-3 gives no number for this row / level: {fb['reason']}"}
        else:
            if fb["widths_m"]["front_boulevard"] <= 0:
                result["design"] = {"available": False, "missing": [], "front_boulevard": fb,
                                    "note": (f"front boulevard width {fb['widths_m']['front_boulevard']} m at this curb position and land use: "
                                             "no band; move the curb toward the centreline or choose another row / level")}
                result["existing"] = _existing_state(face, existing, target, extra_utilities, include_city_utilities, sites_path)
                return result
            band = {"kind": "design", "u_from": face["block"]["u_from"], "u_to": face["block"]["u_to"],
                    "v_from": fb["back_of_curb_v"], "v_to": fb["sidewalk_road_edge_v"],
                    "edge_description": (f"back of curb (curb face at {curb_offset_from_centreline_m} m from the centreline, knob, + 0.15 m curb) "
                                         f"to the sidewalk edge (P/L − back boulevard {fb['widths_m']['back_boulevard']} − sidewalk {fb['widths_m']['sidewalk_clear']})"),
                    "provenance_field": field(curb_offset_from_centreline_m, curb_prov, "KNOWN"),
                    "width_inputs": {"sidewalk_clear_width_m": {"value": fb["widths_m"]["sidewalk_clear"], "provenance": "SOURCE_RULE", "source": fb["sources"]["sidewalk_clear"]},
                                     "back_boulevard_width_m": {"value": fb["widths_m"]["back_boulevard"], "provenance": "SOURCE_RULE", "source": fb["sources"]["back_boulevard"]},
                                     "curb_width_m": {"value": fb["widths_m"]["curb"], "provenance": "SOURCE_RULE", "source": fb["sources"]["curb"]},
                                     "land_use": land_use, "width_level": level},
                    "width_note": fb["width_note"]}
            result["design"] = _evaluate_state(face, band, soil_depth_m, soil_type, knob_provenance, target,
                                               extra_utilities, include_city_utilities, sites_path, "design",
                                               extensions=knobs["extensions"]["value"], replacement=replacement)
            result["design"]["front_boulevard"] = fb
    result["existing"] = _existing_state(face, existing, target, extra_utilities, include_city_utilities, sites_path)
    return result


def _existing_state(face, existing, target, extra_utilities, include_city_utilities, sites_path) -> Dict[str, Any]:
    pl = face["tree"]["property_line_offset_m"]

    # ---- existing state (GRI p.18 default; designer inputs in two grades) ------------------
    ex = existing or {}
    width_f = _designer_field("soil_width_m", ex.get("soil_width_m"))
    depth_f = _designer_field("soil_depth_m", ex.get("soil_depth_m"))
    type_f = _designer_field("soil_type", ex.get("soil_type"))
    exist: Dict[str, Any] = {
        "default": R29["notes"], "inputs": {"soil_width_m": width_f, "soil_depth_m": depth_f, "soil_type": type_f},
        "utility_note": ({"value": ex["utility_note"], "provenance": "USER_INPUT", "status": "REVIEW_REQUIRED"}
                         if ex.get("utility_note") else None),
        "grade": ("evidenced (solid)" if all(f["provenance"] == "CONFIRMED_SITE_DATA" for f in (width_f, depth_f, type_f))
                  else "typed, no evidence (hatched)" if any(f["status"] == "KNOWN" for f in (width_f, depth_f, type_f))
                  else "nothing supplied"),
    }
    if width_f["status"] != "KNOWN":
        exist.update({"available": False, "missing": [n for n, f in (("existing soil_width_m", width_f),
                                                                     ("existing soil_depth_m", depth_f),
                                                                     ("existing soil_type", type_f)) if f["status"] != "KNOWN"],
                      "share": unknown_field(),
                      "note": "existing open-strip width not supplied; existing share stays UNKNOWN (no default strip)"})
    else:
        w = float(width_f["value"])
        band = {"kind": "existing", "u_from": face["block"]["u_from"], "u_to": face["block"]["u_to"],
                "v_from": _r(-w / 2), "v_to": _r(w / 2),
                "edge_description": f"open planting strip {w} m wide, drawn centred on the tree line (nominal position)",
                "provenance_field": width_f,
                "width_note": ("existing credit default (R29, GRI p.18): only the open planting strip counts; "
                               "soil under hardscape is excluded unless tested; strip drawn centred on the tree line")}
        exist.update(_evaluate_state(face, band, depth_f["value"], type_f["value"], None, target, extra_utilities,
                                     include_city_utilities, sites_path, "existing",
                                     depth_field=depth_f, type_field=type_f))
    return exist


def _evaluate_state(face, band, depth_value, type_value, knob_provenance, target, extra_utilities, include_city,
                    sites_path, state, depth_field=None, type_field=None, extensions=None, replacement=False) -> Dict[str, Any]:
    strips = utility_strips(face, band, extra_utilities, include_city)
    app = apportion(face, band, strips)
    depth = depth_field or (known_field(depth_value, knob_provenance) if depth_value is not None else unknown_field())
    stype = type_field or (known_field(type_value, knob_provenance) if type_value is not None else unknown_field())
    ext = _extension_setup(face, band, extensions, extra_utilities, include_city) if extensions else None
    trees_out, envs = [], {}
    for t in face["trees"]:
        cell = app["cells"][t["site_id"]]
        rec, pre = _tree_record(face, t, cell, band, depth, stype, target, state, sites_path, replacement)
        env = engine.evaluate_site(rec, pre_trace=pre)
        envs[t["site_id"]] = env
        s = _summary(env, cell)
        s.update({"site_id": t["site_id"], "u": t["u"], "height_m": t["height_m"], "genus": t["genus"],
                  "cell": {k: cell[k] for k in ("u_from", "u_to", "segment", "interrupted", "utility_conflict_at_tree")}})
        if ext:
            s["extensions"] = _extension_shares(face, t, cell, ext, env, depth, target, state, sites_path, replacement)
        trees_out.append(s)
    sel_id = face["site_id"]
    sel_env = envs[sel_id]
    sel_cell = app["cells"][sel_id]
    # solitary comparison for the selected tree: same cell, Table 9-2 Solitary column
    sol_rec = copy.deepcopy(sel_env["record"])
    for n in engine.downstream_fields({"planting_condition"}):
        sol_rec.pop(n, None)
    sol_rec["planting_condition"] = derived_field("solitary")
    sol_pre = {k: v for k, v in sel_env["trace"].items() if k in ("boulevard_width_m", "soil_area_m2", "utility_conflict")}
    sol_pre["planting_condition"] = _trace(R26, {}, "comparison only: the same cell read against the Solitary column", False)
    sol_env = engine.evaluate_site(sol_rec, pre_trace=sol_pre)
    sel_summary = _summary(sel_env, sel_cell)
    sel_summary["solitary_comparison"] = {
        "required_m3": (sol_env["record"].get("required_soil_volume_m3") or {}).get("value"),
        "gap_m3": ((sol_env["record"].get("soil_volume_gap_m3") or {}).get("value")
                   if (sol_env["record"].get("soil_volume_gap_m3") or {}).get("status") == "KNOWN" else None),
        "benchmark_classes": ((sol_env["record"].get("soil_volume_benchmark_classes") or {}).get("value")
                              if (sol_env["record"].get("soil_volume_benchmark_classes") or {}).get("status") == "KNOWN" else None),
    }
    sel_summary["share_at_table_spacing_m3"] = _share_at_table_spacing(sel_env, sel_cell)
    if ext:
        sel_summary["extensions"] = next(t["extensions"] for t in trees_out if t["site_id"] == sel_id)
    closes = _what_closes_the_gap(sel_env, sel_cell, face, band)
    target_box = None
    if closes.get("available") and closes.get("soil_depth_to_meet_m") is not None:
        target_box = {"u0": sel_cell["u_from"], "u1": sel_cell["u_to"], "v0": band["v_from"], "v1": band["v_to"],
                      "depth_m": closes["soil_depth_to_meet_m"],
                      "note": "ghost box: the selected tree's cell footprint at the depth that meets the benchmark"}
    return {
        "available": True,
        "band": {k: band[k] for k in ("kind", "u_from", "u_to", "v_from", "v_to", "edge_description", "width_note")},
        "band_provenance": band["provenance_field"],
        "strips": strips, "segments": app["segments"],
        "crossing_count": app["crossing_count"], "partial_count": app["partial_count"],
        "trees": trees_out,
        "selected": {"site_id": sel_id, "summary": sel_summary, "what_would_close_the_gap": closes,
                     "target_box": target_box, "shared_row": sel_env, "solitary": sol_env},
        "extensions": ({"zones": ext["zones"], "band_extended": ext["band_extended"], "strips": ext["strips"],
                        "segments": ext["app"]["segments"], "rule": "R31", "note": R31["notes"]} if ext else None),
    }


# --------------------------------------------------------------------------
# R31: engineered-soil extension zones beyond the front boulevard (the fifth lever)
# --------------------------------------------------------------------------

def _validate_extensions(extensions: Optional[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    out = []
    seen = set()
    for x in extensions or []:
        side, w, st, prov = x.get("side"), x.get("width_m"), x.get("soil_type"), x.get("provenance", "DESIGN_ASSUMPTION")
        if side not in EXTENSION_SIDES:
            raise BlockFaceError(f"extension side must be one of {EXTENSION_SIDES}; got {side!r}")
        if side in seen:
            raise BlockFaceError(f"only one extension zone per side ({side})")
        if not isinstance(w, (int, float)) or w <= 0:
            raise BlockFaceError(f"extension {side}: width_m must be a positive number; got {w!r}")
        if st not in EXTENSION_SOIL_TYPES:
            raise BlockFaceError(f"extension {side}: soil_type must be one of {EXTENSION_SOIL_TYPES}; got {st!r}")
        if prov not in EXTENSION_PROVENANCE:
            raise BlockFaceError(f"extension {side}: provenance must be one of {EXTENSION_PROVENANCE}; got {prov!r}")
        if prov == "CONFIRMED_SITE_DATA" and not x.get("evidence"):
            raise BlockFaceError(f"extension {side}: CONFIRMED_SITE_DATA requires an evidence reference")
        if x.get("depth_m") is not None and (not isinstance(x["depth_m"], (int, float)) or x["depth_m"] <= 0):
            raise BlockFaceError(f"extension {side}: depth_m must be a positive number")
        seen.add(side)
        out.append({"side": side, "width_m": float(w), "soil_type": st, "provenance": prov,
                    "depth_m": float(x["depth_m"]) if x.get("depth_m") is not None else None,
                    "evidence": x.get("evidence"), "label": x.get("label")})
    return out


def _extension_setup(face, band, zones, extra_utilities, include_city) -> Dict[str, Any]:
    """Zone v-ranges clipped to the property line / centreline, and one apportion over band + zones for connectivity."""
    pl = face["tree"]["property_line_offset_m"]
    d_cl = face["tree"]["dist_centreline_m"]
    out_zones = []
    v_lo, v_hi = band["v_from"], band["v_to"]
    for z in zones:
        if z["side"] == "property":
            v0, v1 = band["v_to"], min(band["v_to"] + z["width_m"], pl)
            under = "sidewalk / back boulevard (hardscape unless evidenced)"
        else:
            v0, v1 = max(band["v_from"] - z["width_m"], -d_cl), band["v_from"]
            under = "curb / parking lane (hardscape)"
        zz = dict(z, v_from=_r(v0), v_to=_r(v1), width_applied_m=_r(v1 - v0), under=under,
                  clipped=bool(abs((v1 - v0) - z["width_m"]) > 1e-6))
        out_zones.append(zz)
        v_lo, v_hi = min(v_lo, v0), max(v_hi, v1)
    band_ext = dict(band, kind="design+extensions", v_from=_r(v_lo), v_to=_r(v_hi),
                    edge_description=f"front boulevard plus R31 extension zones: v {_r(v_lo)}..{_r(v_hi)}")
    strips = utility_strips(face, band_ext, extra_utilities, include_city)
    app = apportion(face, band_ext, strips)
    return {"zones": out_zones, "band_extended": {k: band_ext[k] for k in ("kind", "u_from", "u_to", "v_from", "v_to", "edge_description")},
            "strips": strips, "app": app}


def _zone_area(cell_ext: Dict[str, Any], v0: float, v1: float) -> float:
    area = 0.0
    for p in cell_ext["pieces"]:
        L = p["u1"] - p["u0"]
        for lo, hi in p["usable_v"]:
            area += L * max(0.0, min(hi, v1) - max(lo, v0))
    return round(area, 4)


def _zone_gross_and_blockers(cell_ext: Dict[str, Any], v0: float, v1: float):
    """Gross zone area over the cell (every piece, full zone width) and the datasets of the strips in the pieces where the
    usable width falls short of the zone width — the feasibility reading for a proposed zone."""
    gross, blockers = 0.0, set()
    for p in cell_ext["pieces"]:
        L = p["u1"] - p["u0"]
        full = max(0.0, v1 - v0)
        usable = sum(max(0.0, min(hi, v1) - max(lo, v0)) for lo, hi in p["usable_v"])
        gross += L * full
        if usable + 1e-6 < full:
            blockers.update(p.get("strips") or [])
    return round(gross, 4), sorted(blockers)


def _extension_shares(face, tree, cell, ext, band_env, depth, target, state, sites_path, replacement) -> Dict[str, Any]:
    """Per zone: usable area (connected through the band), its own record through the rule engine, credited share; then totals."""
    rec_band = band_env["record"]
    band_cred = rec_band.get("credited_soil_volume_m3") or unknown_field()
    req = (rec_band.get("required_soil_volume_m3") or {}).get("value")
    cond = (rec_band.get("planting_condition") or {}).get("value")
    cell_ext = ext["app"]["cells"][tree["site_id"]]
    blocked = cell["usable_area_m2"] is None
    zones_out = []
    for z in ext["zones"]:
        area = 0.0 if blocked else _zone_area(cell_ext, z["v_from"], z["v_to"])
        zdepth = known_field(z["depth_m"], z["provenance"]) if z["depth_m"] is not None else depth
        gross, blockers = (0.0, []) if blocked else _zone_gross_and_blockers(cell_ext, z["v_from"], z["v_to"])
        zo = {"side": z["side"], "soil_type": z["soil_type"], "provenance": z["provenance"], "under": z["under"],
              "v_from": z["v_from"], "v_to": z["v_to"], "width_applied_m": z["width_applied_m"],
              "usable_area_m2": _r(area, 4), "gross_area_m2": gross, "blocked_by": blockers,
              "connection": ("NONE" if area <= 0 else "FULL" if area + 1e-6 >= gross else "PARTIAL"),
              "depth_m": zdepth.get("value"),
              "credited_m3": None, "status": "UNKNOWN", "rules": [], "note": ""}
        if blocked:
            zo.update(status="REVIEW_REQUIRED", note="band cell not computable (conflict or tree outside the band); zone not counted")
            zones_out.append(zo); continue
        if area <= 0:
            zo.update(status="NOT_CONNECTED", note="no zone soil connected to the tree's cell after Table 2-2 interruptions (GRI p.18)")
            zones_out.append(zo); continue
        if z["soil_type"] == "native_soil" and z["provenance"] != "CONFIRMED_SITE_DATA":
            zo.update(status="NOT_COUNTED", rules=["R29"],
                      note="native soil under hardscape is not counted unless tested (GRI p.18); supply CONFIRMED_SITE_DATA with evidence")
            zones_out.append(zo); continue
        # run the zone through the rule engine as its own record (its own soil type and depth)
        zrec = copy.deepcopy(rec_band)
        for n in engine.downstream_fields({"soil_area_m2", "soil_depth_m", "soil_type"}):
            zrec.pop(n, None)
        zrec["boulevard_width_m"] = derived_field(z["width_applied_m"])
        zrec["soil_area_m2"] = derived_field(_r(area, 4))
        zrec["soil_depth_m"] = zdepth
        zrec["soil_type"] = known_field(z["soil_type"], z["provenance"])
        zrec["target_tree_class"] = target
        assert_valid_record(zrec)
        zpre = {"soil_area_m2": _trace(R31, {"zone": {k: z[k] for k in ("side", "v_from", "v_to", "soil_type", "provenance")},
                                              "pieces": cell_ext["pieces"]},
                                        "R31 extension zone: usable area = soil in the zone still connected to the tree's band cell", True,
                                        also=["R28", "R26"], formula="zone_area_m2 = Σ piece length × usable width within the zone")}
        zenv = engine.evaluate_site(zrec, pre_trace=zpre)
        zc = zenv["record"].get("credited_soil_volume_m3") or unknown_field()
        restr = [w for w in zenv["warnings"] if w["rule_id"] in ("R08", "R09") and w.get("level") == "restriction"]
        zo["rules"] = sorted({w["rule_id"] for w in zenv["warnings"]} | {u["rule_id"] for u in zenv["unresolved"]} | {"R31"})
        if restr:
            zo.update(status="REFUSED", note="; ".join(w["message"] for w in restr))
        elif z["soil_type"] == "soil_cell":
            zo.update(status="UNKNOWN", note="soil cells: no credit factor in the source (R11); manual conditions R10: "
                                             + ", ".join(engine.RULE_INDEX["R10"]["manual_conditions"]))
        elif zc["status"] == "KNOWN" and zc["value"] is not None:
            zo.update(credited_m3=_r(zc["value"]), status="KNOWN",
                      note=(zenv["trace"].get("credited_soil_volume_m3") or {}).get("note") or "credited by the rule engine")
        else:
            zo.update(status=zc["status"], note="; ".join(u["message"] for u in zenv["unresolved"]) or "credited volume not KNOWN")
        zo["physical_m3"] = (zenv["record"].get("physical_soil_volume_m3") or {}).get("value")
        zones_out.append(zo)
    known = [z["credited_m3"] for z in zones_out if z["status"] == "KNOWN"]
    band_known = band_cred["status"] == "KNOWN" and band_cred["value"] is not None
    total = _r(band_cred["value"] + sum(known)) if band_known else None
    table = engine.RULE_INDEX["R01"]["lookup_table_m3"]
    classes = ([c for c, v in table.items() if cond in v and total is not None and total >= v[cond]] if total is not None else None)
    return {
        "zones": zones_out,
        "band_share_m3": band_cred["value"] if band_known else None,
        "extension_share_m3": _r(sum(known)) if known else 0.0,
        "share_total_m3": total, "status": "KNOWN" if total is not None else "UNKNOWN",
        "required_m3": req, "gap_total_m3": _r(total - req) if (total is not None and req is not None) else None,
        "benchmark_classes_total": classes,
        "provenance": "DERIVED_CALCULATION", "rule": "R31",
        "formula": "share_total = band credited share + Σ zone credited shares (zones that are KNOWN only)",
        "note": R31["notes"],
    }
