"""
Run the Boulevard Soil Band check for ANY Vancouver City tree (11_redefinition_2026-09-28.md §7a).

  asset_id / address / point
    -> the City tree (data/raw/public-trees.geojson, citywide, local)
    -> a window around it: City Open Data context + underground layers (scripts/fetch_context.py)
       and the VanMap depth layers (scripts/fetch_vanmap.py), fetched once per window and reused
    -> SITE records for every tree in the window (src/sites.py; street_name from the VanMap
       block sentence when reachable, else the nearest-address string; both DERIVED_CALCULATION)
    -> scripts/run_block_face.py --site V-<asset_id> --sites data/processed/sites_<window>.json
    -> data/processed/block_face_V-<asset_id>.json

The site TYPE is a user confirmation (--site-type boulevard | median | park). Without it the
script prints the geometric hint and stops; median and park trees stop with the reason.

Examples
  python3 scripts/run_site.py --asset-id 332826 --site-type boulevard --curb 9.0 --depth 0.9 --target Large \
      --soil native_soil --land-use residential_detached
  python3 scripts/run_site.py --address "2091 W 7th Av"           # lists the candidate trees
  python3 scripts/run_site.py --lon -123.146 --lat 49.266          # nearest trees to a point
Every argument after the site arguments is passed through to scripts/run_block_face.py.
"""
import argparse
import json
import pathlib
import subprocess
import sys
from datetime import date

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src import sites  # noqa: E402

WINDOW_RADIUS_M = 500.0     # fetch radius; the block face itself is measured by src/block_face.py
WINDOW_GRID_DEG = 0.004     # windows are keyed on a lon/lat grid so neighbouring trees share one fetch


def window_for(lon: float, lat: float):
    glon = round(round(lon / WINDOW_GRID_DEG) * WINDOW_GRID_DEG, 3)
    glat = round(round(lat / WINDOW_GRID_DEG) * WINDOW_GRID_DEG, 3)
    name = f"w{glon:+.3f}_{glat:+.3f}".replace("+", "p").replace("-", "m").replace(".", "_")
    return name, glon, glat


def ensure_fetched(name: str, glon: float, glat: float, refetch: bool):
    raw = ROOT / "data" / "raw"
    log = raw / f"{name}__fetch_log.json"
    if refetch or not log.exists():
        subprocess.run([sys.executable, str(ROOT / "scripts" / "fetch_context.py"), "--lon", str(glon), "--lat", str(glat),
                        "--radius", str(WINDOW_RADIUS_M), "--window", name, "--group", "all"], check=True)
    vlog = raw / "vanmap" / f"{name}__vanmap_fetch_log.json"
    if refetch or not vlog.exists():
        subprocess.run([sys.executable, str(ROOT / "scripts" / "fetch_vanmap.py"), "--lon", str(glon), "--lat", str(glat),
                        "--radius", str(WINDOW_RADIUS_M), "--window", name], check=True)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--asset-id", type=int)
    g.add_argument("--address")
    g.add_argument("--lon", type=float)
    p.add_argument("--lat", type=float)
    p.add_argument("--site-type", choices=["boulevard", "median", "park"], default=None,
                   help="user confirmation of the site type; required to run the engine")
    p.add_argument("--refetch", action="store_true", help="re-download the window even if it exists")
    p.add_argument("--no-vanmap-notes", action="store_true", help="do not query the VanMap Trees layer for the block sentence")
    a, passthrough = p.parse_known_args(argv)

    # 1. resolve
    if a.address:
        r = sites.trees_by_address(a.address)
        if len(r["candidates"]) != 1:
            print(f"{a.address!r} matched by {r['matched_by']}: {len(r['candidates'])} trees. Pick one with --asset-id:")
            for c in r["candidates"][:20]:
                q = c["properties"]
                print(f"  {c['asset_id']:>7}  {q.get('genus_name')} {q.get('species_name')} {q.get('cultivar_name')}  "
                      f"h {q.get('height_m')} m  {q.get('address')}  {q.get('local_area')}" + (f"  {c['distance_m']} m" if c["distance_m"] is not None else ""))
            return 2
        tree = sites.tree_by_asset_id(r["candidates"][0]["asset_id"])
    elif a.lon is not None:
        if a.lat is None:
            p.error("--lon needs --lat")
        near = sites.trees_near(a.lon, a.lat, 60.0)
        if not near:
            print("no City tree within 60 m of that point")
            return 2
        if len(near) > 1 and near[0][0] > 5.0:
            print("nearest City trees; pick one with --asset-id:")
            for d, f in near[:10]:
                q = f["properties"]
                print(f"  {q['asset_id']:>7}  {d:5.1f} m  {q.get('genus_name')} {q.get('species_name')}  {q.get('address')}")
            return 2
        tree = near[0][1]
    else:
        tree = sites.tree_by_asset_id(a.asset_id)
    props = tree["properties"]
    asset = int(props["asset_id"])
    lon, lat = tree["geometry"]["coordinates"][:2]
    site_id = f"{sites.SITE_ID_PREFIX}{asset}"

    # 2. window: fetch once
    name, glon, glat = window_for(lon, lat)
    ensure_fetched(name, glon, glat, a.refetch)

    # 3. site records for the window (street name + hint for the selected tree first, for the message)
    notes = None if a.no_vanmap_notes else sites.vanmap_location_notes(asset)
    street, how = sites.street_name_for(props, notes)
    hint = sites.position_hint(lon, lat, street)
    print(f"{site_id}: {props.get('genus_name')} {props.get('species_name')} {props.get('cultivar_name')} · {props.get('address')} · {props.get('local_area')}")
    print(f"  street {street!r} ({how}); hint {hint['hint']}, {hint.get('dist_centreline_m')} m from ℄ of {hint.get('nearest_hblock')}"
          + ("; inside a City park polygon" if hint.get("in_park_polygon") else ""))
    if a.site_type is None:
        print("  site type not confirmed: re-run with --site-type boulevard | median | park")
        return 2
    if a.site_type != "boulevard":
        print(f"  site type {a.site_type}: outside the tool's scope (front boulevard band, R30); stopping")
        return 3
    if hint.get("in_park_polygon") or hint["hint"] == "median":
        print(f"  WARNING: the City geometry says {'park polygon' if hint.get('in_park_polygon') else 'median'} but the site type "
              f"was confirmed as boulevard; the result is flagged REVIEW_REQUIRED in the sites file")
    sys.stdout.flush()
    sites_path, doc = sites.build_window_sites(glon, glat, WINDOW_RADIUS_M, name, asset, a.site_type, use_vanmap=not a.no_vanmap_notes)
    print(f"  {doc['site_count']} SITE records -> {sites_path.relative_to(ROOT)}")

    # 4. engine
    cmd = [sys.executable, str(ROOT / "scripts" / "run_block_face.py"), "--site", site_id, "--sites", str(sites_path)] + passthrough
    print("  " + " ".join(cmd[1:]))
    sys.stdout.flush()
    return subprocess.run(cmd, cwd=str(ROOT)).returncode


if __name__ == "__main__":
    sys.exit(main())
