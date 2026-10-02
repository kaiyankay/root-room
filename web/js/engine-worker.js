/* Root Room's engine in the visitor's browser (a classic Web Worker).
   Pyodide runs the same Python as scripts/serve_web.py — src/ (the rule engine, scene_api) and scripts/export_scene.py — on the
   pilot street's City data, unpacked from engine/bundle.zip into the worker's in-memory file system. Nothing is approximated
   in JavaScript: every number the page draws still comes from the engine's file. */
const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/';
let py = null;
let ready = null;
const post = (m) => self.postMessage(m);
const T0 = performance.now(); const log = (what) => post({ log: what, ms: Math.round(performance.now() - T0) });   /* timings for the console (static-api logs them) */

async function boot(bundleUrl) {
  post({ stage: 'LOADING THE ENGINE' });
  const bundle = fetch(bundleUrl).then((r) => { if (!r.ok) throw new Error('engine bundle: ' + r.status); return r.arrayBuffer(); });   /* the street's data downloads while Python starts */
  importScripts(PYODIDE + 'pyodide.js');
  log('pyodide.js loaded');
  py = await self.loadPyodide({ indexURL: PYODIDE });
  log('python started');   /* no packages to load: a valid record is decided without jsonschema (src/schema_validation.py) */
  post({ stage: "LOADING THE PILOT STREET'S CITY DATA" });
  py.unpackArchive(await bundle, 'zip', { extractDir: '/home/pyodide/rr' });
  log('bundle unpacked');
  py.runPython(`
import os, sys, json, glob, pathlib, gc
os.environ['ROOT_ROOM_INDEX_SIZE_ONLY'] = '1'
os.environ['ROOT_ROOM_FAST_ONLY'] = '1'
sys.path.insert(0, '/home/pyodide/rr')
os.chdir('/home/pyodide/rr')
from src import scene_api, window_index

def _scene_get(site):
    p = scene_api.scene_path(site)
    return json.loads(p.read_text(encoding='utf-8')) if p.exists() else scene_api.scene_result(site)

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
        'list_frozen': scene_api.list_frozen, 'scene_get': _scene_get, 'warm': _warm}

def _call(op, args_json):
    try:
        return json.dumps({'ok': True, 'result': _OPS[op](*json.loads(args_json))})
    except Exception as e:
        return json.dumps({'ok': False, 'error': str(e) or type(e).__name__})
`);
  log('modules imported');
  post({ stage: null });
}

self.onmessage = async (e) => {
  const { id, op, args } = e.data;
  try {
    if (op === 'boot') { ready = ready || boot(args[0]); await ready; post({ id, ok: true, result: true }); return; }
    await ready;
    py.globals.set('_OP', op); py.globals.set('_ARGS', JSON.stringify(args || []));
    const t = performance.now(); const out = py.runPython('_call(_OP, _ARGS)'); const t2 = performance.now(); const o = JSON.parse(out); log(`${op} python ${Math.round(t2 - t)} ms, result ${Math.round(out.length / 1024)} kB`);
    post({ id, ...o });
  } catch (err) {
    const msg = String((err && err.message) || err).trim().split('\n').filter(Boolean);   /* a Python traceback: its last line is the message */
    post({ id, ok: false, error: msg[msg.length - 1] || 'the engine failed' });
  }
};
