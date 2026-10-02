"""
Fetch City of Vancouver VanMap ArcGIS REST layers that carry the depth and dimension fields the
Open Data portal omits (11_redefinition_2026-09-28.md §5; facts in reports/11_fact_check_2026-09-28.md §5.4).

Source: https://maps.vancouver.ca/server/rest/services/ (the VanMap viewer services, City-owned,
queryable without login; no licence statement on the service — the user accepted it on
2026-09-28 as a City source distinct from the Open Data licence). Nothing in the attribute
content is modified: Esri JSON is converted to GeoJSON (WGS84, requested with outSR=4326),
epoch-millisecond dates are also written as ISO strings in a parallel *_iso field.

Layers (id → what it adds):
  Infrastructure_Water/MapServer/11  Water distribution mains   DEPTH_OF_COVER_M, DIAMETER, MATERIAL, INSTALLATION_DATE
  Infrastructure_Water/MapServer/14  Water transmission mains   same
  Infrastructure_Water/MapServer/13  DFPS mains                 same
  Infrastructure_Water/MapServer/9   Abandoned water mains      same
  Infrastructure_Sewer/MapServer/35  Sanitary mains             UPSTREAM_INVERT, DWNSTREAM_INVERT (m elev.), DIAMETER_INSIDE, GRADE, INSTALLDATE
  Infrastructure_Sewer/MapServer/36  Storm mains                same
  Infrastructure_Sewer/MapServer/37  Combined mains             same
  Infrastructure_Sewer/MapServer/29  Sewer manholes             RIMELEV (m), EFLNTTYPE
  Infrastructure_Sewer/MapServer/104 Sewer service lines        DEPTH_AT_PL, OFFSET_FROM_PL, DIAMETER_INSIDE (private connections)
  Infrastructure_Street_Lighting/MapServer/95  Street lighting conduits   WIRESET_TYPE only (no depth; kept for parity)
  Environment/MapServer/10           Peat areas (unconfirmed)   ground-condition context

Run (defaults reproduce the King Edward pilot window):
  python3 scripts/fetch_vanmap.py
  python3 scripts/fetch_vanmap.py --lon -123.1163 --lat 49.2490 --radius 900 --window king_edward_window
"""
import argparse
import json
import math
import pathlib
import sys
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "vanmap"
BASE = "https://maps.vancouver.ca/server/rest/services/VanMapViewer/"
DEFAULT_LON, DEFAULT_LAT, DEFAULT_RADIUS_M, DEFAULT_WINDOW = -123.1163, 49.2490, 900, "king_edward_window"

LAYERS = {
    "water-distribution-mains": ("Infrastructure_Water/MapServer/11", "water"),
    "water-transmission-mains": ("Infrastructure_Water/MapServer/14", "water"),
    "dfps-water-mains": ("Infrastructure_Water/MapServer/13", "water"),
    "abandoned-water-mains": ("Infrastructure_Water/MapServer/9", "water"),
    "sanitary-mains": ("Infrastructure_Sewer/MapServer/35", "sewer"),
    "storm-mains": ("Infrastructure_Sewer/MapServer/36", "sewer"),
    "combined-mains": ("Infrastructure_Sewer/MapServer/37", "sewer"),
    "sewer-manholes": ("Infrastructure_Sewer/MapServer/29", "sewer"),
    "sewer-service-lines": ("Infrastructure_Sewer/MapServer/104", "sewer"),
    "street-lighting-conduits": ("Infrastructure_Street_Lighting/MapServer/95", "street_lighting"),
    "peat-areas-unconfirmed": ("Environment/MapServer/10", "ground"),
}
PAGE = 1000


def fetch_json(url, timeout=180):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read())


def envelope(lon, lat, radius_m):
    dlat = radius_m / 111_320.0
    dlon = radius_m / (111_320.0 * math.cos(math.radians(lat)))
    return {"xmin": lon - dlon, "ymin": lat - dlat, "xmax": lon + dlon, "ymax": lat + dlat,
            "spatialReference": {"wkid": 4326}}


def esri_to_geojson_geometry(g, gtype):
    if g is None:
        return None
    if gtype == "esriGeometryPoint":
        return {"type": "Point", "coordinates": [g["x"], g["y"]]}
    if gtype == "esriGeometryPolyline":
        paths = g.get("paths", [])
        return {"type": "LineString", "coordinates": paths[0]} if len(paths) == 1 else {"type": "MultiLineString", "coordinates": paths}
    if gtype == "esriGeometryPolygon":
        rings = g.get("rings", [])
        return {"type": "Polygon", "coordinates": rings}
    return None


def add_iso_dates(attrs, fields):
    for f in fields:
        if f.get("type") == "esriFieldTypeDate":
            v = attrs.get(f["name"])
            if isinstance(v, (int, float)):
                attrs[f["name"] + "_iso"] = datetime.fromtimestamp(v / 1000, tz=timezone.utc).date().isoformat()
    return attrs


def fetch_layer(layer_path, env):
    info = fetch_json(BASE + layer_path + "?f=json")
    gtype = info.get("geometryType")
    fields = info.get("fields", [])
    feats, offset = [], 0
    while True:
        q = urllib.parse.urlencode({
            "f": "json", "where": "1=1", "geometry": json.dumps(env), "geometryType": "esriGeometryEnvelope",
            "inSR": 4326, "spatialRel": "esriSpatialRelIntersects", "outFields": "*", "outSR": 4326,
            "returnGeometry": "true", "resultOffset": offset, "resultRecordCount": PAGE})
        r = fetch_json(BASE + layer_path + "/query?" + q)
        if "error" in r:
            raise RuntimeError(f"{layer_path}: {r['error']}")
        for f in r.get("features", []):
            feats.append({"type": "Feature", "properties": add_iso_dates(f.get("attributes", {}), fields),
                          "geometry": esri_to_geojson_geometry(f.get("geometry"), gtype)})
        if not r.get("exceededTransferLimit") or not r.get("features"):
            break
        offset += len(r["features"])
    return info, feats


def fetch_window(lon, lat, radius_m, window, only=None):
    RAW.mkdir(parents=True, exist_ok=True)
    env = envelope(lon, lat, radius_m)
    log_path = RAW / f"{window}__vanmap_fetch_log.json"
    log = json.loads(log_path.read_text()) if log_path.exists() else {"layers": []}
    log.update({"fetched_on": date.today().isoformat(), "source": BASE, "licence": "none stated on the service (VanMap viewer services)",
                "window": window, "centre": {"lon": lon, "lat": lat}, "radius_m": radius_m, "envelope_wgs84": env})
    by_id = {e["layer_id"]: e for e in log.get("layers", [])}
    for lid, (path, group) in LAYERS.items():
        if only and lid not in only:
            continue
        info, feats = fetch_layer(path, env)
        out = RAW / f"{lid}__{window}.geojson"
        out.write_text(json.dumps({"type": "FeatureCollection", "features": feats}), encoding="utf-8")
        (RAW / f"{lid}__layer_info.json").write_text(json.dumps(info, indent=1), encoding="utf-8")
        by_id[lid] = {"layer_id": lid, "service_layer": path, "name": info.get("name"), "geometry_type": info.get("geometryType"),
                      "fields": [f["name"] for f in info.get("fields", [])], "fetched_on": date.today().isoformat(),
                      "features_saved": len(feats), "saved_as": str(out.relative_to(ROOT)), "layer_group": group}
        print(f"{lid}: {len(feats)} features -> {by_id[lid]['saved_as']}")
    log["layers"] = [by_id[k] for k in sorted(by_id)]
    log_path.write_text(json.dumps(log, indent=1), encoding="utf-8")
    return log


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--lon", type=float, default=DEFAULT_LON)
    p.add_argument("--lat", type=float, default=DEFAULT_LAT)
    p.add_argument("--radius", type=float, default=DEFAULT_RADIUS_M, help="metres (envelope half-width)")
    p.add_argument("--window", default=DEFAULT_WINDOW)
    p.add_argument("--only", nargs="*", default=None, choices=list(LAYERS))
    a = p.parse_args(argv)
    fetch_window(a.lon, a.lat, a.radius, a.window, a.only)


if __name__ == "__main__":
    sys.exit(main())
