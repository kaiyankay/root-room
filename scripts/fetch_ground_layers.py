"""
Ground / landscape layers for the borehole column and the chunk labels (night of 2026-09-28, task 2).
Every fetch is recorded in data/raw/ground/_fetch_log.json with dataset id, fields, dates and licence.

  (a) City Open Data  sidewalk-condition-rating           full geojson (15,580 hundred-block segments, 2021)        CITY_DATA
  (b) City Open Data  3-1-1-service-requests (2022–)      service_request_type in {City and Park Trees Maintenance Case,
                      3-1-1-service-requests-2009-2021    Boulevard Maintenance Case, External Utility Concern Case}
                                                          with coordinates; csv exports                             CITY_DATA
  (c) BC GWELLS REST API (apps.nrs.gov.bc.ca/gwells/api/v1) every well in the City of Vancouver bbox + its
                      lithologydescription_set            PROVINCIAL RECORD (Province of BC, Open Government Licence – BC);
                                                          a well log at a distance, never interpolated to a site
  (d) GSC Armstrong & Hicock 1979 Map 1486A surficial geology (digital) — download when a URL is known (--gsc-url)
                                                          FEDERAL RECORD (NRCan / GSC, Open Government Licence – Canada)
  (e) City Open Data catalogue scan (api/explore/v2.1/catalog/datasets, all pages) filtered by landscape keywords
                                                          -> data/raw/ground/catalog_landscape_scan.json

Run:  python3 scripts/fetch_ground_layers.py            (a, b, c, e)
      python3 scripts/fetch_ground_layers.py --only catalog
      python3 scripts/fetch_ground_layers.py --only gsc --gsc-url <url>
"""
import argparse
import csv
import io
import json
import pathlib
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from datetime import date

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "raw" / "ground"
LOG = OUT / "_fetch_log.json"
OD = "https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets"
GWELLS = "https://apps.nrs.gov.bc.ca/gwells/api/v1"
# City of Vancouver bbox (local-area-boundary extent, rounded outward)
VAN_BBOX = {"sw_lat": 49.195, "sw_long": -123.230, "ne_lat": 49.320, "ne_long": -123.020}
SR_TYPES = ["City and Park Trees Maintenance Case", "Boulevard Maintenance Case", "External Utility Concern Case"]
KEYWORDS = ["tree", "canopy", "green", "soil", "boulevard", "garden", "horticult", "impervious", "pervious", "rain", "storm",
            "catchment", "watershed", "sidewalk", "landscape", "park", "planting", "vegetation", "natural", "shoreline", "creek",
            "elevation", "lidar", "orthophoto", "contour", "geolog", "peat", "ground", "surface", "lane", "curb", "street"]


def get(url, timeout=300, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as r:
                return r.read()
        except Exception as e:
            print(f"  retry {i + 1} after {e}", flush=True); time.sleep(15)
    raise RuntimeError(f"failed: {url}")


def log_entry(key, entry):
    log = json.loads(LOG.read_text()) if LOG.exists() else {}
    entry["fetched_on"] = date.today().isoformat()
    log[key] = entry
    LOG.write_text(json.dumps(log, indent=1, ensure_ascii=False), encoding="utf-8")


def od_meta(ds):
    d = json.loads(get(f"{OD}/{ds}"))
    m = d["metas"]["default"]
    return {"dataset_id": ds, "title": m.get("title"), "records_count": m.get("records_count"), "data_modified": m.get("modified"),
            "data_processed": m.get("data_processed"), "licence": m.get("license"), "publisher": m.get("publisher"),
            "fields": [f["name"] for f in d.get("fields", [])], "description": (m.get("description") or "")[:600]}


def fetch_sidewalk():
    meta = od_meta("sidewalk-condition-rating")
    url = f"{OD}/sidewalk-condition-rating/exports/geojson"
    gj = json.loads(get(url))
    p = OUT / "sidewalk-condition-rating.geojson"; p.write_text(json.dumps(gj), encoding="utf-8")
    from collections import Counter
    c = Counter(f["properties"].get("sidewalk_condition_index_rating") for f in gj["features"])
    log_entry("sidewalk-condition-rating", {**meta, "export_url": url, "features_saved": len(gj["features"]), "saved_as": str(p.relative_to(ROOT)),
                                            "rating_counts": dict(c), "grade": "CITY_DATA", "survey_year": 2021,
                                            "note": "Sidewalk Condition Index per hundred-block segment; a surface-distress rating, not a cause"})
    print(f"sidewalk: {len(gj['features'])} segments {dict(c)}")


def fetch_311(ds, key):
    meta = od_meta(ds)
    where = "service_request_type in (" + ",".join(f'"{t}"' for t in SR_TYPES) + ") and latitude is not null"
    url = f"{OD}/{ds}/exports/csv?" + urllib.parse.urlencode({"where": where, "delimiter": ";"})
    raw = get(url, timeout=900)
    p = OUT / f"{key}.csv"; p.write_bytes(raw)
    rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig")), delimiter=";"))
    from collections import Counter
    c = Counter(r.get("service_request_type") for r in rows)
    log_entry(key, {**meta, "export_url": url, "where": where, "rows_saved": len(rows), "saved_as": str(p.relative_to(ROOT)), "type_counts": dict(c),
                    "grade": "CITY_DATA", "note": "case counts only; closure reasons are administrative, not diagnoses; addresses geolocated by the City"})
    print(f"{key}: {len(rows)} rows {dict(c)}")


def fetch_gwells():
    q = dict(VAN_BBOX); q["limit"] = 100
    wells = []; offset = 0
    while True:
        d = json.loads(get(f"{GWELLS}/wells?" + urllib.parse.urlencode({**q, "offset": offset})))
        wells.extend(d["results"])
        if not d.get("next"):
            break
        offset += len(d["results"])
    tags = [w["well_tag_number"] for w in wells]
    lith = {}
    for i in range(0, len(tags), 20):
        chunk = tags[i:i + 20]
        d = json.loads(get(f"{GWELLS}/wells/lithology?" + urllib.parse.urlencode({"wells": ",".join(map(str, chunk)), "limit": 100})))
        for r in d["results"]:
            lith[r["well_tag_number"]] = r.get("lithologydescription_set") or []
        time.sleep(0.2)
    keep = ["well_tag_number", "well_class", "well_subclass", "intended_water_use", "well_status", "street_address", "city", "latitude", "longitude",
            "coordinate_acquisition_code", "ground_elevation", "ground_elevation_method", "construction_start_date", "construction_end_date",
            "finished_well_depth", "total_depth_drilled", "static_water_level", "drilling_methods", "well_location_description", "legal_district_lot"]
    feats = []
    for w in wells:
        if w.get("latitude") is None or w.get("longitude") is None:
            continue
        pr = {k: w.get(k) for k in keep}
        pr["lithology"] = lith.get(w["well_tag_number"], [])
        pr["lithology_intervals"] = len(pr["lithology"])
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [w["longitude"], w["latitude"]]}, "properties": pr})
    gj = {"type": "FeatureCollection", "features": feats}
    p = OUT / "gwells_vancouver.geojson"; p.write_text(json.dumps(gj), encoding="utf-8")
    n_l = sum(1 for f in feats if f["properties"]["lithology_intervals"] > 0)
    log_entry("gwells", {"source": "Province of British Columbia, GWELLS (Groundwater Wells and Aquifers) REST API v1", "api": GWELLS,
                         "bbox": VAN_BBOX, "wells_saved": len(feats), "wells_with_lithology": n_l, "saved_as": str(p.relative_to(ROOT)),
                         "licence": "Open Government Licence – British Columbia (data.gov.bc.ca)", "grade": "PROVINCIAL_RECORD",
                         "fields_kept": keep + ["lithology[start,end,lithology_raw_data,lithology_colour,lithology_hardness,...]"],
                         "units": "lithology start/end as served (GWELLS stores feet in these fields; see data dictionary); coordinates WGS84",
                         "note": "a logged well is a point record at a distance; the tool names the nearest one and its distance and never interpolates"})
    print(f"gwells: {len(feats)} wells, {n_l} with lithology")


def scan_catalog():
    items = []; offset = 0
    while True:
        d = json.loads(get(f"{OD}?limit=100&offset={offset}"))
        items.extend(d["results"])
        if len(items) >= d.get("total_count", 0) or not d["results"]:
            break
        offset += 100
    rows = []
    for it in items:
        m = it["metas"]["default"]
        text = f"{it['dataset_id']} {m.get('title', '')} {m.get('description', '')}".lower()
        hits = [k for k in KEYWORDS if k in text]
        rows.append({"dataset_id": it["dataset_id"], "title": m.get("title"), "records": m.get("records_count"), "modified": m.get("modified"),
                     "keywords_hit": hits, "themes": m.get("theme"), "description": (m.get("description") or "")[:300].replace("\n", " ")})
    p = OUT / "catalog_landscape_scan.json"
    p.write_text(json.dumps({"scanned_on": date.today().isoformat(), "datasets_total": len(items), "keywords": KEYWORDS, "datasets": rows}, indent=1, ensure_ascii=False), encoding="utf-8")
    log_entry("catalog_scan", {"datasets_total": len(items), "saved_as": str(p.relative_to(ROOT)), "with_keyword_hit": sum(1 for r in rows if r["keywords_hit"])})
    print(f"catalog: {len(items)} datasets, {sum(1 for r in rows if r['keywords_hit'])} with a landscape keyword")


def fetch_gsc(url):
    raw = get(url, timeout=900)
    name = url.rsplit("/", 1)[-1]
    p = OUT / f"gsc_{name}"; p.write_bytes(raw)
    entry = {"url": url, "saved_as": str(p.relative_to(ROOT)), "bytes": len(raw), "grade": "FEDERAL_RECORD",
             "source": "Geological Survey of Canada (NRCan), Armstrong & Hicock 1979 Map 1486A Vancouver surficial geology, digital release",
             "licence": "Open Government Licence – Canada"}
    if zipfile.is_zipfile(io.BytesIO(raw)):
        entry["zip_members"] = zipfile.ZipFile(io.BytesIO(raw)).namelist()[:50]
    log_entry("gsc_1486A", entry)
    print("gsc:", entry)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--only", nargs="*", default=None, choices=["sidewalk", "311", "gwells", "catalog", "gsc"])
    p.add_argument("--gsc-url", default=None)
    a = p.parse_args(argv)
    OUT.mkdir(parents=True, exist_ok=True)
    steps = a.only or ["sidewalk", "311", "gwells", "catalog"]
    for s in steps:
        print(f"== {s}", flush=True)
        try:
            if s == "sidewalk": fetch_sidewalk()
            elif s == "311": fetch_311("3-1-1-service-requests", "311_2022_on"); fetch_311("3-1-1-service-requests-2009-2021", "311_2009_2021")
            elif s == "gwells": fetch_gwells()
            elif s == "catalog": scan_catalog()
            elif s == "gsc":
                if not a.gsc_url: print("gsc: no URL known yet (see reports/18_ground_layers.md)"); continue
                fetch_gsc(a.gsc_url)
        except Exception as e:
            print(f"{s} FAILED: {e}", flush=True)
            log_entry(f"{s}_error", {"error": str(e)})


if __name__ == "__main__":
    sys.exit(main())
