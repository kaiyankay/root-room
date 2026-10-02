"""
Export the per-site SCENE file for the web page (11_redefinition_2026-09-28.md §8, phase 3).

  data/processed/block_face_<site>.json   (engine output: the only source of every number)
  data/raw/<dataset>__<window>.geojson    (City Open Data: buildings, parcels, points)
  data/raw/vanmap/<layer>__<window>.geojson (VanMap: the same City facilities with depth fields)
      -> data/processed/scene_<site>.json

Everything is in the engine's local frame: u along the street (east-pointing), v across the street
positive toward the property, z up with z = 0 the road surface (nominal, not surveyed). The page
computes nothing but geometry for previews; every number printed comes from this file.

Depth grades (11 §5), one per facility, always labelled:
  record   VanMap DEPTH_OF_COVER_M (water mains), DEPTH_AT_PL (service lines)
  derived  sewer mains: nearest manhole RIMELEV - mean(invert)  (VanMap /29 and /35-37)
  nominal  EDM minimum cover: water §3.4.2.6 p.89 (0.9 m; 0.75 m under 300 mm), sanitary §4.4.2.3 p.115
           and storm §5.4.2.3 p.154 (1.0 m), service connections §4.6.3 p.125 / §5.6.3 p.165 (1.5 m)
  unknown  street-lighting conduits and poles, catch basins, junction boxes, transit: no depth anywhere

Run:  python3 scripts/export_scene.py --site KE-198571_curb10
      python3 scripts/export_scene.py --site V-10880
"""
import argparse
import glob
import json
import math
import pathlib
import sys
from datetime import date

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
RAW = ROOT / "data" / "raw"
PROCESSED = ROOT / "data" / "processed"

from src import rule_engine as engine                    # noqa: E402  (R17 Table 9-3 lookup, rules 1.3)
from src import window_index as wi                      # noqa: E402  (open only the window files near the site)

NOMINAL_BUILDING_HEIGHT_M = 8.0     # 09 standard: buildings are massing, footprints 2015
CROWN_DIAMETER_PER_HEIGHT = 0.6     # fallback crown when a tree has no library record (round form)
SPECIES_DIR = ROOT / "data" / "species"
ZOOM_CELL_HALF_M = 16.0             # chapters 03–05 frame the selected tree ±16 m (its cell and both neighbours) at true scale
GROUND_DEPTH_M = 8.0                # the heavy section: black ground body from grade to -8 m (deeper than any recorded facility here)
ROOT_DEPTH_BY_FORM = {"tap": 1.0, "heart": 0.8, "flat": 0.5}


def load_library():
    """data/species/_index.json + every record. Phase 4 (11 §6)."""
    idx = json.load(open(SPECIES_DIR / "_index.json", encoding="utf-8"))
    recs = {s["id"]: json.load(open(SPECIES_DIR / f"{s['id']}.json", encoding="utf-8")) for s in idx["species"]}
    return idx, recs


def species_for(recs, genus, species, cultivar):
    """The library record for a City tree (listed via the engine's R17 lookup, else an unlisted record), plus the lookup."""
    look = engine.table_9_3_lookup(genus, species, cultivar)
    g = (genus or "").upper().strip()
    sp = engine._species_word(species) or None
    if look["listed"]:
        m = look["matched_on"]
        for r in recs.values():
            if r["table_9_3"]["listed"] and r["genus"] == m["genus"] and r["species"] == m["species"] and r["cultivar_filter"] == m["cultivar"]:
                return r, look
    for r in recs.values():
        if not r["table_9_3"]["listed"] and r["genus"] == g and r["species"] == sp:
            return r, look
    return None, look


def crown_ratio(rec, cultivar):
    """Nominal crown diameter / height for this tree: the record's form, or a cultivar override (both NOMINAL)."""
    if not rec:
        return CROWN_DIAMETER_PER_HEIGHT, "round"
    form = rec["form"]["value"]
    over = (rec["form"].get("cultivar_overrides") or {}).get((cultivar or "").upper())
    if over:
        form = over
    ratios = {"round": 0.6, "oval": 0.5, "vase": 0.7, "columnar": 0.3, "conical": 0.45, "weeping": 0.8}   # = build_species_library.CROWN_RATIO_BY_FORM
    return (rec["crown_width"]["ratio_of_height"] if not over else ratios[form]), form


def species_summary(rec, look, cultivar=None):
    if not rec:
        return None
    ratio, form = crown_ratio(rec, cultivar)
    t93 = rec["table_9_3"]
    return {"id": rec["id"], "common": rec["name"]["common"], "latin": rec["name"]["latin"], "class": t93["class"], "listed": t93["listed"],
            "form": form, "form_grade": "NOMINAL", "crown_ratio_of_height": ratio, "model": f"models/{rec['id']}.json",
            "drawn_height_m": rec["drawn_height_m"]["value"], "drawn_height_basis": rec["drawn_height_m"]["basis"],
            "volume_m3": rec.get("volume_m3"), "spacing_m": rec.get("spacing_m"), "city_count": rec["city"]["count"],
            "cite": (look or {}).get("cite") or rec["name"].get("cite"), "note": (look or {}).get("message") or t93.get("note")}


def rects_overlapping(u0, u1, v0, v1, strips):
    """Where a box [u0,u1]×[v0,v1] crosses applied clearance strips: the overlap rectangles (Table 2-2, R12/R13)."""
    out, seen = [], set()
    for s in strips:
        if s.get("u0") is None:
            continue
        a, b = max(u0, s["u0"]), min(u1, s["u1"])
        c, d = max(v0, s["v0"]), min(v1, s["v1"])
        key = (r2(a), r2(b), r2(c), r2(d), s.get("kind"), s.get("type"))
        if b - a > 0.01 and d - c > 0.01 and key not in seen:
            seen.add(key)
            out.append({"u0": r2(a), "u1": r2(b), "v0": r2(c), "v1": r2(d), "type": s.get("type"), "kind": s.get("kind"),
                        "dataset": s.get("dataset"), "clearance_m": s.get("clearance_m")})
    return out


def credited_volume(tree, band, depth, segments, zones):
    """Rectangles of soil the rule credits to this tree (its band cell within the segment + KNOWN zones): where roots may be drawn."""
    cell = tree.get("cell") or {}
    if not band or cell.get("u_from") is None:
        return []
    rects = []
    for sg in segments or []:
        a, b = max(cell["u_from"], sg["u_from"]), min(cell["u_to"], sg["u_to"])
        if b - a > 0.05:
            rects.append({"u0": r2(a), "u1": r2(b), "v0": band["v_from"], "v1": band["v_to"], "z0": -depth, "z1": 0.0, "kind": "band"})
    for z in zones or []:
        if z.get("status") != "KNOWN":
            continue
        a, b = max(cell["u_from"], z["u_from"]), min(cell["u_to"], z["u_to"])
        if b - a > 0.05:
            rects.append({"u0": r2(a), "u1": r2(b), "v0": z["v_from"], "v1": z["v_to"], "z0": -(z.get("depth_m") or depth), "z1": 0.0, "kind": f"zone {z['side']}"})
    return rects


def need_box_for(u_centre, required_m3, band, depth, cell, strips):
    w = band["v_to"] - band["v_from"]
    if not (w > 0 and depth and required_m3):
        return None
    L = required_m3 / (w * depth)
    u0, u1 = u_centre - L / 2, u_centre + L / 2
    beyond = []
    if cell and cell.get("u_from") is not None:
        if u0 < cell["u_from"] - 0.005:
            beyond.append({"u0": r2(u0), "u1": r2(cell["u_from"]), "side": "west"})
        if u1 > cell["u_to"] + 0.005:
            beyond.append({"u0": r2(cell["u_to"]), "u1": r2(u1), "side": "east"})
    return {"u0": r2(u0), "u1": r2(u1), "v0": band["v_from"], "v1": band["v_to"], "depth_m": depth, "length_m": r2(L),
            "conflicts": rects_overlapping(u0, u1, band["v_from"], band["v_to"], strips), "beyond_cell": beyond,
            "note": "need-box: the band's width and depth, long enough to hold the Table 9-2 volume (PROJECT_INTERPRETATION: the source gives a volume, not a shape)"}
EXTENT_MARGIN_U = 25.0
EXTENT_PROPERTY_DEPTH = 45.0        # how far behind the property line the scene reaches (houses)
CUT_OFFSET_V = 0.3                  # the long cut sits just behind the trunks, on the property side

EDM_COVER = {
    "water_main": {"depth_m": 0.9, "small_depth_m": 0.75, "small_below_mm": 300, "cite": "EDM 2026 §3.4.2.6 p.89"},
    "sewer_main": {"depth_m": 1.0, "cite": "EDM 2026 §4.4.2.3 p.115 / §5.4.2.3 p.154"},
    "sewer_service": {"depth_m": 1.5, "cite": "EDM 2026 §4.6.3 p.125 / §5.6.3 p.165 (invert 1.5 m below street ℄ at the P/L)"},
}
NOT_PUBLISHED = [
    {"kind": "gas", "owner": "FortisBC", "note": "position not published anywhere; drawn as a nominal corridor at EDM Table 7-1 p.202 minimum cover (610 mm, the lesser footnoted value for a 150 mm main); lateral position undetermined"},
    {"kind": "electrical", "owner": "BC Hydro", "note": "position not published; drawn as a nominal corridor at Table 7-1 main-duct cover 1070 mm; lateral position undetermined"},
    {"kind": "telecom", "owner": "Telus / cable", "note": "position not published; drawn as a nominal corridor at Table 7-1 main-duct cover 1070 mm; lateral position undetermined"},
    {"kind": "traffic-signal conduit", "owner": "City", "note": "not published; EDM §10.6.2 gives no depth"},
    {"kind": "water service laterals", "owner": "City / private", "note": "not published (\"connections to the mains are not available\")"},
]
# EDM 2026 Table 7-1 p.202 minimum depth of cover (reports/11_fact_check_2026-09-28.md §2.4). Superscripts ¹–⁴ are printed
# without footnote text in the extract, so the lesser value is drawn and said so. §7.2.1: "It must not be assumed that all
# utilities are at standard depth." No source gives the lateral position of a private main duct: the corridor spans the
# boulevard (back of curb to property line) and is labelled 'position undetermined'.
TABLE_7_1 = {
    "gas": {"owner": "FortisBC", "depth_m": 0.61, "as_printed": "Gas (FortisBC) mains 150 mm: 760³ / 610⁴ mm; 200 mm: 910³ / 610⁴ mm; ≥ 250 mm: 1070 mm (profile required)",
            "drawn": "610 mm, the lesser footnoted value for a 150 mm main; footnote text not recoverable from the extract"},
    "electrical": {"owner": "BC Hydro", "depth_m": 1.07, "as_printed": "Electrical (BC Hydro) main ducts 1070 mm (profile required); laterals 910 mm", "drawn": "1070 mm main ducts"},
    "telecom": {"owner": "Telus / cable", "depth_m": 1.07, "as_printed": "Telephone, Cable and Communications main ducts 1070 mm (profile required); laterals 910 mm", "drawn": "1070 mm main ducts"},
}
CORRIDOR_THICKNESS_M = 0.15
# City electrical duct banks (street lighting, communications, traffic signals): Standard Detail G4.7 (May 2025), fig. 1–3
G47 = {"non_vehicular_m": 0.45, "vehicular_m": 0.60,
       "cite": "City of Vancouver Standard Detail G4.7 (May 2025) underground electrical duct bank configurations: 450 mm min. cover in non-vehicular area, 600 mm in vehicular area; EDM §10.4.2 p.379 refers to it"}
GROUND = RAW / "ground"
_GROUND_CACHE = {}
GWELLS_FT_TO_M = 0.3048     # GWELLS stores lithology from/to and well depths in feet (a 125 ft well logs 'to 125''); converted here and said so


def load(path):
    return wi.load_json(pathlib.Path(path))   # parsed once per process while the file is unchanged (the server keeps a street's windows)


def r2(x, nd=2):
    return None if x is None else round(x, nd)


class Frame:
    def __init__(self, face):
        fr = face["frame"]
        self.lon0, self.lat0 = fr["origin_lonlat"]
        self.kx = 111_320.0 * math.cos(math.radians(self.lat0))
        self.ky = 111_320.0
        self.ux, self.uy = fr["along_unit_xy"]
        self.px, self.py = fr["property_unit_xy"]

    def uv(self, lon, lat):
        x, y = (lon - self.lon0) * self.kx, (lat - self.lat0) * self.ky
        return (x * self.ux + y * self.uy, x * self.px + y * self.py)


def geom_parts(geom):
    """List of coordinate lists (rings or lines) for any GeoJSON geometry."""
    if not geom:
        return []
    t, c = geom["type"], geom["coordinates"]
    if t == "Point":
        return [[c]]
    if t == "LineString":
        return [c]
    if t == "MultiLineString":
        return c
    if t == "Polygon":
        return c[:1]
    if t == "MultiPolygon":
        return [p[0] for p in c]
    return []


def window_files(dataset, sub=None):
    base = RAW / sub if sub else RAW
    return [pathlib.Path(p) for p in sorted(glob.glob(str(base / f"{dataset}__*.geojson")))]


_CLIP = None   # (Frame, extent, pad_m): set by main; features() then keeps only what lies near this site's extent


def clip_bbox(margin_m=80.0):
    """The lon/lat box of the padded extent (+ a margin): only the window files that touch it are opened (window_index)."""
    if _CLIP is None:
        return None
    F, ext, pad = _CLIP
    lons, lats = [], []
    for u in (ext["u_from"] - pad - margin_m, ext["u_to"] + pad + margin_m):
        for v in (ext["v_from"] - pad - margin_m, ext["v_to"] + pad + margin_m):
            x, y = u * F.ux + v * F.px, u * F.uy + v * F.py
            lons.append(F.lon0 + x / F.kx)
            lats.append(F.lat0 + y / F.ky)
    return [min(lons), min(lats), max(lons), max(lats)]


def _coords(geom):
    if not geom:
        return
    c = geom.get("coordinates")
    if geom.get("type") == "GeometryCollection":
        for g in geom.get("geometries", []):
            yield from _coords(g)
        return
    stack = [c]
    while stack:
        x = stack.pop()
        if isinstance(x, (list, tuple)) and x and isinstance(x[0], (int, float)):
            yield x
        elif isinstance(x, (list, tuple)):
            stack.extend(x)


def features(dataset, sub=None):
    # Every window file of the dataset is read (the citywide sample stores one window per sampled block face), so the
    # features are clipped to this site's padded extent and de-duplicated where windows overlap; otherwise a per-site
    # export walks the whole city (nearest-manhole search became minutes long after the 2026-09-28 batch).
    out = []
    seen = set()
    for p in wi.select(window_files(dataset, sub), clip_bbox()):

        if p.name.endswith("__dataset_metadata.json") or p.name.endswith("__layer_info.json"):
            continue
        for f in load(p).get("features", []):
            if _CLIP is not None:
                F, ext, pad = _CLIP
                near = False
                for c in _coords(f.get("geometry")):
                    u, v = F.uv(c[0], c[1])
                    if ext["u_from"] - pad <= u <= ext["u_to"] + pad and ext["v_from"] - pad <= v <= ext["v_to"] + pad:
                        near = True
                        break
                if not near:
                    continue
            key = json.dumps([f.get("geometry"), f.get("properties")], sort_keys=True, default=str)
            if key in seen:
                continue
            seen.add(key)
            out.append(f)
    return out


def in_extent(pts, ext):
    return any(ext["u_from"] <= u <= ext["u_to"] and ext["v_from"] <= v <= ext["v_to"] for u, v in pts)


def clip_pts(pts, ext, pad=0.0):
    return [[r2(u), r2(v)] for u, v in pts]


def where_class(pts, band, cell):
    """cell / band / face / window, by the nearest v-distance of the feature to the band and its u-range."""
    in_u_cell = any(cell["u_from"] <= u <= cell["u_to"] for u, v in pts) if cell else False
    in_v_band = any(band["v_from"] <= v <= band["v_to"] for u, v in pts)
    in_u_band = any(band["u_from"] <= u <= band["u_to"] for u, v in pts)
    if in_v_band and in_u_cell:
        return "cell"
    if in_v_band and in_u_band:
        return "band"
    if in_u_band:
        return "face"
    return "window"


def ground_layer(name):
    if name not in _GROUND_CACHE:
        p = GROUND / name
        if not p.exists():
            _GROUND_CACHE[name] = None
        elif name.endswith(".csv"):
            import csv
            with open(p, encoding="utf-8-sig", newline="") as fh:
                _GROUND_CACHE[name] = [(float(r["latitude"]), float(r["longitude"]), r["service_request_type"], r["service_request_open_timestamp"][:10])
                                       for r in csv.DictReader(fh, delimiter=";") if r.get("latitude") and r.get("longitude")]
        else:
            _GROUND_CACHE[name] = load(p)
    return _GROUND_CACHE[name]


def _dist_to_path(u, v, pts):
    if len(pts) == 1:
        return math.hypot(u - pts[0][0], v - pts[0][1])
    best = 1e9
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy or 1e-9
        t = max(0.0, min(1.0, ((u - ax) * dx + (v - ay) * dy) / L2))
        best = min(best, math.hypot(u - ax - t * dx, v - ay - t * dy))
    return best


def ground_block(F, blk, d_cl, pl, sidewalk_v, sel):
    """What the City and the Province record about the ground at this block face (task 2): sidewalk rating, 311 cases,
    the nearest logged borehole, the surficial unit (not obtained). Every entry carries its grade and its distance."""
    log = ground_layer("_fetch_log.json") or {}
    uc = (blk["u_from"] + blk["u_to"]) / 2
    v_sw = (sidewalk_v[0] + sidewalk_v[1]) / 2 if sidewalk_v and sidewalk_v[0] is not None else pl - 1.5
    # sidewalk condition (CITY_DATA, 2021)
    sidewalk = {"rating": None, "status": "UNKNOWN", "dataset": "sidewalk-condition-rating", "provenance": "CITY_DATA", "note": "no rated sidewalk segment within 15 m of this face's sidewalk"}
    sw = ground_layer("sidewalk-condition-rating.geojson")
    if sw:
        best = None
        for f in sw["features"]:
            for part in geom_parts(f["geometry"]):
                pts = [F.uv(*c[:2]) for c in part]
                if not any(abs(u) < 400 and abs(v) < 400 for u, v in pts):
                    continue
                d = _dist_to_path(uc, v_sw, pts)
                if best is None or d < best[0]:
                    best = (d, f["properties"])
        if best and best[0] <= 15.0:
            m = log.get("sidewalk-condition-rating", {})
            sidewalk = {"rating": best[1].get("sidewalk_condition_index_rating"), "hundred_block": best[1].get("hundred_block"), "distance_m": r2(best[0]),
                        "status": "KNOWN", "survey_year": 2021, "dataset": "sidewalk-condition-rating", "data_modified": (m.get("data_modified") or "")[:10],
                        "provenance": "CITY_DATA", "licence": m.get("licence"),
                        "note": "Sidewalk Condition Index rating of the nearest rated hundred-block segment (City survey 2021, repeated every four years); a surface-distress rating, not a cause"}
    # 311 cases (CITY_DATA): address points inside this face's frontage parcels between the cross streets
    box = {"u_from": blk["u_from"], "u_to": blk["u_to"], "v_from": r2(-d_cl - 1.0), "v_to": r2(pl + 40.0)}
    cases = {"provenance": "CITY_DATA", "box": box, "datasets": ["3-1-1-service-requests", "3-1-1-service-requests-2009-2021"],
             "types": ["City and Park Trees Maintenance Case", "Boulevard Maintenance Case", "External Utility Concern Case"],
             "note": "cases geocoded by the City to an address; counted where the address point falls in this block face's frontage parcels (centreline to 40 m behind the property line) between the cross streets; closure reasons are administrative, not diagnoses"}
    for key, name in (("since_2022", "311_2022_on.csv"), ("2009_2021", "311_2009_2021.csv")):
        rows = ground_layer(name)
        if rows is None:
            cases[key] = {"count": None, "status": "UNKNOWN"}
            continue
        by = {}
        for lat, lon, typ, day in rows:
            u, v = F.uv(lon, lat)
            if box["u_from"] <= u <= box["u_to"] and box["v_from"] <= v <= box["v_to"]:
                by[typ] = by.get(typ, 0) + 1
        m = log.get(name.replace(".csv", ""), {})
        cases[key] = {"count": sum(by.values()), "by_type": by, "status": "KNOWN", "data_modified": (m.get("data_modified") or "")[:10]}
    # nearest logged borehole (PROVINCIAL_RECORD): a log at a distance, never interpolated
    bore = {"status": "UNKNOWN", "provenance": "PROVINCIAL_RECORD", "source": "BC GWELLS", "note": "no logged well in the City bbox"}
    gw = ground_layer("gwells_vancouver.geojson")
    if gw:
        best = None
        for f in gw["features"]:
            pr = f["properties"]
            if not pr.get("lithology_intervals"):
                continue
            u, v = F.uv(*f["geometry"]["coordinates"][:2])
            d = math.hypot(u - sel["u"], v - sel["v"])
            if best is None or d < best[0]:
                best = (d, pr, u, v)
        if best:
            d, pr, u, v = best
            ints = []; skipped = 0
            for it in pr["lithology"]:
                try:
                    a, b = float(it.get("start") or 0), float(it.get("end") or 0)
                except ValueError:
                    continue
                if b <= a or not (it.get("lithology_raw_data") or "").strip():
                    skipped += 1
                    continue
                ints.append({"from_m": r2(a * GWELLS_FT_TO_M), "to_m": r2(b * GWELLS_FT_TO_M), "text": (it.get("lithology_raw_data") or "").strip() or "(no description)",
                             "colour": it.get("lithology_colour"), "hardness": it.get("lithology_hardness")})
            m = log.get("gwells", {})
            bore = {"status": "KNOWN", "well_tag_number": pr["well_tag_number"], "distance_m": r2(d), "u": r2(u), "v": r2(v),
                    "date": pr.get("construction_end_date") or pr.get("construction_start_date"), "well_class": pr.get("well_class"), "intended_use": pr.get("intended_water_use"),
                    "finished_depth_m": r2(float(pr["finished_well_depth"]) * GWELLS_FT_TO_M) if pr.get("finished_well_depth") else None,
                    "coordinate_acquisition_code": pr.get("coordinate_acquisition_code"), "intervals": ints,
                    "provenance": "PROVINCIAL_RECORD", "source": "Province of British Columbia, GWELLS REST API v1", "fetched_on": m.get("fetched_on"), "licence": m.get("licence"),
                    "units_note": "GWELLS lithology depths are in feet; converted × 0.3048", "intervals_skipped": skipped,
                    "note": f"the nearest well with a lithology log, {r2(d)} m from this tree; what it found is that well's ground, not this site's; never interpolated"}
    surficial = {"unit": None, "status": "UNKNOWN", "provenance": "FEDERAL_RECORD",
                 "note": "GSC Map 1486A (Armstrong & Hicock 1979, surficial geology, Vancouver 1:50 000) digital polygons not obtained: no download found on open.canada.ca, the BC Data Catalogue, geo.ca or ArcGIS Hub on 2026-09-28 (reports/18_ground_layers.md)"}
    return {"sidewalk": sidewalk, "cases_311": cases, "borehole": bore, "surficial": surficial,
            "note": "records about the ground at this block, each at its own distance and grade; none of them changes a share"}


def protection_for(dbh_cm):
    """R32 (rules 1.4): By-law 9958 Schedule A distance for the City trunk diameter; a construction protection radius, not a root extent."""
    r = engine.protection_barrier_distance(dbh_cm)
    return {"radius_m": r.get("distance_m"), "applies": r.get("applies"), "row_cm": r.get("row_cm"), "dbh_cm": dbh_cm,
            "offsets_m": engine.RULE_INDEX["R32"]["boulevard_offsets_m"], "provenance": "SOURCE_RULE", "rule": "R32",
            "cite": r.get("cite"), "label": "protection radius (By-law 9958 Sch. A), not root extent", "message": r.get("message")}


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--site", required=True, help="engine file suffix, e.g. KE-198571_curb10 or V-10880")
    p.add_argument("--out", default=None)
    p.add_argument("--candidate", default=None, help="library species id dropped into the selected tree's cell (chapter 04)")
    a = p.parse_args(argv)
    lib_index, lib = load_library()

    bf = load(PROCESSED / f"block_face_{a.site}.json")
    face, design, existing, knobs = bf["face"], bf["design"], bf["existing"], bf["knobs"]
    F = Frame(face)
    d_cl = face["tree"]["dist_centreline_m"]
    pl = face["tree"]["property_line_offset_m"]
    blk = face["block"]
    ext = {"u_from": blk["u_from"] - EXTENT_MARGIN_U, "u_to": blk["u_to"] + EXTENT_MARGIN_U,
           "v_from": -d_cl - 12.0, "v_to": pl + EXTENT_PROPERTY_DEPTH}
    global _CLIP
    _CLIP = (F, ext, 120.0)          # 120 m beyond the extent: the sewer depth derivation looks for a manhole within 80 m
    sel_id = face["site_id"]

    # ---- band, segments, strips, trees (engine numbers only) --------------------------------------
    avail = design.get("available", False)
    band = design["band"] if avail else None
    fb = design.get("front_boulevard") or {}
    depth = knobs["soil_depth_m"]["value"]
    trees = []
    dtrees = {t["site_id"]: t for t in design.get("trees", [])} if avail else {}
    for t in face["trees"]:
        dt = dtrees.get(t["site_id"], {})
        rec, look = species_for(lib, t["genus"], t["species"], t["cultivar"])
        ratio, form = crown_ratio(rec, t["cultivar"])
        trees.append({
            "site_id": t["site_id"], "tree_id": t["tree_id"], "u": t["u"], "v": t["v"],
            "height_m": t["height_m"], "diameter_cm": t["diameter_cm"],
            "genus": t["genus"], "species": t["species"], "cultivar": t["cultivar"], "install_date": t.get("install_date"),
            "species_ref": species_summary(rec, look, t["cultivar"]),
            "table_9_3": {"listed": look["listed"], "class": look.get("class"), "note": look["message"]},
            "crown_diameter_m": r2((t["height_m"] or 0) * ratio),
            "crown_grade": f"nominal ({ratio} × City height, {form} form; crown spread is not published)",
            "gap_west_m": t.get("gap_west_m"), "gap_east_m": t.get("gap_east_m"),
            "share_m3": dt.get("share_m3"), "share_status": dt.get("share_status"), "required_m3": dt.get("required_m3"),
            "gap_m3": dt.get("gap_m3"), "benchmark_classes": dt.get("benchmark_classes"),
            # the engine's arithmetic for this tree, copied so the page's ledger reads it instead of recomputing (R04 footprint, R05 volume, R06/R07 credit)
            "spacing_m": dt.get("spacing_m"), "band_width_m": dt.get("band_width_m"), "soil_area_m2": dt.get("soil_area_m2"),
            "physical_soil_volume_m3": dt.get("physical_soil_volume_m3"), "soil_type": dt.get("soil_type"), "planting_condition": dt.get("planting_condition"),
            "solitary_comparison": dt.get("solitary_comparison"), "refused": dt.get("refused"), "unresolved": dt.get("unresolved"),
            "cell": (dt.get("cell") or {}), "selected": t["site_id"] == sel_id,
            "extensions": dt.get("extensions"),
            "protection": protection_for(t["diameter_cm"]),
        })
    sel = next(t for t in trees if t["selected"])
    sel_cell = sel["cell"] if sel["cell"].get("u_from") is not None else None

    # ---- facilities: VanMap layers with depth, plus City point layers ------------------------------
    manholes = []
    for f in features("sewer-manholes", "vanmap"):
        if f["geometry"] and f["properties"].get("RIMELEV"):
            u, v = F.uv(*f["geometry"]["coordinates"][:2])
            manholes.append((u, v, f["properties"]["RIMELEV"], f["properties"].get("FACILITYID")))

    def nearest_rim(u, v):
        if not manholes:
            return None
        m = min(manholes, key=lambda m: math.hypot(m[0] - u, m[1] - v))
        return {"rim_m": m[2], "dist_m": r2(math.hypot(m[0] - u, m[1] - v)), "facility_id": m[3]}

    facilities = []
    fid = 0

    def add(kind, dataset, source, pts, grade, depth_top, diameter_mm, label, props, cite=None, depth_bottom=None, extra=None):
        nonlocal fid
        if not in_extent(pts, ext):
            return
        fid += 1
        facilities.append({
            "id": f"f{fid}", "kind": kind, "dataset": dataset, "source": source,
            "geometry": "point" if len(pts) == 1 else "line", "path_uv": clip_pts(pts, ext),
            "grade": grade, "depth_top_m": r2(depth_top), "depth_bottom_m": r2(depth_bottom),
            "diameter_mm": diameter_mm, "label": label, "cite": cite, "properties": props,
            "where": where_class(pts, band, sel_cell) if band else "window", **(extra or {}),
        })

    # water mains (record / nominal)
    for lid, dataset, kind in (("water-distribution-mains", "water-distribution-mains", "water_main"),
                               ("water-transmission-mains", "water-transmission-mains", "water_main"),
                               ("abandoned-water-mains", "abandoned-water-mains", "water_main_abandoned"),
                               ("dfps-water-mains", "dedicated-fire-protection-systems-dfps-water-mains", "water_main")):
        for f in features(lid, "vanmap"):
            pr = f["properties"]
            dia = None
            if pr.get("DIAMETER"):
                try:
                    dia = int(str(pr["DIAMETER"]).split()[0])
                except ValueError:
                    dia = None
            cover = pr.get("DEPTH_OF_COVER_M")
            for part in geom_parts(f["geometry"]):
                pts = [F.uv(*c[:2]) for c in part]
                if cover and 0 < cover < 10:
                    add(kind, dataset, "VanMap Infrastructure_Water", pts, "record", cover, dia,
                        f"{lid.replace('-', ' ')} {dia or '?'} mm · {pr.get('MATERIAL') or ''} {pr.get('INSTALLATION_DATE_iso') or ''}".strip(),
                        {"material": pr.get("MATERIAL"), "installed": pr.get("INSTALLATION_DATE_iso")},
                        cite="DEPTH_OF_COVER_M as recorded by the City (VanMap)",
                        depth_bottom=cover + (dia or 0) / 1000.0)
                else:
                    nd = EDM_COVER["water_main"]["small_depth_m"] if (dia and dia < EDM_COVER["water_main"]["small_below_mm"]) else EDM_COVER["water_main"]["depth_m"]
                    add(kind, dataset, "VanMap Infrastructure_Water", pts, "nominal", nd, dia,
                        f"{lid.replace('-', ' ')} {dia or '?'} mm · no recorded cover", {"material": pr.get("MATERIAL")},
                        cite=EDM_COVER["water_main"]["cite"] + " minimum cover; not surveyed (§7.2.1: do not assume standard depth)",
                        depth_bottom=nd + (dia or 0) / 1000.0)
    # sewer mains (derived / nominal)
    for lid in ("sanitary-mains", "storm-mains", "combined-mains"):
        for f in features(lid, "vanmap"):
            pr = f["properties"]
            dia = pr.get("DIAMETER_INSIDE")
            ui, di = pr.get("UPSTREAM_INVERT"), pr.get("DWNSTREAM_INVERT")
            for part in geom_parts(f["geometry"]):
                pts = [F.uv(*c[:2]) for c in part]
                mid = pts[len(pts) // 2]
                rim = nearest_rim(*mid) if (ui is not None and di is not None) else None
                if rim and rim["dist_m"] <= 80:
                    inv = (ui + di) / 2
                    depth_inv = rim["rim_m"] - inv
                    top = depth_inv - (dia or 0) / 1000.0
                    add("sewer_main", "sewer-mains", "VanMap Infrastructure_Sewer", pts, "derived", top, dia,
                        f"{pr.get('EFFLUENT_TYPE') or lid} sewer {dia or '?'} mm · {pr.get('MATERIAL') or ''} {pr.get('INSTALLDATE_iso') or ''}".strip(),
                        {"effluent": pr.get("EFFLUENT_TYPE"), "material": pr.get("MATERIAL"), "installed": pr.get("INSTALLDATE_iso"),
                         "upstream_invert_m": ui, "downstream_invert_m": di, "invert_estimated": [pr.get("UPSTRM_INVERT_ESTIMATED"), pr.get("DNSTRM_INVERT_ESTIMATED")]},
                        cite=f"derived: manhole {rim['facility_id']} rim {rim['rim_m']} m ({rim['dist_m']} m away) − mean invert {r2(inv)} m",
                        depth_bottom=depth_inv)
                else:
                    nd = EDM_COVER["sewer_main"]["depth_m"]
                    add("sewer_main", "sewer-mains", "VanMap Infrastructure_Sewer", pts, "nominal", nd, dia,
                        f"{pr.get('EFFLUENT_TYPE') or lid} sewer {dia or '?'} mm · no invert record",
                        {"effluent": pr.get("EFFLUENT_TYPE"), "material": pr.get("MATERIAL")},
                        cite=EDM_COVER["sewer_main"]["cite"] + " minimum cover; not surveyed", depth_bottom=nd + (dia or 0) / 1000.0)
    # sewer service lines (record at P/L / nominal)
    for f in features("sewer-service-lines", "vanmap"):
        pr = f["properties"]
        dia = pr.get("DIAMETER_INSIDE")
        dpl = pr.get("DEPTH_AT_PL")
        for part in geom_parts(f["geometry"]):
            pts = [F.uv(*c[:2]) for c in part]
            if dpl:
                add("sewer_service", "sewer-service-lines", "VanMap Infrastructure_Sewer/104", pts, "record", dpl, dia,
                    f"{pr.get('EFFLUENT_TYPE') or ''} service {dia or '?'} mm · {dpl} m at P/L", {"effluent": pr.get("EFFLUENT_TYPE"), "installed": pr.get("INSTALLDATE_iso")},
                    cite="DEPTH_AT_PL as recorded (VanMap); depth elsewhere along the lateral not recorded", depth_bottom=dpl + (dia or 0) / 1000.0)
            else:
                nd = EDM_COVER["sewer_service"]["depth_m"]
                add("sewer_service", "sewer-service-lines", "VanMap Infrastructure_Sewer/104", pts, "nominal", nd, dia,
                    f"{pr.get('EFFLUENT_TYPE') or ''} service {dia or '?'} mm · no depth record", {"effluent": pr.get("EFFLUENT_TYPE")},
                    cite=EDM_COVER["sewer_service"]["cite"], depth_bottom=nd + (dia or 0) / 1000.0)
    # street lighting conduits: no record anywhere; Standard Detail G4.7 gives the minimum cover of a City electrical duct bank (nominal)
    curb_v = fb.get("curb_face_v")
    for f in features("street-lighting-conduits", "vanmap"):
        for part in geom_parts(f["geometry"]):
            pts = [F.uv(*c[:2]) for c in part]
            vehicular = curb_v is not None and any(v < curb_v for u, v in pts)
            nd = G47["vehicular_m"] if vehicular else G47["non_vehicular_m"]
            add("electrical_conduit", "street-lighting-conduits", "VanMap Infrastructure_Street_Lighting/95", pts, "nominal", nd, None,
                f"street-lighting conduit · wireset {f['properties'].get('WIRESET_TYPE') or '?'} · nominal cover {nd} m (G4.7)", {"wireset": f["properties"].get("WIRESET_TYPE")},
                cite=G47["cite"] + ("; the duct crosses the roadway (vehicular cover)" if vehicular else "; boulevard / sidewalk (non-vehicular cover)") + "; not surveyed (EDM §7.2.1: do not assume standard depth)",
                depth_bottom=nd + 0.10, extra={"duct_bank": "G4.7 fig. 1: 1 × 53 mm + 1 × 78 mm + 1 × 103 mm RPVC in a 325 mm trench (residential); fig. 2 both sides on arterials"})
    # City point layers (unknown)
    for dataset, kind, lab in (("sewer-catch-basins", "sewer_catch_basin", "catch basin · location approximate"),
                               ("street-lighting-poles", "street_lighting_pole", "street-lighting pole"),
                               ("street-lighting-junction-boxes", "junction_box", "lighting junction box"),
                               ("water-hydrants", "hydrant", "hydrant"),
                               ("water-control-valves", "valve", "water control valve"),
                               ("sewer-manholes", "manhole", "sewer manhole")):
        for f in features(dataset):
            if not f["geometry"]:
                continue
            for part in geom_parts(f["geometry"]):
                pts = [F.uv(*c[:2]) for c in part]
                props = {k: f["properties"].get(k) for k in ("type", "cover_elevation_m", "material") if k in f["properties"]}
                add(kind, dataset, "City Open Data", pts, "unknown" if kind != "manhole" else "record", None, None,
                    lab + (f" · rim {props['cover_elevation_m']} m" if props.get("cover_elevation_m") else ""), props,
                    cite="plan position only" if kind != "manhole" else "cover_elevation_m as published")
    # transit (unknown, approximate)
    transit = []
    for f in features("rapid-transit-lines"):
        for part in geom_parts(f["geometry"]):
            pts = [F.uv(*c[:2]) for c in part]
            if in_extent(pts, ext):
                transit.append(f["properties"].get("line"))
                add("transit", "rapid-transit-lines", "City Open Data", pts, "unknown", None, None,
                    f"{f['properties'].get('line')} · alignment approximate · structure not published", {},
                    cite="City: 'as most of the line locations are underground, their locations are approximate'")
    # nominal corridors (task 4, EDM §7): the private utilities nobody publishes, at Table 7-1 cover, lateral position undetermined
    corridors = []
    if avail and band and fb.get("back_of_curb_v") is not None:
        span = [fb["back_of_curb_v"], pl]
        for i, (kind, t71) in enumerate(TABLE_7_1.items()):
            vc = r2((span[0] + span[1]) / 2)
            fid += 1
            c = {"id": f"f{fid}", "kind": "corridor", "utility": kind, "owner": t71["owner"], "dataset": None, "source": "EDM 2026 Table 7-1 p.202 (nominal cover); no source for the position",
                 "geometry": "corridor", "path_uv": [[blk["u_from"], vc], [blk["u_to"], vc]], "corridor_v": [r2(span[0]), r2(span[1])],
                 "position": "undetermined: no City source gives the lateral position of a private main duct; the corridor spans the boulevard from the back of curb to the property line",
                 "grade": "nominal", "depth_top_m": t71["depth_m"], "depth_bottom_m": r2(t71["depth_m"] + CORRIDOR_THICKNESS_M), "diameter_mm": None,
                 "label": f"{t71['owner']} {kind} · nominal corridor · cover {t71['depth_m']} m (Table 7-1) · position undetermined",
                 "cite": "EDM 2026 §7.2.1 p.201 (\"It must not be assumed that all utilities are at standard depth\"); Table 7-1 p.202: " + t71["as_printed"] + "; drawn " + t71["drawn"],
                 "properties": {}, "where": "band", "nominal_corridor": True}
            facilities.append(c); corridors.append(c)
    not_published = list(NOT_PUBLISHED)
    if transit:
        not_published.append({"kind": "transit structure", "owner": "TransLink", "note": f"{', '.join(transit)} crosses this window; tunnel / station structure not published"})

    # ---- buildings and parcels (context) -----------------------------------------------------------
    buildings, parcels = [], []
    for f in features("building-footprints-2015"):
        for ring in geom_parts(f["geometry"]):
            pts = [F.uv(*c[:2]) for c in ring]
            if in_extent(pts, ext):
                buildings.append({"ring_uv": clip_pts(pts, ext), "height_m": NOMINAL_BUILDING_HEIGHT_M, "grade": "footprint 2015 (City); height nominal"})
    for f in features("property-parcel-polygons"):
        for ring in geom_parts(f["geometry"]):
            pts = [F.uv(*c[:2]) for c in ring]
            if in_extent(pts, ext):
                parcels.append(clip_pts(pts, ext))

    # ---- strips / segments / zones -----------------------------------------------------------------
    strips = [{k: s.get(k) for k in ("u0", "u1", "v0", "v1", "type", "kind", "dataset", "clearance_m", "provenance")}
              for s in (design.get("strips") or []) if s.get("applied")]
    zones = []
    if avail and design.get("extensions"):
        for z, zs in zip(design["extensions"]["zones"], (sel.get("extensions") or {}).get("zones", [])):
            zones.append({**{k: z[k] for k in ("side", "soil_type", "provenance", "v_from", "v_to", "width_applied_m", "under")},
                          "status": zs.get("status"), "credited_m3": zs.get("credited_m3"), "note": zs.get("note"),
                          "connection": zs.get("connection"), "blocked_by": zs.get("blocked_by"), "usable_area_m2": zs.get("usable_area_m2"),
                          "gross_area_m2": zs.get("gross_area_m2"), "physical_m3": zs.get("physical_m3"),
                          "u_from": blk["u_from"], "u_to": blk["u_to"], "depth_m": zs.get("depth_m") or depth})
        ext_strips = [{k: s.get(k) for k in ("u0", "u1", "v0", "v1", "type", "kind", "dataset", "clearance_m")}
                      for s in design["extensions"]["strips"] if s.get("applied")]
    else:
        ext_strips = []

    # ---- need box (Table 9-2 volume as a box the section of the band) ------------------------------
    need = None
    all_strips = strips + ext_strips
    cond = design["selected"]["summary"]["planting_condition"] if avail else None
    usable = None
    if avail:
        e = sel.get("extensions") or {}
        usable = e.get("share_total_m3") if e.get("share_total_m3") is not None else sel.get("share_m3")
    if avail and sel_cell and sel.get("required_m3") and band:
        cube = sel["required_m3"] ** (1 / 3)
        box = need_box_for(sel["u"], sel["required_m3"], band, depth, sel_cell, all_strips)
        need = {"required_m3": sel["required_m3"], "class": knobs["target_tree_class"]["value"], "condition": cond,
                "usable_m3": r2(usable) if usable is not None else None,
                "fits": (usable is not None and sel["required_m3"] <= usable + 1e-9) if sel.get("share_status") == "KNOWN" else None,
                "box": box,
                "cube": {"side_m": r2(cube), "u": sel["u"], "v": r2((band["v_from"] + band["v_to"]) / 2), "note": "cube of the same volume, for comparison only"},
                "cell": {"u0": sel_cell["u_from"], "u1": sel_cell["u_to"], "width_m": r2(sel_cell["u_to"] - sel_cell["u_from"])}}

    # ---- every listed tree's own need-box (chapter 04: the existing trees as they are) --------------
    for t in trees:
        sr = t.get("species_ref")
        t["own_need"] = None
        if avail and band and sr and sr["listed"] and sr.get("volume_m3") and cond and t.get("cell") and t["cell"].get("u_from") is not None:
            vol = sr["volume_m3"][cond]
            t["own_need"] = {"class": sr["class"], "required_m3": vol, "condition": cond, **need_box_for(t["u"], vol, band, depth, t["cell"], all_strips)}

    # ---- roots: a NOMINAL drawing that fills the credited soil (09 standard, key roots) ------------
    for t in trees:
        sr = t.get("species_ref"); rf = (lib[sr["id"]].get("root_form") if sr else None) or {"value": "heart", "depth_ratio_of_credited": 0.8}
        vol = credited_volume(t, band, depth, design.get("segments") if avail else [], zones)
        t["roots"] = {"form": rf["value"], "depth_ratio": rf["depth_ratio_of_credited"], "provenance": "NOMINAL",
                      "volume": vol, "note": "drawn to the credited soil, cut at clearance strips and the neighbour's cell; not a measured extent"} if vol else None

    # ---- the candidate species dropped into the selected cell (chapter 04) -------------------------
    candidate = None
    if a.candidate:
        if a.candidate not in lib:
            sys.exit(f"--candidate {a.candidate!r}: not in the library ({SPECIES_DIR / '_index.json'})")
        crec = lib[a.candidate]
        cs = species_summary(crec, None)
        cbox = None
        if avail and band and cs["listed"] and cs.get("volume_m3") and cond and sel_cell:
            cbox = need_box_for(sel["u"], cs["volume_m3"][cond], band, depth, sel_cell, all_strips)
        creq = cs["volume_m3"][cond] if (cs["listed"] and cs.get("volume_m3") and cond) else None
        crf = crec.get("root_form") or {"value": "heart", "depth_ratio_of_credited": 0.8}
        candidate = {**cs, "u": sel["u"], "v": sel["v"], "in_cell_of": sel_id, "required_m3": creq,
                     "roots": ({"form": crf["value"], "depth_ratio": crf["depth_ratio_of_credited"], "provenance": "NOMINAL", "volume": credited_volume(sel, band, depth, design.get("segments") if avail else [], zones)} if avail and band else None),
                     "usable_m3": r2(usable) if usable is not None else None,
                     "fits": ((usable is not None and creq <= usable + 1e-9) if (creq is not None and sel.get("share_status") == "KNOWN") else None),
                     "class_matches_knob": (cs["class"] == knobs["target_tree_class"]["value"]) if cs["listed"] else None,
                     "box": cbox, "provenance": "DESIGN_ASSUMPTION",
                     "note": "a species card in the selected cell; drawn at the species' City p90 height with a nominal crown; the box is the Table 9-2 volume for its Table 9-3 class"}

    # ---- the library as cards, each judged against this cell (11 §6: fits when class volume ≤ usable share) ----
    cards = []
    here = {(t["genus"], engine._species_word(t["species"])) for t in trees}
    for sidx in lib_index["species"]:
        r = lib[sidx["id"]]
        cs = species_summary(r, None)
        fit = {"fits": None, "usable_m3": r2(usable) if usable is not None else None, "required_m3": None, "reason": ""}
        if not cs["listed"]:
            fit["reason"] = "not in Table 9-3: no class, no box; set the class yourself"
        elif not avail or cond is None:
            fit["reason"] = "no band at this curb position"
        elif sel.get("share_status") != "KNOWN" or usable is None:
            fit["required_m3"] = cs["volume_m3"][cond]; fit["reason"] = "this cell's share is not KNOWN (review required)"
        else:
            req = cs["volume_m3"][cond]; fit["required_m3"] = req; fit["fits"] = req <= usable + 1e-9
            fit["reason"] = (f"needs {req} m³, cell has {r2(usable)} m³" if not fit["fits"] else f"{req} m³ ≤ {r2(usable)} m³ usable")
        cards.append({**cs, "on_this_face": (r["genus"], r["species"]) in here, "fit": fit,
                      "city_height_p50_m": r["city"]["height_m"]["p50"], "on_block_faces": r["on_block_faces"]["sites"]})
    library = {"index": "data/species/_index.json", "table": "EDM 2026 §9.3.4.1 Table 9-3 pp.351–352", "city_copy_date": lib_index["city_copy_date"],
               "count_listed": lib_index["count_listed"], "count_unlisted": lib_index["count_unlisted"], "condition": cond,
               "rule": "a card fits when its Table 9-2 volume for the class (Shared/Row here) ≤ the usable share of the selected cell (band + KNOWN zones)",
               "cards": cards}

    # ---- readouts in plain words --------------------------------------------------------------------
    n_tree = len(trees)
    side = (face.get("side") or "").replace("_", " ")
    cw, ce = (blk.get("cross_street_west") or {}).get("name"), (blk.get("cross_street_east") or {}).get("name")
    r01 = (f"{n_tree} trees on the {side} of {face['hblock']}" + (f", {cw} to {ce}" if cw and ce else "") +
           f". At this tree the neighbours stand {sel['gap_west_m'] or '—'} m west and {sel['gap_east_m'] or '—'} m east; "
           f"the property line is {pl} m behind the trunk and the street centreline {d_cl} m in front.")
    by_grade = {}
    for fc in facilities:
        if fc["where"] in ("cell", "band", "face"):
            by_grade.setdefault(fc["grade"], []).append(fc)
    inband = [fc for fc in facilities if fc["where"] in ("cell", "band")]
    r02 = (f"The City records {sum(len(v) for v in by_grade.values())} facilities on this block face: "
           + ", ".join(f"{len(v)} with {g} depth" for g, v in by_grade.items()) + ". "
           + (f"{len(inband)} of them sit inside the band itself. " if inband else "None sits inside the band itself. ")
           + "Not published anywhere: " + ", ".join(x["kind"] for x in not_published) + "."
           + (f" Gas, BC Hydro and telecom are drawn as nominal corridors at EDM Table 7-1 cover, position undetermined." if corridors else ""))
    ground = ground_block(F, blk, d_cl, pl, [fb.get("sidewalk_road_edge_v"), fb.get("sidewalk_property_edge_v")], sel)
    gs = ground["sidewalk"]; gc = ground["cases_311"]; gb = ground["borehole"]
    r02 += (f" The sidewalk here is rated {gs['rating']} (City survey 2021)." if gs.get("rating") else " No City sidewalk rating within 15 m.")
    if gc.get("since_2022", {}).get("count") is not None:
        r02 += f" {gc['since_2022']['count']} tree, boulevard or utility 3-1-1 cases on this block since 2022 ({gc['2009_2021'].get('count', '—')} in 2009–2021)."
    if gb.get("status") == "KNOWN":
        r02 += f" The nearest logged borehole (BC GWELLS well {gb['well_tag_number']}, {gb['date'] or 'undated'}) is {gb['distance_m']} m away; what it found is not this site's ground."
    if avail:
        s = design["selected"]["summary"]
        wfb = fb.get("widths_m", {})
        r03 = (f"Front boulevard {wfb.get('front_boulevard')} m: property line to curb {wfb.get('property_line_to_curb_face')} m, "
               f"minus sidewalk {wfb.get('sidewalk_clear')} m, back boulevard {wfb.get('back_boulevard')} m and curb {wfb.get('curb')} m. "
               f"Depth {depth} m. Cut into {len(design.get('segments', []))} segment(s) by {design.get('crossing_count')} crossing(s); "
               f"{design.get('partial_count')} clearance strip(s) take width. This tree's share: {r2(s.get('share_m3'))} m³ "
               f"against Table 9-2 {s.get('required_m3')} m³ ({s.get('planting_condition', '').replace('_', ' ')}, {knobs['target_tree_class']['value']})"
               + (f"; it would carry {', '.join(s['benchmark_classes'])}." if s.get("benchmark_classes") else "."))
        if sel.get("extensions"):
            e = sel["extensions"]
            r03 += " " + " ".join(f"Extension {z['side']} ({z['soil_type'].replace('_', ' ')}): {z['status'].lower().replace('_', ' ')}"
                                  + (f", {z['credited_m3']} m³" if z.get("credited_m3") else "") + "." for z in e["zones"])
            r03 += f" Total with zones {e['share_total_m3']} m³."
    else:
        r03 = design.get("note") or "no band at this curb position"
    # 04: the existing tree as it is, then the candidate
    sr = sel.get("species_ref")
    hname = (sr["common"] if sr else f"{sel['genus']} {sel['species']}".title())
    r04 = (f"This tree is a {hname} ({sel['genus'].title()} {sel['species'].lower()}"
           + (f" '{sel['cultivar'].title()}'" if sel.get("cultivar") and sel["cultivar"] != "NONE" else "") + f"), {sel['height_m']} m by the City's record. ")
    if sel["table_9_3"]["listed"]:
        r04 += (f"Table 9-3 lists it as {sel['table_9_3']['class']}, so it stands over its own box: {sel['own_need']['required_m3']} m³ = {sel['own_need']['length_m']} m of this band"
                if sel.get("own_need") else f"Table 9-3 lists it as {sel['table_9_3']['class']}") + ". "
    else:
        r04 += "It is not in Table 9-3: no class, no box. "
    n_listed = sum(1 for t in trees if t["table_9_3"]["listed"])
    r04 += f"{n_listed} of the {len(trees)} trees on this face are listed species. "
    if candidate:
        if candidate["listed"] and candidate.get("box"):
            b = candidate["box"]
            r04 += (f"Dropped in: {candidate['common']} ({candidate['class']}, {candidate['required_m3']} m³ shared row): a box {b['length_m']} m long in this band "
                    f"against a cell {need['cell']['width_m'] if need else '—'} m wide with {candidate['usable_m3']} m³ usable → "
                    + ("fits" if candidate["fits"] else "does not fit" if candidate["fits"] is False else "not judged (share not KNOWN)") + "."
                    + (f" It runs {sum(r2(x['u1'] - x['u0']) for x in b['beyond_cell'])} m into the neighbour's cell." if b["beyond_cell"] else "")
                    + (f" {len(b['conflicts'])} clearance strip(s) overlap the box (red): " + ", ".join(sorted({x['kind'].replace('_', ' ') for x in b['conflicts']})) + "." if b["conflicts"] else ""))
        else:
            r04 += f"Dropped in: {candidate['common']}, not in Table 9-3: it stands here grey, without a box; set the class yourself."
    else:
        r04 += "Drag a species card from the library into this cell."

    # ---- 05: the slab and its numbered captions (every line a number from this file) ----------------
    slab = {"u0": r2(sel["u"] - ZOOM_CELL_HALF_M), "u1": r2(sel["u"] + ZOOM_CELL_HALF_M), "v0": r2(-d_cl), "v1": pl, "depth_m": GROUND_DEPTH_M,
            "note": "one thick block of the street pulled out: property line to centreline, the cut window long, 8 m deep; end faces carry the transverse section"}
    caps = []
    if avail and band:
        wfb = fb.get("widths_m", {})
        caps.append({"n": 1, "title": "the band", "at": {"u": sel["u"], "v": r2((band["v_from"] + band["v_to"]) / 2), "z": -depth / 2},
                     "text": f"front boulevard {wfb.get('front_boulevard')} m wide, {depth} m deep; this tree's share {r2(sel.get('share_m3'))} m³"
                             + (f", {r2(sel['extensions']['share_total_m3'])} m³ with the zones" if sel.get("extensions") and sel["extensions"].get("share_total_m3") is not None else "")})
        cut_by = [fc for fc in facilities if fc["where"] in ("cell", "band")]
        strips_here = sorted({(x.get("kind") or "?").replace("_", " ") for x in (need["box"]["conflicts"] if need and need.get("box") else [])})
        if strips_here:
            f0 = next((fc for fc in facilities if fc["kind"] == (need["box"]["conflicts"][0].get("kind"))), None)
            caps.append({"n": 2, "title": "what cuts it", "at": ({"u": sel["u"], "v": r2(sum(f0["path_uv"][0]) / 1 and f0["path_uv"][0][1]), "z": -(f0.get("depth_top_m") or 1.0)} if f0 else None),
                         "text": f"Table 2-2 clearance of the {', '.join(strips_here)} takes width from the band" + (f"; {len(cut_by)} facilities sit in the band itself" if cut_by else "")})
        if candidate:
            caps.append({"n": 3, "title": "the tree", "at": {"u": sel["u"], "v": sel["v"], "z": 2.0},
                         "text": f"{candidate['common']}" + (f", Table 9-3 {candidate['class']}, needs {candidate['required_m3']} m³ → " + ("fits" if candidate["fits"] else "does not fit" if candidate["fits"] is False else "not judged") if candidate["listed"] else ", not in Table 9-3: no box")})
        else:
            sr = sel.get("species_ref")
            caps.append({"n": 3, "title": "the tree", "at": {"u": sel["u"], "v": sel["v"], "z": 2.0},
                         "text": f"{sr['common'] if sr else sel['genus'].title()}, {sel['height_m']} m by the City" + (f", Table 9-3 {sel['table_9_3']['class']}: needs {sel['own_need']['required_m3']} m³" + (" → fits" if sel.get("share_m3") and sel["own_need"]["required_m3"] <= (usable or 0) else " → does not fit") if sel.get("own_need") else ", not in Table 9-3: no box")})
        unk = [fc for fc in facilities if fc["where"] in ("cell", "band") and fc["grade"] == "unknown"]
        caps.append({"n": 4, "title": "what the roots reach", "at": {"u": sel["u"] + 1.5, "v": band["v_from"] + 0.3, "z": -depth * 0.7},
                     "text": "roots drawn to the credited soil only (nominal); they stop at the black and at every clearance"
                             + (f"; {len(unk)} facility(ies) of unknown depth inside the band: " + ", ".join(sorted({u['kind'].replace('_', ' ') for u in unk})) if unk else "")})
    caps.append({"n": 5, "title": "not published", "at": None, "text": "no position anywhere for " + ", ".join(x["kind"] for x in not_published)
                 + (" — gas, hydro and telecom drawn as nominal corridors at Table 7-1 cover, position undetermined; " if corridors else " — ") + "the black stays black"})
    r05 = " ".join(f"{c['n']} {c['text']}." for c in caps)

    scene = {
        "site_id": a.site, "engine_file": f"data/processed/block_face_{a.site}.json", "exported_on": date.today().isoformat(),
        "title": {"street": face["street_name"], "hblock": face["hblock"], "side": side, "cross_west": cw, "cross_east": ce,
                  "selected_tree": f"{sel['genus']} {sel['species']}".strip(), "selected_site_id": sel_id},
        "frame": face["frame"], "units": "metres in the engine frame: u along the street (east+), v toward the property (+), z up, z = 0 road surface (nominal)",
        "extent": {k: r2(v) for k, v in ext.items()},
        "street": {"centreline_v": r2(-d_cl), "curb_face_v": fb.get("curb_face_v"), "back_of_curb_v": fb.get("back_of_curb_v"),
                   "sidewalk_v": [fb.get("sidewalk_road_edge_v"), fb.get("sidewalk_property_edge_v")],
                   "back_boulevard_v": [fb.get("sidewalk_property_edge_v"), pl], "property_line_v": pl,
                   "widths_m": fb.get("widths_m"), "sources": fb.get("sources"),
                   "cross_streets": [c for c in ({"name": cw, "u": (blk.get("cross_street_west") or {}).get("centreline_u")},
                                                 {"name": ce, "u": (blk.get("cross_street_east") or {}).get("centreline_u")}) if c["name"]],
                   "block": {"u_from": blk["u_from"], "u_to": blk["u_to"], "outline_uv": blk.get("outline_local_uv")}},
        "knobs": {k: knobs.get(k) for k in ("curb_offset_from_centreline_m", "soil_depth_m", "target_tree_class", "soil_type", "land_use", "width_level", "tree_state", "extensions")},
        "band": {"design": ({**band, "depth_m": depth, "provenance": knobs["curb_offset_from_centreline_m"]["provenance"]} if band else None),
                 "existing": ({**existing["band"], "depth_m": existing["inputs"]["soil_depth_m"]["value"], "grade": existing["grade"]}
                              if existing.get("available") else {"available": False, "grade": existing.get("grade"), "missing": existing.get("missing")}),
                 "segments": design.get("segments") if avail else [], "strips": strips,
                 "zones": zones, "zone_strips": ext_strips},
        "trees": trees,
        "facilities": facilities, "not_published": not_published, "corridors": corridors, "ground": ground,
        "buildings": buildings, "parcels": parcels,
        "need": need,
        "candidate": candidate,
        "library": library,
        "slab": slab, "captions": caps,
        "cut": {"long_v": r2(CUT_OFFSET_V), "zoom_half_m": ZOOM_CELL_HALF_M, "depth_m": GROUND_DEPTH_M, "note": "long section: vertical plane parallel to the street just behind the trunks; the property half is removed; ground body to -8 m"},
        "readout": {"01": r01, "02": r02, "03": r03, "04": r04, "05": r05},
        "legend": {"grades": {"record": "solid tube · City record (VanMap)", "derived": "thin solid tube · manhole rim − invert",
                              "nominal": "dashed tube · EDM minimum cover, cited", "unknown": "vertical dashed sheet · depth unknown"},
                   "black": "black = ground not credited or not known (GRI p.18)",
                   "hatch": "45° hatch = typed design assumption; solid = evidenced; 135° hatch = Table 2-2 clearance strip",
                   "trees": "white hull with ink edges = Table 9-3 species (its own box below); grey edges = not listed, no box; accent edges = the candidate card; crown form and width nominal",
                   "need": "dashed accent box = Table 9-2 volume as this band's section × length (project interpretation); red hatch = a clearance strip crosses it; red dash = the box runs into the neighbour's cell",
                   "roots": "roots drawn to the credited soil, not a measured extent; habit from the WUR root atlas where a plate exists (REFERENCE), else nominal",
                   "protection": "dashed ring at grade = By-law 9958 Schedule A protection radius for the City trunk diameter (R32, reference): a construction distance, not a root extent",
                   "corridor": "dashed corridor across the boulevard = private utility (gas / BC Hydro / telecom) at EDM Table 7-1 minimum cover, lateral position undetermined (nominal)",
                   "conduit_cover": "street-lighting conduits at Standard Detail G4.7 minimum cover (nominal), not surveyed",
                   "ground": "sidewalk rating and 3-1-1 counts are City records on this block; the borehole is a provincial record at its own distance; the surficial unit is not obtained"},
    }
    out = pathlib.Path(a.out) if a.out else PROCESSED / f"scene_{a.site}.json"
    out.write_text(json.dumps(scene, ensure_ascii=False), encoding="utf-8")
    shown = out.relative_to(ROOT) if str(out).startswith(str(ROOT)) else out
    print(f"wrote {shown}: {len(trees)} trees, {len(facilities)} facilities "
          f"({', '.join(f'{g} {len(v)}' for g, v in by_grade.items())} on the face), {len(buildings)} buildings, {len(zones)} zones")


if __name__ == "__main__":
    sys.exit(main())
