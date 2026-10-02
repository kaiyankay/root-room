/* Root Room on a static host (GitHub Pages): the same page and the same engine.
   window.ROOT_ROOM_STATIC is written into one.html by scripts/build_static.py; without it the page talks to scripts/serve_web.py.
   - GET routes read the files the build wrote under api/ (the build ran the engine to make them, as the server would).
   - A tree clicked on the pilot street, with the knobs the build used, reads the build's run of that tree (instant).
   - Every other run — a ground change, a species, a saved scenario — goes to the engine in this browser (engine-worker.js). */
export const STATIC = typeof window !== 'undefined' && window.ROOT_ROOM_STATIC ? window.ROOT_ROOM_STATIC : null;
const M = STATIC || {};

const asJson = async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || (r.status === 404 ? 'not in the online demo' : r.statusText)); return j; };
const get = (p) => fetch(p).then(asJson);

/* knob values compared as the engine reads them: numbers to 1e-6, null = undefined = absent */
function same(a, b) {
  if (a == null || b == null) return a == null && b == null;
  if (typeof a === 'number' || typeof b === 'number') return typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-6;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (typeof a === 'object' && typeof b === 'object') return [...new Set([...Object.keys(a), ...Object.keys(b)])].every((k) => same(a[k], b[k]));
  return a === b;
}
const KNOBS = ['curb', 'depth', 'target', 'soil', 'land_use', 'width_level', 'replacement', 'extensions', 'candidate', 'curb_provenance', 'curb_evidence'];
const pick = (o) => Object.fromEntries(KNOBS.map((k) => [k, k === 'replacement' ? !!o[k] : o[k]]));

export function makeStaticApi({ onStage = () => {} } = {}) {
  let worker = null, booting = null, booted = false, seq = 0;
  const waits = new Map(); const session = new Set(); const frozenHere = new Set();   /* scenes and frozen lists this tab changed: only those ask the engine */
  const call = (op, args) => new Promise((res, rej) => { const id = ++seq; waits.set(id, { res, rej }); worker.postMessage({ id, op, args }); });
  function boot() {
    if (booting) return booting;
    worker = new Worker(new URL('./engine-worker.js', import.meta.url));
    worker.onmessage = (e) => {
      const { id, ok, result, error } = e.data;
      if ('log' in e.data) { console.info(`[engine] ${e.data.ms} ms · ${e.data.log}`); return; }
      if ('stage' in e.data && id == null) { onStage(e.data.stage); return; }
      const w = waits.get(id); if (!w) return; waits.delete(id); if (ok) w.res(result); else w.rej(new Error(error));
    };
    worker.onerror = (e) => { for (const w of waits.values()) w.rej(new Error('the engine could not start in this browser: ' + (e.message || 'worker error'))); waits.clear(); };
    booting = call('boot', [new URL(M.bundle || 'engine/bundle.zip', location.href).href]).then(() => { booted = true; });
    booting.catch(() => { booting = null; worker = null; });
    return booting;
  }
  async function engine(op, args) {
    if (!booted) { onStage('PREPARING THE ENGINE IN THIS BROWSER', true); await boot(); onStage(null); }
    return call(op, args);
  }
  let trees = null;
  const treesAll = () => trees || (trees = get('api/trees_all.json'));
  const story = M.story || { trees: [], knobs: {} };
  if (STATIC) boot().catch(() => {});   /* the engine starts with the page, not after the street has loaded */
  return {
    scene: async (s) => {
      if (session.has(s)) return engine('scene_get', [s]);
      try { return await get(`api/scene/${encodeURIComponent(s)}.json`); } catch (e) { if (booted) return engine('scene_get', [s]); throw e; }
    },
    evaluate: async (p) => {
      if (p.scenario === false && !p.candidate_only && story.trees.includes(p.site_id) && same(pick(p), story.knobs)) {
        if (booting) booting.then(() => call('warm', [{ ...p, scenario: true, scenario_fresh: true }])).catch(() => {});   /* the engine gets ready for this tree while it is read */
        return get(`api/scene/${encodeURIComponent(p.site_id)}.json`);
      }
      const S = await engine('evaluate_scene', [p.site_id, p]);
      session.add(S.site_id); return S;
    },
    freezeScenario: async (p) => { const F = await engine('freeze_scene', [p.site_id, p.scene, p.subject, p.cut_aa_u]); session.add(F.site_id); frozenHere.add(String(p.site_id).split('_')[0]); return F; },
    listScenarios: async (site) => {
      if (frozenHere.has(String(site).split('_')[0])) return engine('list_frozen', [site]);
      try { return await get(`api/scenario_list/${encodeURIComponent(site)}.json`); } catch (e) { return { site_id: site, base_hash: null, scenarios: [] }; }
    },
    tree: async (id) => {
      try { return await get(`api/tree/${id}.json`); } catch (e) { return { asset_id: +id, properties: {}, street: null, site_id: 'V-' + id, has_engine_file: false }; }
    },
    treesNear: async (lon, lat) => {
      const all = await treesAll(); const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 111320; const have = new Set(M.engineAssets || []);
      return all.map(([x, y, a]) => ({ asset_id: a, lon: x, lat: y, distance_m: Math.hypot((x - lon) * kx, (y - lat) * ky) })).filter((t) => t.distance_m <= 60)
        .sort((u, v) => u.distance_m - v.distance_m).slice(0, 12).map((t) => ({ ...t, distance_m: +t.distance_m.toFixed(1), has_engine_file: have.has(t.asset_id) }));
    },
    addresses: () => get('api/address_index.json'),
    rules: () => get('api/rules.json'),
    runSite: async () => { throw new Error(M.offPilot || 'the online demo carries the City data of the pilot street only'); },
    warm: (payload) => boot().then(() => call('warm', [payload || null])).catch(() => {}),
  };
}
