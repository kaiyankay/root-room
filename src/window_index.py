"""A bounding-box index of the City window files under data/raw.

The citywide sample stores one window per sampled block face (93 windows of each dataset, 1.1 GB in all). A per-site run
used to read and parse every window of every dataset it touches (about 1 750 files for the exporter, 850 for the engine)
and clip afterwards — 30 of the 40 seconds a tree click cost. This index remembers each file's lon/lat bounding box
(keyed by its size and mtime, so an updated file is re-measured) and lets a run open only the windows that overlap the
site's padded extent. It changes which files are opened, never what is read from them: windows overlap and the readers
already de-duplicate, so a feature near the site is found in whichever window contains it.

The index lives in data/processed/window_bbox_index.json and is written atomically; two processes writing at once lose
nothing but a little work.
"""
from __future__ import annotations

import json
import os
import pathlib
import tempfile
from collections import OrderedDict
from typing import Dict, Iterable, List, Optional, Sequence

ROOT = pathlib.Path(__file__).resolve().parents[1]
INDEX_PATH = ROOT / "data" / "processed" / "window_bbox_index.json"

BBox = Sequence[float]   # min_lon, min_lat, max_lon, max_lat

_index: Optional[Dict[str, Dict]] = None
_dirty = False
_KEYS: Dict[str, str] = {}   # path as given -> index key (the resolve is the costly part of a lookup over 1 700 files)


def _load() -> Dict[str, Dict]:
    global _index
    if _index is None:
        try:
            _index = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
            if not isinstance(_index, dict):
                _index = {}
        except (OSError, ValueError):
            _index = {}
    return _index


def _save() -> None:
    global _dirty
    if not _dirty or _index is None:
        return
    INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(INDEX_PATH.parent), prefix=".window_bbox_index.", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(_index, fh, separators=(",", ":"))
        os.replace(tmp, INDEX_PATH)
    except OSError:
        try:
            os.unlink(tmp)
        except OSError:
            pass
    _dirty = False


def _coords(geom):
    if not geom:
        return
    if geom.get("type") == "GeometryCollection":
        for g in geom.get("geometries", []):
            yield from _coords(g)
        return
    stack = [geom.get("coordinates")]
    while stack:
        x = stack.pop()
        if isinstance(x, (list, tuple)) and x and isinstance(x[0], (int, float)):
            yield x
        elif isinstance(x, (list, tuple)):
            stack.extend(x)


def measure(path: pathlib.Path) -> Optional[List[float]]:
    """The lon/lat bounding box of a GeoJSON file's features; None for a file without coordinates."""
    doc = json.loads(path.read_text(encoding="utf-8"))
    lo0 = la0 = float("inf")
    lo1 = la1 = float("-inf")
    for f in doc.get("features", []):
        for c in _coords(f.get("geometry")):
            lo, la = c[0], c[1]
            if lo < lo0:
                lo0 = lo
            if lo > lo1:
                lo1 = lo
            if la < la0:
                la0 = la
            if la > la1:
                la1 = la
    if lo0 == float("inf"):
        return None
    return [lo0, la0, lo1, la1]


def bbox_of(path: pathlib.Path) -> Optional[List[float]]:
    """The file's bounding box from the index, measured (and remembered) when the file is new or changed.
    Returns None when the file has no features; raises nothing — an unreadable file reports a box that matches everything,
    so the reader meets it and fails the way it always did."""
    global _dirty
    idx = _load()
    key = _KEYS.get(str(path))
    if key is None:
        rp = path.resolve()
        key = str(rp.relative_to(ROOT)) if rp.is_relative_to(ROOT) else str(rp)
        _KEYS[str(path)] = key
    try:
        st = path.stat()
    except OSError:
        return [-180.0, -90.0, 180.0, 90.0]
    ent = idx.get(key)
    if ent and ent.get("size") == st.st_size and ent.get("mtime") == int(st.st_mtime_ns):
        return ent.get("bbox")
    try:
        box = measure(path)
    except (OSError, ValueError):
        return [-180.0, -90.0, 180.0, 90.0]
    idx[key] = {"size": st.st_size, "mtime": int(st.st_mtime_ns), "bbox": box}
    _dirty = True
    return box


def select(paths: Iterable[pathlib.Path], bbox: Optional[BBox]) -> List[pathlib.Path]:
    """The paths whose features can lie inside bbox (min_lon, min_lat, max_lon, max_lat). bbox None keeps every path."""
    paths = list(paths)
    if bbox is None:
        return paths
    lo0, la0, lo1, la1 = bbox
    out: List[pathlib.Path] = []
    for p in paths:
        b = bbox_of(p)
        if b is None:
            continue                      # no features at all: nothing to read
        if b[2] < lo0 or b[0] > lo1 or b[3] < la0 or b[1] > la1:
            continue
        out.append(p)
    _save()
    return out


_JSON: "OrderedDict[str, tuple]" = OrderedDict()   # path -> (size, mtime_ns, parsed, bytes)
_JSON_BYTES = 0
JSON_CACHE_BYTES = int(os.environ.get("ROOT_ROOM_JSON_CACHE_MB", "192")) * 1024 * 1024   # the parsed window files kept between runs in one process (a street's set is ~40 MB); smaller on a small host


def load_json(path: pathlib.Path):
    """json.loads of a file, kept in memory between runs (keyed by size + mtime, so a rewritten file is read again).
    A long-lived server reads a street's windows once; a one-shot script pays nothing extra."""
    global _JSON_BYTES
    key = str(path)
    st = path.stat()
    ent = _JSON.get(key)
    if ent and ent[0] == st.st_size and ent[1] == int(st.st_mtime_ns):
        _JSON.move_to_end(key)
        return ent[2]
    doc = json.loads(path.read_text(encoding="utf-8"))
    if ent:
        _JSON_BYTES -= ent[3]
        del _JSON[key]
    _JSON[key] = (st.st_size, int(st.st_mtime_ns), doc, st.st_size)
    _JSON_BYTES += st.st_size
    while _JSON_BYTES > JSON_CACHE_BYTES and len(_JSON) > 1:
        _, old = _JSON.popitem(last=False)
        _JSON_BYTES -= old[3]
    return doc


def any_features(paths: Iterable[pathlib.Path]) -> bool:
    """True when at least one of the files holds a feature (the dataset was fetched), without reading them again."""
    found = any(bbox_of(p) is not None for p in paths)
    _save()
    return found


def pad_lonlat(lon: float, lat: float, metres: float) -> List[float]:
    """A square of ± metres around a point, in degrees."""
    import math
    dlat = metres / 111_320.0
    dlon = metres / (111_320.0 * max(0.2, math.cos(math.radians(lat))))
    return [lon - dlon, lat - dlat, lon + dlon, lat + dlat]
