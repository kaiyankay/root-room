"""
Scene endpoints for the phase-3 page (11_redefinition §8): any site, engine + exporter behind HTTP.

  GET  /api/scene/<site_id>        scene_<site>.json (exported from the engine file; re-exported when stale)
  POST /api/scene/evaluate         {site_id, curb, depth, target, soil, land_use, width_level, existing{…},
                                    extensions:[{side,width_m,soil_type,provenance,depth_m,evidence}], replacement,
                                    candidate: <library species id> (chapter 04 card in the selected cell, exporter only)}
                                   -> runs scripts/run_block_face.py (with the right --sites), then the exporter
  POST /api/site/run               {asset_id, site_type, ...knobs} -> scripts/run_site.py (fetches the window on
                                   first use, minutes), then the exporter
  GET  /api/trees_all              [[lon, lat, asset_id], …] for the CITY map (cached)

The page computes nothing: every number it shows is read from the scene file.
"""
import contextlib
import datetime
import glob
import hashlib
import importlib.util
import io
import json
import os
import re
import pathlib
import shutil
import subprocess
import sys
import threading
from typing import Any, Dict, List, Optional

from . import web_api as W

ROOT = pathlib.Path(__file__).resolve().parents[1]
PROCESSED = ROOT / "data" / "processed"
SCRIPTS = ROOT / "scripts"
RAW = ROOT / "data" / "raw"
EXT_SIDES = ("property", "road")
EXT_SOILS = ("native_soil", "structural_soil", "soil_cell", "other")
EXT_PROV = ("USER_INPUT", "DESIGN_ASSUMPTION", "CONFIRMED_SITE_DATA")
_SITES_INDEX: Dict[str, str] = {}


def sites_path_for(site_id: str) -> Optional[pathlib.Path]:
    """KE- sites live in the pilot file; V- sites in the sites_<window>.json that lists them."""
    if site_id.startswith("KE-"):
        return None
    if site_id in _SITES_INDEX:
        return pathlib.Path(_SITES_INDEX[site_id])
    for p in sorted(glob.glob(str(PROCESSED / "sites_*.json"))):
        doc = json.loads(pathlib.Path(p).read_text(encoding="utf-8"))
        for e in doc.get("sites", []):
            _SITES_INDEX.setdefault(e["record"]["site_id"], p)
    if site_id not in _SITES_INDEX:
        raise W.ApiError(f"{site_id}: no SITE records file lists it; run scripts/run_site.py --asset-id {site_id[2:]} first")
    return pathlib.Path(_SITES_INDEX[site_id])


def scene_path(site: str) -> pathlib.Path:
    W.block_face_path(site.split("_")[0])            # validates the id part
    if not all(c.isalnum() or c in "-_." for c in site):
        raise W.ApiError(f"bad site {site!r}")
    return PROCESSED / f"scene_{site}.json"


SPECIES_DIR = ROOT / "data" / "species"
_LIBRARY_IDS: Optional[set] = None


def library_ids() -> set:
    global _LIBRARY_IDS
    if _LIBRARY_IDS is None:
        idx = json.loads((SPECIES_DIR / "_index.json").read_text(encoding="utf-8"))
        _LIBRARY_IDS = {s["id"] for s in idx["species"]}
    return _LIBRARY_IDS


def export_scene(site: str, candidate: Optional[str] = None) -> None:
    args = [str(SCRIPTS / "export_scene.py"), "--site", site]
    if candidate:
        if candidate not in library_ids():
            raise W.ApiError(f"candidate {candidate!r}: not a library species id")
        args += ["--candidate", candidate]
    _run(args, "exporter")


# ---- the engine and the exporter run inside the server process ------------------------------------------------------
# A subprocess per run cost a Python start-up and a cold import each time, and re-read the street's window files on every
# click. In-process, the scripts' main(argv) is called under one lock (their module globals — the exporter's clip, the engine's
# layer cache — are per run), stdout is captured as the subprocess's was, and window_index keeps the parsed files between
# runs. ROOT_ROOM_SUBPROCESS=1 in the environment restores the subprocess path (e.g. while editing the scripts: an in-process
# module is imported once per server start).
_RUN_LOCK = threading.RLock()
_MODULES: Dict[str, Any] = {}


def _script_module(path: str):
    p = pathlib.Path(path)
    mod = _MODULES.get(p.name)
    if mod is None:
        spec = importlib.util.spec_from_file_location("rootroom_scripts_" + p.stem, str(p))
        mod = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(mod)
        _MODULES[p.name] = mod
    return mod


# ---- what the server is doing right now, for the page's wait (one street at a time) ------------------------------------
PROGRESS: Dict[str, Any] = {"what": "", "text": "", "t": 0.0}


def set_progress(what: str, text: str) -> None:
    import time as _time
    PROGRESS.update(what=what, text=text, t=_time.time())


def _run(args: List[str], what: str) -> str:
    if os.environ.get("ROOT_ROOM_SUBPROCESS") == "1":
        return W._run(args, what)
    mod = _script_module(args[0])
    out = io.StringIO()
    with _RUN_LOCK:
        try:
            with contextlib.redirect_stdout(out):
                rc = mod.main(args[1:])
        except W.ApiError:
            raise
        except SystemExit as exc:          # argparse: a bad flag
            rc = exc.code
        except Exception as exc:           # the scripts raise on a site that cannot be measured; the page shows the message
            tail = out.getvalue().strip().splitlines()[-3:]
            raise W.ApiError(f"{what} failed: {type(exc).__name__}: {exc}" + (" | " + " | ".join(tail) if tail else ""))
    if rc not in (None, 0):
        tail = out.getvalue().strip().splitlines()
        raise W.ApiError(f"{what} failed (exit {rc}): " + " | ".join(tail[-6:]))
    return out.getvalue()


def scene_result(site: str) -> Dict[str, Any]:
    sp = scene_path(site)
    bp = PROCESSED / f"block_face_{site}.json"
    if not bp.exists() and (PROCESSED / "batch" / bp.name).exists():
        shutil.copy2(PROCESSED / "batch" / bp.name, bp)      # a sampled face from the citywide batch: the unsuffixed file is the web loop's working copy
    if not bp.exists():
        raise W.ApiError(f"no engine file for {site}")
    set_progress("open", "reading the rule's file for this street")
    if not sp.exists() or sp.stat().st_mtime < bp.stat().st_mtime:
        set_progress("open", "drawing the street: the City's trees, its utilities, the block")
        export_scene(site)
    doc = json.loads(sp.read_text(encoding="utf-8"))
    if doc.get("scene_version") != _scene_version():   # an older export: the page reads blocks it does not have (the plan's context)
        set_progress("open", "drawing the street again: the file is from an older version")
        export_scene(site)
        doc = json.loads(sp.read_text(encoding="utf-8"))
    set_progress("open", "the street is drawn")
    _warm_street(doc)
    return doc


_WARMED: set = set()


def _warm_street(doc: Dict[str, Any]) -> None:
    """Parse the City window files around this street now, in a daemon thread, so the first run for one of its trees
    (at 03) finds them in memory: cold, that parsing was ~7 s of an 11 s wait; warm, the run is ~2 s."""
    fr = (doc or {}).get("frame") or {}
    o = fr.get("origin_lonlat")
    if not o:
        return
    key = (round(o[0], 3), round(o[1], 3))
    if key in _WARMED:
        return
    _WARMED.add(key)

    def go():
        try:
            from . import window_index as wi
            bbox = wi.pad_lonlat(o[0], o[1], 500.0)
            paths = [pathlib.Path(p) for p in glob.glob(str(RAW / "*__wm*.geojson"))] + [pathlib.Path(p) for p in glob.glob(str(RAW / "*__king_edward_window.geojson"))] \
                + [pathlib.Path(p) for p in glob.glob(str(RAW / "vanmap" / "*__*.geojson"))]
            for p in wi.select(paths, bbox):
                if p.name.endswith("__dataset_metadata.json") or p.name.endswith("__layer_info.json"):
                    continue
                wi.load_json(p)
            _script_module(str(SCRIPTS / "export_scene.py")).warm_process()
        except Exception:
            pass

    threading.Thread(target=go, name="warm-street", daemon=True).start()


def _scene_version() -> int:
    try:
        return int(getattr(_script_module(str(SCRIPTS / "export_scene.py")), "SCENE_VERSION", 0))
    except Exception:
        return 0


def _knob_args(params: Dict[str, Any]) -> List[str]:
    args: List[str] = []
    curb = W._num(params.get("curb"), "curb", 0.5, 60)
    depth = W._num(params.get("depth"), "depth", 0.05, 5)
    if curb is not None:
        args += ["--curb", f"{curb:g}"]
    if depth is not None:
        args += ["--depth", f"{depth:g}"]
    cp = params.get("curb_provenance")
    if cp:
        if cp not in ("DESIGN_ASSUMPTION", "USER_INPUT", "CONFIRMED_SITE_DATA"):
            raise W.ApiError(f"curb_provenance: {cp!r}")
        if cp == "CONFIRMED_SITE_DATA" and not params.get("curb_evidence"):
            raise W.ApiError("a confirmed curb needs an evidence reference (curb_evidence)")
        args += ["--curb-provenance", cp]
        if params.get("curb_evidence"):
            args += ["--curb-evidence", str(params["curb_evidence"])[:200]]
    for key, flag in (("target", "--target"), ("soil", "--soil"), ("land_use", "--land-use"), ("width_level", "--width-level")):
        v = params.get(key)
        if v:
            if v not in W._KNOB_CHOICES[key]:
                raise W.ApiError(f"{key}: {v!r} is not one of {W._KNOB_CHOICES[key]}")
            args += [flag, v]
    ex = params.get("existing") or {}
    if ex.get("width") not in (None, ""):
        args += ["--existing-width", f"{W._num(ex.get('width'), 'existing width', 0.05, 30):g}"]
    if ex.get("depth") not in (None, ""):
        args += ["--existing-depth", f"{W._num(ex.get('depth'), 'existing depth', 0.05, 5):g}"]
    if ex.get("soil"):
        if ex["soil"] not in W._KNOB_CHOICES["soil"]:
            raise W.ApiError(f"existing soil: {ex['soil']!r}")
        args += ["--existing-soil", ex["soil"]]
    if ex:
        prov = ex.get("provenance") or "USER_INPUT"
        if prov not in W._KNOB_CHOICES["existing_provenance"]:
            raise W.ApiError(f"existing provenance: {prov!r}")
        args += ["--existing-provenance", prov]
        if ex.get("evidence"):
            args += ["--existing-evidence", str(ex["evidence"])[:200]]
    for z in params.get("extensions") or []:
        side = z.get("side")
        if side not in EXT_SIDES:
            raise W.ApiError(f"extension side {side!r}")
        w = W._num(z.get("width_m"), f"extension {side} width", 0.05, 30)
        st = z.get("soil_type")
        if st not in EXT_SOILS:
            raise W.ApiError(f"extension {side} soil_type {st!r}")
        prov = z.get("provenance") or "DESIGN_ASSUMPTION"
        if prov not in EXT_PROV:
            raise W.ApiError(f"extension {side} provenance {prov!r}")
        spec = f"{w:g}:{st}:{prov}"
        if z.get("depth_m") not in (None, ""):
            spec += f":{W._num(z['depth_m'], f'extension {side} depth', 0.05, 5):g}"
        args += ["--extend-property" if side == "property" else "--extend-road", spec]
        if z.get("evidence"):
            args += ["--extension-evidence", str(z["evidence"])[:200]]
    if params.get("replacement"):
        args += ["--replacement"]
    return args


def site_type_of(site_id: str) -> str:
    """The site type the engine file was run with (boulevard unless the file says median)."""
    try:
        d = json.loads(W.block_face_path(site_id).read_text(encoding="utf-8"))
        st = ((d.get("knobs") or {}).get("site_type") or {}).get("value") or (d.get("face") or {}).get("site_type")
        return "median" if st == "median" else "boulevard"
    except (OSError, ValueError):
        return "boulevard"


def evaluate_scene(site_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """A run of the engine and the exporter. With params["scenario"] truthy (the page's scenario / review modes) both write
    the `_scenario` side files (block_face_<id>_scenario.json, scene_<id>_scenario.json) so the canonical files — the
    existing condition the page shows in story mode and reloads after a refresh — are never overwritten by a what-if.
    Single-user demo isolation only; no sessions."""
    W.block_face_path(site_id)
    scenario = bool(params.get("scenario"))
    out_id = f"{site_id}_scenario" if scenario else site_id
    if params.get("candidate_only"):
        # choosing a tree changes nothing in the ground: no engine run, the exporter alone places the card in the current engine file
        bp_out = PROCESSED / f"block_face_{out_id}.json"
        if scenario and (not bp_out.exists() or params.get("scenario_fresh")):
            # the page's working ground is the existing one: start from the engine file its scene was exported from (e.g. the _curb10
            # variant), never from an old side file
            src = W.block_face_path(site_id)
            base = str(params.get("base_engine") or "")
            m = re.fullmatch(r"(?:.*/)?(block_face_[A-Za-z0-9_-]+\.json)", base)
            if m and (PROCESSED / m.group(1)).exists():
                src = PROCESSED / m.group(1)
            shutil.copy2(src, bp_out)
        set_progress("place", "placing the species card in the ground")
        export_scene(out_id, params.get("candidate") or None)
        scene = json.loads(scene_path(out_id).read_text(encoding="utf-8"))
        scene["engine_stdout"] = ["candidate only: the engine did not run; the exporter placed the card"]
        return scene
    args = [str(SCRIPTS / "run_block_face.py"), "--site", site_id]
    sp = sites_path_for(site_id)
    if sp is not None:
        args += ["--sites", str(sp)]
    args += ["--site-type", site_type_of(site_id)]   # the site type is the user's confirmation, kept in the engine file: a re-run keeps it
    if scenario:
        args += ["--out", str(PROCESSED / f"block_face_{out_id}.json")]
    args += _knob_args(params)
    set_progress("engine", "running the rule for this cell")
    stdout = _run(args, "engine")
    set_progress("engine", "drawing the section")
    export_scene(out_id, params.get("candidate") or None)
    scene = json.loads(scene_path(out_id).read_text(encoding="utf-8"))
    scene["engine_stdout"] = stdout.strip().splitlines()[-6:]
    scene["args"] = args[1:]
    return scene


def run_site(params: Dict[str, Any]) -> Dict[str, Any]:
    """Any City tree: scripts/run_site.py (fetch on first use), then the exporter."""
    try:
        asset = int(params.get("asset_id"))
    except (TypeError, ValueError):
        raise W.ApiError("asset_id must be an integer")
    st = params.get("site_type")
    if st not in ("boulevard", "median", "park"):
        raise W.ApiError("site_type must be boulevard | median | park (your confirmation)")
    args = [str(SCRIPTS / "run_site.py"), "--asset-id", str(asset), "--site-type", st] + _knob_args(params)
    set_progress("run_site", f"fetching the City's layers around tree {asset}, then running the rule for its block")
    out = _run(args, "run_site")   # in-process, like the engine and the exporter: no Python start, the window's files parsed once
    site_id = f"V-{asset}"
    set_progress("run_site", "drawing the street: the City's trees, its utilities, the block")
    export_scene(site_id)
    set_progress("run_site", "the street is drawn")
    scene = json.loads(scene_path(site_id).read_text(encoding="utf-8"))
    scene["engine_stdout"] = out.strip().splitlines()[-8:]
    return scene


_TREES_ALL: Optional[List[List[Any]]] = None


def trees_all() -> List[List[Any]]:
    global _TREES_ALL
    if _TREES_ALL is None:
        cache = PROCESSED / "trees_all.json"
        if cache.exists():
            _TREES_ALL = json.loads(cache.read_text(encoding="utf-8"))
        else:
            out = []
            for f in json.loads((RAW / "public-trees.geojson").read_text(encoding="utf-8"))["features"]:
                g = f.get("geometry")
                if g and g.get("coordinates"):
                    lon, lat = g["coordinates"][:2]
                    if lon and lat:
                        out.append([round(lon, 5), round(lat, 5), f["properties"]["asset_id"]])
            cache.write_text(json.dumps(out), encoding="utf-8")
            _TREES_ALL = out
    return _TREES_ALL


_ADDR: Optional[List[List[Any]]] = None


def address_index() -> List[List[Any]]:
    """['123 W KING EDWARD AV', lon, lat] for every City address point (property-addresses), once."""
    global _ADDR
    if _ADDR is None:
        cache = PROCESSED / "address_index.json"
        if cache.exists():
            _ADDR = json.loads(cache.read_text(encoding="utf-8"))
        else:
            out = []
            for f in json.loads((RAW / "property-addresses.geojson").read_text(encoding="utf-8"))["features"]:
                p = f["properties"]; g = f.get("geometry")
                if not g or not g.get("coordinates") or not p.get("std_street"):
                    continue
                lon, lat = g["coordinates"][:2]
                out.append([f"{p.get('civic_number', '')} {p['std_street']}".strip(), round(lon, 5), round(lat, 5)])
            out.sort(key=lambda x: x[0])
            cache.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
            _ADDR = out
    return _ADDR


def trees_near_point(lon: float, lat: float, radius_m: float = 40.0) -> List[Dict[str, Any]]:
    from . import sites
    out = []
    for d, f in sorted(sites.trees_near(lon, lat, min(radius_m, 120.0)), key=lambda x: x[0])[:12]:
        p = f["properties"]
        out.append({"asset_id": p["asset_id"], "distance_m": round(d, 1), "genus": p.get("genus_name"), "species": p.get("species_name"),
                    "cultivar": p.get("cultivar_name"), "address": p.get("address"), "height_m": p.get("height_m"),
                    "lon": f["geometry"]["coordinates"][0], "lat": f["geometry"]["coordinates"][1],
                    "has_engine_file": any((PROCESSED / f"block_face_{pre}-{p['asset_id']}.json").exists() for pre in ("V", "KE")) or (PROCESSED / "batch" / f"block_face_V-{p['asset_id']}.json").exists()})
    return out


_TREE_SITE: Optional[Dict[int, str]] = None


def _tree_site_index(rebuild: bool = False) -> Dict[int, str]:
    """Every tree of every checked block face → the face's site id (the anchor tree's). A tree on a checked street then opens that
    street at once instead of being fetched and run as a new site; built once from the engine files, rebuilt on a miss."""
    global _TREE_SITE
    if _TREE_SITE is None or rebuild:
        idx: Dict[int, str] = {}
        for p in list(PROCESSED.glob("block_face_*.json")) + list((PROCESSED / "batch").glob("block_face_V-*.json")):
            stem = p.stem[len("block_face_"):]
            if "_" in stem:
                continue   # variants (…_curb10) and scenarios (…_A, …_scenario)
            try:
                d = json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                continue
            if not ((d.get("design") or {}).get("band")):
                continue   # a run without a design band (no curb could be set) is no home for the face's trees
            face = d.get("face") or {}
            for t in face.get("trees") or []:
                sid = str(t.get("site_id") or "")
                if "-" in sid and sid.split("-")[1].isdigit():
                    idx.setdefault(int(sid.split("-")[1]), stem)
        _TREE_SITE = idx
    return _TREE_SITE


def tree_lookup(asset_id: int) -> Dict[str, Any]:
    from . import sites
    f = sites.tree_by_asset_id(asset_id)
    p = f["properties"]
    lon, lat = f["geometry"]["coordinates"][:2]
    street, how = sites.street_name_for(p, None)
    hint = sites.position_hint(lon, lat, street)
    # the engine file may exist under V-<id> (any tree), KE-<id> (the pilot sites) or in the citywide batch folder
    site_id = next((sid for sid in (f"V-{asset_id}", f"KE-{asset_id}") if (PROCESSED / f"block_face_{sid}.json").exists()), f"V-{asset_id}")
    has = (PROCESSED / f"block_face_{site_id}.json").exists() or (PROCESSED / "batch" / f"block_face_V-{asset_id}.json").exists()
    tree_site = None
    if not has:   # not an anchor: maybe a tree on a checked face — open that face and select this tree there
        home = _tree_site_index().get(asset_id) or _tree_site_index(rebuild=True).get(asset_id)
        if home:
            site_id, has, tree_site = home, True, f"V-{asset_id}"
    return {"asset_id": asset_id, "properties": p, "lon": lon, "lat": lat, "street": street, "hint": hint, "site_id": site_id, "has_engine_file": has, "tree_site_id": tree_site}


# ---------------------------------------------------------------------------------------------------- frozen scenarios
# A saved scenario is a file: scene_<site>_<ID>.json (ID = A, B, C …) beside a copy of the engine file it was exported from.
# 05 (three.js), the report and the Rhino reconstruction all read that one file; the `_scenario` side file keeps changing.
FROZEN_ID = re.compile(r"^[A-Z]$")


def scene_hash(scene: Dict[str, Any]) -> str:
    """Content hash of a scene without its `frozen` block, so the file and any reader can agree on what was read."""
    body = {k: v for k, v in scene.items() if k not in ("frozen", "engine_stdout", "args")}
    return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")).hexdigest()[:12]


def base_hash(site_id: str) -> Optional[str]:
    """Identity of the site's canonical scene (what 03 shows); a frozen scenario saved against another base is stale."""
    sp = PROCESSED / f"scene_{site_id}.json"
    if not sp.exists():
        return None
    base = json.loads(sp.read_text(encoding="utf-8"))
    base.pop("exported_on", None)
    return scene_hash(base)


SCENE_SITE_ID = re.compile(r"(?:KE|V)-\d{1,8}(?:_[A-Za-z0-9]+)?")   # a block face or one of its exported variants (…_curb10)


def frozen_files(site_id: str) -> List[pathlib.Path]:
    if not SCENE_SITE_ID.fullmatch(site_id or ""):
        raise W.ApiError(f"bad site id {site_id!r}")
    out = []
    for p in sorted(glob.glob(str(PROCESSED / f"scene_{site_id}_*.json"))):
        suffix = pathlib.Path(p).stem[len(f"scene_{site_id}_"):]
        if FROZEN_ID.fullmatch(suffix):
            out.append(pathlib.Path(p))
    return out


def freeze_scene(site_id: str, scene: Dict[str, Any], subject: Optional[str] = None, cut_aa_u: Optional[float] = None) -> Dict[str, Any]:
    """Write the page's finished scenario scene as scene_<site>_<ID>.json (next free letter) and copy its engine file.
    Returns the frozen scene exactly as written, so the page keeps the file's content, not its own copy."""
    W.block_face_path(site_id)
    if not isinstance(scene, dict) or scene.get("site_id", "").split("_")[0] != site_id:
        raise W.ApiError("the scene to freeze does not belong to this site")
    used = {p.stem[len(f"scene_{site_id}_"):] for p in frozen_files(site_id)}
    sid = next((c for c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ" if c not in used), None)
    if sid is None:
        raise W.ApiError("26 scenarios are frozen for this site already")
    out_scene = PROCESSED / f"scene_{site_id}_{sid}.json"
    out_engine = PROCESSED / f"block_face_{site_id}_{sid}.json"
    src_engine = PROCESSED / f"block_face_{site_id}_scenario.json"
    engine_from = None
    if src_engine.exists():
        shutil.copy2(src_engine, out_engine)
        engine_from = out_engine.name
    frozen = dict(scene)
    frozen.pop("engine_stdout", None); frozen.pop("args", None)
    frozen["site_id"] = f"{site_id}_{sid}"
    # the A–A cut is a spatial state of the scenario (02 sets it, 03 / 04 draw it, 05 and Rhino inherit it): frozen here, never a rule input
    sel = next((t for t in frozen.get("trees", []) if t.get("selected")), None)
    u_rel = float(cut_aa_u or 0.0)
    cell = (sel or {}).get("cell") or {}
    if sel and cell.get("u_from") is not None:
        u_rel = max(cell["u_from"] - sel["u"], min(cell["u_to"] - sel["u"], u_rel))   # within the selected tree's cell
    cut = dict(frozen.get("cut") or {})
    cut["aa"] = {"u": round(u_rel, 2), "u_abs": round((sel["u"] if sel else 0.0) + u_rel, 2), "direction": "transverse",
                 "half_width_m": cut.get("zoom_half_m", 16.0), "note": "SECTION A–A: across the street at this u (relative to the selected tree); a drawing state, not a rule input"}
    frozen["cut"] = cut
    frozen["selected_tree_id"] = sel["site_id"] if sel else None
    slab = dict(frozen.get("slab") or {})
    if slab.get("u0") is not None:
        half = (slab["u1"] - slab["u0"]) / 2.0
        slab["u0"], slab["u1"] = round(cut["aa"]["u_abs"] - half, 2), round(cut["aa"]["u_abs"] + half, 2)
        frozen["slab"] = slab
    frozen["frozen"] = {"scenario_id": sid, "file": out_scene.name, "engine_file": engine_from, "saved_at": datetime.datetime.now().isoformat(timespec="seconds"),
                        "base_hash": base_hash(site_id), "subject": subject,
                        "note": "a saved scenario: 05, the report and the Rhino reconstruction read this file and nothing else"}
    frozen["frozen"]["hash"] = scene_hash(frozen)
    out_scene.write_text(json.dumps(frozen, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return frozen


def list_frozen(site_id: str) -> Dict[str, Any]:
    """The site's frozen scenarios with their base identity, so the page can skip the ones saved against an older record."""
    bh = base_hash(site_id)
    items = []
    for p in frozen_files(site_id):
        try:
            sc = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        fz = sc.get("frozen") or {}
        items.append({"scenario_id": fz.get("scenario_id"), "file": p.name, "hash": fz.get("hash"), "saved_at": fz.get("saved_at"), "subject": fz.get("subject"),
                      "stale": bool(bh) and fz.get("base_hash") != bh, "hash_ok": scene_hash(sc) == fz.get("hash")})
    return {"site_id": site_id, "base_hash": bh, "scenarios": items}
