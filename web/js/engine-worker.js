/* Root Room's engine in the visitor's browser (a classic Web Worker).
   Pyodide runs the same Python as scripts/serve_web.py — src/ (the rule engine, scene_api) and scripts/export_scene.py,
   scripts/run_site.py, scripts/run_block_face.py — unpacked from engine/bundle.zip into the worker's in-memory file system.
   Nothing is approximated in JavaScript: every number the page draws still comes from the engine's file.
   Any City tree: the street's window of City layers is fetched here, from the same two City services the local scripts
   read (the Open Data portal's export route, the VanMap map services), written where scripts/fetch_context.py and
   scripts/fetch_vanmap.py write them, and the engine runs on them as it does on the author's machine. */
const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/';
const ODS = 'https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets';
const VANMAP = 'https://maps.vancouver.ca/server/rest/services/VanMapViewer/';
const VANMAP_TREES = VANMAP + 'Environment/MapServer/32/query';
const RR = '/home/pyodide/rr';
const RADIUS_M = 500.0;          /* scripts/run_site.py WINDOW_RADIUS_M */
/* scripts/fetch_context.py ALL_DATASETS, without the 1 m contours (7–20 MB a window; kept locally for provenance, read by nothing the page draws) */
const DATASETS = ['right-of-way-widths', 'block-outlines', 'building-footprints-2015', 'property-parcel-polygons', 'lanes',
  'water-distribution-mains', 'water-transmission-mains', 'sewer-mains', 'sewer-catch-basins', 'street-lighting-conduits', 'street-lighting-poles',
  'sewer-manholes', 'gvrd-sewer-trunk-mains', 'abandoned-water-mains', 'dedicated-fire-protection-systems-dfps-water-mains', 'water-control-valves',
  'water-hydrants', 'street-lighting-junction-boxes', 'street-lighting-abandoned-conduits', 'street-lighting-service-panels', 'traffic-signals',
  'property-easements', 'rapid-transit-lines', 'rapid-transit-stations', 'property-addresses', 'street-intersections'];
const GROUPS = { context: ['right-of-way-widths', 'block-outlines', 'building-footprints-2015', 'property-parcel-polygons', 'lanes'],
  utility: ['water-distribution-mains', 'water-transmission-mains', 'sewer-mains', 'sewer-catch-basins', 'street-lighting-conduits', 'street-lighting-poles'],
  address: ['property-addresses', 'street-intersections'] };
const groupOf = (ds) => Object.keys(GROUPS).find((g) => GROUPS[g].includes(ds)) || 'underground_extra';
/* scripts/fetch_vanmap.py LAYERS */
const VLAYERS = { 'water-distribution-mains': ['Infrastructure_Water/MapServer/11', 'water'], 'water-transmission-mains': ['Infrastructure_Water/MapServer/14', 'water'],
  'dfps-water-mains': ['Infrastructure_Water/MapServer/13', 'water'], 'abandoned-water-mains': ['Infrastructure_Water/MapServer/9', 'water'],
  'sanitary-mains': ['Infrastructure_Sewer/MapServer/35', 'sewer'], 'storm-mains': ['Infrastructure_Sewer/MapServer/36', 'sewer'], 'combined-mains': ['Infrastructure_Sewer/MapServer/37', 'sewer'],
  'sewer-manholes': ['Infrastructure_Sewer/MapServer/29', 'sewer'], 'sewer-service-lines': ['Infrastructure_Sewer/MapServer/104', 'sewer'],
  'street-lighting-conduits': ['Infrastructure_Street_Lighting/MapServer/95', 'street_lighting'], 'peat-areas-unconfirmed': ['Environment/MapServer/10', 'ground'] };
const PAGE = 1000;

let py = null;
let ready = null;
const post = (m) => self.postMessage(m);
const T0 = performance.now(); const log = (what) => post({ log: what, ms: Math.round(performance.now() - T0) });   /* timings for the console (static-api logs them) */
const stage = (text) => post({ stage: text });
const today = () => new Date().toISOString().slice(0, 10);
const windows = [];   /* the windows this engine holds: {name, lon, lat, r} — the bundle's (manifest) and the ones fetched here */

/* VanMap answers no cross-origin fetch; its REST routes answer JSONP, which a classic worker loads with importScripts (synchronous: the callback has run when it returns) */
let jpSeq = 0;
function jsonp(url) {
  return new Promise((res, rej) => {
    const cb = '__vm' + (++jpSeq); self[cb] = (d) => { delete self[cb]; res(d); };
    try { importScripts(url + (url.includes('?') ? '&' : '?') + 'callback=' + cb); } catch (e) { delete self[cb]; rej(new Error('VanMap: ' + (e.message || e))); }
    if (self[cb]) { delete self[cb]; rej(new Error('VanMap: no answer from ' + url.split('?')[0])); }
  });
}
async function fetchText(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} from the City portal (${url.split('/datasets/')[1].split('/')[0]})`); return r.text(); }
async function pool(items, n, fn) { const out = new Array(items.length); let i = 0; const run = async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }; await Promise.all(Array.from({ length: Math.min(n, items.length) }, run)); return out; }

/* scripts/fetch_vanmap.py: esri → GeoJSON, date fields as ISO beside the millisecond value */
function esriGeom(g, t) {
  if (!g) return null;
  if (t === 'esriGeometryPoint') return { type: 'Point', coordinates: [g.x, g.y] };
  if (t === 'esriGeometryPolyline') { const p = g.paths || []; return p.length === 1 ? { type: 'LineString', coordinates: p[0] } : { type: 'MultiLineString', coordinates: p }; }
  if (t === 'esriGeometryPolygon') return { type: 'Polygon', coordinates: g.rings || [] };
  return null;
}
function isoDates(attrs, fields) { for (const f of fields) if (f.type === 'esriFieldTypeDate') { const v = attrs[f.name]; if (typeof v === 'number') attrs[f.name + '_iso'] = new Date(v).toISOString().slice(0, 10); } return attrs; }
async function vanmapLayer(path, env) {
  const info = await jsonp(VANMAP + path + '?f=json'); const gtype = info.geometryType; const fields = info.fields || [];
  const feats = []; let offset = 0;
  for (;;) {
    const q = new URLSearchParams({ f: 'json', where: '1=1', geometry: JSON.stringify(env), geometryType: 'esriGeometryEnvelope', inSR: 4326, spatialRel: 'esriSpatialRelIntersects',
      outFields: '*', outSR: 4326, returnGeometry: 'true', resultOffset: offset, resultRecordCount: PAGE });
    const r = await jsonp(VANMAP + path + '/query?' + q.toString());
    if (r.error) throw new Error(path + ': ' + JSON.stringify(r.error));
    for (const f of r.features || []) feats.push({ type: 'Feature', properties: isoDates(f.attributes || {}, fields), geometry: esriGeom(f.geometry, gtype) });
    if (!r.exceededTransferLimit || !(r.features || []).length) break;
    offset += r.features.length;
  }
  return { info, feats };
}

/* the window around a tree, as scripts/run_site.py names and fills it; the City's layers go to data/raw and data/raw/vanmap with their logs */
async function fetchWindow(name, lon, lat, label) {
  const where = `within_distance(geom, geom'POINT(${lon} ${lat})', ${RADIUS_M}m)`;
  const raw = `${RR}/data/raw`; py.FS.mkdirTree(raw + '/vanmap');
  const total = DATASETS.length + Object.keys(VLAYERS).length; let done = 0;
  const tick = () => { done += 1; stage(`${label} · THE CITY'S LAYERS ${done}/${total}`); };
  const odsOne = async (ds) => {
    const [meta, gj] = await Promise.all([fetchText(`${ODS}/${ds}`), fetchText(`${ODS}/${ds}/exports/geojson?where=${encodeURIComponent(where)}`)]);
    py.FS.writeFile(`${raw}/${ds}__${name}.geojson`, gj); py.FS.writeFile(`${raw}/${ds}__dataset_metadata.json`, meta);
    const d = ((JSON.parse(meta).metas || {}).default) || {}; let n = 0; try { n = (JSON.parse(gj).features || []).length; } catch (e) { /* counted for the log only */ }
    tick();
    return { dataset_id: ds, title: d.title, records_in_dataset: d.records_count, data_modified: d.modified, fetched_on: today(),
      export_url: `${ODS}/${ds}/exports/geojson?where=${encodeURIComponent(where)}`, features_saved: n, saved_as: `data/raw/${ds}__${name}.geojson`, layer_group: groupOf(ds) };
  };
  const dlat = RADIUS_M / 111320, dlon = RADIUS_M / (111320 * Math.cos((lat * Math.PI) / 180));
  const env = { xmin: lon - dlon, ymin: lat - dlat, xmax: lon + dlon, ymax: lat + dlat, spatialReference: { wkid: 4326 } };
  const vmAll = async () => {   /* one layer at a time: the map service answers a burst with errors */
    const out = [];
    for (const [lid, [path, group]] of Object.entries(VLAYERS)) {
      const { info, feats } = await vanmapLayer(path, env);
      py.FS.writeFile(`${raw}/vanmap/${lid}__${name}.geojson`, JSON.stringify({ type: 'FeatureCollection', features: feats }));
      py.FS.writeFile(`${raw}/vanmap/${lid}__layer_info.json`, JSON.stringify(info));
      out.push({ layer_id: lid, service_layer: path, name: info.name, geometry_type: info.geometryType, fields: (info.fields || []).map((f) => f.name), fetched_on: today(),
        features_saved: feats.length, saved_as: `data/raw/vanmap/${lid}__${name}.geojson`, layer_group: group });
      tick();
    }
    return out;
  };
  const treesP = fetchText(`${ODS}/public-trees/exports/geojson?where=${encodeURIComponent(where)}`);   /* the City trees of the window: SITE records for every one of them */
  const [ods, vm, trees] = await Promise.all([pool(DATASETS, 6, odsOne), vmAll(), treesP]);
  py.FS.writeFile(`${raw}/${name}__fetch_log.json`, JSON.stringify({ fetched_on: today(), licence: 'Open Government Licence – Vancouver', portal: 'https://opendata.vancouver.ca', window: name,
    centre: { lon, lat }, radius_m: RADIUS_M, spatial_filter: where, datasets: ods.sort((a, b) => a.dataset_id.localeCompare(b.dataset_id)), fetched_in: 'the visitor\'s browser (engine-worker.js)' }));
  py.FS.writeFile(`${raw}/vanmap/${name}__vanmap_fetch_log.json`, JSON.stringify({ fetched_on: today(), source: VANMAP, licence: 'none stated on the service (VanMap viewer services)', window: name,
    centre: { lon, lat }, radius_m: RADIUS_M, envelope_wgs84: env, layers: vm }));
  py.globals.set('_TREES_GJ', trees); py.runPython('_add_trees(_TREES_GJ)');
  windows.push({ name, lon, lat, r: RADIUS_M });
}
/* the tree's window is held already when a window's centre is within (its radius − 300 m) and, for a window the build cut to a box, the tree's 300 m lie inside that box: a block face and its neighbours fit */
const NEED_M = 300;
function covered(lon, lat) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 111320;
  return windows.some((w) => Math.hypot((w.lon - lon) * kx, (w.lat - lat) * ky) <= w.r - NEED_M
    && (!w.bbox || (lon - NEED_M / kx >= w.bbox[0] && lon + NEED_M / kx <= w.bbox[2] && lat - NEED_M / ky >= w.bbox[1] && lat + NEED_M / ky <= w.bbox[3])));
}
async function ensureWindow(lon, lat, label) {
  if (covered(lon, lat)) return false;
  py.globals.set('_LON', lon); py.globals.set('_LAT', lat); const name = py.runPython('_window_for(_LON, _LAT)');
  const t = performance.now(); await fetchWindow(name, lon, lat, label); log(`window ${name} fetched in ${Math.round(performance.now() - t)} ms`);
  return true;
}
/* the City tree itself, by its asset id, into the engine's public-trees file (the citywide file stays on the author's machine) */
async function ensureTree(asset) {
  const have = py.runPython(`_has_tree(${+asset})`); if (have) return;
  const gj = await fetchText(`${ODS}/public-trees/exports/geojson?where=${encodeURIComponent('asset_id=' + (+asset))}`);
  py.globals.set('_TREES_GJ', gj); py.runPython('_add_trees(_TREES_GJ)');
}
/* the VanMap Trees layer's block sentence for the selected tree (scripts/run_site.py asks it over the network; here it is asked first and handed in) */
async function vanmapNotes(asset) {
  try {
    const q = new URLSearchParams({ f: 'json', where: `ASSET_ID=${+asset}`, outFields: 'ASSET_ID,LOCATION_NOTES,INSTALL_DATE,FULL_ADDR', returnGeometry: 'false' });
    const d = await jsonp(VANMAP_TREES + '?' + q.toString()); const f = (d.features || [])[0]; if (!f) return null;
    const at = f.attributes; at.INSTALL_DATE_iso = typeof at.INSTALL_DATE === 'number' ? new Date(at.INSTALL_DATE).toISOString().slice(0, 10) : null;
    py.globals.set('_NOTES_JSON', JSON.stringify(at)); py.runPython(`_NOTES[${+asset}] = json.loads(_NOTES_JSON)`); return at;
  } catch (e) { return null; }
}

async function boot(bundleUrl, cityFiles, known) {
  stage('LOADING THE ENGINE');
  const bundle = fetch(bundleUrl).then((r) => { if (!r.ok) throw new Error('engine bundle: ' + r.status); return r.arrayBuffer(); });   /* the street's data downloads while Python starts */
  const city = Promise.all((cityFiles || []).map((u) => fetch(u).then((r) => (r.ok ? r.text() : null)).catch(() => null)));   /* the citywide street and park files the map already holds: the engine reads the same */
  importScripts(PYODIDE + 'pyodide.js');
  log('pyodide.js loaded');
  py = await self.loadPyodide({ indexURL: PYODIDE });
  log('python started');   /* no packages to load: a valid record is decided without jsonschema (src/schema_validation.py) */
  stage("LOADING THE STREET'S CITY DATA");
  py.unpackArchive(await bundle, 'zip', { extractDir: RR });
  log('bundle unpacked');
  for (const [i, text] of (await city).entries()) if (text) py.FS.writeFile(`${RR}/data/raw/${cityFiles[i].split('/').pop().split('?')[0]}`, text);
  for (const w of known || []) windows.push(w);
  py.runPython(`
import os, sys, json, glob, pathlib, gc
os.environ['ROOT_ROOM_INDEX_SIZE_ONLY'] = '1'
os.environ['ROOT_ROOM_FAST_ONLY'] = '1'
sys.path.insert(0, '/home/pyodide/rr')
os.chdir('/home/pyodide/rr')
from src import scene_api, window_index, sites
import importlib.util
_spec = importlib.util.spec_from_file_location('rootroom_scripts_run_site', '/home/pyodide/rr/scripts/run_site.py')
_run_site_mod = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(_run_site_mod)
_window_for = lambda lon, lat: _run_site_mod.window_for(lon, lat)[0]
_NOTES = {}
sites.vanmap_location_notes = lambda asset_id, timeout=20: _NOTES.get(int(asset_id))   # asked by the worker first (JSONP), never over a socket here
scene_api.set_progress = lambda what, text: _js_stage(text.upper())                   # the engine's phases, in words, to the page

def _scene_get(site):
    p = scene_api.scene_path(site)
    return json.loads(p.read_text(encoding='utf-8')) if p.exists() else scene_api.scene_result(site)

def _has_tree(asset):
    try:
        sites.tree_by_asset_id(int(asset)); return True
    except Exception:
        return False

def _add_trees(gj_text):
    # the window's City trees (or one tree) into the engine's public-trees file, once each; the site module reads the file again
    new = json.loads(gj_text).get('features', [])
    p = sites.TREES_PATH
    doc = json.loads(p.read_text(encoding='utf-8')) if p.exists() else {'type': 'FeatureCollection', 'features': []}
    have = {f['properties'].get('asset_id') for f in doc['features']}
    add = [f for f in new if f.get('geometry') and f['properties'].get('asset_id') not in have]
    if add:
        doc['features'].extend(add)
        p.write_text(json.dumps(doc), encoding='utf-8')
        sites._CACHE.pop(str(p), None)
    return len(add)

def _warm(payload=None):
    # parse the street's City data once, run the engine once for the street on screen (its caches fill), then keep
    # everything loaded out of the garbage collector: a later run only does the work that depends on the knobs
    for p in sorted(glob.glob('/home/pyodide/rr/data/raw/**/*.geojson', recursive=True) + glob.glob('/home/pyodide/rr/data/raw/**/*.json', recursive=True)):
        window_index.load_json(pathlib.Path(p))
    if payload and payload.get('site_id'):
        try:
            scene_api.evaluate_scene(payload['site_id'], payload)
        except Exception:
            pass
    gc.collect(); gc.freeze()
    return True

_OPS = {'evaluate_scene': scene_api.evaluate_scene, 'freeze_scene': scene_api.freeze_scene,
        'list_frozen': scene_api.list_frozen, 'delete_frozen': scene_api.delete_frozen, 'scene_get': _scene_get, 'warm': _warm,
        'run_site': scene_api.run_site, 'tree_lookup': scene_api.tree_lookup}

def _call(op, args_json):
    try:
        return json.dumps({'ok': True, 'result': _OPS[op](*json.loads(args_json))})
    except Exception as e:
        return json.dumps({'ok': False, 'error': str(e) or type(e).__name__})
`);
  py.globals.set('_js_stage', (t) => stage(t));
  log('modules imported');
  stage(null);
}

/* before the engine runs for a tree: its record, its window; op by op the page asks only what the server's routes ask */
async function prepare(op, args) {
  if (op === 'tree_lookup') { await ensureTree(args[0]); return; }
  if (op === 'run_site') {
    const p = args[0]; const asset = +p.asset_id; const label = `TREE ${asset}`;
    stage(`${label} · THE CITY'S RECORD`); await ensureTree(asset);
    const [lon, lat] = JSON.parse(py.runPython(`json.dumps(sites.tree_by_asset_id(${asset})['geometry']['coordinates'][:2])`));
    stage(`${label} · THE CITY'S LAYERS AROUND IT`); await Promise.all([ensureWindow(lon, lat, label), vanmapNotes(asset)]);
    stage(`${label} · RUNNING THE RULE FOR ITS BLOCK`); return;
  }
  if (op === 'evaluate_scene' && args[1] && args[1].lon != null && args[1].lat != null) { const { lon, lat } = args[1]; delete args[1].lon; delete args[1].lat; await ensureWindow(lon, lat, `TREE ${String(args[0]).split('_')[0].split('-')[1] || ''}`); }
}

self.onmessage = async (e) => {
  const { id, op, args } = e.data;
  try {
    if (op === 'boot') { ready = ready || boot(args[0], args[1], args[2]); await ready; post({ id, ok: true, result: true }); return; }
    await ready;
    await prepare(op, args || []);
    py.globals.set('_OP', op); py.globals.set('_ARGS', JSON.stringify(args || []));
    const t = performance.now(); const out = py.runPython('_call(_OP, _ARGS)'); const t2 = performance.now(); const o = JSON.parse(out); log(`${op} python ${Math.round(t2 - t)} ms, result ${Math.round(out.length / 1024)} kB`);
    post({ id, ...o });
  } catch (err) {
    const msg = String((err && err.message) || err).trim().split('\n').filter(Boolean);   /* a Python traceback: its last line is the message */
    post({ id, ok: false, error: msg[msg.length - 1] || 'the engine failed' });
  }
};
