"""
Fetch City of Vancouver Open Data context layers for ANY site window.

Generalises scripts/fetch_king_edward_context.py (Round 5) so the tool can be run on any
Vancouver location (08_redefinition_2026-09-22.md §2.8). Nothing in the feature content is
modified; the only filter is spatial (whole features within RADIUS of the centre, as served).
Each download is saved with its API metadata and the exact query used.

Datasets (Opendatasoft Explore API v2.1, Open Government Licence – Vancouver):

  above ground / cadastral (Round 5)
    right-of-way-widths           legal property-line-to-property-line widths (feet as published;
                                  NOT curb-to-curb, NOT boulevard width)
    block-outlines                road / property edge of each City block
    building-footprints-2015      building footprints, 2015 vintage
    property-parcel-polygons      parcel polygons (the property line the tool measures from)
    lanes                         lane centrelines
    elevation-contour-lines-1-metre-contours   2002 orthophoto contours, "approximate" (kept for
                                  provenance; the redefined tool does not draw terrain)

  underground utilities (Round 8) — plan position only; depth is not published
    water-distribution-mains      diameter_mm, installation_date, material
    water-transmission-mains
    sewer-mains                   effluent_type (Sanitary / Storm / Combined), material
    sewer-catch-basins            points, "location approximate"
    street-lighting-conduits      wireset_type
    street-lighting-poles         points

  Basis for loading utilities: GRI Planting Guidelines p.18 ("not interrupted by any utility
  conflicts") and EDM 2026 Table 2-2 tree clearances (water / sewer mains 2.0 m, electrical
  conduits 0.3 m from trunk edge) — see sources/02c_supporting_source_extract_edm_2-2-5.pdf.

  underground, phase 1 (11_redefinition §5) — plan position only on the portal
    sewer-manholes (cover_elevation_m), gvrd-sewer-trunk-mains, abandoned-water-mains,
    dedicated-fire-protection-systems-dfps-water-mains, water-control-valves (offsets from
    property line), water-hydrants, street-lighting-junction-boxes / -abandoned-conduits /
    -service-panels, traffic-signals, property-easements, rapid-transit-lines ("locations are
    approximate" as most are underground), rapid-transit-stations
  address resolution (§7a): property-addresses, street-intersections
  Depth fields are not on the portal; see scripts/fetch_vanmap.py.

Run (defaults reproduce the King Edward pilot window):
  python3 scripts/fetch_context.py
  python3 scripts/fetch_context.py --lon -123.1163 --lat 49.2490 --radius 900 --window king_edward_window
  python3 scripts/fetch_context.py --only sewer-mains water-distribution-mains
"""
import argparse
import json
import pathlib
import sys
import urllib.parse
import urllib.request
from datetime import date

ROOT = pathlib.Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
BASE = "https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets"

# Midpoint of W King Edward Av between Heather St and Ontario St; radius covers the 1.12 km corridor.
DEFAULT_LON, DEFAULT_LAT, DEFAULT_RADIUS_M, DEFAULT_WINDOW = -123.1163, 49.2490, 900, "king_edward_window"

CONTEXT_DATASETS = ["right-of-way-widths", "block-outlines", "building-footprints-2015",
                    "property-parcel-polygons", "lanes", "elevation-contour-lines-1-metre-contours"]
UTILITY_DATASETS = ["water-distribution-mains", "water-transmission-mains", "sewer-mains",
                    "sewer-catch-basins", "street-lighting-conduits", "street-lighting-poles"]
# Phase 1 (11_redefinition §5): every further underground-related layer the City publishes.
UNDERGROUND_EXTRA_DATASETS = ["sewer-manholes", "gvrd-sewer-trunk-mains", "abandoned-water-mains",
                              "dedicated-fire-protection-systems-dfps-water-mains", "water-control-valves",
                              "water-hydrants", "street-lighting-junction-boxes",
                              "street-lighting-abandoned-conduits", "street-lighting-service-panels",
                              "traffic-signals", "property-easements",
                              "rapid-transit-lines", "rapid-transit-stations"]
# Address resolution (11_redefinition §7a).
ADDRESS_DATASETS = ["property-addresses", "street-intersections"]
ALL_DATASETS = CONTEXT_DATASETS + UTILITY_DATASETS + UNDERGROUND_EXTRA_DATASETS + ADDRESS_DATASETS
GROUPS = {"context": CONTEXT_DATASETS, "utility": UTILITY_DATASETS, "underground_extra": UNDERGROUND_EXTRA_DATASETS,
          "address": ADDRESS_DATASETS, "all": ALL_DATASETS}


def group_of(ds):
    for g, lst in GROUPS.items():
        if g != "all" and ds in lst:
            return g
    return "context"


def fetch(url):
    with urllib.request.urlopen(url, timeout=180) as r:
        return r.read()


def fetch_window(lon, lat, radius_m, window, datasets):
    RAW.mkdir(parents=True, exist_ok=True)
    where = f"within_distance(geom, geom'POINT({lon} {lat})', {radius_m}m)"
    log_path = RAW / f"{window}__fetch_log.json"
    log = json.loads(log_path.read_text()) if log_path.exists() else {"datasets": []}
    log.update({"fetched_on": date.today().isoformat(), "licence": "Open Government Licence – Vancouver",
                "portal": "https://opendata.vancouver.ca", "window": window,
                "centre": {"lon": lon, "lat": lat}, "radius_m": radius_m, "spatial_filter": where})
    by_id = {e["dataset_id"]: e for e in log.get("datasets", [])}
    for ds in datasets:
        meta = json.loads(fetch(f"{BASE}/{ds}"))
        url = f"{BASE}/{ds}/exports/geojson?{urllib.parse.urlencode({'where': where})}"
        gj = json.loads(fetch(url))
        out = RAW / f"{ds}__{window}.geojson"
        out.write_text(json.dumps(gj), encoding="utf-8")
        (RAW / f"{ds}__dataset_metadata.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
        d = meta["metas"]["default"]
        by_id[ds] = {"dataset_id": ds, "title": d.get("title"), "records_in_dataset": d.get("records_count"),
                     "data_modified": d.get("modified"), "fetched_on": date.today().isoformat(),
                     "export_url": url, "features_saved": len(gj.get("features", [])),
                     "saved_as": str(out.relative_to(ROOT)),
                     "layer_group": group_of(ds)}
        print(f"{ds}: {by_id[ds]['features_saved']} features -> {by_id[ds]['saved_as']}")
    log["datasets"] = [by_id[k] for k in sorted(by_id)]
    log_path.write_text(json.dumps(log, indent=1), encoding="utf-8")
    return log


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--lon", type=float, default=DEFAULT_LON)
    p.add_argument("--lat", type=float, default=DEFAULT_LAT)
    p.add_argument("--radius", type=float, default=DEFAULT_RADIUS_M, help="metres")
    p.add_argument("--window", default=DEFAULT_WINDOW, help="suffix used in saved file names")
    p.add_argument("--only", nargs="*", default=None, help="subset of dataset ids (default: all)")
    p.add_argument("--group", choices=list(GROUPS), default="all")
    a = p.parse_args(argv)
    datasets = a.only if a.only else GROUPS[a.group]
    unknown = [d for d in datasets if d not in ALL_DATASETS]
    if unknown:
        p.error(f"unknown dataset id(s): {unknown}")
    fetch_window(a.lon, a.lat, a.radius, a.window, datasets)


if __name__ == "__main__":
    sys.exit(main())
