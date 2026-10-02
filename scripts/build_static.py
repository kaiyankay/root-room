#!/usr/bin/env python3
"""Build Root Room as a static site for GitHub Pages (or any static host).

    python3 scripts/build_static.py --out _site

The page is the same `web/one.html`; a manifest written into it (window.ROOT_ROOM_STATIC) switches its API calls to
`web/js/static-api.js`:

- api/…            the answers of the server's GET routes, computed here by the same functions (scene_api, web_api);
- api/scene/<T>    for every tree on the pilot street, the engine's run of that tree with the pilot's knobs, exactly as the
                   server returns it when the tree is clicked;
- engine/bundle.zip  the Python the server runs (src/, scripts/export_scene.py, scripts/run_block_face.py) and the files a
                   run reads, found by tracing real runs; the page unpacks it into Pyodide (engine-worker.js) and every later
                   run happens in the visitor's browser.

The engine runs in a temporary copy of the repository, so the working tree is not touched.
"""
from __future__ import annotations

import argparse
import datetime
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
PILOT = "KE-198571_curb10"
MAP_FILES = {
    "data/raw": ("parks-polygon-representation.geojson", "public-streets.geojson", "local-area-boundary.geojson"),
    "data/processed": ("local_area_species.json", "local_area_capacity.json", "citywide_faces.json", "region_base.json",
                       "city_blocks.json", "region_blocks.json"),
}
OFF_PILOT = ("the online demo carries the City data of the pilot street, 400 W King Edward Av · any other street runs on your "
             "own machine (python3 scripts/serve_web.py, see the README)")

# Runs inside the temporary copy (cwd = the copy). Writes the static answers and the trace to argv[1].
TRACE = r'''
import builtins, io, json, pathlib, sys
ROOT = pathlib.Path.cwd().resolve(); sys.path.insert(0, str(ROOT))
OUT = pathlib.Path(sys.argv[1]); PILOT = sys.argv[2]
from src import scene_api, web_api

def dump(rel, obj):
    p = OUT / rel; p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

PROC = ROOT / "data" / "processed"
before = {str(p.relative_to(ROOT)) for p in ROOT.rglob("*") if p.is_file()}

# 1 · the GET routes that do not depend on a run
dump("api/trees_all.json", scene_api.trees_all())
dump("api/address_index.json", scene_api.address_index())
dump("api/rules.json", web_api.rules_doc())
engine_assets = []
for p in sorted(PROC.glob("block_face_*.json")):
    sid = p.stem[len("block_face_"):]
    if "_" in sid: continue
    try:
        asset = int(sid.split("-")[1]); dump(f"api/tree/{asset}.json", scene_api.tree_lookup(asset)); engine_assets.append(asset)
    except Exception as e:
        print("tree lookup", sid, "skipped:", e, file=sys.stderr)

# 2 · trace every file the engine and the exporter read from here on
reads = set(); _open = builtins.open
def traced(p, mode="r", *a, **k):
    try:
        rp = pathlib.Path(p).resolve()
        if "r" in mode and "+" not in mode and str(rp).startswith(str(ROOT)): reads.add(str(rp.relative_to(ROOT)))
    except Exception: pass
    return _open(p, mode, *a, **k)
builtins.open = traced; io.open = traced

def knobs(S):
    k = S["knobs"]; v = lambda n: (k.get(n) or {}).get("value"); curb = k.get("curb_offset_from_centreline_m") or {}
    conf = curb.get("provenance") == "CONFIRMED_SITE_DATA"
    return {"curb": v("curb_offset_from_centreline_m"), "depth": v("soil_depth_m"), "target": v("target_tree_class"), "soil": v("soil_type"),
            "land_use": v("land_use"), "width_level": v("width_level"), "replacement": (k.get("tree_state") or {}).get("value") == "vacant_replacement",
            "extensions": [{"side": z.get("side"), "width_m": z.get("width_applied_m"), "soil_type": z.get("soil_type"), "provenance": z.get("provenance"), "status": z.get("status")} for z in (S["band"].get("zones") or [])],
            "candidate": None, "curb_provenance": "CONFIRMED_SITE_DATA" if conf else None, "curb_evidence": curb.get("evidence") if conf else None}

pilot = scene_api.scene_result(PILOT)
base = knobs(pilot)
story = []
for t in pilot["trees"]:
    T = t.get("site_id")
    if not T or t.get("selected"): continue   # the page never re-runs the tree it already shows (and its frozen scenarios keep their base)
    p = dict(base, site_id=T, scenario=False, scenario_fresh=True, base_engine=pilot["engine_file"])
    try:
        scene_api.evaluate_scene(T, p); story.append(T)
    except Exception as e:
        print("story run", T, "skipped:", e, file=sys.stderr)

# 3 · the scenes and the frozen lists as the server would serve them after those runs
sites = set()
for p in sorted(PROC.glob("scene_*.json")):
    s = p.stem[len("scene_"):]
    if s.endswith("_scenario"): continue
    dump(f"api/scene/{s}.json", json.loads(p.read_text(encoding="utf-8"))); sites.add(s.split("_")[0])
for s in sorted(sites):
    try: dump(f"api/scenario_list/{s}.json", scene_api.list_frozen(s))
    except Exception as e: print("list", s, "skipped:", e, file=sys.stderr)

# 4 · the paths the page takes in the browser: a ground change, a species, a saved scenario
T0 = PILOT.split("_")[0]
sc = dict(base, site_id=T0, scenario=True, scenario_fresh=True, base_engine=pilot["engine_file"], depth=1.2)
S1 = scene_api.evaluate_scene(T0, sc)
lib = (S1.get("library") or {}).get("cards") or []
if lib:
    scene_api.evaluate_scene(T0, dict(sc, scenario_fresh=False, candidate=lib[0]["id"], candidate_only=True))
scene_api.evaluate_scene(T0, dict(sc, scenario_fresh=False, depth=0.9, extensions=[{"side": "property", "width_m": 1.8, "soil_type": "structural_soil", "provenance": "DESIGN_ASSUMPTION"}]))
scene_api.freeze_scene(T0, S1, "trace", 0.0)
scene_api.list_frozen(T0)

json.dump({"before": sorted(before), "reads": sorted(reads), "story": story, "base": base, "engine_assets": engine_assets}, open(OUT / "_trace.json", "w"))
'''


def copy_repo(dst: pathlib.Path) -> None:
    ignore = shutil.ignore_patterns(".git", "_site", "__pycache__", "*.pyc", "reports", "docs", "archive", "tests")
    for name in ("src", "scripts", "sources", "data"):
        if (ROOT / name).exists():
            shutil.copytree(ROOT / name, dst / name, ignore=ignore)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default="_site")
    a = ap.parse_args(argv)
    out = (ROOT / a.out).resolve() if not pathlib.Path(a.out).is_absolute() else pathlib.Path(a.out)
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    with tempfile.TemporaryDirectory(prefix="rootroom_build_") as tmp:
        work = pathlib.Path(tmp) / "repo"
        copy_repo(work)
        print("running the engine in", work)
        subprocess.run([sys.executable, "-c", TRACE, str(out), PILOT], cwd=work, check=True)
        tr = json.loads((out / "_trace.json").read_text())
        (out / "_trace.json").unlink()
        before = set(tr["before"])

        # the engine bundle: the Python, then what the runs read, then the scene and engine files as the runs left them
        files = {str(p.relative_to(work)) for p in (work / "src").rglob("*.py")}
        files |= {"scripts/export_scene.py", "scripts/run_block_face.py"}
        files |= {r for r in tr["reads"] if r in before and not r.endswith(".py")}
        files |= {str(p.relative_to(work)) for p in (work / "data" / "processed").glob("*.json")
                  if (p.name.startswith(("scene_", "block_face_")) and not p.stem.endswith("_scenario") and str(p.relative_to(work)) in before)}
        files |= {str(p.relative_to(work)) for p in (work / "data" / "species").glob("*.json")}
        files |= {str(p.relative_to(work)) for p in (work / "sources").glob("*.json")}   # read when the modules import, before the trace starts
        idx = work / "data" / "processed" / "window_bbox_index.json"
        if idx.exists():
            files.add(str(idx.relative_to(work)))
        (out / "engine").mkdir()
        size = 0
        with zipfile.ZipFile(out / "engine" / "bundle.zip", "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
            for rel in sorted(files):
                fp = work / rel
                if fp.is_file():
                    z.write(fp, rel); size += fp.stat().st_size
        print(f"engine bundle: {len(files)} files, {size / 1e6:.1f} MB unpacked, {(out / 'engine' / 'bundle.zip').stat().st_size / 1e6:.1f} MB zipped")

    # the page
    for p in (ROOT / "web").iterdir():
        if p.name in ("round12",):
            continue
        (shutil.copytree if p.is_dir() else shutil.copy2)(p, out / p.name)
    for d, names in MAP_FILES.items():
        for n in names:
            src = ROOT / d / n
            if src.exists():
                (out / "data").mkdir(exist_ok=True); shutil.copy2(src, out / "data" / n)
    manifest = {"bundle": "engine/bundle.zip", "pilot": PILOT, "story": {"trees": tr["story"], "knobs": tr["base"]},
                "engineAssets": tr["engine_assets"], "offPilot": OFF_PILOT, "built": datetime.date.today().isoformat()}
    html = (ROOT / "web" / "one.html").read_text(encoding="utf-8")
    tag = '<script type="module" src="js/one.js"></script>'
    assert tag in html, "one.html: the module tag moved"
    html = html.replace(tag, f"<script>window.ROOT_ROOM_STATIC = {json.dumps(manifest, ensure_ascii=False)};</script>\n{tag}")
    (out / "one.html").write_text(html, encoding="utf-8")
    (out / "index.html").write_text(html, encoding="utf-8")
    (out / ".nojekyll").write_text("")
    total = sum(p.stat().st_size for p in out.rglob("*") if p.is_file())
    print(f"site: {out} · {total / 1e6:.1f} MB · story runs for {len(tr['story'])} trees · {len(tr['engine_assets'])} tree records")
    return 0


if __name__ == "__main__":
    sys.exit(main())
