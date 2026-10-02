/* Root Room's engine in the visitor's browser (a classic Web Worker).
   Pyodide runs the same Python as scripts/serve_web.py — src/ (the rule engine, scene_api) and scripts/export_scene.py — on the
   pilot street's City data, unpacked from engine/bundle.zip into the worker's in-memory file system. Nothing is approximated
   in JavaScript: every number the page draws still comes from the engine's file. */
const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/';
let py = null;
let ready = null;
const post = (m) => self.postMessage(m);

async function boot(bundleUrl) {
  post({ stage: 'LOADING THE ENGINE' });
  importScripts(PYODIDE + 'pyodide.js');
  py = await self.loadPyodide({ indexURL: PYODIDE });
  await py.loadPackage(['jsonschema']);
  post({ stage: "LOADING THE PILOT STREET'S CITY DATA" });
  const res = await fetch(bundleUrl);
  if (!res.ok) throw new Error('engine bundle: ' + res.status);
  py.unpackArchive(await res.arrayBuffer(), 'zip', { extractDir: '/home/pyodide/rr' });
  py.runPython(`
import os, sys, json, glob, pathlib
os.environ['ROOT_ROOM_INDEX_SIZE_ONLY'] = '1'
sys.path.insert(0, '/home/pyodide/rr')
os.chdir('/home/pyodide/rr')
from src import scene_api, window_index

def _scene_get(site):
    p = scene_api.scene_path(site)
    return json.loads(p.read_text(encoding='utf-8')) if p.exists() else scene_api.scene_result(site)

def _warm():
    for p in sorted(glob.glob('/home/pyodide/rr/data/raw/**/*.geojson', recursive=True)):
        window_index.load_json(pathlib.Path(p))
    return True

_OPS = {'evaluate_scene': scene_api.evaluate_scene, 'freeze_scene': scene_api.freeze_scene,
        'list_frozen': scene_api.list_frozen, 'scene_get': _scene_get, 'warm': _warm}

def _call(op, args_json):
    try:
        return json.dumps({'ok': True, 'result': _OPS[op](*json.loads(args_json))})
    except Exception as e:
        return json.dumps({'ok': False, 'error': str(e) or type(e).__name__})
`);
  post({ stage: null });
}

self.onmessage = async (e) => {
  const { id, op, args } = e.data;
  try {
    if (op === 'boot') { ready = ready || boot(args[0]); await ready; post({ id, ok: true, result: true }); return; }
    await ready;
    py.globals.set('_OP', op); py.globals.set('_ARGS', JSON.stringify(args || []));
    post({ id, ...JSON.parse(py.runPython('_call(_OP, _ARGS)')) });
  } catch (err) {
    const msg = String((err && err.message) || err).trim().split('\n').filter(Boolean);   /* a Python traceback: its last line is the message */
    post({ id, ok: false, error: msg[msg.length - 1] || 'the engine failed' });
  }
};
