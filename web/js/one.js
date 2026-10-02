// One street, one line (stops 1–6): the chunk never leaves the screen; scrolling walks the camera around it.
// 1 the city: the map is the ground; the camera dives to the block and the chunk is cut out of it.
// 2 the street: straight down onto the chunk, everything labelled on the object.
// 3 below: the lid lifts off, the facilities inside the black are captioned with leaders.
// 4 the rule: the camera walks round to the property side, the chunk is cut along the street; the band carved out of
//   the black; two handles (curb, band depth); the engine runs when a handle is released.
// 5 the tree: a tray of the City's species; one card dragged (or clicked) into this tree's cell; its need-box lands in the cut.
// 6 the sheet: the camera walks back to the road side; the chunk stands as one block with captions ①–⑤; save it as a PNG.
// Every number is read from the scene file; the page computes only geometry.
import * as THREE from 'three';
import { Scene, loadModels, MODELS, COL } from './scene.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const asJson = async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j; };
const fmt = (x, d = 1) => (x == null ? '—' : Number(x).toFixed(d));
const svgNS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, text) => { const e = document.createElementNS(svgNS, tag); for (const k in attrs) { let v = attrs[k]; if ((k === 'width' || k === 'height') && +v < 0) { console.warn('negative ' + k, tag, attrs.class || attrs.id || '', v); v = 0; } e.setAttribute(k, v); } if (text != null) e.textContent = text; return e; };
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
const RAMP = ['#E7ECDF', '#CBDABD', '#ACC59F', '#8CAB82', '#6B9065', '#4C724A'];   // one dusty green, six steps, printed not fluorescent
const HUE = { 1: ['#E3D3A8', '#D0BB80', '#B99F5E'], 2: ['#B4CDE4', '#94B5D2', '#7B93B5'], 3: ['#B8CFA7', '#93B387', '#6E9569'] };   // Small · Medium · Large, three depths
const WATER = '#DEE5E8', LAND = '#F6F3EC', PAPER = '#F6F3EC';   // atlas base: warm paper land, very pale cool water
const INK = '30,45,35';   // the map's one ink (charcoal green) for streets, boundaries and patterns
const VERDICT_HATCH = { Large: 'cross', Medium: 'ring', Small: 'diag', none: 'x' };   // the rule's answer on an area's checked streets, as a pattern over the colour
const STOPS = 6;   // one continuous scroll: 01 location · 02 street plan · 03 tree + ground · 04 scenario builder · 05 axonometric results · 06 summary & report
let SCROLL = 5.5;  // t in [0, 5.5]: the page ends on the summary's anchor, nothing to bounce back from; the stage is floor(t) (the dive's last leg, t ≥ 0.8, already belongs to the street)
// one two-panel layout for stages 02–04: rail | zone labels | PLAN (the chunk + margin m either side) | gap | SECTION A–A with its tables | the right column (03 the City's record, 04 the rule result)
const SHEET = { rail: 280, west: 118, planW: 610, gap: 26, margin: 3.0, head: 104, foot: 140, east: 250 };   /* foot: the scale bar (yBot + 22/44) and the key row (H − 22) live here */
// the sheet follows the window: the rail, the zone-label column, the plan, the gap and the right column share the width, and the
// section takes the rest — never less than it needs to draw (the layout was first composed at 2000 × 1100; smaller windows scale it)
function fitSheet() {
  const W = app.scene ? app.scene.W : 2000; if (app.fitW === W) return; app.fitW = W;
  const wide = W >= 1900; SHEET.rail = wide ? 240 : W >= 1500 ? 205 : 190; SHEET.west = wide ? 130 : 118; SHEET.east = wide ? 330 : 310; SHEET.toolL = wide ? 360 : 300; SHEET.toolR = wide ? 440 : 330;   /* 04: inputs left · the instrument centre · outputs right */ SHEET.eastRec = wide ? 330 : 300;   /* 03: the fact sheet (WHAT DO WE KNOW) needs the width */ SHEET.gap = wide ? 26 : 16;   /* the right column: the record (03) is narrow, the tool (04) is two columns wide */
  const avail = W - SHEET.rail - SHEET.west - SHEET.eastRec - SHEET.gap - 10; SHEET.planW = Math.round(Math.max(300, Math.min(560, avail * 0.38)));
  $('rail').style.width = SHEET.rail + 'px'; $('q').style.paddingLeft = (SHEET.rail + 26) + 'px'; $('result').style.width = (SHEET.eastRec - 14) + 'px'; $('summary').style.left = (SHEET.rail + 20) + 'px';
  if (app.scene) app.scene._pf = null;
}
// the state: selectedTree (the scene file's selected tree) · existing (the canonical scene, never touched by a what-if) · workingScenario
// (app.scenario, the last engine run on the section, written to a _scenario side file) · savedScenarios (app.saved, immutable snapshots)
const app = { S: null, site: params.get('site') || 'KE-198571_curb10', t: 0, busy: false, city: null, shade: params.get('shade') || 'species',
              drag: null, dragCard: null, armed: null, ctlKey: '', cityKey: '', resKey: '', sumKey: '',
              existing: null, scenario: null, saved: [], axo: 0, cutU: 0, report: null, sumOpen: false, hotNeed: false, sectionOpen: false, secK: 0, secAnim: false, cls: null };
const STAGE_TAG = ['THE ATLAS', 'STREET PLAN', 'EXISTING CONDITION', 'WORKING SCENARIO', 'AXONOMETRIC RESULT', 'SUMMARY & REPORT'];
const smoothInv = (y) => { let lo = 0, hi = 1; for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (smooth(m) < y) lo = m; else hi = m; } return (lo + hi) / 2; };
const diveT = () => { const sc = app.scene; const pa = (sc && sc.divePA) || 0.3, ps = (sc && sc.divePS) || 0.85, pb = (sc && sc.divePB) || 0.6; return { ta: smoothInv(pa), tb: smoothInv(pb), ts: smoothInv(ps) }; };   /* ta: the area level · tb: the block level (tree dots) · ts: the street arrives */
const DOTS_HALF_W = 560;   /* the block level: tree dots are drawn and clickable once the half-width is under this (m) */
const atlasLevel = (t) => { const dv = diveT(); const hw = app.scene && app.scene.halfW1; return t >= dv.ts ? 'street' : (hw != null ? hw < DOTS_HALF_W : t >= dv.tb - 0.05) ? 'block' : t >= dv.ta - 0.1 ? 'area' : 'city'; };
const stage = (t) => (t < diveT().ts ? 0 : Math.min(5, Math.floor(Math.max(1, t))));
// the plan panel's width: alone (02) it takes the whole sheet; as the section comes in (1.72 → 2.0) it narrows to its 03–04 width
const secOnAt = (t) => Math.max(smooth((t - 1.72) / 0.28), app.secK);   /* the section is open: by a click on a tree (02) or by the scroll (03 on) */
const planWAt = (t) => { const W = app.scene ? app.scene.W : 2000; const wide = Math.max(SHEET.planW, W - SHEET.rail - SHEET.west - 40); return lerp(wide, SHEET.planW, secOnAt(t)); };
// which scene a stage draws: 01–03 the existing condition; 04 the working scenario (or the existing until something is changed); 05–06 the selected saved scenario
const sceneFor = (t) => (app.report ? app.report.scene : t < 3 ? (app.existing || app.S) : t < 4 ? (app.scenario || app.existing || app.S) : (app.saved[app.axo] ? app.saved[app.axo].scene : (app.scenario || app.existing || app.S)));   /* 05: the chosen frozen scenario, else the working state as it stands (02–04 decide it; saving is optional); 06 compares frozen ones */
function syncScene() { const S = sceneFor(app.t); if (S && S !== app.S) { app.S = S; app.scene.build(S); app.ctlKey = ''; app.resKey = ''; question(); } }
const SOIL_NOTE = { native_soil: 'native soil · credited in full', structural_soil: 'structural soil · 50 % credited · R06', soil_cell: 'soil cells · no credit factor in the source (R11) · manual conditions R10', other: 'other soil · as the engine reads it' };
// the sampled block faces (scripts/batch_faces.py): one colour per "largest Table 9-2 class that fits" at the batch knobs
const FACE_COL = { Large: '#2E5A2B', Medium: '#6E9E6A', Small: '#A9C2A4', none: '#B0413E', unknown: '#9A9A9A' };   // one hue by size; red only for nothing
const FACE_TXT = { Large: 'Large fits', Medium: 'Medium fits', Small: 'only Small', none: 'nothing fits', unknown: 'no record' };
// where the camera stands at the end of each stop (azimuth from the road side, elevation), radians
const A6 = 2 * Math.PI - 0.62, E6 = 0.62; // 05 the axonometric: the block seen from the road side, above; drag turns it
const EXPLODE_GAP = 2.6;                   // 05: metres between the exploded layers
const SHEET_ON = 4.3;                      // the captions and the orbit, once the camera has arrived
const STOP_T = [0, 1.5, 2.5, 3.5, 4.85, 5.5];   // where a click on the rail lands
const SOIL_PAT = { native_soil: 'p4', structural_soil: 'p1', soil_cell: 'p2', other: 'p7' };   // the growing medium's stratum tile by soil type (library swatches)
const SOIL_TXT = { native_soil: 'NATIVE SOIL', structural_soil: 'STRUCTURAL SOIL', soil_cell: 'SOIL CELLS', other: 'OTHER SOIL' };
const SOIL_SHORT = { native_soil: 'NATIVE', structural_soil: 'STRUCTURAL', soil_cell: 'SOIL CELLS', other: 'OTHER' };
const LAND_TXT = { residential_detached: 'RESIDENTIAL · DETACHED', residential_low_rise: 'RESIDENTIAL · LOW-RISE', residential_mid_high_rise_ftn_greenway: 'RESIDENTIAL · MID / HIGH-RISE · FTN · GREENWAY', commercial_mixed_use: 'COMMERCIAL · MIXED USE' };
const LAND_SHORT = { residential_detached: 'DETACHED', residential_low_rise: 'LOW-RISE', residential_mid_high_rise_ftn_greenway: 'MID / HIGH-RISE', commercial_mixed_use: 'COMMERCIAL' };

class One extends Scene {
  constructor(canvas) { super(canvas); this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -3000, 3000); this.lidZ = 0; this.dAz = 0; this.dEl = 0; this.cutOn = false; this.renderer.localClippingEnabled = true; this._clipOn = null; }
  /* 05: the block the axonometric cuts out of the street — the file's slab along the street, but only the street's own width
     (a metre of road before the curb face to the property line) and three metres of ground, deeper if a recorded main in it needs it */
  axoBox(S) {
    const sl = this.slab; const st = S.street; const v0 = st.curb_face_v != null ? st.curb_face_v - 1.0 : sl.v0, v1 = st.property_line_v != null ? st.property_line_v : sl.v1;
    let D = 3.0; for (const f of S.facilities || []) { if (f.depth_top_m == null || !f.path_uv || f.kind === 'corridor') continue; if (!f.path_uv.some(([u, v]) => u >= sl.u0 && u <= sl.u1 && v >= v0 && v <= v1)) continue; D = Math.max(D, Math.min(4.5, f.depth_top_m + (f.diameter_mm || 200) / 1000 + 0.6)); }
    return { u0: sl.u0, u1: sl.u1, v0, v1, depth_m: +D.toFixed(1) };
  }
  /* local clipping at 05: the ground, the mains and the roots are cut at the block's faces; the trees keep their crowns (their set is widened along the street) */
  applyClip(on) {
    if (on === this._clipOn) return; this._clipOn = on;
    this.scene.traverse((o) => { if (!o.material) return; const mats = Array.isArray(o.material) ? o.material : [o.material]; for (const m of mats) { m.clippingPlanes = on ? (o.isMesh && o.geometry && o.geometry.type === 'PlaneGeometry' && ((o.userData.tree !== undefined && o.userData.tree !== null) || o.userData.tuft) ? this.treeClip : this.slabClip) : null; m.needsUpdate = true; } });
  }
  // the city as the ground: two canvas textures painted by one painter in the site's metre frame — the whole city
  // (24 km, 5.9 m per texel) and the 8.4 km around the block (2 m per texel) on top of it; the dive crosses from one to the other
  async buildCity(S, city, shade = 'species') {
    const fr = S.frame; const [lon0, lat0] = fr.origin_lonlat; const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 111320;
    const [ux, uy] = fr.along_unit_xy, [px, py] = fr.property_unit_xy;
    const uv = (lon, lat) => { const x = (lon - lon0) * kx, y = (lat - lat0) * ky; return [x * ux + y * uy, x * px + y * py]; };
    // the city's extent and centre in this frame (from the 22 local-area rings)
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9; const areaRings = [];
    if (city.areas) for (const f of city.areas.features) { const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates; for (const p of polys) for (const r of p) { const ring = r.map(([lon, lat]) => uv(lon, lat)); areaRings.push({ name: f.properties.name, ring }); for (const [u, v] of ring) { u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); } } }
    this.cityBox = { u0, u1, v0, v1 }; this.cityCentre = new THREE.Vector3((u0 + u1) / 2, (v0 + v1) / 2, 0);
    // the areas as the unit of the city view: name, centre (the City's own point), extent, numbers from the scene's files, the ring for hit-testing
    const nFaces = (name) => (city.faces ? city.faces.faces.filter((f) => f.run_ok && f.local_area === name).length : 0);
    this.areaInfo = (city.areas ? city.areas.features : []).map((f) => {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates; const ring = polys.map((pp) => pp[0]).sort((a, b) => b.length - a.length)[0].map(([lon, lat]) => uv(lon, lat));
      let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9; for (const [u, v] of ring) { a0 = Math.min(a0, u); a1 = Math.max(a1, u); b0 = Math.min(b0, v); b1 = Math.max(b1, v); }
      const gp = f.properties.geo_point_2d; const [cu, cv] = gp ? uv(gp.lon, gp.lat) : [(a0 + a1) / 2, (b0 + b1) / 2]; const sh = city.shares && city.shares.areas[f.properties.name];
      return { name: f.properties.name, u: cu, v: cv, box: { u0: a0, u1: a1, v0: b0, v1: b1 }, ring, trees: sh ? sh.trees : null, share: sh ? sh.share : null, faces: nFaces(f.properties.name) };
    });
    const inRing = (ring, u, v) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > v) !== (yj > v) && u < (xj - xi) * (v - yi) / (yj - yi) + xi) c = !c; } return c; };
    this.areaAt = (u, v) => this.areaInfo.find((a) => u >= a.box.u0 && u <= a.box.u1 && v >= a.box.v0 && v <= a.box.v1 && inRing(a.ring, u, v)) || null;
    for (const a of this.areaInfo) { const c = city.capacity && city.capacity.areas[a.name]; const lc = c && c.largest_class_fits; a.verdict = null; if (lc) { const best = ['Large', 'Medium', 'Small', 'none'].map((k) => [k, lc[k] || 0]).sort((x, y) => y[1] - x[1])[0]; if (best[1] > 0) a.verdict = best[0]; } }
    const areaHa = (pts) => { let a2 = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a2 += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]); return Math.abs(a2) / 2 / 1e4; };
    for (const a of this.areaInfo) { a.dens = (a.trees || 0) / Math.max(1, areaHa(a.ring)); }
    this.blockUV = []; if (city.blocks) for (const bk of city.blocks.blocks) { if (bk.l < 4) continue; const pts = bk.r.map(([lon, lat]) => uv(lon, lat)); let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9; for (const [u, v] of pts) { u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); } const c3 = bk.c; this.blockUV.push({ pts, box: [u0, u1, v0, v1], cls: c3[2] >= c3[1] && c3[2] >= c3[0] ? 3 : c3[1] >= c3[0] ? 2 : 1, dens: bk.n / Math.max(.2, areaHa(pts)) }); }
    this.homeArea = this.areaAt(0, 0);   // the area this street is in: the dive always passes through it
    // the mosaic: 400 m cells binned from every public tree — class of the Table 9-3 species the City planted most (hue),
    // share of the cell's trees that are on the list (depth of colour); fewer than 6 trees = hatched (too few to say)
    const C = 400; const cells = new Map();
    for (const p of city.trees) { const [u, v] = uv(p[0], p[1]); const key = Math.floor(u / C) + ',' + Math.floor(v / C); let c = cells.get(key); if (!c) { c = [0, 0, 0, 0]; cells.set(key, c); } c[p[3] || 0]++; }
    this.cells = cells; this.cellSize = C;
    this.northUV = new THREE.Vector3(uy, py, 0);   // north in this frame: the city view stands north-up, the block view street-up
    this.faceUV = []; if (city.faces) for (const f of city.faces.faces) { if (!f.run_ok || !f.line_lonlat) continue; const [a, b] = f.line_lonlat.map(([lon, lat]) => uv(lon, lat)); this.faceUV.push({ f, a, b }); }
    this.treeUV = city.trees.map((p) => { const [u, v] = uv(p[0], p[1]); return [u, v, p[2], p[3] || 0]; });   /* every public tree in this frame: the block level's dots, each one a door to its own 03 */
    const shares = city.shares; const cap = city.capacity; const lo = shares ? shares.share_min : 0.05, hi = shares ? shares.share_max : 0.25;
    const areaShade = (name) => {
      if (shade === 'large') { const a = cap && cap.areas[name]; if (!a || a.large_fits_share == null) return RAMP[0]; return RAMP[Math.min(5, Math.floor(a.large_fits_share * 5.999))]; }
      const a = shares && shares.areas[name]; return RAMP[a && a.share != null ? Math.min(5, Math.floor((a.share - lo) / (hi - lo + 1e-9) * 6)) : 0];
    };
    const level = (share) => (share < 0.10 ? 0 : share < 0.20 ? 1 : 2);
    const paint = (cx, cy, R, N, fine) => {
      const k = N / (2 * R); const c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d');
      const X = (u) => N / 2 + (u - cx) * k, Y = (v) => N / 2 - (v - cy) * k; const w = (m, min) => Math.max(min, m * k);
      const path = (pts) => { pts.forEach(([u, v], i) => (i ? g.lineTo(X(u), Y(v)) : g.moveTo(X(u), Y(v)))); g.closePath(); };
      const line = (pts) => { g.beginPath(); pts.forEach(([u, v], i) => (i ? g.lineTo(X(u), Y(v)) : g.moveTo(X(u), Y(v)))); g.stroke(); };
      const near = (pts) => pts.some(([u, v]) => Math.abs(u - cx) < R + 300 && Math.abs(v - cy) < R + 300);
      const rg = city.region; const ll = (r) => r.map(([lon, lat]) => uv(lon, lat)); const ink = (a2) => `rgba(${INK},${a2})`;
      // 1 · paper and water: the same paper everywhere, data or not
      g.fillStyle = PAPER; g.fillRect(0, 0, N, N);
      if (rg) { g.fillStyle = WATER; for (const poly of rg.ocean.concat(rg.water)) { g.beginPath(); for (const r of poly) path(ll(r)); g.fill('evenodd'); } }
      // 2 · parks and larger green spaces, the faintest context
      if (city.parks) { g.fillStyle = 'rgba(110,146,104,.13)'; for (const f of city.parks.features) { if (!f.geometry) continue; const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates; for (const pp of polys) for (const r of pp) { g.beginPath(); path(ll(r)); g.fill(); } } }
      // 3 · the thematic layer, printed: far = the 22 areas on the ramp, near = the real blocks on the same ramp (share of trees on the City's list)
      const shareIdx = (sh) => Math.max(0, Math.min(5, Math.floor((sh - lo) / (hi - lo + 1e-9) * 6)));
      if (!fine) { for (const a of areaRings) { g.fillStyle = areaShade(a.name); g.beginPath(); path(a.ring); g.fill(); } }
      else if (city.blocks) { g.globalAlpha = 1; for (const bk of city.blocks.blocks) { const pts = ll(bk.r); if (!near(pts)) continue; g.fillStyle = bk.n >= 4 ? RAMP[shareIdx(bk.l / bk.n)] : '#E9EDE3'; g.beginPath(); path(pts); g.fill(); } g.globalAlpha = 1; }
      // 4 · the street fabric, one weight system across the whole map, over the colour: neighbours' blocks as their street lines, the City's streets, the regional roads
      g.lineCap = 'round'; g.lineJoin = 'round';
      if (city.regionBlocks) { g.strokeStyle = ink(fine ? .13 : .18); g.lineWidth = w(2.4, fine ? .45 : .55); for (const r of city.regionBlocks.blocks) { const pts = ll(r); if (!near(pts)) continue; g.beginPath(); path(pts); g.stroke(); } }
      if (city.streets) for (const f of city.streets.features) { if (!f.geometry) continue; const res = f.properties.streetuse === 'Residential'; g.strokeStyle = ink(res ? (fine ? .16 : .2) : (fine ? .26 : .34)); g.lineWidth = res ? w(2.4, fine ? .45 : .55) : w(5, fine ? .8 : 1.2); const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates; for (const l of lines) line(l.map(([lon, lat]) => uv(lon, lat))); }
      if (rg) { g.save(); g.beginPath(); g.rect(0, 0, N, N); for (const a of areaRings) path(a.ring); g.clip('evenodd'); for (const rd of rg.roads) { const big = rd.c === 'freeway' || rd.c === 'highway' || rd.c === 'arterial'; g.strokeStyle = ink(big ? (fine ? .24 : .36) : .13); g.lineWidth = big ? w(5, fine ? .8 : 1.3) : w(2.4, .45); line(rd.p.map(([lon, lat]) => uv(lon, lat))); } g.restore(); }
      // 5 · boundaries: blocks fine, areas soft charcoal green (never hard black)
      if (fine && city.blocks) { g.strokeStyle = ink(.28); g.lineWidth = w(.7, .4); for (const bk of city.blocks.blocks) { const pts = ll(bk.r); if (!near(pts)) continue; g.beginPath(); path(pts); g.stroke(); } }
      // 7 · close in: every public tree (on the list = ink, sized by class; the rest faint), and the checked streets
      const DOT = [ink(.25), ink(.6), ink(.72), ink(.85)];
      if (fine) for (const pass of [0, 1]) for (const p of city.trees) { const cls = p[3] || 0; if ((pass === 0) !== (cls === 0)) continue; const [u, v] = uv(p[0], p[1]); if (Math.abs(u - cx) > R || Math.abs(v - cy) > R) continue; g.fillStyle = DOT[cls]; if (fine === 2) { g.beginPath(); g.arc(X(u), Y(v), (cls ? 1.1 : 0.8) * k, 0, 6.2832); g.fill(); } else { const r = cls ? 1.6 : 1.0; g.fillRect(X(u) - r / 2, Y(v) - r / 2, r, r); } }
      if (fine) { g.lineCap = 'butt'; for (const { f, a: pa, b: pb } of this.faceUV) { g.strokeStyle = FACE_COL[f.largest_class_fits] || FACE_COL.unknown; g.lineWidth = w(2.5, 1.4); g.beginPath(); g.moveTo(X(pa[0]), Y(pa[1])); g.lineTo(X(pb[0]), Y(pb[1])); g.stroke(); } }
      const tex = new THREE.CanvasTexture(c); tex.anisotropy = 8; tex.minFilter = THREE.LinearMipmapLinearFilter; return tex;
    };
    for (const m of [this.cityPlane, this.cityPlaneFar, this.cityPlaneNear]) if (m) this.scene.remove(m);
    const RF = 12000, RN = 4200, RB = 1000;
    this.cityPlaneFar = new THREE.Mesh(new THREE.PlaneGeometry(2 * RF, 2 * RF), new THREE.MeshBasicMaterial({ map: paint(this.cityCentre.x, this.cityCentre.y, RF, 4096, false), depthWrite: false }));
    this.cityPlaneFar.position.set(this.cityCentre.x, this.cityCentre.y, -0.10); this.cityPlaneFar.renderOrder = -11;
    this.cityPlane = new THREE.Mesh(new THREE.PlaneGeometry(2 * RN, 2 * RN), new THREE.MeshBasicMaterial({ map: paint(0, 0, RN, 4096, true), depthWrite: false, transparent: true, opacity: 0 })); this.cityPlane.position.z = -0.08; this.cityPlane.renderOrder = -10;
    this.cityPlaneNear = new THREE.Mesh(new THREE.PlaneGeometry(2 * RB, 2 * RB), new THREE.MeshBasicMaterial({ map: paint(0, 0, RB, 4096, 2), depthWrite: false, transparent: true, opacity: 0 })); this.cityPlaneNear.position.z = -0.06; this.cityPlaneNear.renderOrder = -9;
    this.scene.add(this.cityPlaneFar); this.scene.add(this.cityPlane); this.scene.add(this.cityPlaneNear);
  }
  // the ground point under the pointer (z = 0), and the area there
  groundAt(px, py) { const r = new THREE.Raycaster(); r.setFromCamera(new THREE.Vector2(px / this.W * 2 - 1, 1 - py / this.H * 2), this.cam); const q = new THREE.Vector3(); return r.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), q) ? q : null; }
  pickArea(px, py) { const q = this.groundAt(px, py); return q && this.areaAt ? this.areaAt(q.x, q.y) : null; }
  // a sampled block face under the pointer, at stop 1 (screen distance to its projected line)
  pickFace(px, py) {
    if (!this.faceUV) return null; let best = null, bd = 7;
    for (const it of this.faceUV) { const a = this.project(it.a[0], it.a[1], 0), b = this.project(it.b[0], it.b[1], 0); const dx = b.x - a.x, dy = b.y - a.y; const L2 = dx * dx + dy * dy || 1; const tt = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / L2)); const d = Math.hypot(px - (a.x + tt * dx), py - (a.y + tt * dy)); if (d < bd) { bd = d; best = it.f; } }
    return best;
  }
  /* ground cover on the planter: line-art tufts (a canvas drawn once), stood up as billboards along the band, never on a tree or a clearance strip */
  tuftTexture() { if (this._tuftTex) return this._tuftTex; const c = document.createElement('canvas'); c.width = 160; c.height = 120; const g = c.getContext('2d'); g.strokeStyle = '#557F52'; g.lineWidth = 3.2; g.lineCap = 'round';   /* strokes bold enough to survive the tenth-size draw, in the accent, not ink */ let sd = 11; const R = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    for (let i = 0; i < 13; i++) { const x0 = 80 + (R() - .5) * 46; const a = (R() - .5) * 1.4; const h = 50 + R() * 60; g.beginPath(); g.moveTo(x0, 118); g.quadraticCurveTo(x0 + Math.sin(a) * h * 0.5, 118 - h * 0.6, x0 + Math.sin(a) * h, 118 - h); g.stroke(); }
    for (let i = 0; i < 5; i++) { const x0 = 80 + (R() - .5) * 60, y0 = 70 + R() * 30, r = 6 + R() * 6; g.beginPath(); g.ellipse(x0, y0, r, r * 0.6, R() * 3, 0, 6.283); g.stroke(); }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; this._tuftTex = tex; return tex; }
  buildTufts(S) {
    const bd = S.band.design; const ax = this.axo || this.slab; if (!bd) return; const strips = (S.band.strips || []); let sd = 5; const R = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    const segs = (S.band.segments || []).map((q) => [Math.max(q.u_from, ax.u0), Math.min(q.u_to, ax.u1)]).filter(([a, b]) => b - a > 0.5); const tex = this.tuftTexture();
    for (const [u0, u1] of segs) { const n = Math.round((u1 - u0) / 0.9); for (let i = 0; i < n; i++) { const u = u0 + 0.5 + R() * (u1 - u0 - 1.0), v = bd.v_from + 0.5 + R() * (bd.v_to - bd.v_from - 1.0);
      if (S.trees.some((t) => Math.hypot(t.u - u, t.v - v) < 1.6) || strips.some((q) => u >= q.u0 - 0.2 && u <= q.u1 + 0.2 && v >= q.v0 && v <= q.v1)) continue;
      const h = 0.55 + R() * 0.4, w = h * 1.33;   /* ornamental grasses and low shrubs, 0.55–0.95 m: the planting the planter is drawn with */ const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, alphaTest: 0.03, opacity: 0.8 }));
      m.position.set(u, v, h / 2); m.userData.base = new THREE.Vector3(u, v, h / 2); m.userData.dx = 0; m.userData.tree = null; m.userData.tuft = true; m.renderOrder = 4; this.g.ground.add(m); this.billboards.push(m); } }   /* renderOrder 4: drawn after the translucent surfaces, whose centres sort them later otherwise */
  }
  build(S) { this.billboards = []; this._candForm = S.candidate ? S.candidate.form : null; super.build(S); this.buildTufts(S); for (const m of [this.cityPlaneFar, this.cityPlane, this.cityPlaneNear]) if (m) this.scene.add(m); this.g.slab.visible = true; this.g.cut.visible = false; this.slabScale = 1; this._pf = null; }
  // 2 the street: the frame holds the chunk and the one row of houses behind it — the far lane at the bottom, the houses' backs
  // at the top, the drawing below the question line, the chunk a little left of centre so the right-hand paper takes the text column
  planFrame() {
    fitSheet(); const t = app.t; const pw = planWAt(t); const kf = secOnAt(t); const key = `${pw}|${kf.toFixed(3)}|${(app.pan || 0).toFixed(2)}`;
    if (this._pf && this._pfW === this.W && this._pfH === this.H && this._pfKey === key) return this._pf;
    const S = this.S, sl = this.slab, st = S.street, blk = st.block; const cl = st.centreline_v;
    const yTop = SHEET.head, yBot = this.H - SHEET.foot; const cap = (yBot - yTop) / 30;   /* never so close that the houses leave the frame */
    const spanA = (blk.u_to - blk.u_from) + 8, cA = (blk.u_from + blk.u_to) / 2;             /* 02: the whole block face, every tree on it */
    const spanB = (sl.u1 - sl.u0) + 24, cB = (sl.u0 + sl.u1) / 2;                            /* 03–04: the selected tree's cell and its neighbours */
    const ppmA = Math.min(pw / spanA, cap), ppmB = Math.min(pw / spanB, cap); const ppm = Math.exp(lerp(Math.log(ppmA), Math.log(ppmB), kf)); const cc = lerp(cA, cB + (app.pan || 0), kf);   /* app.pan: the drag along the street (m), only in the zoomed frame */
    const halfW = this.W / 2 / ppm; const xc = SHEET.rail + SHEET.west + pw / 2; const cu = cc + (this.W / 2 - xc) / ppm;
    const bottom = cl - 3; const top = bottom + (yBot - yTop) / ppm;   /* the far lane at the bottom, the houses' fronts at the top */
    const cv = (top + bottom) / 2 - (this.H / 2 - (yTop + yBot) / 2) / ppm;
    this._pf = { cu, cv, halfW, ppm }; this._pfW = this.W; this._pfH = this.H; this._pfKey = key; return this._pf;
  }
  // one camera, framed on a centre with a half-width, from a direction (top: dir (0,0,1); oblique: azimuth/elevation from the road side)
  fitAxo(dir, up, ex) {
    const sl = this.axo || this.slab; const S = this.S; const D = sl.depth_m; const G = EXPLODE_GAP; const hTop = Math.max(8, ...(S.trees || []).filter((q) => q.u >= sl.u0 - 4 && q.u <= sl.u1 + 4).map((q) => q.height_m || 6), S.candidate ? S.candidate.drawn_height_m || 8 : 0);
    const zs = [-D, 0, G * ex, 2 * G * ex]; const pts = []; for (const z of zs) for (const [u, v] of [[sl.u0, sl.v0], [sl.u0, sl.v1], [sl.u1, sl.v0], [sl.u1, sl.v1]]) pts.push([u, v, z]);
    const sel = (S.trees || []).find((q) => q.selected); const crowns = (S.trees || []).filter((q) => q.u >= sl.u0 - 4 && q.u <= sl.u1 + 4 && !(S.candidate && q.selected)).map((q) => [q.u, q.v, q.height_m || 6, (q.crown_diameter_m || (q.height_m || 6) * 0.6) / 2]); if (S.candidate && sel) crowns.push([sel.u, sel.v, S.candidate.drawn_height_m || 8, (S.candidate.drawn_height_m || 8) * (S.candidate.crown_ratio_of_height || 0.6) / 2]);
    for (const [u, v, h, rr] of crowns) for (const [du, dv] of [[-rr, 0], [rr, 0], [0, -rr], [0, rr]]) pts.push([u + du, v + dv, 2 * G * ex + h]);   /* the real crowns, not a tree-high box over the whole block */
    const c0 = new THREE.Vector3((sl.u0 + sl.u1) / 2, (sl.v0 + sl.v1) / 2, (-D + 2 * G * ex + hTop) / 2); let halfW = 60; this.frame(halfW, c0, dir, up); this.cam.updateMatrixWorld(true); this.cam.matrixWorldInverse.copy(this.cam.matrixWorld).invert();   /* project() needs the view matrix of this frame, not of the last render */
    const area = { x0: SHEET.rail + 40, x1: this.W - 380 - 24 - 36, y0: 150, y1: this.H - 28 };
    const px = pts.map(([u, v, z]) => this.project(u, v, z)); const bx0 = Math.min(...px.map((p) => p.x)), bx1 = Math.max(...px.map((p) => p.x)), by0 = Math.min(...px.map((p) => p.y)), by1 = Math.max(...px.map((p) => p.y));
    const k = Math.max((bx1 - bx0) / Math.max(100, area.x1 - area.x0), (by1 - by0) / Math.max(100, area.y1 - area.y0)) * 1.04; halfW *= k;
    const right = new THREE.Vector3().crossVectors(up, dir).normalize(), upC = new THREE.Vector3().crossVectors(dir, right).normalize();   /* the camera's right and up in the world */
    const wpp = 2 * 60 / this.W;   /* world units per pixel at the provisional frame the box was measured in; the final frame is k times coarser and scales about the screen centre, so the area's centre is carried over with k */
    const dx = (((bx0 + bx1) / 2 - this.W / 2) + (this.W / 2 - (area.x0 + area.x1) / 2) * k) * wpp, dy = (((by0 + by1) / 2 - this.H / 2) + (this.H / 2 - (area.y0 + area.y1) / 2) * k) * wpp;
    return { halfW, centre: c0.clone().addScaledVector(right, dx).addScaledVector(upC, -dy) };
  }
  frame(halfW, centre, dir, up) {
    const cam = this.cam; const asp = this.W / this.H;
    cam.position.copy(centre).add(dir.clone().normalize().multiplyScalar(900)); cam.up.copy(up); cam.lookAt(centre);
    cam.left = -halfW; cam.right = halfW; cam.top = halfW / asp; cam.bottom = -halfW / asp; cam.updateProjectionMatrix();
    this.activeCam = cam; this.split = false;
  }
  treeModel(u, v, h, ratio, model, edgeMat, trunkMat, tag) {
    const form = (tag && tag.species_ref && tag.species_ref.form) || (tag ? null : this._candForm) || 'round'; const asset = TREE_ART.get(form) || TREE_ART.get('round');
    if (!asset) { this.needsArtRebuild = true; return super.treeModel(u, v, h, ratio, model, edgeMat, trunkMat, tag); }
    const col = edgeMat && edgeMat.color ? edgeMat.color.getHex() : COL.ink; const tone = col === COL.accent || col === COL.accentDark ? '#46693F' : col === COL.grey || col === COL.greyLight ? '#A0A0A0' : '#26382C';
    const tex = this.treeTexture(asset, tone); const span = Math.max(1e-6, asset.ground.y - asset.top.y); const crownD = h * ratio; const Hw = h * asset.h / span, Ww = crownD * asset.w / Math.max(1e-6, asset.right.x - asset.left.x);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(Ww, Hw), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, alphaTest: 0.1 })); m.renderOrder = 4;
    const below = (asset.h - asset.ground.y) * (h / span); m.position.set(u, v, Hw / 2 - below); m.userData.base = new THREE.Vector3(u, v, Hw / 2 - below); m.userData.dx = (asset.w / 2 - asset.ground.x) * (Ww / asset.w); m.userData.tree = tag;
    const g = new THREE.Group(); g.add(m); g.userData.crown = m; g.userData.trunk = m; g.userData.radius = crownD / 2; g.userData.trunkR = 0.15; this.billboards.push(m); return g;
  }
  treeTexture(asset, tone) {   /* the asset's paths, filled paper and stroked in the tree's tone, rasterised once per form and tone */
    this._treeTex = this._treeTex || {}; const key = `${asset.w}x${asset.h}|${tone}`; if (!this._treeTex[key]) {
      const sc = 900 / asset.h; const c = document.createElement('canvas'); c.width = Math.ceil(asset.w * sc); c.height = 900; const g = c.getContext('2d'); g.scale(sc, sc); g.lineWidth = 2.2 / sc; g.lineJoin = 'round'; g.lineCap = 'round'; g.fillStyle = '#F7F4EC'; g.strokeStyle = tone;
      for (const grp of asset.groups) for (const d of grp.d) { const path = new Path2D(d); g.fill(path); g.stroke(path); }
      this._treeTex[key] = c; }
    const tex = new THREE.CanvasTexture(this._treeTex[key]); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; return tex;
  }
  render() {
    if (this.billboards && this.billboards.length && this.activeCam) { const dir = this.activeCam.getWorldDirection(new THREE.Vector3()); const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 0, 1)).normalize();
      const f = dir.clone().negate(); const upv = new THREE.Vector3(0, 0, 1); const r = new THREE.Vector3().crossVectors(upv, f).normalize(); const f2 = new THREE.Vector3().crossVectors(r, upv).normalize(); const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(r, upv, f2));   /* the sheet stands vertical (z up) and turns about z to face the camera, as entourage in an axonometric does */
      for (const b of this.billboards) { if (!b.parent) continue; b.position.copy(b.userData.base).addScaledVector(r, b.userData.dx); b.quaternion.copy(q); } }
    super.render();
  }
  setStop(t) {
    this.pose = t; const S = this.S; if (!S) return; const sl = this.slab;
    const cS = new THREE.Vector3((sl.u0 + sl.u1) / 2, (sl.v0 + sl.v1) / 2, 0);   /* the dive and the plan centre on the file's slab; the axonometric frames its own box (fitAxo) */
    const obl = (az, el) => new THREE.Vector3(Math.sin(az) * Math.cos(el), -Math.cos(az) * Math.cos(el), Math.sin(el));
    const TOP = new THREE.Vector3(0, 0, 1), UPTOP = new THREE.Vector3(0, 1, 0), UPZ = new THREE.Vector3(0, 0, 1);
    const c6 = new THREE.Vector3(cS.x, cS.y, -2);
    let halfW, dir, up, centre = cS; let rise = 1, lid = 0, clip = false; const cut = false;
    if (t < 1) {                                                   // 1 the city → its area → the street: three legs, then the tilt
      const cb = this.cityBox || { u0: -8000, u1: 8000, v0: -5000, v1: 5000 }; const asp = this.W / this.H;
      const halfW0 = (cb.v1 - cb.v0) / 2 * 1.0 * asp;              // the city fills the height; the sea and the neighbours fill the sides
      const c0 = this.cityCentre || new THREE.Vector3(0, 0, 0); const shift = halfW0 * (110 / this.W);
      const cityC = new THREE.Vector3(c0.x - shift, c0.y + halfW0 / asp * 0.02, 0);
      const ar = (app.area && this.areaInfo ? this.areaInfo.find((a) => a.name === app.area) : null) || this.homeArea;
      const aHW = ar ? Math.max(1200, Math.max((ar.box.u1 - ar.box.u0) * 0.62, (ar.box.v1 - ar.box.v0) * 0.62 * asp)) : 1500; const aC = ar ? new THREE.Vector3(ar.u, ar.v, 0) : cS.clone();
      const L = (a, b, k) => Math.exp(lerp(Math.log(a), Math.log(b), k));
      const pf = this.planFrame(); const planC = new THREE.Vector3(pf.cu, pf.cv, 0); const l0 = Math.log(halfW0), l1 = Math.log(pf.halfW); const p = smooth(t);
      halfW = Math.exp(lerp(l0, l1, p));   /* one curve from the city to the plan: no leg ends, no restart */
      const pa = Math.max(0.05, Math.min(0.8, (l0 - Math.log(aHW)) / (l0 - l1))), ps = Math.max(pa + 0.05, Math.min(0.95, (l0 - Math.log(60)) / (l0 - l1))); this.divePA = pa; this.divePS = ps; this.divePB = Math.max(pa + 0.05, Math.min(ps - 0.05, (l0 - Math.log(330)) / (l0 - l1)));   /* where on that curve the area, the block (330 m half-width) and the street are */
      centre = p < pa ? cityC.clone().lerp(aC, p / pa) : p < ps ? aC.clone().lerp(cS, (p - pa) / (ps - pa)) : cS.clone().lerp(planC, (p - ps) / (1 - ps));
      dir = TOP; const turn = smooth((p - pa) / (ps - pa)); up = (this.northUV || UPTOP).clone().lerp(UPTOP, turn).normalize();   /* north-up becomes street-up between the area and the street */
      this.halfW1 = halfW; this.centre1 = centre; if (this.cityPlane) this.cityPlane.material.opacity = smooth((Math.log(6500) - Math.log(halfW)) / (Math.log(6500) - Math.log(2600)));   // the 8.4 km texture is fully in by the area level, so the city stipple never shows enlarged
      if (this.cityPlaneNear) this.cityPlaneNear.material.opacity = smooth((Math.log(1400) - Math.log(halfW)) / (Math.log(1400) - Math.log(700)));
      rise = 0; centre = new THREE.Vector3(centre.x, centre.y, 0);
    } else if (t < 4) {                                            // 02 the street plan · 03 tree + ground · 04 the scenario builder: straight down onto the chunk; the plan and the section hold still
      const pf = this.planFrame(); halfW = pf.halfW; dir = TOP; up = UPTOP; centre = new THREE.Vector3(pf.cu, pf.cv, 0);
    } else {                                                       // 05 the axonometric: the plan has gone; the block appears under the same frame and the camera walks round to the road side
      const s = smooth((t - 4.1) / 0.6); const pf = this.planFrame(); clip = t > 4.05; const ex = smooth((t - 4.35) / 0.45); this.explode = ex;
      const az = A6 + this.dAz, e = Math.max(0.12, Math.min(1.3, E6 + this.dEl)); const dirF = obl(az, e).normalize();
      /* the block is fitted to the sheet's drawing area — right of the rail, under the title, left of the captions' column — whatever the window and the explode */
      const fit = this.fitAxo(dirF, UPZ, ex);
      halfW = lerp(pf.halfW, fit.halfW, s); dir = TOP.clone().lerp(dirF, s).normalize(); up = UPTOP.clone().lerp(UPZ, s).normalize(); centre = new THREE.Vector3(pf.cu, pf.cv, 0).lerp(fit.centre, s);
      if (this.cityPlane) this.cityPlane.material.opacity = 1;
    }
    this.g.slab.scale.z = Math.max(0.001, rise); this.g.slab.visible = rise > 0.01;
    for (const o of this.g.slab.children) { if (o.renderOrder >= 5) o.visible = !cut && (this.explode || 0) < 0.5; if (o.userData.bandCut) o.visible = (this.explode || 0) < 0.35; }
    if (this.rootSets) { const k5 = t >= 4 ? 1.25 : 1; if (this._rootK !== k5) { this._rootK = k5; for (const set of Object.values(this.rootSets)) { set.heavy.linewidth = 1.7 * k5; set.medium.linewidth = 0.9 * k5; set.thin.linewidth = 0.55 * k5; } } }   /* the roots a quarter heavier in the axonometric, still a drawing, never a cable */   /* the roots a weight heavier in the axonometric, where the planter is the subject */
    if (this.slabLid) { const e2 = t >= 4 ? (this.explode || 0) : 0; this.slabLid.material.opacity = smooth((e2 - 0.15) / 0.5) * 0.96; this.slabLid.visible = e2 > 0.15; }   // the X-ray ghosts show the mains inside the closed block; once the layers lift, the mains themselves are in the air
    this.g.ground.position.z = lid; this.lidZ = lid;
    { const ex = t >= 4 ? (this.explode || 0) : 0; const G = EXPLODE_GAP; this.g.below.position.z = G * ex; for (const k of ['ground', 'above', 'sel', 'roots']) this.g[k].position.z = (k === 'ground' ? lid : 0) + 2 * G * ex; }   /* exploded: the native ground · the mains · the tree with its soil and roots — three layers */
    const near = t < 1 ? smooth((t - 0.55) / 0.3) : t < 4 ? 1 : smooth((t - 4.1) / 0.2);   // the block's own paper appears only once the dive is close; at the axonometric it fades in after the plan has gone
    const exN = t >= 4 ? (this.explode || 0) : 0; const glass = exN * 0.22;   /* exploded: the surface thins a little; the band's lid turns to glass so the roots read inside the lifted planter */
    for (const m of this.groundMeshes) { m.material.opacity = near * (m.userData.blvd ? 1 - exN * 0.8 : 1 - glass); m.material.transparent = near < 1 || glass > 0 || exN > 0; m.material.depthWrite = near > 0.5 && glass < 0.1 && !(m.userData.blvd && exN > 0.1); }   /* the boulevard's own surface is the roots' lid: glass once the planter has lifted */
    for (const o of this.g.ground.children) if (o.isMesh && !this.groundMeshes.includes(o)) { if (o.userData.op0 == null) o.userData.op0 = o.material.opacity; const k = o.userData.kerb || o.userData.tuft ? 1 : o.userData.bandTop ? 1 - exN * 0.86 : o.userData.band ? 1 : 1 - glass; o.material.opacity = o.userData.op0 * k; o.material.transparent = o.material.opacity < 1; o.material.depthWrite = !o.userData.band && glass < 0.1; }
    this.g.above.visible = near > 0.05; this.g.below.visible = near > 0.05; this.g.ground.visible = near > 0.02; this.g.roots.visible = near > 0.05;
    if (t < 4.0 || t >= 5) for (const k of ['ground', 'above', 'below', 'sel', 'slab', 'roots']) this.g[k].visible = false;   // 01–04 are the map and the flat sheet; the modelled block is the axonometric of a saved scenario (05)
    this.g.cut.visible = cut; this.cutOn = cut;
    if (this.gOwn) { this.gOwn.visible = false; this.gOwnPlan.visible = false; }
    if (this.needGroup) this.needGroup.visible = false;
    for (const m of [this.cityPlane, this.cityPlaneFar, this.cityPlaneNear]) if (m) m.visible = !clip;
    this.renderer.clippingPlanes = []; this.applyClip(!!clip);
    this.frame(halfW, centre, dir, up);
    this.render();
  }
  project(u, v, z) { const p = new THREE.Vector3(u, v, z); p.project(this.cam); return { x: (p.x + 1) / 2 * this.W, y: (1 - p.y) / 2 * this.H }; }
  axis(u, v, z, du, dv, dz) { const p = this.project(u, v, z), q = this.project(u + du, v + dv, z + dz); return { p, d: { x: q.x - p.x, y: q.y - p.y } }; }   // screen pixels per unit along a world direction
  orbit(daz, del) { this.dAz += daz; this.dEl = Math.max(-0.5, Math.min(0.6, this.dEl + del)); }
}

// ---------- data ----------
const api = { freezeScenario: (p) => fetch('/api/scenario/freeze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }).then(asJson), listScenarios: (site) => fetch(`/api/scenario/list?site=${encodeURIComponent(site)}`).then(asJson), addresses: () => fetch('/api/address_index').then(asJson), treesNear: (lon, lat) => fetch(`/api/trees_near?lon=${lon}&lat=${lat}&r=60`).then(asJson), runSite: (p) => fetch('/api/site/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }).then(asJson), scene: (s) => fetch(`/api/scene/${encodeURIComponent(s)}`).then(asJson), evaluate: (p) => fetch('/api/scene/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }).then(asJson), tree: (id) => fetch(`/api/tree?asset_id=${id}`).then(asJson), rules: () => fetch('/api/rules').then(asJson) };
async function cityData() {
  if (app.city) return app.city;
  const [trees, areas, parks, streets, shares] = await Promise.all([
    fetch('/api/trees_all').then((r) => r.json()), fetch('/data/local-area-boundary.geojson').then((r) => r.ok ? r.json() : null).catch(() => null),
    fetch('/data/parks-polygon-representation.geojson').then((r) => r.ok ? r.json() : null).catch(() => null), fetch('/data/public-streets.geojson').then((r) => r.ok ? r.json() : null).catch(() => null),
    fetch('/data/local_area_species.json').then((r) => r.ok ? r.json() : null).catch(() => null)]);
  const regionBlocks = await fetch('/data/region_blocks.json').then((r) => r.ok ? r.json() : null).catch(() => null);
  const [capacity, faces, region, blocks] = await Promise.all([fetch('/data/local_area_capacity.json').then((r) => r.ok ? r.json() : null).catch(() => null), fetch('/data/citywide_faces.json').then((r) => r.ok ? r.json() : null).catch(() => null), fetch('/data/region_base.json').then((r) => r.ok ? r.json() : null).catch(() => null), fetch('/data/city_blocks.json').then((r) => r.ok ? r.json() : null).catch(() => null)]);
  app.city = { trees, areas, parks, streets, shares, capacity, faces, region, blocks, regionBlocks }; return app.city;
}
function knobs(S) { const k = S.knobs; return { site_id: S.site_id.split('_')[0], curb: k.curb_offset_from_centreline_m && k.curb_offset_from_centreline_m.value, depth: k.soil_depth_m && k.soil_depth_m.value, target: k.target_tree_class && k.target_tree_class.value, soil: k.soil_type && k.soil_type.value, land_use: k.land_use && k.land_use.value, width_level: k.width_level && k.width_level.value, replacement: !!(k.tree_state && k.tree_state.value === 'vacant_replacement'), extensions: (S.band.zones || []).map((z) => ({ side: z.side, width_m: z.width_applied_m, soil_type: z.soil_type, provenance: z.provenance, status: z.status })), candidate: S.candidate ? S.candidate.id : null, curb_provenance: k.curb_offset_from_centreline_m && k.curb_offset_from_centreline_m.provenance === 'CONFIRMED_SITE_DATA' ? 'CONFIRMED_SITE_DATA' : null, curb_evidence: k.curb_offset_from_centreline_m && k.curb_offset_from_centreline_m.provenance === 'CONFIRMED_SITE_DATA' ? k.curb_offset_from_centreline_m.evidence : null }; }
async function show(S) {
  app.S = S; const ids = new Set(); for (const t of S.trees) if (t.species_ref) ids.add(t.species_ref.model); if (S.candidate) ids.add(S.candidate.model); await loadModels([...ids]);
  const city = await cityData(); const ck = `${S.site_id.split('_')[0]}|${app.shade}`;
  if (ck !== app.cityKey) { await app.scene.buildCity(S, city, app.shade); app.cityKey = ck; }   // the city texture is drawn once per block, not per engine run
  app.scene.build(S); app.scene.setStop(app.t); question(); app.ctlKey = ''; draw();
}
async function load(site) { status('loading…'); runStart('open', 'OPENING THE STREET'); try { const S = await api.scene(site); if (!(S && S.band && S.band.design)) throw new Error((S && S.error) || 'no scene for ' + site); app.existing = S; app.scenario = null; app.saved = []; app.axo = 0; app.pan = 0; app.cutU = 0; await show(S); app.site = site; await restoreSaved(site); draw(); status(''); runEnd(true); return true; } catch (e) { runEnd(false); status(e.message); return false; } }   /* false: no usable scene file on this server (a fresh clone) — the caller may run the tree instead */
// a change: the page shows it at once (app.pending), the engine runs (about 40 s: the block-face engine and the scene exporter), the file replaces it.
// story mode (selecting a tree) runs from the existing baseline's knobs and refreshes the baseline; scenario / review run from the
// scenario's knobs and the server writes the _scenario side file, so the existing condition on disk is never overwritten by a what-if
async function evaluate(patch) {
  if (app.busy) return; app.busy = true; app.pending = patch; closeMenu(); question(); app.ctlKey = ''; app.resKey = ''; draw();
  const runTree = patch.site_id ? ((app.existing || app.S).trees.find((x) => x.site_id === patch.site_id) || null) : null; const runName = runTree ? ((runTree.species_ref && runTree.species_ref.common) || runTree.genus || 'the tree') : '';
  status(patch.candidate_only ? 'placing the tree in the ground …' : runTree ? `reading the ground under ${runName} …` : 'the rule is running …');
  runStart(patch.candidate_only ? 'place' : 'engine', patch.candidate_only ? 'PLACING THE TREE' : runTree ? `READING THE GROUND · ${runName.toUpperCase()}` : 'RUNNING THE RULE');
  const story = app.t < 3; const base = story ? { ...knobs(app.existing || app.S), candidate: null } : knobs(app.S);   // 02–03: selecting a tree refreshes the existing condition; 04: the working scenario
  try { const S = await api.evaluate({ ...base, ...patch, scenario: !story, scenario_fresh: !app.scenario, base_engine: (app.existing || app.S).engine_file });   /* fresh: no scenario run yet, the working ground is the existing one (the server must not reuse an old side file) */ app.pending = null; if (story) { if (app.cutKeep) { app.cutKeep = false; if (app.cutNext != null) { app.cutU = app.cutNext; app.cutNext = null; } app.pan = 0; } else if (!app.existing || app.existing.site_id.split('_')[0] !== S.site_id.split('_')[0]) app.cutU = 0; app.existing = S; app.scenario = null; } else app.scenario = S; await show(S); if (story) { await restoreSaved(S.site_id); app.hotTree = null; } status(''); runEnd(true);   /* another tree: its own frozen scenarios, not an empty 05; the section shows the chosen tree, not whatever the pan left under the pointer */ } catch (e) { app.pending = null; app.cutKeep = false; app.cutNext = null; runEnd(false); status(e.message); question(); }
  app.busy = false; app.ctlKey = ''; app.resKey = ''; draw();
}
// ---------- the saved scenarios: immutable snapshots of a finished engine run on the section; the axonometric and the report read them ----------
async function saveScenario() {
  const S = app.S; if (!app.scenario || S !== app.scenario || app.busy || app.pending) return;   // only the last finished evaluation of the working scenario
  app.busy = true; status('freezing the scenario …'); runStart('freeze', 'FREEZING THE SCENARIO'); app.ctlKey = ''; draw();
  try {
    const F = await api.freezeScenario({ site_id: S.site_id.split('_')[0], scene: S, subject: resultFor(S).subject, cut_aa_u: app.cutU || 0 });   /* the server writes scene_<site>_<ID>.json and hands the file back: the snapshot is the file */
    app.saved.push(snapshotOf(F)); app.axo = app.saved.length - 1; app.ctlKey = ''; app.sumKey = ''; runEnd(true); status(`scenario ${F.frozen.scenario_id} frozen · ${F.frozen.file}`);
    app.busy = false; draw(); scrollToT(STOP_T[4]);
  } catch (e) { app.busy = false; runEnd(false); status(e.message); draw(); }
}
/* a saved scenario is read from its frozen file: knobs, result and subject are derived from the file, nothing from the page's memory */
/* the working state as 05 reads it when nothing is frozen: the same shape as a saved snapshot, marked live */
function liveSnap() { const S = app.scenario || app.existing || app.S; if (!S) return null; const r = resultFor(S); return { id: null, live: true, file: null, hash: null, knobs: knobs(S), result: r, scene: S, subject: r.subject, savedAt: null }; }
const axoSnap = () => app.saved[app.axo] || liveSnap();
function snapshotOf(F) { const r = resultFor(F); return { id: F.frozen.scenario_id, file: F.frozen.file, hash: F.frozen.hash, knobs: knobs(F), result: r, scene: F, subject: F.frozen.subject || r.subject, savedAt: F.frozen.saved_at }; }
async function restoreSaved(site) {
  app.saved = []; app.axo = 0;
  const base = site.split('_')[0];   /* frozen files are written against the block face, not its exported variant (…_curb10): list and read them there */
  try { const L = await api.listScenarios(base); for (const it of L.scenarios) { if (it.stale || !it.hash_ok) continue; const F = await api.scene(`${base}_${it.scenario_id}`); if (F && F.frozen) app.saved.push(snapshotOf(F)); } }
  catch (e) { status(e.message); }
  app.ctlKey = ''; app.sumKey = '';
}
// the report of one saved scenario: the sheet is drawn at the scenario builder's frame from the snapshot, captured, and the page returns to where it was
async function reportFor(snap, dry = false) {   // dry: the sheet's PNG goes to reports/screens only, no download (a check)
  if (app.busy) return; app.busy = true; status('composing the report …'); const t0 = app.t;
  app.report = snap; app.t = 3.5; syncScene(); app.scene.setStop(app.t); $('summary').classList.remove('on'); app.ctlKey = ''; app.resKey = ''; question(); draw();
  try { await capture(`scenario_${snap.id}_${app.site}_${new Date().toISOString().slice(0, 10)}`, !dry); } catch (e) { status(e.message); }
  app.report = null; app.t = t0; syncScene(); app.scene.setStop(app.t); app.ctlKey = ''; app.resKey = ''; app.sumKey = ''; question(); draw(); app.busy = false;
}
/* a programmatic move (a rail step, a street card, the fly down to the plan): the settle never interrupts it */
const scrollToT = (t) => { app.flyTo = t; app.snapping = true; clearTimeout(app.flyT); app.flyT = setTimeout(() => { app.flyTo = null; app.snapping = false; }, 3000); window.scrollTo({ top: t / SCROLL * (document.body.scrollHeight - window.innerHeight), behavior: 'smooth' }); };
// the rule's answer, one object for the verdict pill, the result panel, the table row, the review and the PDF — read from the engine's
// statuses, never forced to yes / no: KNOWN shares give YES or NOT YET; REVIEW_REQUIRED (a conflict at the tree, the tree outside the
// band) and soil cells (R11 no credit factor, R10 manual conditions) give MANUAL REVIEW; an unlisted species has no box; else NOT KNOWN
function resultFor(S) {
  const sel = S.trees.find((x) => x.selected); const cand = candidateShown(S); const live = liveKnobs(S); const lib = S.library; const cond = (lib && lib.condition) || 'shared_row';
  const r = { state: 'unknown', label: 'NOT ASSESSABLE', cls: '', available: null, required: null, gap: null, treeClass: null, condition: cond.replace(/_/g, ' '), cand: !!cand,
              subject: cand ? cand.common : `the City's tree · ${(sel && sel.species_ref && sel.species_ref.common) || (sel && sel.genus) || '—'}`, why: [], conflicts: [] };
  if (!sel) return r;
  const box = cand ? (S.candidate && S.candidate.box) : (S.need && S.need.box); const seen = new Set();
  for (const c of (box && box.conflicts) || []) { const k = c.dataset || c.kind; if (seen.has(k)) continue; seen.add(k); r.conflicts.push(c); }
  const review = (why) => { r.state = 'review'; r.label = 'MANUAL REVIEW'; r.cls = 'review'; r.why.push({ t: why, cls: 'review' }); };
  const CONFLICT = 'this cell needs a person\'s review: a utility conflict at the tree, or the tree stands outside the band (share REVIEW_REQUIRED)';
  if (cand) {
    r.treeClass = cand.listed ? cand.class : null; r.available = cand.usable_m3 != null ? cand.usable_m3 : null;
    r.required = cand.required_m3 != null ? cand.required_m3 : (cand.listed && cand.volume_m3 ? cand.volume_m3[cond] : null);
    if (!cand.listed) { r.state = 'nobox'; r.label = 'NOT IN TABLE 9-3 · NO BOX'; r.why.push({ t: `${cand.common} is not in Table 9-3: no class, no required volume (R16 / R17)` }); }
    else if (sel.share_status === 'REVIEW_REQUIRED') review(CONFLICT);
    else if (live.soil === 'soil_cell') review(SOIL_NOTE.soil_cell);
    else if (cand.fits === true) { r.state = 'yes'; r.label = 'YES'; r.cls = 'yes'; }
    else if (cand.fits === false) { r.state = 'no'; r.label = 'NOT YET'; r.cls = 'no'; }
    else r.why.push({ t: cand.fit && cand.fit.reason ? cand.fit.reason : 'the cell\'s share is not on record', cls: 'grey' });
  } else {
    r.treeClass = live.target || null; r.required = sel.required_m3 != null ? sel.required_m3 : null;   /* the engine's benchmark class is the target knob (R20 for the City's tree, Table 9-2 for a new one) */
    const have = sel.extensions && sel.extensions.share_total_m3 != null ? sel.extensions.share_total_m3 : sel.share_m3; r.available = have != null ? have : null;
    if (sel.share_status === 'REVIEW_REQUIRED') review(CONFLICT);
    else if (live.soil === 'soil_cell') review(SOIL_NOTE.soil_cell);
    else if (sel.share_status !== 'KNOWN' || have == null || r.required == null) r.why.push({ t: 'the cell\'s share is not on record', cls: 'grey' });
    else if (have >= r.required) { r.state = 'yes'; r.label = 'YES'; r.cls = 'yes'; }
    else { r.state = 'no'; r.label = 'NOT YET'; r.cls = 'no'; }
  }
  if (r.available != null && r.required != null) r.gap = +(r.available - r.required).toFixed(1);
  if (r.treeClass) r.why.unshift({ t: `Table 9-2 · ${r.treeClass} tree · ${r.condition}` });
  r.why.push({ t: SOIL_NOTE[live.soil] || live.soil, cls: live.soil === 'soil_cell' ? 'review' : '' });
  for (const z of (sel.extensions && sel.extensions.zones) || []) r.why.push(z.status === 'KNOWN' ? { t: `proposed ${z.side === 'property' ? 'under the sidewalk' : 'under the parking lane'} · ${fmt(z.width_applied_m, 2)} m ${(z.soil_type || '').replace('_', ' ')} · ${fmt(z.credited_m3)} m³ credited · ${z.connection === 'PARTIAL' ? 'PARTIAL' : 'CONNECTED'}`, cls: 'grey' }
                            : { t: `proposed ${z.side === 'property' ? 'under the sidewalk' : 'under the parking lane'} · ${(z.status || '').toLowerCase().replace(/_/g, ' ')}${z.note ? ' · ' + z.note : ''}`, cls: 'grey' });
  for (const c of r.conflicts) r.why.push({ t: `need-box cut by the ${(c.dataset || c.kind || '').replace(/[-_]/g, ' ')} · ${fmt(c.clearance_m, 1)} m clearance`, cls: 'red' });
  if (app.pending) { r.state = 'running'; r.label = app.pending.candidate_only ? 'PLACING THE TREE …' : 'RUNNING THE RULE …'; r.cls = 'wait'; }
  return r;
}
const resultLine = (r) => r.label + (r.state === 'yes' || r.state === 'no' ? ` · ${fmt(r.available)} OF ${r.required} m³` : '');
/* the band's own answer (R27, extension-aware when the zones are KNOWN): the Table 9-2 classes whose volume the cell's share meets, read from the engine */
function fitClasses(S) { const sel = S.trees.find((x) => x.selected); if (!sel || sel.share_status !== 'KNOWN') return null; const E = sel.extensions; return (E && E.status === 'KNOWN' && E.benchmark_classes_total) || sel.benchmark_classes || null; }
function bandFit(S) {
  const sel = S.trees.find((x) => x.selected); const live = liveKnobs(S); const r = { cls: null, label: 'NOT ASSESSABLE', vcls: '', available: null };
  if (!sel) return r; const E = sel.extensions; r.available = E && E.share_total_m3 != null ? E.share_total_m3 : sel.share_m3;
  if (app.pending && !app.pending.candidate_only) { r.label = 'RUNNING THE RULE …'; r.vcls = 'wait'; return r; }
  if (sel.share_status === 'REVIEW_REQUIRED' || live.soil === 'soil_cell') { r.label = 'MANUAL REVIEW'; r.vcls = 'review'; return r; }
  const bc = fitClasses(S); if (!bc) return r;
  r.cls = ['Large', 'Medium', 'Small'].find((c) => bc.includes(c)) || 'none'; r.upto = r.cls === 'none' ? 'NOTHING FITS' : r.cls === 'Small' ? 'ONLY SMALL' : `UP TO ${r.cls.toUpperCase()}`; r.label = (r.available != null ? `${fmt(r.available)} m³ · ` : '') + r.upto; r.vcls = r.cls === 'none' ? 'no' : 'yes'; return r;
}
// the species on the drawing: the engine's candidate, or the card just dropped while the engine runs (a library card: no box, no verdict yet)
function candidateShown(S) { const p = app.pending; if (p && 'candidate' in p) return p.candidate && S.library ? S.library.cards.find((c) => c.id === p.candidate) || null : null; return S.candidate; }
// what the rule reads, live: the handle being dragged, else the value just sent to the engine, else the file's
function liveKnobs(S) {
  const st = S.street, bd = S.band.design, k = S.knobs, d = app.drag, p = app.pending || {}; const v = (key, file) => (p[key] != null ? p[key] : file);
  const curb = d && d.kind === 'curb' ? st.centreline_v + d.value : p.curb != null ? st.centreline_v + p.curb : st.curb_face_v;
  const depth = d && d.kind === 'depth' ? d.value : p.depth != null ? p.depth : bd.depth_m;
  const kk = knobs(S); return { curb, depth, soil: v('soil', k.soil_type && k.soil_type.value), land_use: v('land_use', k.land_use && k.land_use.value), width_level: v('width_level', k.width_level && k.width_level.value), target: v('target', k.target_tree_class && k.target_tree_class.value), replacement: p.replacement != null ? !!p.replacement : kk.replacement, extensions: p.extensions != null ? p.extensions : kk.extensions };
}
function status(m) { $('status').textContent = m; }
/* a run the user waits for (the engine, the exporter, a fetch, a freeze): one bar along the top of the sheet that fills over the time the
   last run of its kind took (a default before the first), the stage tag names the run and ticks the seconds, the controls that cannot
   answer step back (#fixed.busy). The bar is an estimate, the tick is the truth. */
const RUN_ETA = { engine: 9000, place: 5000, freeze: 4000, fetch: 60000, open: 2500 };
function runStart(kind, label) {
  let eta = RUN_ETA[kind] || 8000; try { eta = +localStorage.getItem('rr_eta_' + kind) || eta; } catch (e) { /* storage may be closed */ }
  app.run = { kind, label, t0: performance.now(), eta }; const b = $('prog'); b.style.transition = 'none'; b.style.width = '0%'; b.className = 'prog on'; void b.offsetWidth;
  b.style.transition = `width ${Math.round(eta * 1.2)}ms cubic-bezier(.15,.55,.35,1)`; b.style.width = '92%'; $('fixed').classList.add('busy');
  clearInterval(app.runT); app.runT = setInterval(runTick, 500); runTick();
}
function runTick() { const r = app.run; if (!r) return; const s = Math.round((performance.now() - r.t0) / 1000); const m = $('q-mode'); m.textContent = `${r.label} · ${s} s`; m.className = 'mode run'; }
function runEnd(ok = true) {
  const r = app.run; if (!r) return; const dt = performance.now() - r.t0; if (ok) { try { localStorage.setItem('rr_eta_' + r.kind, String(Math.round(dt))); } catch (e) { /* no storage: the default stays */ } }
  app.run = null; clearInterval(app.runT); app.runT = null; $('fixed').classList.remove('busy'); if (app.S) question();   /* the tag goes back to the stage's */
  const b = $('prog'); b.style.transition = 'width 220ms ease-out'; b.style.width = '100%'; b.className = 'prog on' + (ok ? '' : ' fail');
  setTimeout(() => { if (!app.run) { b.style.transition = 'opacity 400ms ease'; b.className = 'prog'; setTimeout(() => { if (!app.run) { b.style.transition = 'none'; b.style.width = '0%'; } }, 420); } }, ok ? 500 : 1600);
}

// ---------- the question line: one sentence, one verdict, always ----------
function question() {
  const S = app.S; if (!S) return; const st = stage(app.t); const cand = candidateShown(S); const target = liveKnobs(S).target || '—'; const sel = S.trees.find((x) => x.selected);
  const name = cand ? cand.common : (sel && sel.species_ref && sel.species_ref.common) || (sel && sel.genus) || '';
  const snap = axoSnap(); const nS = app.saved.length; let head = 'HOW MUCH TREE CAN THE GROUND CARRY AT', tail = '?', mode = STAGE_TAG[st];
  /* one sentence for the whole tool; what the stage shows is the small tag at the right, never a tail on the sentence */
  if (app.report) mode = `REPORT · SCENARIO ${app.report.id} · ${app.report.subject.toUpperCase()}`;
  else if (st === 0) { head = 'HOW MUCH TREE CAN THE GROUND CARRY IN VANCOUVER? ·'; tail = ''; }
  else if (st === 1) mode = sel && app.sectionOpen && name ? `STREET PLAN · ${name.toUpperCase()} · ${S.trees.length} TREES` : `STREET PLAN · ${S.trees.length} TREES · CLICK ONE`;
  else if (st === 2) mode = `EXISTING CONDITION · ${name.toUpperCase()}`;
  else if (st === 4) mode = snap && !snap.live ? `AXONOMETRIC · SCENARIO ${snap.id} · ${snap.subject.toUpperCase()}` : app.scenario ? 'AXONOMETRIC · WORKING SCENARIO' : 'AXONOMETRIC · EXISTING CONDITION';
  else if (st === 5) mode = `SUMMARY · ${nS} SAVED SCENARIO${nS === 1 ? '' : 'S'}`;
  $('q-text').innerHTML = `<span id="q-head">${head}</span> ${addrChip(S)}<span id="q-tail">${tail}</span>`;
  const chip = $('q-addr'); if (app.t < 2) chip.onclick = editAddress; else { chip.classList.add('locked'); chip.title = 'go back to the location or the street plan to go elsewhere'; }
  $('q').classList.toggle('city', st === 0);
  const v = $('q-verdict'); const r = app.report ? app.report.result : st === 3 ? resultFor(S) : st === 4 && snap && !snap.live ? snap.result : null; const bf = st === 3 && !app.report ? bandFit(S) : null; v.textContent = bf ? (bf.vcls === 'wait' || bf.vcls === 'review' || !cand ? bf.label : `${fmt(bf.available)} m³ · ${cand.common.toUpperCase()} · ${r.label}`) : r ? resultLine(r) : ''; v.className = 'verdict ' + (bf ? (cand && bf.vcls !== 'wait' && bf.vcls !== 'review' ? r.cls : bf.vcls) : r ? r.cls : '') + (r ? '' : ' off');
  const m = $('q-mode'); if (app.run) runTick(); else { m.textContent = mode; m.className = 'mode'; }   /* while a run is on, the tag is the run's */
}
function headline() { question(); }

const addrChip = (S) => `<span id="q-addr" class="addr" title="type another address or a tree's asset id">${S.title.hblock}<i class="caret">▾</i></span>`;
// ---------- overlay: labels on the object (2), captions with leaders (3), handles (4), the cell (5), the sheet (6) ----------
// click the address in the question: type an address or a tree's asset id, Enter goes there (a new tree runs the engine, ~1 min)
function editAddress() {
  const sp = $('q-addr'); if (app.busy || sp.querySelector('input')) return; const was = sp.firstChild.textContent;
  const inp = document.createElement('input'); inp.type = 'text'; inp.value = was; inp.className = 'addr-in'; inp.placeholder = 'address or tree asset id · Enter'; inp.setAttribute('aria-label', 'address or asset id');
  sp.textContent = ''; sp.appendChild(inp); sp.classList.add('editing'); setTimeout(() => { inp.focus(); inp.select(); }, 0);
  const done = (ok) => { if (!sp.contains(inp)) return; inp.onblur = null; sp.classList.remove('editing'); sp.innerHTML = `${ok || was}<i class="caret">▾</i>`; };
  inp.onblur = () => done(null);
  inp.onkeydown = async (e) => {
    if (e.key === 'Escape') { done(null); return; } if (e.key !== 'Enter') return; e.preventDefault(); const q = inp.value.trim(); done(q || null); if (!q) return;
    await goTo(q, () => done(null));
  };
}
/* an address or a tree's asset id → that tree's street (a new tree runs the engine as a boulevard tree, about a minute) */
async function goTo(q, fail = () => {}, toT = null) {
  if (app.busy) return; const done = (x) => { if (x == null) fail(); };
  {
    app.busy = true;
    try {
      let asset = /^\d+$/.test(q) ? +q : null;
      if (asset == null) {
        status('looking up ' + q + ' …'); const idx = app.addr || (app.addr = await api.addresses()); const Q = q.toUpperCase().replace(/\s+/g, ' ').replace(/\bAVE(NUE)?\b/, 'AV').replace(/\bSTREET\b/, 'ST');
        let hit = idx.find((a) => a[0] === Q) || idx.find((a) => a[0].startsWith(Q));
        if (!hit) { const mm = Q.match(/^(\d+)\s+(.+)$/); if (mm) { const n = +mm[1], st = ' ' + mm[2]; const same = idx.filter((a) => a[0].endsWith(st)).map((a) => ({ a, n: parseInt(a[0]) })).filter((x) => !isNaN(x.n)); same.sort((x, y) => (Math.abs(x.n - n) + ((x.n - n) % 2 ? 1000 : 0)) - (Math.abs(y.n - n) + ((y.n - n) % 2 ? 1000 : 0))); if (same.length) hit = same[0].a; } }   // no such civic number: the nearest number on the same side of that street
        if (!hit) { status('no City address matches ' + q); done(null); app.busy = false; return; }
        const near = await api.treesNear(hit[1], hit[2]); if (!near.length) { status('no public tree within 60 m of ' + hit[0]); done(null); app.busy = false; return; }
        asset = (near.find((x) => x.has_engine_file) || near[0]).asset_id;
      }
      const info = await api.tree(asset); app.busy = false;
      let needRun = !info.has_engine_file;
      if (info.has_engine_file) { status('going to ' + (info.street || asset) + ' …'); const S0 = await api.scene(info.site_id); if (S0.band && S0.band.design) { await load(info.site_id); if (toT != null) { app.ctlKey = ''; draw(); scrollToT(toT); } } else needRun = true; }   /* an engine file without a design band (no curb could be set): run again, with the hint or the typed curb */
      if (needRun) { status('new tree ' + asset + ': fetching its street and running the rule as a boulevard tree …'); app.busy = true; runStart('fetch', `NEW TREE ${asset} · FETCHING THE STREET · RUNNING THE RULE`); try { const kk = knobs(app.existing || app.S); const run = (curb) => api.runSite({ asset_id: asset, site_type: 'boulevard', target: kk.target, soil: kk.soil, land_use: kk.land_use, width_level: kk.width_level, depth: kk.depth, ...(curb != null ? { curb } : {}) });
        let S2 = await run(app.curbFor && app.curbFor.asset === asset ? app.curbFor.curb : null);
        if (!(S2.band && S2.band.design)) { const hint = curbHint(S2); if (hint != null) { status(`no curb line on ${S2.title.hblock} · the catch basins put it near ${fmt(hint, 1)} m from ℄ · running with that as a design assumption …`); S2 = await run(hint); } }   /* the City publishes no curb line: the batch's convention is the median catch-basin offset, a DESIGN_ASSUMPTION */
        if (!(S2.band && S2.band.design)) { app.needCurb = { asset, hblock: S2.title.hblock, pl: +(S2.street.property_line_v - S2.street.centreline_v).toFixed(1) }; app.ctlKey = ''; draw(); runEnd(false); status(`no curb line and no catch basin on ${S2.title.hblock} · type the curb distance in the rail to run this tree`); done(null); app.busy = false; return; }   /* nothing to infer from: the user types it (the form at 01) */
        app.needCurb = null; app.curbFor = null; app.existing = S2; app.scenario = null; app.saved = []; app.axo = 0; await show(S2); app.site = 'V-' + asset; status(''); runEnd(true); if (toT != null) { app.ctlKey = ''; draw(); scrollToT(toT); } } catch (err) { runEnd(false); status(err.message); done(null); } app.busy = false; }
    } catch (err) { status(err.message); done(null); app.busy = false; }
  }
}
function label(x, y, text, anchor = 'start', grey = false) {
  const g = el('g', { class: 'lab' + (grey ? ' grey' : '') }); const w = text.length * 7 + 8; const x0 = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x;
  g.appendChild(el('rect', { x: x0 - 2, y: y - 11, width: w + 2, height: 15 })); g.appendChild(el('text', { x: anchor === 'end' ? x : anchor === 'middle' ? x : x + 2, y, 'text-anchor': anchor }, text)); return g;
}
function leaderLabel(svg, from, to, text, anchor, grey = false) { svg.appendChild(el('line', { class: 'lab', x1: from.x, y1: from.y, x2: to.x, y2: to.y, stroke: '#000', 'stroke-width': .7 })); svg.appendChild(label(to.x + (anchor === 'end' ? -4 : 4), to.y + 4, text, anchor, grey)); }
const wrap = (text, n) => { const out = []; let line = ''; for (const w of text.split(' ')) { const t = line ? line + ' ' + w : w; if (t.length > n && line) { out.push(line); line = w; } else line = t; } if (line) out.push(line); return out; };
// a column of labels on the paper beside the chunk: each wants a height, none may overlap
function column(items, gap = 22) { items.sort((a, b) => a.y - b.y); let y = -1e9; for (const it of items) { it.y = Math.max(it.y, y + gap); y = it.y; } return items; }
function poly(pts, attrs) { return el('polygon', { ...attrs, points: pts.map((p) => `${p.x},${p.y}`).join(' ') }); }
/* what the tool reads: the City Open Data layers fetched for every 500 m window (data/raw), the VanMap depth layers, and the rule sources (sources/) */
const DATA_READ = [
  { head: 'THE TREES', items: ['public trees (every City tree: species, height, DBH, planted)'] },
  { head: 'THE STREET', items: ['public streets', 'block outlines', 'property parcels', 'property addresses', 'right-of-way widths', 'building footprints 2015', 'lanes', 'street intersections', 'parks', 'local area boundaries', 'property easements', '1 m contours'] },
  { head: 'UNDER THE GROUND · PLAN', items: ['water transmission mains', 'water distribution mains', 'abandoned water mains', 'DFPS water mains', 'water control valves', 'hydrants', 'sewer mains', 'GVRD sewer trunk mains', 'sewer catch basins', 'sewer manholes', 'street-lighting conduits', 'abandoned lighting conduits', 'street-lighting poles', 'junction boxes', 'service panels', 'traffic signals', 'rapid transit lines', 'rapid transit stations'] },
  { head: 'UNDER THE GROUND · DEPTH (VanMap)', items: ['sanitary mains', 'sewer manholes', 'sewer service lines'] },
  { head: 'THE RULE', items: ['EDM 2026 §9.3 Table 9-2 soil volumes · §9.3.3.2 soil types', 'EDM 2026 §2.2.5 Table 2-2 clearances', 'EDM 2026 §8.4 Tables 8-3 / 8-4 the pedestrian realm', 'GRI Planting Guidelines p.18 what soil counts', 'Table 9-3 recommended species', 'By-law 9958 Schedule A protection'] },
];

function ctlFor(t, S) {
  const st = stage(t); const ctl = $('ctl'); const bd = S.band.design; const cand = S.candidate; const live = liveKnobs(S);
  const lvl0 = st === 0 ? atlasLevel(t) : ''; const key = `${st}|${lvl0}|${app.needCurb ? app.needCurb.asset : ''}|${S.site_id}|${app.shade}|${app.area || ''}|${app.scene.homeArea ? app.scene.homeArea.name : ''}|${app.scene.faceUV ? app.scene.faceUV.length : 0}|${cand ? cand.id : ''}|${bd ? bd.depth_m + ':' + bd.v_from : ''}|${app.city ? 1 : 0}|${app.busy ? 1 : 0}|${app.pending ? JSON.stringify(app.pending) : ''}|${live.soil}|${live.land_use}|${live.width_level}|${app.rules ? 1 : 0}|${app.saved.length}|${app.axo}|${app.scenario === S ? 1 : 0}|${app.cls || ''}|${(S.band.zones || []).map((z) => z.side + z.width_applied_m + z.status).join()}|${S.knobs.tree_state ? S.knobs.tree_state.value : ''}|${S.knobs.curb_offset_from_centreline_m ? S.knobs.curb_offset_from_centreline_m.provenance : ''}|${JSON.stringify(app.extDraft || {})}|${JSON.stringify(app.openCls || {})}`;
  if (key === app.ctlKey) { if (st === 3) syncFields(S); return; } app.ctlKey = key; app.armed = null;
  const c311 = S.ground && S.ground.cases_311 && S.ground.cases_311.since_2022 ? S.ground.cases_311.since_2022.count : null; const sel = S.trees.find((x) => x.selected);
  if (st === 0) {   /* 01 · the atlas: any street by address; what the tool reads; every checked area and street as a choice (an area lists its streets, a street flies to its plan) */
    const sc = app.scene; const faces = (app.city && app.city.faces ? app.city.faces.faces : []).filter((f) => f.run_ok); const nTrees = app.city && app.city.trees ? app.city.trees.length : null;
    const focus = (app.area && sc.areaInfo ? sc.areaInfo.find((a) => a.name === app.area) : null) || sc.homeArea; const here = S.site_id.split('_')[0];
    const areas = (sc.areaInfo || []).slice().sort((x, y) => x.name.localeCompare(y.name)); const nAreas = new Set(faces.map((f) => f.local_area)).size;
    const mine = focus ? faces.filter((f) => f.local_area === focus.name).sort((a, b) => (b.known_count || 0) - (a.known_count || 0) || (b.tree_count || 0) - (a.tree_count || 0)) : [];
    const sw = (k) => `<i class="vsw" style="background:${FACE_COL[k] || FACE_COL.unknown}"></i>`;
    const LV = { city: ['CITY', 'click an area · scroll: zoom in'], area: ['AREA', 'click a coloured street (checked) · scroll: zoom to the block'], block: ['BLOCK', 'click a tree dot: it opens at 03 · scroll on: the plan of this street'], street: ['STREET', ''] };
    ctl.innerHTML = `<div class="ph">01 · LOCATION</div><div class="lvls">${['city', 'area', 'block'].map((k) => `<button type="button" class="lv${lvl0 === k ? ' on' : ''}" data-lv="${k}">${LV[k][0]}</button>`).join('')}</div><div class="do">${LV[lvl0] ? LV[lvl0][1] : ''}</div><div class="pn">scroll = zoom · click = choose</div>${app.needCurb ? `<div class="needcurb"><b>NO CURB LINE · ${esc(app.needCurb.hblock)}</b><span>the City publishes none and no catch basin is near · the property line is ${app.needCurb.pl} m from ℄</span><div class="row"><input id="nc-curb" type="number" step="0.1" min="2" max="${Math.max(3, app.needCurb.pl - 2)}" value="${Math.max(2, +(app.needCurb.pl - 6.9).toFixed(1))}"> m from ℄ <button type="button" id="nc-go">RUN AS AN ASSUMPTION</button><a id="nc-x">×</a></div></div>` : ''}<form id="f-go" class="go"><input id="f-q" type="text" placeholder="address or tree id · any of ${nTrees ? nTrees.toLocaleString() : 'the City\'s'} public trees" title="a street not checked yet runs the engine first, about a minute" autocomplete="off"><button type="submit">GO</button></form>
      <details class="reads"><summary>WHAT THE TOOL READS <span>${DATA_READ.reduce((n, g) => n + g.items.length, 0)} CITY LAYERS · 4 RULE SOURCES</span></summary>${DATA_READ.map((g) => `<div class="rg"><b>${g.head}</b>${g.items.map((it) => `<span>${esc(it)}</span>`).join('<em> · </em>')}</div>`).join('')}</details>
      <div class="gh">THE CHECKED STREETS <span>${faces.length} · ${nAreas} AREAS</span></div>
      <div class="areas">${areas.map((a) => { const on = focus && a.name === focus.name; return `<button type="button" class="ar${on ? ' on' : ''}${a.faces ? '' : ' none'}" data-area="${esc(a.name)}" title="${a.faces ? a.faces + ' checked streets · click to list them' : 'no checked street yet · the map flies there'}">${sw(a.verdict || 'unknown')}<span>${esc(a.name)}</span><b>${a.faces || '–'}</b></button>${on && mine.length ? `<div class="list faces">${mine.map((f) => `<button type="button" class="sp fc${f.site_id === here ? ' on' : ''}" data-site="${esc(f.site_id)}">${sw(f.largest_class_fits)}<span class="hb">${esc(f.hblock)}</span><i>${esc((f.side || '').replace('_side', '').replace('_', ' '))} · ${f.tree_count} trees · ${FACE_TXT[f.largest_class_fits] || 'not known'}${f.site_id === here ? ' · on screen' : ''}</i></button>`).join('')}</div>` : ''}`; }).join('')}</div>`;
    $('f-go').onsubmit = (e) => { e.preventDefault(); const q = $('f-q').value.trim(); if (q) goTo(q); };
    if ($('nc-go')) { $('nc-go').onclick = () => { const v = +$('nc-curb').value; if (!(v > 0)) return; const a = app.needCurb.asset; app.curbFor = { asset: a, curb: v }; app.needCurb = null; app.ctlKey = ''; draw(); goTo(String(a), () => status('could not open tree ' + a), STOP_T[2]); }; $('nc-x').onclick = () => { app.needCurb = null; app.ctlKey = ''; status(''); draw(); }; }
    for (const b of ctl.querySelectorAll('.lv')) b.onclick = () => { const dv = diveT(); scrollToT(b.dataset.lv === 'city' ? 0 : b.dataset.lv === 'area' ? dv.ta : dv.tb); };
    for (const b of ctl.querySelectorAll('.fc')) b.onclick = () => goFace(b.dataset.site);
    { const on = ctl.querySelector('.ar.on'); if (on) requestAnimationFrame(() => { const box = ctl.querySelector('.areas'); if (box && box.scrollHeight > box.clientHeight) box.scrollTop = Math.max(0, on.offsetTop - box.offsetTop - 28); }); }   /* a short rail: the list scrolls inside and opens on the focused area */
    for (const b of ctl.querySelectorAll('.ar')) b.onclick = () => { const ar = areas.find((a) => a.name === b.dataset.area); if (!ar) return; app.area = ar.name; app.ctlKey = ''; app.pulse = { u: ar.u, v: ar.v }; if (app.t > 0.2 || !ar.faces) goArea(ar); else { app.hotArea = null; draw(); } }; }
  else if (st === 1) ctl.innerHTML = `<div class="ph">02 · STREET PLAN</div><div>${S.trees.length} trees on this block face</div><div class="do">click a tree: its section opens beside the plan</div>`;
  else if (st === 2) ctl.innerHTML = `<div class="ph">03 · TREE + GROUND</div><div>${sel ? esc((sel.species_ref && sel.species_ref.common) || sel.genus) : 'the selected tree'} · the section and the City's record</div><div class="do">click another tree to switch</div><div class="pn">scroll on: change the tree, the soil or the area</div>`;
  else if (st === 3 && app.report) { if ($('inputs')) $('inputs').innerHTML = ''; if ($('inputsB')) $('inputsB').innerHTML = ''; const L = panelLines(S); ctl.innerHTML = `<div class="ph">REPORT · SCENARIO ${app.report.id}</div><div class="pn">saved ${app.report.savedAt.slice(0, 16).replace('T', ' ')} · the existing condition is the City's record; everything below is the scenario</div><div class="ph">SCENARIO INPUTS</div>${L.inputs.map((l) => `<div class="p">${esc(l)}</div>`).join('')}<div class="ph">ADVANCED · SITE &amp; RULE CONTEXT</div>${L.advanced.map((l) => `<div class="p">${esc(l)}</div>`).join('')}`; }
  else if (st === 3) { const lib = S.library; const cond = (lib && lib.condition) || 'shared_row'; const vol = (cls) => { const c0 = lib ? lib.cards.find((c) => c.listed && c.class === cls) : null; return c0 && c0.volume_m3 ? c0.volume_m3[cond] : '—'; };
    ctl.innerHTML = `<div class="ph">04 · SCENARIO BUILDER</div><div class="do">design the ground · see how much tree it can carry</div><div class="pn">Table 9-2 (${cond.replace(/_/g, ' ')}): Small ${vol('Small')} · Medium ${vol('Medium')} · Large ${vol('Large')} m³. The soil comes from the band between the back of curb and the sidewalk, less the mains' clearances.</div><div class="pn">left: what you can move · centre: the ground answers in section · right: what it can support</div>${app.saved.length ? '<div class="ph">SAVED</div>' + app.saved.map((x) => `<div class="sv"><b>${x.id}</b> ${esc(x.subject)} · ${esc((x.knobs.soil || '').replace('_', ' '))} · ${fmt(x.knobs.depth, 2)} m · <span class="${x.result.cls}">${esc(x.result.label)}</span></div>`).join('') + '<div class="pn">scroll on for their axonometric and the comparison</div>' : ''}`; if ($('inputs')) inputsPanel($('inputs'), S); }   /* 04 the scenario builder: the inputs live in the right column with the result */
  else if (st === 4) axoPanel(ctl);                          // 05 the axonometric: the saved scenarios as tabs
  else ctl.innerHTML = `<div class="ph">06 · SUMMARY &amp; REPORT</div><div>${app.saved.length ? 'the saved scenarios side by side · open the full information · download the report of one' : app.scenario ? 'the working scenario beside the existing condition · VIEW SPATIAL RESULT at 04 saves it, then its report is here' : 'the existing condition alone · design the ground at 04 and the scenario compares here'}</div>`;
}
const esc = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const PROV = { user: '<span class="prov user">USER INPUT</span>', assumed: '<span class="prov assumed">ASSUMED</span>', derived: '<span class="prov derived">DERIVED</span>', city: '<span class="prov">CITY RECORD</span>' };
// a knob's provenance on the panel: the file's value is the demo's design assumption; a value the user changed is user input
const knobProv = (key, S) => { const ex = app.existing ? knobs(app.existing) : null; const cur = liveKnobs(S); const map = { depth: cur.depth, soil: cur.soil, land_use: cur.land_use, width_level: cur.width_level, curb: +(cur.curb - S.street.centreline_v).toFixed(2) }; return ex && ex[key] != null && Math.abs(+ex[key] - +map[key]) > 1e-6 && ex[key] !== map[key] ? PROV.user : PROV.assumed; };
const r30sub = (lu, lv) => { const r = app.rules && app.rules.r30; if (!r) return ''; const sw = r.sidewalk_clear_width_m, bb = r.back_boulevard_width_m, rows = r.land_use_rows; if (!sw || !sw[lu]) return ''; const w = sw[lu][lv]; if (w == null) return sw[lu].preferred_note || 'not given'; const b = bb && rows && rows[lu] && bb[rows[lu].table_8_4] ? bb[rows[lu].table_8_4][lv] : null; return `sidewalk ${w} m` + (b != null ? ` · back blvd ${b} m` : ''); };
// ====== 04 · three areas: A · WHAT IS HERE (site facts, read) · B · DESIGN THE GROUND (the premise and the levers) · C · WHAT CAN IT SUPPORT? (the engine's answer) ======
const TAG_TIP = { CITY: "the City's record", DERIVED: "computed from the City's record", ASSUMED: 'a table value or a demo assumption · not measured', 'NO RECORD': 'the City publishes no data here · nothing is counted', CONFIRMED: 'measured on site, with evidence', EVIDENCED: 'measured on site, with evidence', NOMINAL: 'a drawing convention, not a measurement', CUT: 'where SECTION A–A is cut' };
const TAGI = (t, k) => `<i class="tag ${k || ''}"${TAG_TIP[t] ? ` title="${TAG_TIP[t]}"` : ''}>${t}</i>`;
const EXT_DEF = { property: { width: 1.8, soil: 'structural_soil' }, road: { width: 2.0, soil: 'structural_soil' } };   /* a proposal's starting values when switched on; the engine decides what it is worth */
const EXT_TXT = { property: ['UNDER THE SIDEWALK', 'toward the property line, under the sidewalk and back boulevard'], road: ['UNDER THE PARKING LANE', 'toward the centreline, under the curb and parking lane'] };
/* the engine's feasibility of a proposed zone, as one word: the status is the engine's, the connection too */
const zoneVerdict = (z) => { if (!z) return null; if (z.status === 'KNOWN') return z.connection === 'PARTIAL' ? ['PARTIAL', 'warn'] : ['CONNECTED', 'ok']; if (z.status === 'NOT_CONNECTED') return ['NOT CONNECTED', 'no']; if (z.status === 'REFUSED') return ['REFUSED', 'no']; if (z.status === 'NOT_COUNTED') return ['NOT COUNTED', 'no']; return [(z.status || 'NO RECORD').replace(/_/g, ' '), 'warn']; };
/* what the page proposes per side: the scene's zones (after a run) or the pending patch, with a per-side draft for the values while a side is off */
function extState(S) { const live = liveKnobs(S); const d = app.extDraft || (app.extDraft = {}); const out = {}; for (const side of ['property', 'road']) { const on = (live.extensions || []).find((z) => z.side === side); const dr = d[side] || (d[side] = { ...EXT_DEF[side] }); if (on) { dr.width = on.width_m; dr.soil = on.soil_type; } out[side] = { on: !!on, width: dr.width, soil: dr.soil }; } return out; }
function sendExt(S, side, patch) {
  const es = extState(S); const d = app.extDraft; Object.assign(d[side], patch); const on = patch.on != null ? patch.on : es[side].on;
  if (!on && !es[side].on) { app.ctlKey = ''; draw(); return; }   /* a draft on a side that is off: nothing for the engine yet */
  const list = []; for (const s2 of ['property', 'road']) { const o = s2 === side ? on : es[s2].on; if (o) list.push({ side: s2, width_m: +d[s2].width, soil_type: d[s2].soil, provenance: 'DESIGN_ASSUMPTION' }); }
  evaluate({ extensions: list });
}
/* A · the site as the City and the tables give it: nothing here is designed; the curb and the sidewalk are facts the City does not publish, so they carry ASSUMED until evidenced */
function factsHtml(S, selOverride = null) {
  const st = S.street; const sel = selOverride || S.trees.find((x) => x.selected); const sr = sel.species_ref || {}; const k = S.knobs; const live = liveKnobs(S);
  const strips = S.band.strips || []; const atTree = strips.find((x) => sel.u >= x.u0 && sel.u <= x.u1); const kinds = [...new Set(strips.map((x) => (x.dataset || x.kind || '').replace(/-/g, ' ')))];
  const curbK = k.curb_offset_from_centreline_m || {}; const curbConf = curbK.provenance === 'CONFIRMED_SITE_DATA'; const curbNow = fmt(live.curb - st.centreline_v, 1);
  const ex = S.band.existing || {}; const lu = k.land_use && k.land_use.value; const wl = (k.width_level && k.width_level.value) || 'minimum';
  const fr = (em, b, tag, small, tip) => `<div class="fr"${tip ? ` title="${tip}"` : ''}><em>${em}</em><b${tag && tag[1] === 'unk' ? ' class="unk"' : ''}>${b}</b>${tag ? TAGI(tag[0], tag[1]) : ''}${small ? `<small>${small}</small>` : ''}</div>`;
  const cellLen = sel.cell && sel.cell.u_from != null ? sel.cell.u_to - sel.cell.u_from : null;
  const read = (k, v, tag, sub) => `<div class="gcard read"><div class="gt">${k} ${TAGI(tag[0], tag[1])}</div><div class="gn">${v}</div>${sub ? `<div class="gs">${sub}</div>` : ''}</div>`;
  const nStrip = strips.length;
  return `<div class="reads">
    ${read('THE TREE', `${fmt(sel.height_m)} m <small>· ${sel.diameter_cm != null ? fmt(sel.diameter_cm, 1) + ' cm dbh' : '—'}</small>`, ['CITY', ''], `${sel.table_9_3 && sel.table_9_3.listed ? 'Table 9-3 ' + esc(sel.table_9_3.class) : 'not in Table 9-3'}${sel.install_date ? ' · planted ' + sel.install_date.slice(0, 4) : ''}`)}
    ${read('THE SOIL IT IS GIVEN', `${fmt(st.widths_m.front_boulevard, 2)} <small>×</small> ${cellLen != null ? fmt(cellLen, 2) : '—'} m`, ['DERIVED', 'derived'], 'band width × this tree\'s cell · back of curb to sidewalk, half-way to each neighbour')}
    ${read('WHAT CUTS IT', atTree ? `${fmt(atTree.clearance_m, 1)} m <small>clearance</small>` : 'none <small>at this tree</small>', ['CITY', ''], atTree ? `${esc((atTree.dataset || atTree.kind).replace(/-/g, ' ').replace(' mains', ' main'))} · ${nStrip} strip${nStrip === 1 ? '' : 's'} on this band` : `${nStrip} strip${nStrip === 1 ? '' : 's'} elsewhere on this band`)}
    ${read('EXISTING SOIL', ex.available ? `${fmt(ex.width_m || 0, 2)} × ${fmt(ex.depth_m || 0, 2)} m` : 'no record', ex.available ? ['EVIDENCED', 'user'] : ['NO RECORD', 'unk'], ex.available ? '' : 'nothing is counted for today · the scenario starts from zero')}
  </div>
  <details class="adv"><summary>ASSUMPTIONS · curb · land use · sidewalk</summary><div class="facts">
    ${fr('CURB', `${curbNow} m from ℄`, curbConf ? ['CONFIRMED', 'user'] : ['ASSUMED', 'assumed'], curbConf ? `measured · ${esc(curbK.evidence || '')}` : null, curbConf ? null : 'no City curb line · catch basins are location approximate')}
    ${fr('LAND USE', esc((LAND_TXT[lu] || lu || '').toLowerCase()), ['ASSUMED', 'assumed'], null, 'Table 8-3 row chosen for the demo · zoning not read')}
    ${fr('SIDEWALK', `${fmt(st.widths_m.sidewalk_clear, 2)} m clear · back blvd ${fmt(st.widths_m.back_boulevard, 2)} m`, ['ASSUMED', 'assumed'], null, `Table 8-3 / 8-4 · ${esc(wl)} widths · not measured`)}
  </div><details class="adv fix"><summary>correct a site measurement · curb</summary><div class="fx"><input id="fx-curb" type="number" step="0.1" min="3" max="${+(st.property_line_v - st.centreline_v - 3.5).toFixed(1)}" value="${curbNow}"> m from the centreline<input id="fx-ev" class="ev" type="text" placeholder="evidence · e.g. tape measure 2026-10-02, photo IMG_0412" value="${curbConf ? esc(curbK.evidence || '') : ''}"><button id="fx-go" type="button">APPLY AS CONFIRMED SITE DATA</button><small>no evidence, no change · every street edge follows the curb</small></div></details></details>
  <div class="facts fold"></div>`;
}
function wireFacts(S) {
  const go = $('fx-go'); if (!go) return;
  go.onclick = () => { if (app.busy) return; const v = +(+$('fx-curb').value).toFixed(1); const ev = $('fx-ev').value.trim(); if (!isFinite(v)) return; if (!ev) { status('a confirmed curb needs an evidence reference'); $('fx-ev').focus(); return; } evaluate({ curb: v, curb_provenance: 'CONFIRMED_SITE_DATA', curb_evidence: ev }); };
}
function inputsPanel(ctl, S) {
  const live = liveKnobs(S); const lib = S.library; const cs = candidateShown(S); const busy = app.busy; const st = S.street; const sel = S.trees.find((x) => x.selected);
  const cond = (lib && lib.condition) || 'shared_row'; const dis = busy ? ' disabled' : ''; const bf = bandFit(S); const fitsCls = fitClasses(S);
  const cards = lib ? lib.cards.slice().sort((a, b) => a.common.localeCompare(b.common)) : [];
  const vol = (cls) => { const c0 = cards.find((c) => c.listed && c.class === cls); return c0 && c0.volume_m3 ? c0.volume_m3[cond] : null; };
  const cid = cs ? cs.id : ''; const E = sel.extensions || {}; const zoneOf = (side) => (E.zones || []).find((z) => z.side === side) || null;
  const run = !!app.pending && !app.pending.candidate_only; const num = (x, d, u) => (run ? '…' : x == null ? '—' : fmt(x, d) + (u || ''));
  const strip = (S.band.strips || []).find((x) => sel.u >= x.u0 && sel.u <= x.u1); const have = E.share_total_m3 != null ? E.share_total_m3 : sel.share_m3;
  const CREDIT = { native_soil: ['×1 in full', 'R07'], structural_soil: ['×0.5', 'R06'], soil_cell: ['manual', 'R10 · R11'], other: ['undefined', 'R25'] }; const cr = CREDIT[live.soil] || ['—', ''];
  const term = (k, v, rule, cls, note) => `<div class="term${cls ? ' ' + cls : ''}" title="${esc(note || '')}"><em>${k}</em><b>${v}</b><small>${rule}</small></div>`; const op = (o) => `<span class="op">${o}</span>`;
  const zp = zoneOf('property'), zr = zoneOf('road'); const zLine = (z, side) => (z && z.status === 'KNOWN' ? num(z.credited_m3, 1, ' m³') : z ? esc((z.status || '').toLowerCase().replace(/_/g, ' ')) : 'not proposed');
  const eq = `<div class="eqrow">
      ${term('CELL', num(sel.spacing_m != null ? sel.spacing_m : (sel.cell && sel.cell.u_from != null ? sel.cell.u_to - sel.cell.u_from : null), 2, ' m'), 'half-way to each neighbour', '', 'the length of band this tree gets (R26)')}${op('×')}
      ${term('WIDTH', num(sel.band_width_m != null ? sel.band_width_m : st.widths_m.front_boulevard, 2, ' m'), 'back of curb → sidewalk', '', 'the front boulevard (R30, Tables 8-3 / 8-4)')}${op('−')}
      ${term('CLEARANCE', strip ? `${fmt(strip.clearance_m, 1)} m` : 'none', strip ? `Table 2-2 · ${esc((strip.dataset || strip.kind || '').replace(/-/g, ' '))}` : 'no strip at this tree', strip ? 'red' : 'grey', strip ? 'that width of the band is not credited (R28)' : 'no clearance strip crosses the band at this tree')}${op('=')}
      ${term('FOOTPRINT', num(sel.soil_area_m2, 1, ' m²'), 'R04 · the qualifying area', '', 'the qualifying soil area of this cell after the clearances (R04)')}${op('×')}
      ${term('DEPTH', fmt(live.depth, 2) + ' m', 'R05 · ' + (knobProv('depth', S).includes('user') ? 'your input' : 'assumed'), '', 'the soil depth (R05)')}${op('=')}
      ${term('PHYSICAL', num(sel.physical_soil_volume_m3, 1, ' m³'), 'R05 · the soil in the cell', '', 'the physical soil volume in this cell (R05)')}${op('×')}
      ${term('CREDIT', cr[0], `${cr[1]} · ${SOIL_SHORT[live.soil] || live.soil}`, live.soil === 'soil_cell' ? 'review' : '', `${SOIL_TXT[live.soil] || live.soil}: ${SOIL_NOTE[live.soil] || ''}`)}${op('=')}
      ${term('IN THE BAND', num(sel.share_m3, 1, ' m³'), sel.share_status === 'KNOWN' ? 'R26 · this tree\'s share' : 'share ' + esc((sel.share_status || '').replace(/_/g, ' ').toLowerCase()), sel.share_status === 'KNOWN' ? '' : 'review', 'this tree\'s credited share of the band (R26)')}${op('+')}
      ${term('SIDEWALK', zLine(zp), 'R31 · proposed', zp && zp.status === 'KNOWN' ? '' : 'grey', 'engineered soil under the sidewalk, credited by the same rules and added (R31)')}${op('+')}
      ${term('PARKING LANE', zLine(zr), 'R31 · proposed', zr && zr.status === 'KNOWN' ? '' : 'grey', 'engineered soil under the parking lane, credited by the same rules and added (R31)')}${op('=')}
      ${term('CREDITED', num(have, 1, ' m³'), 'against Table 9-2', 'sum', 'what the rule reads for this cell against Table 9-2')}
    </div>`;
  const fitting = ['Small', 'Medium', 'Large'].filter((cls) => fitsCls && fitsCls.includes(cls)); void fitting; const known = !!fitsCls && !run;
  const provTag = (key) => (knobProv(key, S).includes('user') ? TAGI('USER INPUT', 'user') : TAGI('ASSUMED', 'assumed'));
  const r = resultFor(S); const canSave = !!app.scenario && S === app.scenario && !app.busy && !app.pending; const repl = !!live.replacement;
  /* B · the premise and the levers; a proposal is checked by the engine and comes back with a feasibility */
  const es = extState(S);
  const prop = (side) => { const e = es[side]; const z = e.on && !run ? zoneOf(side) : null; const v = zoneVerdict(z); const maxW = side === 'property' ? +(st.property_line_v - st.sidewalk_v[0]).toFixed(1) : +(st.curb_face_v - st.centreline_v - 0.5).toFixed(1);
    const stp = (t, cls) => `<div class="st${cls ? ' ' + cls : ''}">${t}</div>`;
    const steps = !e.on ? stp(EXT_TXT[side][1], 'grey')
      : (run ? stp('checking utilities …', 'run') : !z ? stp('not evaluated yet', 'grey')
        : `${stp(`${TAGI(v[0], v[1])} ${z.status === 'KNOWN' ? `<b>${fmt(z.credited_m3)} m³ credited</b>${z.soil_type === 'structural_soil' ? ' · ×0.5' : ''}` : z.blocked_by && z.blocked_by.length ? `blocked by ${esc(z.blocked_by.map((b) => b.replace(/-/g, ' ')).join(', '))}` : z.note ? esc(z.note.split(/[;.] /)[0].slice(0, 70)) : ''}`, v[1])}`);   /* one line: the status and what it credits; the engine's full reason is in the report */   /* one clause of the engine's reason; the full text is in the review and the report */
    return `<div class="prop${e.on ? '' : ' off'}" data-side="${side}"><div class="ph2"><label><input type="checkbox" class="x-on"${e.on ? ' checked' : ''}${dis}> ${EXT_TXT[side][0]}</label>${TAGI(e.on ? 'PROPOSED' : 'OFF', e.on ? 'assumed' : '')}</div>
      <div class="pr"${e.on ? '' : ' style="display:none"'}><input type="number" class="x-w" step="0.1" min="0.3" max="${maxW}" value="${fmt(e.width, 1)}"${dis}> m wide <div class="segs">${['structural_soil', 'soil_cell'].map((k2) => `<button type="button" class="seg x-soil${k2 === e.soil ? ' on' : ''}" data-soil="${k2}"${dis}>${SOIL_SHORT[k2]}</button>`).join('')}</div></div><div class="steps">${steps}</div></div>`; };
  const designHtml = `<div class="gh">DESIGN THE GROUND <span>what you can move</span></div>
    <div class="f"><div class="fl"><label>PREMISE</label>${TAGI(repl ? 'SCENARIO' : 'CITY TREE', repl ? 'assumed' : 'derived')}</div><div class="segs"><button type="button" class="seg prem${repl ? '' : ' on'}" data-repl="0"${dis}>KEEP THE CITY'S TREE</button><button type="button" class="seg prem${repl ? ' on' : ''}" data-repl="1"${dis}>REPLACEMENT TREE</button></div><div class="fs"><span>${repl ? 'a new tree here · structural soil eligible' : 'the City\'s tree stays · no structural soil'}</span></div></div>
    <div class="f"><div class="fl"><label>DEPTH</label><b>${fmt(isFinite(live.depth) ? live.depth : S.band.design.depth_m, 2)} m</b>${provTag('depth')}</div><input id="f-depth-r" type="range" step="0.05" min="0.3" max="2" value="${fmt(isFinite(live.depth) ? live.depth : S.band.design.depth_m, 2)}"${dis}><div class="fs"><span>0.3</span><span>${busy && app.pending && !app.pending.candidate_only ? '<b class="run">the rule is running</b>' : 'drag · let go: the rule runs'}</span><span>2.0 m</span></div><input id="f-depth" type="number" step="0.05" min="0.3" max="2" value="${fmt(isFinite(live.depth) ? live.depth : S.band.design.depth_m, 2)}" class="hid"></div>
    <div class="f"><div class="fl"><label>SOIL SYSTEM</label>${provTag('soil')}</div><div class="segs four">${Object.keys(SOIL_TXT).map((k2) => `<button type="button" class="seg soil${k2 === live.soil ? ' on' : ''}" data-soil="${k2}" title="${esc(SOIL_NOTE[k2] || '')}"${dis}>${SOIL_SHORT[k2]}</button>`).join('')}</div></div>
    <div class="gh">EXTENSIONS <span>a proposal · the engine checks it against the mains</span></div>${prop('property')}${prop('road')}
    <div class="reset"><a id="f-reset">↺ RESET TO THE CITY'S GROUND</a></div>`;
  /* C · what the engine says the ground can support */
  const readout = run ? `<b>counting …</b> the rule is running on the new ground` : !known ? `<b>not assessable</b> ${bf.vcls === 'review' ? 'this cell needs a person\'s review' : 'the capacity of this cell is not known'}`
    : `the ground as designed gives <b>${num(have, 1, ' m³')}</b> of credited soil · it carries ${bf.cls === 'none' ? '<b>no Table 9-2 tree</b>' : bf.cls === 'Small' ? '<b>a Small tree</b> only' : `up to <b>a ${bf.cls} tree</b>`}`;
  const zonesPhys = ['property', 'road'].map((s2) => zoneOf(s2)).filter((z) => z && z.status === 'KNOWN' && z.physical_m3 != null);
  const nums = `<div class="nums"><div class="n"><em>PHYSICAL SOIL</em><b>${num(sel.physical_soil_volume_m3, 1, ' m³')}</b><small>in the cell${zonesPhys.length ? zonesPhys.map((z) => `<br>+ ${fmt(z.physical_m3, 1)} m³ ${z.side === 'property' ? 'under the sidewalk' : 'under the parking lane'}`).join('') : ''}</small></div>
    <div class="n"><em>CREDITED SOIL</em><b>${num(have, 1, ' m³')}</b><small>${SOIL_SHORT[live.soil] || ''} ${cr[0]}${E.share_total_m3 != null ? ' + zones (R31)' : ''} · ${known && !run ? (bf.cls === 'none' ? 'carries no Table 9-2 tree' : bf.cls === 'Small' ? 'carries a Small tree only' : `carries up to a ${bf.cls} tree`) : run ? 'counting …' : 'capacity not known'}</small></div></div>`;
  const tiles = ['Small', 'Medium', 'Large'].map((cls) => { const f = fitsCls ? fitsCls.includes(cls) : null; const top = known && bf.cls === cls; return `<div class="tile${f ? ' ok' : f === false ? ' no' : ''}${top ? ' top' : ''}"><em>${cls.toUpperCase()}</em><b>${vol(cls) != null ? vol(cls) + ' m³' : '—'}</b>${run ? TAGI('PENDING') : f == null ? TAGI('NO RECORD') : f ? TAGI('FITS', 'ok') : TAGI('NO ROOM', 'no')}</div>`; }).join('');
  const chipsOf = (cls) => cards.filter((c) => c.listed && c.class === cls).map((c) => `<button type="button" class="tchip${c.id === cid ? ' on' : ''}${c.fit && c.fit.fits === false ? ' nofit' : ''}" data-id="${esc(c.id)}" title="${esc(c.latin || '')} · ${(c.city_count || 0).toLocaleString()} in the City${c.on_this_face ? ' · on this street' : ''}"${dis}>${esc(c.common)}</button>`).join('');
  const openCls = app.openCls || {};
  const spHere = sel.spacing_m != null ? sel.spacing_m : (sel.cell && sel.cell.u_from != null ? sel.cell.u_to - sel.cell.u_from : null);   /* Table 9-2's spacing range (R02) beside the measured spacing: reference only, never judged */
  const classRows = ['Large', 'Medium', 'Small'].map((cls) => { const f = fitsCls ? fitsCls.includes(cls) : null; const nSp = cards.filter((c) => c.listed && c.class === cls).length; const sp = (cards.find((c) => c.listed && c.class === cls && c.spacing_m) || {}).spacing_m; const open = f && (openCls[cls] != null ? openCls[cls] : bf.cls === cls); return `<div class="crow${f === false ? ' nofit' : ''}"><div class="crh" data-cls="${cls}" data-open="${open ? 1 : 0}"><em>${cls.toUpperCase()}</em><span>${vol(cls) != null ? vol(cls) + ' m³' : ''} · ${nSp} species${sp ? ` · spacing ${sp.min}–${sp.max} m${spHere != null ? ` (here ${fmt(spHere, 1)})` : ''}` : ''}</span>${f ? TAGI('FITS', 'ok') : TAGI('NO ROOM', 'no')}${f ? `<u>${open ? '▾' : '▸'}</u>` : ''}</div>${open ? `<div class="chips">${chipsOf(cls)}</div>` : ''}</div>`; }).join('');
  const chooser = !known ? `<div class="gh">CHOOSE A TREE <span>once the capacity is known</span></div><div class="rl grey">${run ? 'the rule is running' : 'the capacity of this cell is not known'}</div>`
    : !repl ? `<div class="gh">THE CITY'S TREE <span>premise: keep it</span></div><div class="rl grey">${esc((sel.species_ref && sel.species_ref.common) || sel.genus)} · ${sel.table_9_3 && sel.table_9_3.listed ? 'Table 9-3 ' + esc(sel.table_9_3.class) : 'not in Table 9-3'} · benchmark ${sel.required_m3 != null ? sel.required_m3 + ' m³' : '—'} (${esc(live.target || '')})</div><div class="gh">OR A REPLACEMENT <span>pick a species · the premise switches (~40 s)</span></div><div class="crows">${classRows}</div>`
    : `<div class="gh">CHOOSE A TREE <span>Table 9-3 · a class that fits opens its species${cs ? ' · <a class="tchip x" data-id="">× none</a>' : ''}</span></div><div class="crows">${classRows}</div>`;
  const resultBox = cs
    ? `<div class="res"><div class="rv ${r.cls}">${esc(r.label)}</div><div class="rl">${esc(cs.common)} · ${r.treeClass ? esc(r.treeClass) : 'not in Table 9-3'}${r.required != null ? ` · needs ${r.required} m³` : ''}${r.available != null ? ` · the ground gives ${fmt(r.available)} m³` : ''}${r.gap != null ? ` · ${r.gap >= 0 ? '+' : '−'}${fmt(Math.abs(r.gap))} m³` : ''}</div>${r.conflicts.length ? `<div class="rl red">need-box cut by ${r.conflicts.map((c) => (c.dataset || c.kind || '').replace(/[-_]/g, ' ')).join(', ')}</div>` : ''}</div>`
    : `<div class="res"><div class="rv ${repl ? bf.vcls : r.cls}">${known ? esc(repl ? (bf.upto || '') : r.label) : run ? 'COUNTING …' : 'NOT ASSESSABLE'}</div><div class="rl">${repl ? 'the ground alone · no species chosen yet' : `the City's tree · ${r.required != null ? 'needs ' + r.required + ' m³' : 'no required volume'}${r.available != null ? ' · the ground gives ' + fmt(r.available) + ' m³' : ''}`}</div></div>`;
  const saveBtn = `<button id="f-save" class="cta big"${canSave ? '' : ' disabled'}>${app.busy && !app.pending ? 'FREEZING …' : 'VIEW SPATIAL RESULT →'}</button><p class="rl grey">${canSave ? 'freezes this scenario as a file · 05 and Rhino read that file' : app.busy || app.pending ? (app.pending && app.pending.candidate_only ? 'placing the tree in the ground …' : 'the rule is running …') : 'change the ground or choose a species to make a scenario'}</p>`;
  const V = $('verdict'); if (V) { const curbK = S.knobs.curb_offset_from_centreline_m || {}; const exA = S.band.existing || {}; V.innerHTML = `<div class="ctx"><span>${esc(S.title.hblock)} · ${esc((sel.species_ref && sel.species_ref.common) || sel.genus)} · band ${fmt(st.widths_m.front_boulevard, 2)} m · curb ${curbK.provenance === 'CONFIRMED_SITE_DATA' ? 'measured' : 'assumed'} · existing soil ${exA.available ? 'evidenced' : 'unknown'} · A–A ${Math.abs(app.cutU || 0) >= 0.05 ? (app.cutU > 0 ? '+' : '−') + fmt(Math.abs(app.cutU), 1) + ' m' : 'at the tree'}</span><a id="to-03">← review site facts</a></div>`; V.className = 'vbox top'; $('to-03').onclick = () => scrollToT(STOP_T[2]); }
  ctl.innerHTML = designHtml;
  const B = $('inputsB'), C = $('inputsC');
  if (B) B.innerHTML = `<div class="gh">WHAT CAN IT SUPPORT? <span>the engine's answer · nothing here is typed</span></div>${nums}
    <details class="count"${app.countOpen ? ' open' : ''}><summary><span>HOW IT IS COUNTED · TABLE 9-2 · ${cond.replace(/_/g, ' ').toUpperCase()}</span></summary>${eq}</details>`;
  if (C) C.innerHTML = `<div class="gh">TREE CAPACITY <span>Table 9-2 · ${cond.replace(/_/g, ' ')}</span></div><div class="tiles">${tiles}</div>${chooser}<div class="gh">RESULT</div>${resultBox}${saveBtn}`;
  /* the handlers */
  wireFacts(S);
  { const sv = $('f-save'); if (sv) sv.onclick = saveScenario; const dc = $('tool').querySelector('details.count'); if (dc) dc.ontoggle = (e) => { app.countOpen = e.target.open; };
    for (const h of $('tool').querySelectorAll('.crh')) h.onclick = () => { const cls = h.dataset.cls; app.openCls = { Large: false, Medium: false, Small: false, [cls]: h.dataset.open !== '1' }; app.ctlKey = ''; draw(); };   /* one class open at a time: the column never outgrows the window */ }
  const root = $('fixed');
  const commitNum = (id, key, d, cur) => { const inp = $(id); if (!inp) return; const go = () => { const v = +(+inp.value).toFixed(d); if (!isFinite(v) || app.busy) return; if (Math.abs(v - cur) < 1e-9) { inp.value = fmt(cur, d); return; } evaluate({ [key]: v }); }; inp.onchange = go; inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } }; };
  for (const b of root.querySelectorAll('.tchip[data-id]')) b.onclick = () => { if (app.busy) return; const id = b.dataset.id; if (id) placeCard(id); else evaluate({ candidate: null, candidate_only: true }); };
  for (const b of ctl.querySelectorAll('.seg.soil')) b.onclick = () => { if (!app.busy && b.dataset.soil !== live.soil) evaluate({ soil: b.dataset.soil }); };
  for (const b of ctl.querySelectorAll('.seg.prem')) b.onclick = () => { const want = b.dataset.repl === '1'; if (app.busy || want === repl) return; evaluate(want ? { replacement: true } : { replacement: false, candidate: null }); };   /* the premise changes the rule path: a run, and no species card for the City's tree */
  for (const p of ctl.querySelectorAll('.prop')) { const side = p.dataset.side; const cb = p.querySelector('.x-on'), w = p.querySelector('.x-w');
    cb.onchange = () => { if (app.busy) { cb.checked = !cb.checked; return; } sendExt(S, side, { on: cb.checked, width: +w.value }); };
    w.onchange = () => { if (app.busy) return; const v = +(+w.value).toFixed(1); if (!isFinite(v) || v <= 0) return; sendExt(S, side, { width: v }); }; w.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); w.blur(); } };
    for (const b of p.querySelectorAll('.x-soil')) b.onclick = () => { if (app.busy) return; sendExt(S, side, { soil: b.dataset.soil }); }; }
  { const r0 = $('f-depth-r'), d0 = $('f-depth'); if (r0) { r0.oninput = () => { d0.value = (+r0.value).toFixed(2); app.drag = { kind: 'depth', value: +r0.value }; const b = r0.parentNode.querySelector('.fl b'); if (b) b.textContent = (+r0.value).toFixed(2) + ' m'; requestDraw(); }; r0.onchange = () => { const v = +(+r0.value).toFixed(2); app.drag = null; if (!app.busy && Math.abs(v - +(app.pending && app.pending.depth != null ? app.pending.depth : S.band.design.depth_m)) > 1e-9) evaluate({ depth: v }); else draw(); }; } }
  commitNum('f-depth', 'depth', 2, +(app.pending && app.pending.depth != null ? app.pending.depth : S.band.design.depth_m));
  $('f-reset').onclick = () => { if (app.busy || !app.existing) return; app.extDraft = null; app.cls = null; app.openCls = null; const k0 = knobs(app.existing); evaluate({ depth: k0.depth, soil: k0.soil, curb: k0.curb, curb_provenance: k0.curb_provenance || null, curb_evidence: k0.curb_evidence || null, extensions: [], replacement: k0.replacement, candidate: null, land_use: k0.land_use, width_level: k0.width_level }); };
}
// a handle being dragged writes the field it belongs to (the field is the primary input; the handle the secondary one)
function syncFields(S) { const live = liveKnobs(S); const d = $('f-depth'); if (d && document.activeElement !== d && isFinite(live.depth)) d.value = fmt(live.depth, 2); const dr = $('f-depth-r'); if (dr && document.activeElement !== dr && isFinite(live.depth)) dr.value = fmt(live.depth, 2); const c = $('f-curb'); if (c && document.activeElement !== c) c.value = fmt(live.curb - S.street.centreline_v, 1); const cr = $('f-curb-r'); if (cr && document.activeElement !== cr) cr.value = fmt(live.curb - S.street.centreline_v, 1); }
// what the panels say, as lines (the capture and the PDF print the same words)
function panelLines(S) {
  const live = liveKnobs(S); const cs = candidateShown(S); const st = S.street; const sel = S.trees.find((x) => x.selected); const zones = (sel && sel.extensions && sel.extensions.zones) || [];
  const r = resultFor(S); const exSel = sel; const k = S.knobs; const curbK = k.curb_offset_from_centreline_m || {}; const ex = S.band.existing || {};
  const zl = (side) => { const z = zones.find((q) => q.side === side); return z ? `${fmt(z.width_applied_m, 2)} m ${(z.soil_type || '').replace('_', ' ')} · ${z.status === 'KNOWN' ? fmt(z.credited_m3) + ' m³ credited · ' + (z.connection === 'PARTIAL' ? 'partial' : 'connected') : (z.status || '').toLowerCase().replace(/_/g, ' ')}${z.blocked_by && z.blocked_by.length ? ' · blocked by ' + z.blocked_by.join(', ').replace(/-/g, ' ') : ''}` : 'not proposed'; };
  return { inputs: [`premise: ${live.replacement ? 'replacement tree at this position (scenario, R08/R09)' : "keep the City's tree (benchmark R20)"}`, `tree: ${cs ? cs.common + (cs.listed ? ' · ' + cs.class : ' · not in Table 9-3') : 'the City\'s tree · ' + ((exSel.species_ref && exSel.species_ref.common) || exSel.genus)}`, `soil system: ${(live.soil || '').replace('_', ' ')}`, `soil depth: ${fmt(live.depth, 2)} m`, `proposed under the sidewalk: ${zl('property')}`, `proposed under the parking lane: ${zl('road')}`],
           advanced: [`tree class: ${r.treeClass || 'not listed'} (derived)`, `curb face: ${fmt(live.curb - st.centreline_v, 1)} m from the centreline · ${curbK.provenance === 'CONFIRMED_SITE_DATA' ? 'confirmed site data · ' + (curbK.evidence || '') : 'assumed · the City publishes no curb line'}`, `sidewalk ${fmt(st.widths_m.sidewalk_clear, 2)} m · back boulevard ${fmt(st.widths_m.back_boulevard, 2)} m · Table 8-3 / 8-4 row ${(LAND_TXT[live.land_use] || live.land_use || '').toLowerCase()} · width level ${live.width_level} (assumed, not measured)`, `front boulevard ${fmt(st.widths_m.front_boulevard, 2)} m (derived, R30)`, `Table 9-2 condition: ${r.condition}`, `existing soil: ${ex.available ? 'evidenced' : 'no City record · ' + ((ex.missing || []).join(', ').replace(/existing /g, '') || 'nothing supplied')}`],
           result: [`rule check: ${resultLine(r)}`, `available ${r.available != null ? fmt(r.available) + ' m³' : '—'} · required ${r.required != null ? r.required + ' m³' : '—'} · ${r.gap == null ? '' : (r.gap >= 0 ? 'surplus +' : 'gap ') + fmt(r.gap) + ' m³'}`].concat(r.why.map((w) => '· ' + w.t)) };
}
function reviewPanel(ctl, S) {
  const ex = app.existing || S; const rE = resultFor(ex), rP = resultFor(S); const kE = knobs(ex), kP = knobs(S); const selE = ex.trees.find((x) => x.selected), selP = S.trees.find((x) => x.selected); const cs = candidateShown(S);
  const bdE = ex.band.design, bdP = S.band.design; const stE = ex.street, stP = S.street; const L = panelLines(S);
  const row = (k, v) => `<div class="r"><em>${k}</em><span>${v}</span></div>`; const name = (t) => (t.species_ref && t.species_ref.common) || t.genus;
  const grades = {}; for (const f of S.facilities || []) { const g = f.depth_top_m == null ? 'not published' : (f.grade || 'record'); grades[g] = (grades[g] || 0) + 1; }
  const np = (S.not_published || []).map((x) => (typeof x === 'string' ? x : x.label || x.kind || '')).filter(Boolean);
  ctl.innerHTML = `<div class="rv ghost"><div class="rh ghost">EXISTING <span class="tag">THE CITY'S TREE</span></div>${row('TREE', `${esc(name(selE))} · ${fmt(selE.height_m)} m`)}${row('CLASS', selE.table_9_3 && selE.table_9_3.listed ? esc(selE.table_9_3.class) : 'not in Table 9-3')}${row('SOIL', 'existing soil · no City record of width, depth or type')}${row('CURB', `${fmt(stE.curb_face_v - stE.centreline_v, 1)} m from ℄ · assumed`)}${row('SOIL VOLUME', `no record · needs ${rE.required != null ? rE.required : '—'} m³ · ${esc(rE.treeClass || '')}`)}${row('VERDICT', 'NOT KNOWN · no evidence of the existing ground')}</div>
    <div class="rv"><div class="rh">PROPOSED <span class="tag">THE SCENARIO</span></div>${row('TREE', cs ? `${esc(cs.common)} · ${cs.drawn_height_m != null ? fmt(cs.drawn_height_m) + ' m p90' : ''}` : `${esc(name(selP))} (the City's tree)`)}${row('CLASS', esc(rP.treeClass || 'not listed'))}${row('SOIL', `${fmt(bdP.v_to - bdP.v_from, 2)} × ${fmt(bdP.depth_m, 2)} m · ${esc((kP.soil || '').replace('_', ' '))}`)}${row('CURB', `${fmt(stP.curb_face_v - stP.centreline_v, 1)} m from ℄`)}${row('SOIL VOLUME', `${rP.available != null ? fmt(rP.available) : '—'} of ${rP.required != null ? rP.required : '—'} m³ · ${esc(rP.treeClass || '')}`)}${row('VERDICT', esc(rP.label))}</div>
    <div class="rv"><div class="rh">SCENARIO INPUTS</div>${L.inputs.map((l) => `<div class="p">${esc(l)}</div>`).join('')}<div class="rh" style="margin-top:6px">ADVANCED · SITE &amp; RULE CONTEXT</div>${L.advanced.map((l) => `<div class="p">${esc(l)}</div>`).join('')}</div>
    <div class="rv"><div class="rh">KNOWN · ASSUMED · NO RECORD</div>
      <div class="p"><b class="known">KNOWN</b>${S.trees.length} trees, positions and heights (City record) · the street's widths (City record) · ${grades.record || 0} facilities at their record depth${grades.derived ? ` · ${grades.derived} at a derived depth` : ''}</div>
      <div class="p"><b class="derived">NOMINAL</b>${grades.nominal || 0} facilities at cited minimum cover · crown spread and root form by habit · the private corridors (gas, electrical, telecom) at Table 7-1 cover, position unknown</div>
      <div class="p"><b class="assumed">ASSUMED</b>the scenario's soil type and depth · the curb face and the sidewalk width (the City publishes neither) · the land-use row · the proposed zones · the species card's height (City p90)${cs ? ' · ' + esc(cs.common) + ' in place of the City\'s tree' : ''}</div>
      <div class="p"><b class="user">USER INPUT</b>${[kP.replacement !== kE.replacement ? 'the premise (' + (kP.replacement ? 'replacement tree' : "keep the City's tree") + ')' : '', kP.candidate ? 'the replacement species' : '', kE.soil !== kP.soil ? 'the soil type' : '', Math.abs(kE.depth - kP.depth) > 1e-6 ? 'the soil depth' : '', kP.curb_provenance ? 'the curb face (confirmed: ' + (kP.curb_evidence || '') + ')' : Math.abs(kE.curb - kP.curb) > 1e-6 ? 'the curb face' : '', (kP.extensions || []).length ? 'proposed ' + kP.extensions.map((z) => (z.side === 'property' ? 'under the sidewalk' : 'under the parking lane') + ' ' + fmt(z.width_m, 1) + ' m').join(', ') : ''].filter(Boolean).join(' · ') || 'nothing changed from the file'}</div>
      <div class="p"><b class="unknown">NO RECORD</b>${grades['not published'] || 0} facilities without a published depth · the native ground (not published, drawn as subsoil)${np.length ? ' · not published anywhere: ' + esc(np.slice(0, 6).join(', ')) : ''}</div></div>
    `;
}
// 03 · the City's record of the selected tree and the ground at it, in the right column: what the City knows, lightly tagged — the full provenance is in VIEW FULL INFORMATION and the PDF
function recordPanel(S) {
  const el2 = $('result'); const pendId = app.pending && app.pending.site_id; const sel = (pendId && S.trees.find((x) => x.site_id === pendId)) || S.trees.find((x) => x.selected); const stg = stage(app.t); const recOn = stg === 2 || (stg === 1 && app.secK > 0.5);   /* a tree just clicked: its City record at once, the run's numbers follow */ if (!recOn || !sel) { el2.classList.remove('record'); if (stg === 1) el2.classList.remove('on'); return; } el2.classList.add('on', 'record'); el2.classList.remove('tool'); el2.style.width = (SHEET.eastRec - 14) + 'px'; el2.style.left = 'auto'; el2.style.right = '10px';   /* only 03 owns the column here; the result panel owns it at 04 */
  const k = S.knobs; const curbK = k.curb_offset_from_centreline_m || {};
  const key = `rec|${S.site_id}|${sel.site_id}|${curbK.provenance}|${app.busy ? 1 : 0}|${app.pending ? JSON.stringify(app.pending) : ''}|${(app.cutU || 0).toFixed(1)}`; if (key === app.resKey) return; app.resKey = key;
  const sr = sel.species_ref || {}; const st = S.street; const strips = S.band.strips || []; const cell = sel.cell || {};
  const constraints = strips.filter((x) => cell.u_from != null && x.u1 >= cell.u_from && x.u0 <= cell.u_to);   /* the clearance strips that touch this tree's cell: what the design will have to work around */
  const g = {}; for (const f of S.facilities || []) { const kk = f.depth_top_m == null ? 'not published' : (f.grade || 'record'); g[kk] = (g[kk] || 0) + 1; }
  const sw = S.ground && S.ground.sidewalk; const c311 = S.ground && S.ground.cases_311 && S.ground.cases_311.since_2022 ? S.ground.cases_311.since_2022.count : null;
  const row = (kk, v, tag) => `<div class="r"><em>${kk}</em><b>${v}${tag ? ` <i class="prov ${tag[0]}">${tag[1]}</i>` : ''}</b></div>`; const ex = S.band.existing || {};
  const run = !!app.pending; const curbConf = curbK.provenance === 'CONFIRMED_SITE_DATA';
  el2.innerHTML = `<div class="k">03 · WHAT DO WE KNOW ABOUT THIS SITE?${pendId && !sel.selected ? '<i class="prov run">READING ITS GROUND …</i>' : ''}</div><div class="v small">${esc(sr.common || sel.genus)}</div><div class="sub">${esc(sr.latin || (sel.genus + ' ' + sel.species))} · tree ${esc(sel.site_id.replace(/^(KE|V)-/, ''))}</div>
    ${factsHtml(S, sel).replace(/<div class="facts fold">[\s\S]*<\/div>\n?\s*$/, '')}
    <details class="adv"><summary>MORE · THE CITY'S RECORDS</summary>
      ${(factsHtml(S).match(/<div class="facts fold">[\s\S]*<\/div>/) || [''])[0]}
      ${row('DIAMETER', sel.diameter_cm != null ? fmt(sel.diameter_cm, 1) + ' cm' : '—', ['', 'CITY'])}${row('CROWN · ROOTS', `${fmt(sel.crown_diameter_m || 3)} m · ${esc((sel.roots && sel.roots.form) || 'heart')} form`, ['derived', 'NOMINAL'])}${row('IN THE CITY', sr.city_count != null ? sr.city_count.toLocaleString() + ' trees' : '—')}
      ${sw && sw.rating ? row('SIDEWALK RATING', esc(sw.rating.toLowerCase()), ['', 'CITY']) : ''}${c311 != null ? row('3-1-1 CASES', `${c311} since 2022`, ['', 'CITY']) : ''}
      <div class="legend"><span><b class="rec"></b>record ${g.record || 0}</span><span><b class="der"></b>derived ${g.derived || 0}</span><span><b class="nom"></b>nominal ${g.nominal || 0}</span><span><b class="unk"></b>no depth ${g['not published'] || 0}</span></div>
    </details>
    <div class="siteread">
      <button id="go-04" class="cta big"${run ? ' disabled' : ''}>${run ? 'THE RECORD IS UPDATING …' : 'DESIGN A SCENARIO →'}</button></div>`;
  wireFacts(S);
  $('go-04').onclick = () => scrollToT(STOP_T[3]);
}
// 05 · the axonometric: the saved scenarios as tabs in the rail; the block is built from the selected snapshot, never recomputed
function axoPanel(ctl) {
  const x = axoSnap(); if (!x) { ctl.innerHTML = `<div class="ph">05 · AXONOMETRIC RESULTS</div>`; return; } const r = x.result;
  const tabs = app.saved.length ? app.saved.map((y, i) => `<button class="tab${i === app.axo ? ' on' : ''}" data-i="${i}">SCENARIO ${y.id}</button>`).join('') : `<button class="tab on" disabled>${app.scenario ? 'WORKING SCENARIO' : 'EXISTING CONDITION'}</button>`;
  ctl.innerHTML = `<div class="ph">05 · AXONOMETRIC RESULTS</div><div class="tabs">${tabs}</div>
    <div class="card"><div class="nm">${esc(x.subject)}</div><div class="r"><em>SOIL</em><span>${esc((x.knobs.soil || '').replace('_', ' '))} · ${fmt(x.knobs.depth, 2)}&nbsp;m&nbsp;deep</span></div><div class="r"><em>CURB</em><span>${fmt(x.knobs.curb, 1)} m from ℄</span></div>
      <div class="r"><em>SOIL VOLUME</em><span>${r.available != null ? fmt(r.available) : '—'} of ${r.required != null ? r.required : '—'} m³</span></div><div class="r"><em>RESULT</em><span class="${r.cls}">${esc(r.label)}</span></div><div class="r"><em>${x.live ? 'STATE' : 'FROZEN'}</em><span class="file" title="${esc(x.hash || '')}">${x.live ? 'not saved · as it stands' : esc(x.file || '—')}</span></div>${x.scene.cut && x.scene.cut.aa ? `<div class="r"><em>A–A</em><span>${Math.abs(x.scene.cut.aa.u) >= 0.05 ? fmt(Math.abs(x.scene.cut.aa.u), 1) + ' m ' + (x.scene.cut.aa.u > 0 ? 'east' : 'west') + ' of the tree' : 'through the tree'}</span></div>` : ''}</div>
    <div class="pn">${x.live ? 'as 02–04 left it · not saved yet' : 'the proposed tree in ink, the City\'s tree as a ghost, the planter is the credited soil with the roots inside'} · drag the block to turn it</div>
    <div class="do"><a id="ax-edit">◂ ${x.live ? 'design the ground' : 'edit the scenario'}</a> · <a id="ax-sum">the summary ▸</a></div>`;
  for (const b of ctl.querySelectorAll('.tab[data-i]')) b.onclick = () => { app.axo = +b.dataset.i; app.ctlKey = ''; app.sumKey = ''; syncScene(); app.scene.setStop(app.t); draw(); };
  $('ax-edit').onclick = () => scrollToT(STOP_T[3]); $('ax-sum').onclick = () => scrollToT(STOP_T[5]);
}
// the axonometric's captions, written from the snapshot; each layer's anchor is a point on its drawn geometry (the right end of the planter's lid, the largest main's end, the block's right face)
function axoLayers(snap, S, ax, ex, G) {
  const r = snap.result, k = snap.knobs; const F = snap.scene; const sel = F.trees.find((x) => x.selected); const cand = F.candidate; const bd = F.band.design;
  const zs = sel && sel.extensions && sel.extensions.zones ? sel.extensions.zones.find((z) => z.side === 'property') : null;
  const inBox = (f) => f.path_uv && f.path_uv.some(([u, v]) => u >= ax.u0 && u <= ax.u1 && v >= ax.v0 && v <= ax.v1);
  const fac = (F.facilities || []).filter((f) => f.kind !== 'corridor' && inBox(f)); const withDepth = fac.filter((f) => f.depth_top_m != null).length, noDepth = fac.length - withDepth;
  const cuts = r.conflicts.map((c) => `${(c.dataset || c.kind || '').replace(/[-_]/g, ' ')} · ${fmt(c.clearance_m, 1)} m`);
  const nb = (F.candidate && F.candidate.box) || (F.need && F.need.box);
  const big = fac.filter((f) => f.depth_top_m != null && f.path_uv.length > 1).sort((p, q) => (q.diameter_mm || 0) - (p.diameter_mm || 0))[0];
  const vMain = big ? big.path_uv.reduce((m, p) => m + p[1], 0) / big.path_uv.length : (ax.v0 + ax.v1) / 2; const zMain = big ? -((big.depth_top_m || 0) + Math.max(0.12, (big.diameter_mm || 0) / 2000)) : -1.0;
  const atBand = bd ? [ax.u1, bd.v_to, 2 * G * ex] : [ax.u1, ax.v1, 2 * G * ex];
  return [
    { n: 1, title: 'the tree and its soil · the planter', at: atBand, bullets: [
      cand ? `proposed · ${cand.common} · ${cand.listed ? 'Table 9-3 ' + cand.class : 'not in Table 9-3'} · ${fmt(cand.drawn_height_m)} m drawn · needs ${r.required != null ? r.required + ' m³' : '—'}` : 'proposed · the City\'s tree stays',
      `today (ghost) · ${((sel.species_ref || {}).common) || sel.genus} · ${fmt(sel.height_m)} m${sel.install_date ? ' · planted ' + sel.install_date.slice(0, 4) : ''}`,
      `${(k.soil || '').replace('_', ' ')} · ${fmt(bd.v_to - bd.v_from, 2)} × ${fmt(k.depth, 2)} m · this cell ${sel && sel.cell ? fmt(sel.cell.u_to - sel.cell.u_from, 1) + ' m' : '—'} · ${sel && sel.share_m3 != null ? fmt(sel.share_m3) + ' m³' : 'share not on record'}${zs && zs.status === 'KNOWN' ? ` + ${fmt(zs.credited_m3)} m³ under the sidewalk` : ''}`,
      `${nb ? `need-box ${fmt(nb.length_m)} m of band${cuts.length ? ', cut by a clearance' : ''}` : 'no need-box: the species is not listed'} · roots nominal, in the credited soil only · ${resultLine(r)}`] },
    { n: 2, title: 'the mains and their clearances', at: [ax.u1, Math.max(ax.v0 + 0.2, Math.min(ax.v1 - 0.2, vMain)), Math.max(-ax.depth_m + 0.3, zMain) + G * ex], bullets: [
      `${fac.length} in this block · ${withDepth} with a published depth · ${noDepth} without`,
      cuts.length ? `clearances that cut the need-box · ${cuts.join(' · ')}` : 'no clearance cuts the need-box',
      'the roots stop at every clearance (Table 2-2)'] },
    { n: 3, title: 'the native ground', at: [ax.u1, (ax.v0 + ax.v1) / 2, -ax.depth_m * 0.5], bullets: [
      'no City record of the soil here · the strata are a drawing convention, not data',
      'gas, electrical, telecom, signal conduit, water laterals · no published position · nominal corridors at Table 7-1 cover'] },
  ];
}
// 06 · the summary: compact cards of the saved scenarios, VIEW FULL INFORMATION (the review's content for one), DOWNLOAD REPORT
function summaryPanel() {
  const el2 = $('summary'); const on = stage(app.t) === 5 && !app.report; el2.classList.toggle('on', on); if (!on) { app.sumKey = ''; return; }
  const live = !app.saved.length && app.scenario ? liveSnap() : null; const list = app.saved.length ? app.saved : live ? [live] : [];   /* 06 follows 02–04 as 05 does: nothing saved yet, the working scenario stands in, marked so; no scenario yet, the existing condition alone */
  const key = `${app.saved.length}|${app.axo}|${app.sumOpen ? 1 : 0}|${app.busy ? 1 : 0}|${live ? live.scene.site_id + ':' + (live.scene.exported_on || '') + ':' + JSON.stringify(live.knobs) + ':' + live.subject : ''}|${app.existing ? app.existing.site_id : ''}`; if (key === app.sumKey) return; app.sumKey = key;
  const axo = Math.max(0, Math.min(app.axo, list.length - 1)); const idOf = (y) => (y.live ? 'WORKING SCENARIO · NOT SAVED' : 'SCENARIO ' + y.id);
  const cards = list.map((x, i) => { const r = x.result; return `<div class="sc${i === axo ? ' on' : ''}${x.live ? ' live' : ''}" data-i="${i}"><div class="id">${idOf(x)}</div><div class="nm">${esc(x.subject)}</div>
      <div class="r"><em>SOIL SYSTEM</em><span>${esc((x.knobs.soil || '').replace('_', ' '))}</span></div><div class="r"><em>SOIL DEPTH</em><span>${fmt(x.knobs.depth, 2)} m</span></div><div class="r"><em>AVAILABLE / REQUIRED</em><span>${r.available != null ? fmt(r.available) : '—'} / ${r.required != null ? r.required : '—'} m³</span></div>
      <div class="verdict ${r.cls}">${esc(r.label)}</div></div>`; }).join('');
  const x = list[axo] || null; const ex = app.existing; const exSel = ex.trees.find((t) => t.selected); const exR = { ...resultFor(ex), available: null, gap: null, label: 'NOT KNOWN', cls: '' }; const exBd = ex.band.design; const exK = { ...knobs(ex), soil: null, depth: null };   /* the existing ground has no evidence: no volume, no verdict */
  const exCard = `<div class="sc ex"><div class="id">EXISTING · TODAY</div><div class="nm">${esc(((exSel || {}).species_ref || {}).common || (exSel || {}).genus || '')}</div>
      <div class="r"><em>EXISTING SOIL</em><span>unknown · not supplied</span></div><div class="r"><em>SOIL DEPTH</em><span>unknown</span></div><div class="r"><em>AVAILABLE / REQUIRED</em><span>unknown / ${exR.required != null ? exR.required : '—'} m³</span></div>
      <div class="verdict ${exR.cls}">${esc(exR.label)}</div></div>`;
  const cols = [{ h: 'EXISTING', K: exK, R: exR, bd: exBd, cls: exSel && exSel.table_9_3 && exSel.table_9_3.listed ? exSel.table_9_3.class : 'not listed', sp: ((exSel || {}).species_ref || {}).common || '', ex: true }]
    .concat(list.map((y) => ({ h: y.live ? 'WORKING · NOT SAVED' : 'SCENARIO ' + y.id, K: y.knobs, R: y.result, bd: y.scene.band.design, cls: y.result.treeClass || 'not listed', sp: y.subject, on: y === x, live: !!y.live })));
  const cc = (c) => `${c.ex ? 'ex' : ''}${c.on ? ' on' : ''}${c.live ? ' live' : ''}`;
  const tr = (label, f) => `<tr><th>${label}</th>${cols.map((c) => `<td class="${cc(c)}">${f(c)}</td>`).join('')}</tr>`;
  const table = `<table class="cmp"><thead><tr><th></th>${cols.map((c) => `<th class="${cc(c)}">${c.h}</th>`).join('')}</tr></thead><tbody>
    ${tr('species', (c) => esc(c.sp))}${tr('Table 9-3 class', (c) => esc(c.cls))}${tr('premise', (c) => (c.ex ? "the City's tree as it stands" : c.K.replacement ? 'replacement tree' : "keep the City's tree"))}${tr('soil system', (c) => (c.K.soil ? esc((c.K.soil || '').replace('_', ' ')) : 'unknown · not supplied'))}${tr('soil depth', (c) => (c.K.depth != null ? fmt(c.K.depth, 2) + ' m' : 'unknown'))}${tr('proposed zones', (c) => (c.ex ? 'none' : (c.K.extensions || []).length ? c.K.extensions.map((z) => (z.side === 'property' ? 'sidewalk' : 'parking lane') + ' ' + fmt(z.width_m, 1) + ' m' + (z.status ? ' · ' + z.status.toLowerCase().replace(/_/g, ' ') : '')).join(' · ') : 'none'))}${tr('band width', (c) => fmt(c.bd.v_to - c.bd.v_from, 2) + ' m')}${tr('curb from ℄', (c) => fmt(c.K.curb, 1) + ' m')}
    ${tr('available soil', (c) => (c.R.available != null ? fmt(c.R.available) + ' m³' : '—'))}${tr('required · Table 9-2', (c) => (c.R.required != null ? c.R.required + ' m³ · ' + esc(c.R.condition) : '—'))}${tr('gap / surplus', (c) => (c.R.gap == null ? '—' : `<b class="${c.R.gap >= 0 ? 'yes' : 'no'}">${c.R.gap >= 0 ? '+' : '−'}${fmt(Math.abs(c.R.gap))} m³</b>`))}${tr('rule result', (c) => `<b class="${c.R.cls}">${esc(c.R.label)}</b>`)}</tbody></table>`;
  el2.innerHTML = `<div class="k">SCENARIO COMPARISON <span class="sub">${esc(app.S.title.hblock)} · ${esc(app.S.title.side)} · the City's tree: ${esc(((exSel || {}).species_ref || {}).common || '')} · ${app.saved.length ? app.saved.length + ' saved scenario' + (app.saved.length === 1 ? '' : 's') : live ? 'the working scenario, not saved yet' : 'no scenario yet'}</span></div><div class="cards">${exCard}${cards}</div>
    <div class="two"><div>${table}</div><div class="side"><div class="k">THE REPORT</div><p>One saved scenario per report. <b>Page 1</b>: the sheet as drawn — the plan with the need-box, SECTION A–A with the proposed tree over the City's tree, the inputs, the rule check. <b>Page 2</b>: existing → proposed, the inputs and the rule context, the rule check and why, the numbered captions, the grades of what is drawn (City record · derived · nominal · design assumption · not published).</p><p class="grey">Click a card to choose the scenario. VIEW FULL INFORMATION opens the same detail on this page.</p>
    <div class="acts">${x ? `<button id="su-info" class="cta alt">${app.sumOpen ? '▾' : '▸'} VIEW FULL INFORMATION · ${idOf(x)}</button><button id="su-pdf" class="cta"${app.busy || x.live ? ' disabled' : ''}>⤓ DOWNLOAD REPORT (PDF)${x.live ? '' : ' · SCENARIO ' + x.id}</button>${x.live ? '<p class="hint">the report reads a saved file · VIEW SPATIAL RESULT at 04 saves this scenario, then its PDF is here</p>' : ''}` : `<button id="su-up" class="cta alt">◂ DESIGN THE GROUND AT 04 · A SCENARIO COMPARES HERE</button>`}</div></div></div>
    <div id="su-drawer" class="drawer${app.sumOpen && x ? ' on' : ''}"></div>`;
  for (const c of el2.querySelectorAll('.sc[data-i]')) c.onclick = () => { if (app.saved.length) { app.axo = +c.dataset.i; syncScene(); } app.sumKey = ''; app.ctlKey = ''; draw(); };
  if (x) { $('su-info').onclick = () => { app.sumOpen = !app.sumOpen; app.sumKey = ''; draw(); }; $('su-pdf').onclick = () => { if (!x.live) reportFor(x); }; } else $('su-up').onclick = () => scrollToT(STOP_T[3]);
  if (app.sumOpen && x) reviewPanel($('su-drawer'), x.scene);
}
// the rule result: the one fixed answer on the right in scenario and review; the need-box and the credited soil are its spatial explanation
function resultPanel(S) {
  const el2 = $('result'); const st = stage(app.t); const on = st === 3; const recOn = st === 2 || (st === 1 && app.secK > 0.5); if (!recOn) { el2.classList.toggle('on', on); el2.classList.remove('record'); el2.classList.toggle('tool', on); } if (!on) { $('tool').classList.remove('on'); if (!recOn) app.resKey = ''; return; }
  el2.style.width = (SHEET.toolL - 14) + 'px'; el2.style.left = (SHEET.rail + 6) + 'px'; el2.style.right = 'auto';   /* 04: A and B on the left */
  if (!$('verdict')) { el2.innerHTML = '<div id="verdict" class="vbox top"></div><div id="inputs" class="ctl inputs"></div>'; app.ctlKey = ''; app.resKey = ''; }   /* #verdict = A · WHAT IS HERE, #inputs = B · DESIGN THE GROUND; C lives in the strip (#tool) */
  $('tool').classList.toggle('on', !app.report);
  void S;
}
// 5: the City's list as compact rows (the library of the scene file); drag one onto the cell, or click it then the cell
function tray(S) {
  const L = document.createElement('div'); L.className = 'tray'; const lib = S.library; if (!lib) return L; const cs = candidateShown(S); const cid = cs && cs.id;
  const order = { Large: 0, Medium: 1, Columnar: 2, Small: 3 };
  const cards = lib.cards.slice().sort((a, b) => (a.listed ? 0 : 1) - (b.listed ? 0 : 1) || (order[a.class] ?? 9) - (order[b.class] ?? 9) || a.common.localeCompare(b.common));
  for (const c of cards) {
    const d = document.createElement('div'); d.className = 'sc' + (c.listed ? '' : ' grey') + (c.fit && c.fit.fits === false ? ' nofit' : '') + (c.id === cid ? ' placed' : ''); d.draggable = true; d.dataset.id = c.id;
    const vol = c.listed && c.volume_m3 && lib.condition ? `${c.volume_m3[lib.condition]} m³` : '';
    d.title = `${c.latin} · ${c.city_count.toLocaleString()} in the City · drawn ${c.drawn_height_m != null ? fmt(c.drawn_height_m) + ' m' : '—'} (City p90) · ${c.form} crown, nominal · ${c.fit ? c.fit.reason : ''}`;
    d.innerHTML = `<div class="nm">${c.common}${c.on_this_face ? ' <i>· here</i>' : ''}</div><div class="cl">${c.listed ? c.class.toUpperCase() : 'NOT LISTED'}${vol ? ' · ' + vol : ''} · ${c.fit && c.fit.fits === true ? '● fits' : c.fit && c.fit.fits === false ? '<span class="no">○ no room</span>' : c.listed ? '' : 'no box'}</div><span class="grip">≡</span>`;
    d.addEventListener('dragstart', (e) => { app.dragCard = c.id; app.armed = null; e.dataTransfer.setData('text/plain', c.id); e.dataTransfer.effectAllowed = 'copy'; draw(); });
    d.addEventListener('dragend', () => { app.dragCard = null; draw(); });
    d.addEventListener('click', () => { if (app.busy) return; app.armed = app.armed === c.id ? null : c.id; for (const x of L.children) x.classList.toggle('armed', x.dataset.id === app.armed); status(app.armed ? `${c.common}: now click the cell` : ''); draw(); });
    L.appendChild(d);
  }
  return L;
}
function placeCard(id) {
  const c = app.S.library.cards.find((x) => x.id === id); if (!c || app.busy) return; app.armed = null; app.dragCard = null;
  const patch = { candidate: id, candidate_only: true }; if (c.listed) { patch.target = c.class; app.cls = c.class; }      /* Table 9-3 lookup fills the class knob; no engine run: the ground has not changed */
  if (!liveKnobs(app.S).replacement) { patch.replacement = true; delete patch.candidate_only; }   /* a species chosen under the keep-the-tree premise switches the premise: a replacement changes what the ground may be, so the rule runs */
  evaluate(patch);
}
const requestDraw = () => { if (app.rafD) return; app.rafD = requestAnimationFrame(() => { app.rafD = 0; draw(); }); };   /* pointer-driven redraws: one per frame */
function draw() {
  if (app.drag && app.S && app.t >= 3 && app.t < 4 && !app.report && app.secKey) {   /* a handle or slider drag at 04: only the instrument moves; the overlay and the panels stay as they are */
    const sc = app.scene, S = app.S; const shown = S.trees.find((x) => x.selected); if (shown) { fitSheet(); syncFields(S); const x04 = SHEET.rail + SHEET.toolL + 14, W04 = sc.W - SHEET.toolR - 22 - x04; sectionLayer(sc, S, app.t, shown, true, false, x04, W04, splitH(sc, S, W04).Hs, 1, 1, 1); return; } }
  fitSheet(); syncScene();
  const svg = $('overlay'); for (const ch of [...svg.children]) if (ch.tagName !== 'defs') ch.remove(); const S = app.S; const sc = app.scene; if (!S || !sc.slab) return; const t = app.t; const sl = sc.slab; const st = S.street; const bd = S.band.design;
  const dv = diveT(); const tR = t >= dv.ts ? Math.max(t, 1) : t;                        // the rail and the headline turn to the street together, when the plan is the drawing
  const stepNow = stage(t);
  for (const li of $('steps').querySelectorAll('li[data-s]')) { const s = +li.dataset.s; li.classList.toggle('on', s === stepNow); li.classList.toggle('done', s < stepNow); }
  resultPanel(S); recordPanel(S); ctlFor(tR, S); summaryPanel();   /* the result panel builds the right column's frame before the inputs fill it */
  $('hint').textContent = t < 1 ? 'scroll ▾ zoom  ·  keys 1–6' : t < STOPS - 0.15 ? 'scroll ▾  ·  keys 1–6' : 'keys 1–6';
  /* 05 always has a subject: the chosen frozen scenario or the working state */
  // the chunk outline on the ground, while it is being cut out and lifted (the object)
  if (t < 1 && sc.areaInfo) atlas(svg, sc, t);
  if (t < 1 && sc.faceUV) {
    const hw = sc.halfW1 || 4000; const k = smooth((Math.log(4500) - Math.log(hw)) / (Math.log(4500) - Math.log(1800)));   // 0 = city (dots), 1 = area (lines)
    const cityOp = 1 - smooth((t - (dv.ta - 0.16)) / 0.14), areaOp = smooth((t - (dv.ta - 0.16)) / 0.14) * (1 - smooth((t - (dv.ts - 0.22)) / 0.14));   /* the city's dots give way to the area's lines before the area level; the lines leave before the street */
    const focus = (app.area && sc.areaInfo.find((x) => x.name === app.area)) || sc.homeArea;
    // the hovered area lifts: its ring in ink, its pill open
    // the checked faces: dots on the city, lines in the area; outside the focused area they fade with the city
    const g = el('g', { class: 'faces' });
    for (const it of sc.faceUV) {
      const a = sc.project(it.a[0], it.a[1], 0), b = sc.project(it.b[0], it.b[1], 0); const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; if (m.x < -20 || m.x > sc.W + 20 || m.y < -20 || m.y > sc.H + 20) continue;
      const own = focus && it.f.local_area === focus.name; const op = Math.max(own ? areaOp : 0, cityOp); if (op < 0.02) continue;
      const p1 = { x: lerp(m.x, a.x, k), y: lerp(m.y, a.y, k) }, p2 = { x: lerp(m.x, b.x, k), y: lerp(m.y, b.y, k) }; const col = FACE_COL[it.f.largest_class_fits] || FACE_COL.unknown;
      const gg = el('g', { opacity: op }); gg.appendChild(el('line', { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, stroke: col })); g.appendChild(gg);
    }
    svg.appendChild(g);
    if (app.hotArea && t < dv.ta + 0.06) { const pts = app.hotArea.ring.map(([u, v]) => sc.project(u, v, 0)); const d = `M0 0H${sc.W}V${sc.H}H0Z M` + pts.map((q) => `${q.x} ${q.y}`).join('L') + 'Z'; svg.appendChild(el('path', { class: 'dim', d, 'fill-rule': 'evenodd' })); svg.appendChild(poly(pts, { class: 'area hot' })); }
    if (app.pulse) { const q = sc.project(app.pulse.u, app.pulse.v, 0); const c = el('circle', { class: 'pulse', cx: q.x, cy: q.y, r: 6 }); c.appendChild(el('animate', { attributeName: 'r', from: 6, to: 60, dur: '.5s', fill: 'freeze' })); c.appendChild(el('animate', { attributeName: 'opacity', from: .9, to: 0, dur: '.5s', fill: 'freeze' })); svg.appendChild(c); setTimeout(() => { app.pulse = null; }, 600); }
    // the block on the city: a ring (or the face just clicked, while its scene is being made)
    const at = app.goto || { u: (sl.u0 + sl.u1) / 2, v: (sl.v0 + sl.v1) / 2 }; const c = sc.project(at.u, at.v, 0); const rop = app.goto ? 1 : 1 - smooth((t - (dv.ts - 0.2)) / 0.14);
    if (rop > 0.01) { const gg = el('g', { class: 'ring' + (app.goto ? ' busy' : ''), opacity: rop }); gg.appendChild(el('circle', { cx: c.x, cy: c.y, r: 11 })); gg.appendChild(el('circle', { cx: c.x, cy: c.y, r: 2.2, class: 'dot' })); svg.appendChild(gg); }
    if (focus && (areaOp > 0.02 || (cityOp > 0.02 && app.area))) { const pts = focus.ring.map(([u, v]) => sc.project(u, v, 0)); svg.appendChild(poly(pts, { class: 'area focus', opacity: Math.max(areaOp, app.area ? cityOp : 0) })); }   /* the area chosen in the index is outlined on the city too */
    /* the block level: every public tree as a dot (ink = Table 9-3 species, grey = other); hover lifts one, a click opens it at 03 */
    sc.treesInView = null;
    if (sc.treeUV && hw < DOTS_HALF_W) { const op = smooth((DOTS_HALF_W - hw) / 120); const c0 = sc.centre1 || { x: 0, y: 0 }; const hh = hw * sc.H / sc.W; const inView = []; const paths = ['', ''];
      for (const q of sc.treeUV) { if (Math.abs(q[0] - c0.x) > hw + 10 || Math.abs(q[1] - c0.y) > hh + 10) continue; const p = sc.project(q[0], q[1], 0); inView.push({ q, p }); const r = q[3] ? 3.2 : 2.4; paths[q[3] ? 1 : 0] += `M${(p.x - r).toFixed(1)} ${p.y.toFixed(1)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`; }
      const g2 = el('g', { class: 'tdots', opacity: op }); if (paths[0]) g2.appendChild(el('path', { class: 'other', d: paths[0] })); if (paths[1]) g2.appendChild(el('path', { class: 'listed', d: paths[1] }));
      if (app.hotTreeDot) { const p = sc.project(app.hotTreeDot[0], app.hotTreeDot[1], 0); g2.appendChild(el('circle', { class: 'hot', cx: p.x, cy: p.y, r: 9 })); }
      svg.appendChild(g2); sc.treesInView = inView; }
    const lvl = atlasLevel(t); const lvlOp = lvl === 'block' ? smooth((DOTS_HALF_W - hw) / 120) : 0;
    if (cityOp > 0.01) legend(svg, SHEET.rail + 24 + 330, sc.H - 28, cityOp, 'city', focus);   /* beside the rail, which is long at 01 now (the street cards) */
    else if (lvlOp > 0.01) legend(svg, SHEET.rail + 24 + 330, sc.H - 28, lvlOp, 'block', focus);
    else if (areaOp > 0.01) legend(svg, SHEET.rail + 24 + 330, sc.H - 28, areaOp, 'area', focus);
  }
  if (t >= dv.ts - 0.12 && t < 4.2) plan(svg, sc, S, t); else if (app.secKey) { app.secKey = ''; for (const ch of [...$('osec').children]) ch.remove(); }                 // 02–04: the plan | section sheet, drawn flat in the atlas's language
  if (t >= SHEET_ON && t < 5) {               // 05: the exploded axonometric — a title, three lifted layers, construction lines, one green callout per layer with a level leader to the caption column
    const snap = axoSnap(); const colW = 356; const col = sc.W - colW - 24; const ax = sc.axo || sl; const bd0 = S.band.design;
    { const gt = el('g', { class: 'axo' }); const x = SHEET.rail + 36; const exSel = S.trees.find((q) => q.selected);   /* S is the frozen scene here (sceneFor at 05) */
      const exName = (((exSel && exSel.species_ref) || {}).common || (exSel && exSel.genus) || '').toUpperCase();
      gt.appendChild(el('text', { class: 't1', x, y: 92 }, snap.live ? (app.scenario ? 'AXONOMETRIC · WORKING SCENARIO · NOT SAVED' : 'AXONOMETRIC · EXISTING CONDITION') : `AXONOMETRIC · SCENARIO ${snap.id}`));
      gt.appendChild(el('text', { class: 't2', x, y: 112 }, `${S.candidate ? `${(S.candidate.common || '').toUpperCase()} IN PLACE OF ${exName}` : `THE CITY'S TREE · ${exName}`} · ${S.title.hblock} · ${S.title.side.toUpperCase()}`));
      gt.appendChild(el('text', { class: 't2 grey', x, y: 128 }, `${(snap.knobs.soil || '').replace('_', ' ').toUpperCase()} · ${fmt(snap.knobs.depth, 2)} m DEEP · ${fmt(snap.scene.band.design.v_to - snap.scene.band.design.v_from, 2)} m WIDE · ${resultLine(snap.result)}`));
      svg.appendChild(gt); }
    const ex = sc.explode || 0; const G = EXPLODE_GAP; const P = (u, v, z) => sc.project(u, v, z); const pt = (q) => `${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
    const segs = bd0 ? (S.band.segments || []).map((q) => [Math.max(q.u_from, ax.u0), Math.min(q.u_to, ax.u1)]).filter(([q0, q1]) => q1 - q0 > 0.3) : [];
    if (ex > 0.3 && bd0) {   /* construction: the planter's footprint dashed on the block's lid, and dashed verticals from the lifted planter's bottom corners down to it */
      const gc = el('g', { class: 'axo-con', opacity: smooth((ex - 0.3) / 0.5) }); const zB = -bd0.depth_m + 2 * G * ex;
      for (const [u0, u1] of segs) { const c4 = [[u0, bd0.v_from], [u1, bd0.v_from], [u1, bd0.v_to], [u0, bd0.v_to]];
        gc.appendChild(el('path', { d: 'M' + c4.map(([u, v]) => pt(P(u, v, 0.02))).join('L') + 'Z' }));
        for (const [u, v] of c4) { const a0 = P(u, v, zB), b0 = P(u, v, 0.02); gc.appendChild(el('line', { x1: a0.x, y1: a0.y, x2: b0.x, y2: b0.y })); } }
      svg.appendChild(gc);
      /* the planter's dimensions on its near end: the band's width across, its depth down — the two numbers the tool trades in */
      if (segs.length) { const [u0] = segs.reduce((m, q) => (q[0] < m[0] ? q : m)); const gd = el('g', { class: 'axo-dim', opacity: smooth((ex - 0.5) / 0.4) }); const zT = 2 * G * ex, zD = zB - 0.45;
        const a1 = P(u0, bd0.v_from, zD), b1 = P(u0, bd0.v_to, zD), a1u = P(u0, bd0.v_from, zB), b1u = P(u0, bd0.v_to, zB);
        gd.appendChild(el('line', { x1: a1.x, y1: a1.y, x2: b1.x, y2: b1.y })); gd.appendChild(el('line', { class: 'ext', x1: a1u.x, y1: a1u.y, x2: a1.x, y2: a1.y })); gd.appendChild(el('line', { class: 'ext', x1: b1u.x, y1: b1u.y, x2: b1.x, y2: b1.y }));
        const m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 }; gd.appendChild(el('text', { x: m1.x, y: m1.y + 14, 'text-anchor': 'middle' }, `${fmt(bd0.v_to - bd0.v_from, 2)} m · the band`));
        const vD = bd0.v_to + 0.45; const c1 = P(u0, vD, zT), d1 = P(u0, vD, zB), c1u = P(u0, bd0.v_to, zT), d1u = P(u0, bd0.v_to, zB);
        gd.appendChild(el('line', { x1: c1.x, y1: c1.y, x2: d1.x, y2: d1.y })); gd.appendChild(el('line', { class: 'ext', x1: c1u.x, y1: c1u.y, x2: c1.x, y2: c1.y })); gd.appendChild(el('line', { class: 'ext', x1: d1u.x, y1: d1u.y, x2: d1.x, y2: d1.y }));
        gd.appendChild(el('text', { x: Math.max(c1.x, d1.x) + 6, y: (c1.y + d1.y) / 2 + 4 }, `${fmt(bd0.depth_m, 2)} m deep`));
        svg.appendChild(gd); }
    }
    const items = axoLayers(snap, S, ax, ex, G).map((L) => ({ ...L, p: P(L.at[0], L.at[1], L.at[2]) })).sort((a, b) => a.p.y - b.p.y);
    const legendH = 92; const legendTop = items.length && items[0].p.y - 10 - legendH - 12 >= 96;   /* the legend takes the top of the column when the first caption starts low enough; otherwise the foot */
    let y = legendTop ? 96 + legendH + 12 : 96;
    for (const it of items) {
      const lines = it.bullets.flatMap((b) => wrap(b, 50).map((l, i) => (i ? '   ' : '•  ') + l)); const h = 24 + lines.length * 14; const yTop = Math.max(y, it.p.y - 10);
      const g = el('g', { class: 'cap sheet' });
      if (it.p.x < col - 24 && it.p.y > 60 && it.p.y < sc.H - 20) {   /* a dot on the layer, a level leader to the column, a short riser when the caption sits lower than the dot */
        g.appendChild(el('circle', { class: 'dot', cx: it.p.x, cy: it.p.y, r: 2.6 })); g.appendChild(el('line', { x1: it.p.x, y1: it.p.y, x2: col - 6, y2: it.p.y })); if (yTop + 2 - it.p.y > 2) g.appendChild(el('line', { x1: col - 6, y1: it.p.y, x2: col - 6, y2: yTop + 2 })); }
      g.appendChild(el('rect', { x: col - 4, y: yTop - 11, width: colW + 4, height: h }));
      const d2 = el('g', { class: 'disc num' }); d2.appendChild(el('circle', { cx: col + 10, cy: yTop + 2, r: 11 })); d2.appendChild(el('text', { x: col + 10, y: yTop + 6 }, `${it.n}`)); g.appendChild(d2);
      g.appendChild(el('text', { class: 't', x: col + 30, y: yTop + 6 }, it.title.toUpperCase()));
      lines.forEach((l, i) => g.appendChild(el('text', { x: col + 30, y: yTop + 26 + i * 14 }, l)));
      svg.appendChild(g); y = yTop + h + 10;
    }
    if (legendTop || y + legendH < sc.H - 12) { const gt = el('g', { class: 'axo' }); if (legendTop) y = 96 - 18;   /* the legend: two columns of short keys, at the column's head or foot — wherever there is room */
      const L = [['ink', 'proposed tree + roots'], ['ghost', 'the City\'s tree today'], ['band', 'credited soil · the planter'], ['need', 'need-box (Table 9-2)'], ['red', 'clearance · not credited'], ['native', 'native ground · nominal']];
      gt.appendChild(el('text', { class: 't3', x: col, y: y + 22 }, 'HOW TO READ IT · drag the block to turn it'));
      L.forEach(([k, txt], i) => { const x = col + (i % 2) * (colW / 2); const ly = y + 44 + Math.floor(i / 2) * 18; if (k === 'band' || k === 'native') gt.appendChild(el('rect', { class: 'sw ' + k, x, y: ly - 9, width: 22, height: 10 })); else gt.appendChild(el('line', { class: 'sw ' + k, x1: x, y1: ly - 4, x2: x + 22, y2: ly - 4 })); gt.appendChild(el('text', { class: 't2', x: x + 30, y: ly }, txt)); });
      svg.appendChild(gt); }
  }
}
/* 04: SECTION B–B is a long, low strip whose scale is set by its width, so it takes only the height it needs; A–A gets the rest */
function splitH(sc, S, Ws) {
  const Htot = sc.H - 74; const sl = sc.slab; const span = (sl.u1 - sl.u0) + 16; const kb = Math.min(26, (Ws - 56) / span);
  const trees = S.trees.filter((t) => t.u >= sl.u0 - 14 && t.u <= sl.u1 + 14); const cand = S.candidate; const hmax = Math.max(6, ...trees.map((t) => t.height_m || 4), cand ? cand.drawn_height_m || 6 : 0);
  const Hb = Math.max(140, Math.min(Htot * 0.42, 44 + 28 + (hmax + 0.8 + Math.max(1.4, S.band.design.depth_m + 0.5)) * kb + 8));
  return { Hs: Htot - Hb - 6, Hb };
}
/* the section's own SVG layer (#osec), composited apart from the overlay: rebuilt only when what it shows changes, so a scroll
   frame or a hover never repaints the ground; during a handle or slider drag it rebuilds at most every 90 ms with a trailing frame */
function sectionLayer(sc, S, t, shown, replace, review, x0s, Ws, Hs, toolK, op, secOn) {
  const osec = $('osec'); const lv = liveKnobs(S); const cs = candidateShown(S); const d = app.drag;
  const key = shown && secOn > 0.01 ? [S.site_id, S.exported_on, S === app.S ? 1 : 0, shown.site_id, (app.cutU || 0).toFixed(2), lv.curb, lv.depth, lv.soil, lv.land_use, lv.width_level, lv.target, Math.round(x0s), Math.round(Hs), Math.round(Ws), toolK.toFixed(2), replace ? 1 : 0, app.busy ? 1 : 0, d ? d.kind + ':' + d.value : '', app.dragCard || '', app.armed || '', cs ? cs.id : '', app.pending ? 'p' : '', app.hotNeed ? 1 : 0, app.bb ? 1 : 0, sc.W, sc.H, GROUND.pat ? 1 : 0, TREE_ART.size, app.report ? 'r' : ''].join('|') : '';
  if (key !== app.secKey) {
    const now = performance.now();
    if (d && now - (app.secAt || 0) < 90) { clearTimeout(app.secT); app.secT = setTimeout(() => { app.secT = null; draw(); }, 95); }
    else { app.secKey = key; app.secAt = now; for (const ch of [...osec.children]) ch.remove();
      if (key) { const gA = el('g', { class: 'plan' }); osec.appendChild(gA); const gS = el('g', { class: 'sheet' }); gA.appendChild(gS); const gSec = el('g'); gS.appendChild(gSec);
        sectionPanel(gSec, sc, S, shown, x0s, 64, Ws, Hs, replace, review);
        if (toolK > 0.02) { const gL = el('g', { opacity: toolK.toFixed(2) }); gS.appendChild(gL); longSection(gL, sc, S, shown, x0s, 64 + Hs + 6, Ws, sc.H - 74 - Hs - 6); } } } }
  osec.style.opacity = key ? (op * smooth((t - 0.8) / 0.2) * secOn).toFixed(3) : 0;
  if (replace) { const T = $('tool'); T.style.left = (sc.W - SHEET.toolR - 10) + 'px'; T.style.top = '52px'; T.style.width = SHEET.toolR + 'px'; T.style.height = (sc.H - 62) + 'px'; }
}
// SECTION A–A: the transverse section through the tree the plan points at, property line to the road, true scale, drawn as a
// landscape section draws the ground — every layer with its section convention and its grade: the City's standard details for the
// sidewalk (G9.2: slab, 100 mm granular base, filter fabric, 750 mm engineered soil, scarified native) and for a main's trench
// (G4.4: bedding, haunching, initial and general backfill), the growing medium the rule credits (0.90 m, the knob), the clearance
// that is not credited (red edge), the native ground nobody publishes (drawn as a subgrade, nominal, dark), the mains at their
// recorded depth, the private corridors at nominal cover, and the roots as a whole system in the manner of the Wurzelatlas plates —
// nominal, living only in the credited soil, cut where it ends. Above: the tree at its City height with the species' hull crown.
function rng2(seed) { let x = (seed >>> 0) || 7; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; }; }
// the root system in this plane, in the manner of the Wurzelatlas plates: a plate of primaries fanning from the base by habit
// (heart · flat · tap), laterals, fine roots and hairs, every stroke tapering; every line lives only where `inside` says and ends
// with a red tick where the credited soil ends. A drawing, not a measurement.
function rootsSection(vT, form, inside, seed) {
  const R = rng2(seed); const segs = [], cut = [];
  const STEP = [0.24, 0.15, 0.1, 0.06], WOB = [0.2, 0.5, 0.8, 1.0], BR = [0.5, 0.45, 0.3], LEN = [9, 6, 4], W0 = [1.5, 0.8, 0.45, 0.28];
  const grow = (p, a, len, gen) => {
    let cur = p;
    for (let i = 0; i < len; i++) {
      const w = W0[gen] * (1 - 0.7 * i / len); const step = STEP[gen] * (0.7 + R() * 0.6); a += (R() - 0.5) * WOB[gen]; if (gen === 0) a += (a > -Math.PI / 2 ? -0.015 : 0.015) * (form === 'flat' ? -1 : 1);
      const nxt = [cur[0] + Math.cos(a) * step, cur[1] + Math.sin(a) * step];
      if (!inside(nxt[0], nxt[1])) { let lo = cur, hi = nxt; for (let q = 0; q < 6; q++) { const m = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2]; if (inside(m[0], m[1])) lo = m; else hi = m; } if (Math.hypot(lo[0] - cur[0], lo[1] - cur[1]) > 0.02) segs.push([cur[0], cur[1], lo[0], lo[1], w]); const t = gen === 0 ? 0.08 : 0.05; if (gen <= 1) cut.push([lo[0] - Math.sin(a) * t, lo[1] + Math.cos(a) * t, lo[0] + Math.sin(a) * t, lo[1] - Math.cos(a) * t]); return; }
      segs.push([cur[0], cur[1], nxt[0], nxt[1], w]); cur = nxt;
      if (gen < 3 && R() < BR[gen]) grow(cur, a + (R() < .5 ? 1 : -1) * (0.45 + R() * 1.0), LEN[gen] + Math.floor(R() * 4), gen + 1);
      if (gen === 0 && form === 'flat' && R() < 0.15) grow(cur, -Math.PI / 2 + (R() - .5) * 0.3, 4 + Math.floor(R() * 3), 1);
    }
  };
  const n = form === 'tap' ? 10 : 18;
  for (let i = 0; i < n; i++) { const side = i % 2 ? 1 : -1; const dip = form === 'flat' ? 0.03 + R() * 0.3 : form === 'tap' ? 0.3 + R() * 0.9 : 0.05 + R() * 0.55; const a = side > 0 ? -dip : -Math.PI + dip; grow([vT + side * (0.05 + R() * 0.15), -0.08 - R() * 0.2], a, 16 + Math.floor(R() * 14), 0); }
  const sinkers = form === 'tap' ? 1 : form === 'heart' ? 3 : 0; for (let i = 0; i < sinkers; i++) grow([vT + (R() - .5) * 0.2, -0.12], -Math.PI / 2 + (R() - .5) * (form === 'tap' ? 0.1 : 0.5), 8 + Math.floor(R() * 4), 0);
  return { segs, cut };
}
// the tree as a landscape section draws it: a tapering trunk with bark lines, a branching structure that fills the crown's
// nominal envelope, foliage as scribbled masses at the branch tips. Height is the City's record; everything else is a convention.
// ---- the section tree: a fixed line-art asset per crown form (web/assets/trees/<form>.svg, cut from the user's vector
// library), scaled to the record's envelope and never redrawn branch by branch. DATA CONTROLS THE ENVELOPE, THE ASSET THE LOOK.
const TREE_FORMS = ['round', 'oval', 'vase', 'columnar', 'conical', 'weeping'];
const TREE_ART = new Map();     // form → { w, h, ground, top, left, right, groups: [{ id, d: [...] }] }
async function loadTreeArt() {
  const pt = (s) => { const [x, y] = (s || '0,0').split(',').map(Number); return { x, y }; };
  await Promise.all(TREE_FORMS.map(async (form) => {
    try {
      const txt = await fetch(`assets/trees/${form}.svg`).then((r) => (r.ok ? r.text() : null)); if (!txt) return;
      const root = new DOMParser().parseFromString(txt, 'image/svg+xml').documentElement;
      const [, , w, h] = (root.getAttribute('viewBox') || '0 0 1 1').split(/\s+/).map(Number);
      const groups = [...root.children].filter((g) => g.tagName === 'g' && g.id !== 'anchors').map((g) => ({ id: g.id, d: [...g.querySelectorAll('path')].map((x) => x.getAttribute('d')) }));
      TREE_ART.set(form, { w, h, ground: pt(root.dataset.ground), top: pt(root.dataset.top), left: pt(root.dataset.crownLeft), right: pt(root.dataset.crownRight), groups });
    } catch (e) { console.warn('tree art', form, e); }
  }));
}
// place one asset so that its ground anchor sits at (x0, yGround), its ground→top spans `height` px and its
// crown-left→crown-right spans `crownSpread` px; nothing inside the drawing is regenerated. trunkDiameter is accepted for
// assets with a separate `trunk` group (none of the six has one: the library draws trunk and canopy as one line) and ignored otherwise.
function placeTree(asset, { x0, yGround, height, crownSpread, trunkDiameter }) {
  const sy = height / Math.max(1e-6, asset.ground.y - asset.top.y), sx = crownSpread / Math.max(1e-6, asset.right.x - asset.left.x);
  const g = el('g', { class: 'treeart', transform: `translate(${x0.toFixed(1)} ${yGround.toFixed(1)}) scale(${sx.toFixed(4)} ${sy.toFixed(4)}) translate(${(-asset.ground.x).toFixed(2)} ${(-asset.ground.y).toFixed(2)})` });
  for (const grp of asset.groups) { const gg = el('g', { class: grp.id }); for (const d of grp.d) gg.appendChild(el('path', { d })); g.appendChild(gg); }
  return g;
}
function treeSection(gs, X, Z, k, vT, h, crownR, form) {
  const asset = TREE_ART.get(form) || TREE_ART.get('round'); if (!asset) return;     // assets still loading: drawn on the next frame
  { const treeEl = placeTree(asset, { x0: X(vT), yGround: Z(0), height: h * k, crownSpread: crownR * 2 * k }); if (Math.abs(app.cutU || 0) > 0.6) treeEl.setAttribute('opacity', '0.28'); gs.appendChild(treeEl); }
}
// ---- the ground's drawing vocabulary, cut from the same library (scripts/tree_assets/build_patterns.py): seven strata
// pattern tiles (web/assets/patterns/p1..p7.png, seamless), the sky hairlines, pebble outlines, a standing figure. ----
const GROUND = { pat: null, pebbles: [], person: null };
const PSCALE = 1.3;   // 1 pt of the library's swatch → 1.3 px on the page: marks a little above their printed size, so they read on a 500-px-wide section without turning into noise
async function loadGroundArt() {
  const parse = (t) => new DOMParser().parseFromString(t, 'image/svg+xml').documentElement;
  const txt = (u) => fetch(u).then((r) => (r.ok ? r.text() : null)).catch(() => null);
  const [idx, pebs, person] = await Promise.all([fetch('assets/patterns/index.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    Promise.all([2, 3, 5, 6].map((i) => txt(`assets/patterns/pebble${i}.svg`))), txt('assets/figures/person.svg')]);
  // tiles as data URLs: the page's own capture serializes the SVG to an image, where external hrefs would not load
  if (idx) await Promise.all(Object.keys(idx).map(async (name) => { try { const b = await fetch(`assets/patterns/${name}.png`).then((r) => (r.ok ? r.blob() : null)); if (b) idx[name].href = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }); } catch (e) { /* keep the file href */ } }));
  GROUND.pat = idx;
  GROUND.pebbles = pebs.filter(Boolean).map((t) => { const r = parse(t); return { vb: r.getAttribute('viewBox'), paths: [...r.querySelectorAll('path')].map((q) => ({ d: q.getAttribute('d'), fill: q.getAttribute('fill') || 'none' })) }; });
  if (person) { const r = parse(person); GROUND.person = { vb: r.getAttribute('viewBox'), d: r.querySelector('path').getAttribute('d') }; }
}
function ensureGroundDefs(svgRoot) {
  const defs = svgRoot.querySelector('defs'); if (!defs || defs.querySelector('#pat-sky')) return;
  const sky = el('pattern', { id: 'pat-sky', patternUnits: 'userSpaceOnUse', width: 40, height: 6 }); sky.appendChild(el('line', { x1: 0, y1: 3, x2: 40, y2: 3, stroke: '#26382C', 'stroke-width': .35 })); defs.appendChild(sky);
  if (GROUND.pat) for (const [name, t] of Object.entries(GROUND.pat)) { const w = t.w / t.zoom * PSCALE, h = t.h / t.zoom * PSCALE; const pt = el('pattern', { id: 'pat-' + name, patternUnits: 'userSpaceOnUse', width: w, height: h }); pt.appendChild(el('image', { href: t.href || `assets/patterns/${name}.png`, width: w, height: h, preserveAspectRatio: 'none' })); defs.appendChild(pt); }
  GROUND.pebbles.forEach((p, i) => { const sy = el('symbol', { id: 'peb-' + i, viewBox: p.vb, overflow: 'visible' }); for (const q of p.paths) sy.appendChild(el('path', { d: q.d, fill: q.fill, 'vector-effect': 'non-scaling-stroke' })); defs.appendChild(sy); });
  if (GROUND.person) { const sy = el('symbol', { id: 'fig-person', viewBox: GROUND.person.vb, overflow: 'visible' }); sy.appendChild(el('path', { d: GROUND.person.d, fill: '#F6F3EC', 'vector-effect': 'non-scaling-stroke' })); defs.appendChild(sy); }
}
function sectionPanel(gAll, sc, S, tr, x0, y0, W, H, replace = false, review = false) {
  const uCut = tr.u + (app.cutU || 0);   /* SECTION A–A is cut at the A–A line the plan carries (02 sets it); the tree is drawn faint when the cut is not through it */
  const st = S.street, B = S.band; const pl = st.property_line_v, cl = st.centreline_v; if (!S.band.design || st.curb_face_v == null) return;
  // 3 replace: what the rule reads, live — the dragged handle, or the value just sent to the engine, overrides the file's until the result lands
  const live = liveKnobs(S); const curb = live.curb; const curbW = st.widths_m.curb || 0.15; const bd = { ...S.band.design, v_from: curb + curbW, depth_m: live.depth };
  const cand = tr.selected ? candidateShown(S) : null;              // the species card standing in for this tree, if one is in the cell
  const sr = cand || tr.species_ref || {}; const listed = cand ? !!cand.listed : !!(tr.table_9_3 && tr.table_9_3.listed); const zs = tr.extensions && tr.extensions.zones ? tr.extensions.zones.find((z) => z.side === 'property' && z.status === 'KNOWN') : null;
  const have = tr.extensions && tr.extensions.share_total_m3 != null ? tr.extensions.share_total_m3 : tr.share_m3; const h = cand ? (cand.drawn_height_m || tr.height_m || 6) : (tr.height_m || 6); const seed = 1000 + (+tr.tree_id || 1); const R = rng2(seed + 7);
  const tool = replace && !review; const narrow = W <= 720; const TBL = 36, HEAD = 58, LAB = tool ? 178 : W > 720 ? 290 : W > 560 ? 238 : 198, PADL = 40; /* the notes column gives way first in a narrow window */ const vL = pl + 0.5, vR = st.curb_face_v - 2.4, DEPTH = 3.5;   // the scale is set by the file's curb, so a dragged curb moves inside a still drawing
  const k = Math.min(tool ? 66 : 54, (H - HEAD - TBL - 44) / ((tool ? 5.0 : 6.5) + 1.0 + DEPTH), (W - PADL - LAB - 10) / (vL - vR));   /* the instrument looks at the ground: 5 m of sky at 04, 6.5 m in the drawing */   /* one scale for every tree: the ground and 6.5 m of sky fit the panel; the tree's height never sets the scale */
  if (!(k > 6)) return;                                            // the panel is not laid out yet (a first frame at the pane's own size)
  if (!tool) { const slack = Math.max(0, W - PADL - LAB - 10 - (vL - vR) * k); x0 += slack / 2; W -= slack; }   /* 03: the drawing and its notes sit in the middle of the panel; 04: A–A and B–B share one left edge */
  const below = DEPTH * k; const secW = (vL - vR) * k; const above = H - HEAD - TBL - 44 - below;   /* the sky's room is fixed, so the ground line stays put from tree to tree; a tall crown is clipped at the top */
  const g = el('g', { class: 'card' }); gAll.appendChild(g);
  g.appendChild(el('text', { class: 'ptitle', x: x0, y: y0 + 16 }, 'SECTION A–A' + (Math.abs(app.cutU || 0) >= 0.05 ? ` · ${fmt(Math.abs(app.cutU), 1)} m ${app.cutU > 0 ? 'EAST' : 'WEST'} OF THE TREE` : '')));
  if (replace && !review) g.appendChild(el('text', { class: 'psub swap', x: x0, y: y0 + 34 }, 'DRAG THE HANDLE · DEPTH ↕ · CURB ⟷'));
  g.appendChild(el('text', { class: 'psub' + (cand ? ' swap' : ''), x: x0 + 132 + (Math.abs(app.cutU || 0) >= 0.05 ? 170 : 0), y: y0 + 16 }, cand ? `${cand.common.toUpperCase()} · ${(cand.latin || '').toUpperCase()} · IN PLACE OF ${((tr.species_ref && tr.species_ref.common) || tr.genus || '').toUpperCase()}` : `${(sr.common || tr.genus || '').toUpperCase()} · ${(sr.latin || (tr.genus + ' ' + tr.species)).toUpperCase()}${tr.selected ? '' : app.pending && app.pending.site_id === tr.site_id ? ' · READING ITS GROUND …' : ' · PREVIEW · CLICK TO CHOOSE'}`));
  const sx = x0 + PADL, yG = y0 + HEAD + above; const X = (v) => sx + (vL - v) * k, Z = (z) => yG - z * k;   /* v runs left→right from the property line to the road; z up */
  const svgRoot = $('overlay'); const cid = 'clip-sec'; let cp = svgRoot.querySelector('#' + cid); if (!cp) { cp = el('clipPath', { id: cid }); cp.appendChild(el('rect', { id: cid + '-r' })); svgRoot.querySelector('defs').appendChild(cp); } const cr0 = svgRoot.querySelector('#' + cid + '-r'); cr0.setAttribute('x', sx - 2); cr0.setAttribute('y', y0 + HEAD - 4); cr0.setAttribute('width', secW + 4); cr0.setAttribute('height', above + below + 8);
  const gs = el('g', { 'clip-path': `url(#${cid})` }); g.appendChild(gs);
  // ---- the ground, drawn in the library's language (Landscape Illustration tutorial): a heavy grade line, bodies as bands
  // filled with one of the seven strata patterns, pebbles growing with depth in the native ground, wavy hand-drawn strata
  // lines in the native ground, straight edges on built layers. What each body means is unchanged. ----
  ensureGroundDefs(svgRoot);
  const box = (v0, v1, d0, d1) => { const xa = X(Math.min(v1, vL)), xb = X(Math.max(v0, vR)); return xb > xa && d1 > d0 ? { x: xa, y: Z(-d0), w: xb - xa, h: (d1 - d0) * k } : null; };
  const wash = (v0, v1, d0, d1, cls, pat, op) => { const b = box(v0, v1, d0, d1); if (!b) return null; gs.appendChild(el('rect', { class: cls, x: b.x, y: b.y, width: b.w, height: b.h })); if (pat && GROUND.pat) gs.appendChild(el('rect', { class: 'pat', x: b.x, y: b.y, width: b.w, height: b.h, fill: `url(#pat-${pat})`, opacity: op == null ? .85 : op })); return b; };
  const edge = (v0, v1, d0, d1, cls) => { const b = box(v0, v1, d0, d1); if (b) gs.appendChild(el('rect', { class: cls || 'bodyedge', x: b.x, y: b.y, width: b.w, height: b.h })); };
  const wave = (v0, v1, d, amp, cls) => { const xa = X(Math.min(v1, vL)), xb = X(Math.max(v0, vR)); if (xb <= xa) return; const n = Math.max(2, Math.round((xb - xa) / 70)); const pts = []; for (let i = 0; i <= n; i++) pts.push([xa + (xb - xa) * i / n, Z(-d) + (R() - .5) * 2 * amp]); let dd = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`; for (let i = 1; i < pts.length; i++) { const [px0, py0] = pts[i - 1], [px1, py1] = pts[i]; const cx = (px0 + px1) / 2; dd += `C${cx.toFixed(1)} ${py0.toFixed(1)} ${cx.toFixed(1)} ${py1.toFixed(1)} ${px1.toFixed(1)} ${py1.toFixed(1)}`; } gs.appendChild(el('path', { class: cls || 'stratum', d: dd })); };
  const pebbles = (b, n, dMin) => { if (!b || !GROUND.pebbles.length) return; const placed = []; for (let i = 0; i < n * 3 && placed.length < n; i++) { const t = Math.pow(R(), 0.6); const y = b.y + b.h * (dMin + (1 - dMin) * t), x = b.x + R() * b.w; const j = Math.floor(R() * GROUND.pebbles.length); const [, , vw, vh] = GROUND.pebbles[j].vb.split(/\s+/).map(Number); const w = (0.09 + 0.4 * t * t) * k * (0.75 + R() * 0.5), hh = w * vh / vw; if (x - w / 2 < b.x + 2 || x + w / 2 > b.x + b.w - 2 || y + hh / 2 > b.y + b.h - 2) continue; if (placed.some(([qx, qy, qr]) => Math.hypot(qx - x, qy - y) < qr + w * 0.75)) continue; placed.push([x, y, w * 0.75]); gs.appendChild(el('use', { class: 'peb', href: '#peb-' + j, x: x - w / 2, y: y - hh / 2, width: w, height: hh, transform: `rotate(${((R() - .5) * 50).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})` })); } };
  const sw = st.sidewalk_v, bb = st.back_boulevard_v; const boc = curb + curbW; const zD = zs ? (zs.depth_m || bd.depth_m) : 0; const soilPat = SOIL_PAT[live.soil] || 'p4';
  // the sky: the library's hairlines, faint; the trees and figures stand white against it
  gs.appendChild(el('rect', { class: 'sky', x: sx - 2, y: y0 + HEAD - 4, width: secW + 4, height: above + 4, fill: 'url(#pat-sky)' }));
  // native ground (nobody publishes it): coarse stipple, two strata lines, pebbles that grow with depth
  const bN = wash(vR, vL, 0, DEPTH, 'native', 'p3', .9);     // the tutorial's deepest band: fine stipple, pebbles growing with depth wave(vR, vL, 1.3, 3); wave(vR, vL, 2.45, 4); pebbles(bN, Math.round(bN.w / 12), 0.3);
  // topsoil under turf, yard and back boulevard: fine stipple, a wavy base
  wash(pl, vL, 0, 0.22, 'topsoil', 'p3', .9); wave(pl, vL, 0.22, 1.2); if (bb) { wash(bb[0], bb[1], 0, 0.22, 'topsoil', 'p3', .9); wave(bb[0], bb[1], 0.22, 1.2); }
  // the growing medium the rule credits (0.90 m, the knob): grain; the credited part keeps the dusty green wash under the same grain
  const strips = B.strips || []; const iv = strips.filter((sp) => uCut >= sp.u0 && uCut <= sp.u1).map((sp) => [Math.max(sp.v0, bd.v_from), Math.min(sp.v1, bd.v_to)]).filter((a) => a[1] > a[0]).sort((a, b) => a[0] - b[0]);
  let cutTop = bd.v_from; for (const [a, b] of iv) { if (a <= cutTop + 0.02) cutTop = Math.max(cutTop, b); else break; } cutTop = Math.min(cutTop, bd.v_to);
  const inSeg = (B.segments || []).some((sg) => tr.u >= sg.u_from && tr.u <= sg.u_to);
  { wash(bd.v_from, bd.v_to, 0, bd.depth_m, 'medium', soilPat, .5); if (inSeg && cutTop < bd.v_to) wash(cutTop, bd.v_to, 0, bd.depth_m, 'credited', soilPat, .5); edge(bd.v_from, bd.v_to, 0, bd.depth_m);
    if (cutTop > bd.v_from) { const xa = X(cutTop), xb = X(bd.v_from); gs.appendChild(el('path', { class: 'clearedge', d: `M${xa} ${Z(0)}V${Z(-bd.depth_m)}H${xb}V${Z(0)}` })); } }
  // the sidewalk as the City builds it (G9.2): slab left blank, granular base as pebbles in fines, filter fabric, engineered soil as the compacted weave, scarified native
  if (sw) { wash(sw[0], sw[1], 0, 0.1, 'slab'); wash(sw[0], sw[1], 0.1, 0.2, 'base', 'p1', .8); edge(sw[0], sw[1], 0.1, 0.2);
    if (zs) { wash(zs.v_from, zs.v_to, 0.2, 0.2 + zD, 'engineered', 'p2', .5); edge(zs.v_from, zs.v_to, 0.2, 0.2 + zD); gs.appendChild(el('line', { class: 'fabric', x1: X(zs.v_to), y1: Z(-0.2), x2: X(zs.v_from), y2: Z(-0.2) })); for (let v = zs.v_from + 0.15; v < zs.v_to; v += 0.3) gs.appendChild(el('line', { class: 'scar', x1: X(v), y1: Z(-(0.2 + zD)), x2: X(v), y2: Z(-(0.2 + zD + 0.07)) })); } }
  // the curb and the road: asphalt as the densest fines on a granular base (typical)
  wash(curb, boc, -0.15, 0.45, 'slab'); { wash(vR, curb, 0, 0.1, 'asphalt', 'p5', .9); wash(vR, curb, 0.1, 0.4, 'base', 'p1', .8); edge(vR, curb, 0, 0.4); }
  // the mains that cross this section, each in its trench (G4.4: bedding, backfill), the private corridors at nominal cover
  const items = []; const crossings = [];
  for (const f of S.facilities) { if (!f.path_uv || f.path_uv.length < 2 || f.kind === 'corridor') continue; const pts = f.path_uv; let hit = null;
    for (let i = 0; i + 1 < pts.length && !hit; i++) { const [au, av] = pts[i], [bu, bv] = pts[i + 1]; if ((au - uCut) * (bu - uCut) <= 0 && au !== bu) hit = av + (bv - av) * (uCut - au) / (bu - au); }
    if (hit == null) { const du = Math.abs(pts[0][0] - pts[pts.length - 1][0]), dv = Math.abs(pts[0][1] - pts[pts.length - 1][1]); if (dv > 3 && du < 1.5 && Math.abs(pts[0][0] - uCut) < 2.5 && f.depth_top_m != null) { const v0 = Math.min(pts[0][1], pts[pts.length - 1][1]), v1 = Math.max(pts[0][1], pts[pts.length - 1][1]); crossings.push({ f, bar: [v0, v1], rr: Math.max(0.1, (f.diameter_mm || 0) / 2000) }); } continue; }
    if (hit < vR || hit > vL) continue; crossings.push({ f, v: hit, rr: Math.max(0.12, (f.diameter_mm || 0) / 2000) }); }
  for (const c of crossings) { const f = c.f; if (f.depth_top_m == null || c.bar || f.grade === 'nominal') continue; const Be = 2 * c.rr; const d0 = c.v < curb ? 0.1 : 0.0, dBot = f.depth_top_m + Be + 0.15; if (dBot > DEPTH) continue; const hw = Be / 2 + 0.3;
    wash(c.v - hw, c.v + hw, d0, dBot, 'backfill', 'p6', .6); wash(c.v - hw, c.v + hw, f.depth_top_m + Be / 2, dBot, 'bedding', 'p1', .7);
    gs.appendChild(el('path', { class: 'trench', d: `M${X(c.v + hw)} ${Z(-d0)}V${Z(-dBot)}H${X(c.v - hw)}V${Z(-d0)}` })); c.trench = true; }
  for (const c of crossings) { const f = c.f; const short = f.label.split(' · ')[0].toUpperCase();
    if (c.bar) { const b = wash(c.bar[0], c.bar[1], f.depth_top_m, f.depth_top_m + 2 * c.rr, 'pipe bar'); items.push({ v: (c.bar[0] + c.bar[1]) / 2, z: -(f.depth_top_m + c.rr), t: `${short} · ${fmt(f.depth_top_m, 2)} m` }); continue; }
    if (f.depth_top_m != null) { const zc = -(f.depth_top_m + c.rr); if (-zc > DEPTH) continue; gs.appendChild(el('circle', { class: 'pipe ' + f.grade, cx: X(c.v), cy: Z(zc), r: Math.max(4, c.rr * k) })); if (c.rr * k > 9) gs.appendChild(el('circle', { class: 'pipein', cx: X(c.v), cy: Z(zc), r: c.rr * k * 0.78 })); items.push({ v: c.v, z: zc, t: `${short.replace('WATER ', '')}${f.diameter_mm ? ' Ø' + f.diameter_mm : ''} · ${fmt(f.depth_top_m, 2)} m · ${f.grade.toUpperCase()}` }); }
    else { gs.appendChild(el('rect', { class: 'unknown', x: X(c.v) - 5, y: Z(-0.2), width: 10, height: 2.5 * k })); items.push({ v: c.v, z: -1.5, t: `${short} · NO DEPTH` }); } }
  for (const c of S.corridors || []) { const v0 = Math.max(c.corridor_v[0], vR), v1 = Math.min(c.corridor_v[1], vL); if (v1 <= v0) continue; gs.appendChild(el('line', { class: 'corridor', x1: X(v1), y1: Z(-c.depth_top_m), x2: X(v0), y2: Z(-c.depth_top_m) })); }
  if (S.corridors && S.corridors.length) items.push({ v: (bd.v_from + bd.v_to) / 2, z: -Math.min(...S.corridors.map((c) => c.depth_top_m)), t: `${S.corridors.map((c) => c.utility.toUpperCase()).join(' · ')} · POSITION NOT PUBLISHED`, cls: 'nominal' });
  // the roots, in the credited soil only, cut where it ends
  const form = (cand && cand.roots && cand.roots.form) || (tr.roots && tr.roots.form) || 'heart';
  { const inside = (v, z) => z <= -0.04 && ((inSeg && v >= cutTop && v <= bd.v_to && z >= -bd.depth_m) || (zs && v >= zs.v_from && v <= zs.v_to && z <= -0.2 && z >= -(0.2 + zD)));
    const rl = rootsSection(tr.v, form, inside, seed); const byW = new Map(); for (const [v0, z0, v1, z1, w] of rl.segs) { const key = Math.max(0.3, Math.round(w * 4) / 4); if (!byW.has(key)) byW.set(key, []); byW.get(key).push(`M${X(v0).toFixed(1)} ${Z(z0).toFixed(1)}L${X(v1).toFixed(1)} ${Z(z1).toFixed(1)}`); }
    const heavy = [...byW.entries()].filter(([w]) => w >= 0.9).sort((a, b) => b[0] - a[0]), fine = [...byW.entries()].filter(([w]) => w < 0.9).sort((a, b) => a[0] - b[0]);
    for (const [w, d] of fine) gs.appendChild(el('path', { class: 'root', 'stroke-width': Math.max(.4, w * 0.8), 'stroke-opacity': w < 0.5 ? .35 : .6, d: d.join('') }));   // the fine roots recede; the library draws few, clear roots
    for (const [w, d] of heavy) gs.appendChild(el('path', { class: 'rootink', 'stroke-width': w + 1.8, d: d.join('') }));
    for (const [w, d] of heavy) gs.appendChild(el('path', { class: 'rootpaper', 'stroke-width': w + 0.2, d: d.join('') }));
    if (rl.cut.length) gs.appendChild(el('path', { class: 'rootcut', d: rl.cut.map(([a, b, c, d]) => `M${X(a).toFixed(1)} ${Z(b).toFixed(1)}L${X(c).toFixed(1)} ${Z(d).toFixed(1)}`).join('') })); }
  // the ground line, grass on the band, the tree, a person for scale
  g.appendChild(el('line', { class: 'grade', x1: X(vL), y1: Z(0), x2: X(vR), y2: Z(0) }));
  { const d = []; for (let v = bd.v_from + 0.06; v < bd.v_to; v += 0.09) { const x = X(v); const hh = 3 + R() * 5; d.push(`M${x.toFixed(1)} ${Z(0)}l${((R() - .5) * 3).toFixed(1)} ${(-hh).toFixed(1)}`); } gs.appendChild(el('path', { class: 'grass', d: d.join('') })); if (bb) { const d2 = []; for (let v = bb[0] + 0.05; v < bb[1]; v += 0.1) d2.push(`M${X(v).toFixed(1)} ${Z(0)}l${((R() - .5) * 2).toFixed(1)} ${(-(2 + R() * 3)).toFixed(1)}`); for (let v = pl + 0.05; v < vL; v += 0.1) d2.push(`M${X(v).toFixed(1)} ${Z(0)}l${((R() - .5) * 2).toFixed(1)} ${(-(2 + R() * 3)).toFixed(1)}`); gs.appendChild(el('path', { class: 'grass', d: d2.join('') })); } }
  const crownD = cand ? +(h * (cand.crown_ratio_of_height || 0.6)).toFixed(1) : (tr.crown_diameter_m || 3); const cr = crownD / 2;
  if (cand && tr.height_m) { const gg = el('g', { class: 'ghost' }); treeSection(gg, X, Z, k, tr.v, tr.height_m, (tr.crown_diameter_m || 3) / 2, tr.species_ref && tr.species_ref.form); gs.appendChild(gg); }   // the City's tree stays as a ghost behind the card's
  treeSection(gs, X, Z, k, tr.v, h, cr, sr.form);     // the whole tree at City height (a card: the species' City p90), the crown at its nominal spread; roots below share the trunk base
  if (sw && GROUND.person) { const [, , vw, vh] = GROUND.person.vb.split(/\s+/).map(Number); const hP = 1.7 * k, wP = hP * vw / vh; const px = X((sw[0] + sw[1]) / 2) + 0.4 * k; gs.appendChild(el('use', { class: 'fig', href: '#fig-person', x: px - wP / 2, y: Z(0) - hP, width: wP, height: hP })); }
  // the depth scale on the left, the height mark
  for (let m = 0; m <= DEPTH; m++) { g.appendChild(el('line', { class: 'tick', x1: sx - 8, y1: Z(-m), x2: sx - 2, y2: Z(-m) })); g.appendChild(el('text', { class: 's', x: sx - 11, y: Z(-m) + 3.5, 'text-anchor': 'end' }, m + '')); }
  g.appendChild(el('text', { class: 's grey', x: sx - 11, y: Z(-DEPTH) + 16, 'text-anchor': 'end' }, 'm'));
  if (Z(h) > y0 + HEAD) { const hy = Z(h); const sd = sx - x0 > 96 ? -1 : 1;   /* the height on the trunk's left, or on its right when the left would run under the panel */ g.appendChild(el('line', { class: 'tick', x1: sx + sd * 8, y1: hy, x2: sx + sd * 2, y2: hy })); g.appendChild(el('line', { class: 'hdim', x1: sx + sd * 5, y1: hy, x2: sx + sd * 5, y2: Z(0) })); g.appendChild(el('text', { class: 's', x: sx + sd * 11, y: hy + 3.5, 'text-anchor': sd < 0 ? 'end' : 'start' }, `${fmt(h)} m`)); g.appendChild(el('text', { class: 's grey', x: sx + sd * 11, y: hy + 15, 'text-anchor': sd < 0 ? 'end' : 'start' }, cand ? 'CITY P90' : 'CITY RECORD')); }
  // zone pills above the ground: the street's parts, named
  // in replace, two pills are choosers (a caret, the accent, a row higher so they never collide): the sidewalk's land-use row and the band's soil type
  const pillW = (t, pick) => t.length * 6.4 + 12 + (pick ? 14 : 0);
  /* the zone string under the ground: one line with a tick at every zone edge, the width (or a short name) on one baseline, the long name below it where it fits; the band's name is the soil chooser */
  const yStr = Z(-DEPTH) + 12;
  const pill2 = (v0, v1, t, pick, dx = 0, row = 0) => { const a = X(Math.min(v1, vL)), b = X(Math.max(v0, vR)); if (b - a < 6) return; const m = t.match(/(\d+\.\d+)/); const num = m ? m[1] : null; const name = t.replace(/\s*\d+\.\d+\s*/, ' ').replace(/\s*·\s*$/, '').replace(/^\s*·\s*/, '').trim(); const cx2 = (a + b) / 2;
    const gp = el('g', { class: 'zpill' + (pick ? ' pick' : '') });
    gp.appendChild(el('path', { class: 'chain', d: `M${a.toFixed(1)} ${yStr - 4}V${yStr + 2}M${a.toFixed(1)} ${yStr - 1}H${b.toFixed(1)}M${b.toFixed(1)} ${yStr - 4}V${yStr + 2}` }));
    const line1 = num || name; const w1 = line1.length * 6.4; if (w1 <= b - a + 26) gp.appendChild(el('text', { x: cx2, y: yStr + 14, 'text-anchor': 'middle' }, line1));
    if (num && name) { const label = name + (pick ? ' ▾' : ''); const w2 = label.length * 6.4; if (w2 <= b - a + 30) { const tx = el('text', { class: 'name', x: cx2, y: yStr + 27, 'text-anchor': 'middle' }, label); gp.appendChild(tx); if (pick) { gp.addEventListener('click', (e) => { e.stopPropagation(); pick(cx2 - w2 / 2, yStr + 32); }); } } }
    g.appendChild(gp); };
  pill2(pl, vL, 'P/L'); if (bb) pill2(bb[0], bb[1], fmt(st.widths_m.back_boulevard, 2));
  const tSw = sw ? `SIDEWALK ${fmt(st.widths_m.sidewalk_clear, 2)}` + (replace ? ` · ${LAND_SHORT[live.land_use] || live.land_use}` : '') : '', tBd = `THE BAND ${fmt(bd.v_to - bd.v_from, 2)}` + (replace ? ` · ${SOIL_SHORT[live.soil] || live.soil}` : '');
  let dxBd = 0, rowBd = 0; if (sw && replace) { const cS = (X(Math.min(sw[1], vL)) + X(Math.max(sw[0], vR))) / 2, cB = (X(Math.min(bd.v_to, vL)) + X(Math.max(bd.v_from, vR))) / 2; const over = cS + pillW(tSw, true) / 2 + 8 - (cB - pillW(tBd, true) / 2); if (over > 0) { if (W > 720) dxBd = over; else rowBd = 1; } }
  if (sw) pill2(sw[0], sw[1], tSw, null);                                                                   // land use is rule context: it lives in the panel's Advanced block, the pill is a label
  pill2(bd.v_from, bd.v_to, tBd, replace && !review && !app.busy ? (x, y) => soilMenu(x, y, live) : null, dxBd, rowBd); pill2(vR, curb, 'ROAD');   // the soil pill stays a chooser, second to the field
  // notes on the paper to the right, in depth order, each with a level leader to its thing
  const lx = sx + secW + 44; items.sort((a, b) => b.z - a.z); let ly = Z(0) + 6; const notes = [];
  const lab = (z, v, t, cls) => { const y = Math.max(Z(z), ly); const lines = wrap(t, LAB > 230 ? 46 : LAB > 190 ? 36 : 29); notes.push({ z, v, y, lines, cls }); ly = y + lines.length * 12 + 4; };
  { const cy0 = Math.max(y0 + HEAD + 12, Z(h * 0.72)); g.appendChild(el('path', { class: 'll', d: `M${(X(tr.v) + cr * k).toFixed(1)} ${cy0.toFixed(1)}H${lx - 22}H${lx - 4}` })); g.appendChild(el('text', { class: 's', x: lx, y: cy0 + 3.5 }, `CROWN ${fmt(crownD)} m · ${(sr.form || 'form').toUpperCase()} · NOMINAL`)); }
  if (replace) lab(-0.15, curb, review ? `CURB ${fmt(curb - cl, 1)} m FROM ℄` : app.drag && app.drag.kind === 'curb' ? `CURB ${fmt(curb - cl, 1)} m · LET GO → THE RULE RUNS` : `CURB ${fmt(curb - cl, 1)} m FROM ℄ ⟷`, 'ctl');
  if (zs) lab(-(0.2 + zD) / 2 - 0.1, (zs.v_from + zs.v_to) / 2, `UNDER THE SLAB · ${fmt(zD, 2)} m${zs.credited_m3 != null ? ' · ' + fmt(zs.credited_m3) + ' m³' : ''} · ASSUMED`, 'zone');
  if (inSeg && cutTop < bd.v_to) lab(-bd.depth_m / 2, (cutTop + bd.v_to) / 2, `CREDITED SOIL · ${fmt(bd.depth_m, 2)} m${tr.share_m3 != null ? ' · ' + fmt(tr.share_m3) + ' m³' : ''}`, 'soil');
  if (replace) lab(-bd.depth_m, bd.v_from + 0.25, review ? `DEPTH ${fmt(bd.depth_m, 2)} m` : app.drag && app.drag.kind === 'depth' ? `DEPTH ${fmt(bd.depth_m, 2)} m · LET GO → THE RULE RUNS` : `DEPTH ${fmt(bd.depth_m, 2)} m ↕`, 'ctl');
  if (cutTop > bd.v_from) { const sp = strips.find((x) => uCut >= x.u0 && uCut <= x.u1); lab(-bd.depth_m * 0.7, (bd.v_from + cutTop) / 2, `NOT CREDITED · ${sp && sp.clearance_m ? fmt(sp.clearance_m, 1) + ' m ' : ''}CLEARANCE`, 'red'); }
  if (!tool) { for (const it of items) lab(it.z, it.v, it.t, it.cls || ''); lab(-bd.depth_m * 0.45, tr.v + 1.0, `ROOTS · ${form.toUpperCase()} · NOMINAL`, 'grey'); lab(-DEPTH + 0.6, (vL + vR) / 2, 'NATIVE GROUND · NOT PUBLISHED', 'grey'); }   /* 04 is the instrument: the ground's explanation stays in 03 */
  /* the notes column, in depth order; when a tall tree leaves little ground the whole column lifts so it ends inside the panel (every leader then climbs at the same slope) */
  const ty = y0 + H - TBL + 10;
  { const lift = Math.max(0, ly + 2 - (ty - 16)); const xc = lx - 22; for (const n of notes) { const y = n.y - lift; g.appendChild(el('path', { class: 'll ' + (n.cls === 'ctl' ? 'ctl' : ''), d: `M${X(n.v).toFixed(1)} ${Z(n.z).toFixed(1)}H${xc}V${y.toFixed(1)}H${lx - 4}` })); n.lines.forEach((l, i) => g.appendChild(el('text', { class: 's ' + (n.cls || ''), x: lx, y: y + 3.5 + i * 12 }, l))); } }
  // 3 replace: the two handles on the drawing itself — the curb face (drag across) and the band's depth (drag up and down);
  // while the engine runs they rest. A dragged or armed species card lights the tree as the drop target.
  if (replace && !review) {
    const busy = app.busy;
    /* the curb is a site fact (A · WHAT IS HERE): no handle on it; a measurement with evidence corrects it there */
    const yd = Z(-bd.depth_m); const xa = X(Math.min(bd.v_to, vL)), xb = X(Math.max(bd.v_from, vR)); const xg = xb + 14;   /* the grip sits off the band's road-side end: a narrow band holds a main where the grip used to be */
    const gd = el('g', { class: 'shandle depth' + (app.drag && app.drag.kind === 'depth' ? ' live' : '') });
    gd.appendChild(el('line', { class: 'hunder', x1: xa, y1: yd, x2: xb, y2: yd })); gd.appendChild(el('line', { class: 'hline', x1: xa, y1: yd, x2: xb, y2: yd }));
    gd.appendChild(el('circle', { cx: xg, cy: yd, r: 8 })); gd.appendChild(el('path', { class: 'arrow', d: `M${xg} ${yd - 14}v-9m-3 3 3-3 3 3M${xg} ${yd + 14}v9m-3-3 3 3 3-3` }));
    if (!busy) gd.addEventListener('pointerdown', (e) => startDrag(e, 'depth', k)); g.appendChild(gd);
    if (app.dragCard || app.armed) { const x1 = X(tr.v) - Math.max(cr * k, 40) - 14, x2 = X(tr.v) + Math.max(cr * k, 40) + 14; g.appendChild(el('rect', { class: 'dropzone hot', x: x1, y: Z(h) - 14, width: x2 - x1, height: Z(-bd.depth_m) - Z(h) + 14, rx: 6 })); g.appendChild(pill(X(tr.v), Z(h) - 30, app.dragCard ? 'DROP THE SPECIES HERE' : 'CLICK HERE TO PLANT IT', true)); }
  }
}
// SECTION B–B · along the band, looking from the road: the selected tree in its cell with its neighbours and theirs, the houses behind,
// the soil the rule credits as one trough, the share a main's clearance takes (red), the need-box as a length, the mains that cross
function longSection(gAll, sc, S, tr, x0, y0, W, H) {
  const bd = S.band.design; if (!bd) return; const sl = sc.slab; const u0 = sl.u0 - 8, u1 = sl.u1 + 8; const cand = candidateShown(S); const live = liveKnobs(S);
  const inR = (u) => u >= u0 && u <= u1; const trees = S.trees.filter((t) => inR(t.u)); const houses = (S.buildings || []).filter((b) => { const us = b.ring_uv.map((q) => q[0]); return Math.max(...us) > u0 && Math.min(...us) < u1; });
  const hmax = Math.max(6, ...trees.map((t) => t.height_m || 4), cand ? cand.drawn_height_m || 6 : 0); const DEPTH = Math.max(1.4, live.depth + 0.5);
  const PADL = 40, HEAD = 44, FOOT = 28; const k = Math.min(26, (H - HEAD - FOOT) / (hmax + 0.8 + DEPTH), (W - PADL - 16) / (u1 - u0)); if (!(k > 2)) return;
  const X = (u) => x0 + PADL + (u - u0) * k; const yG = y0 + HEAD + (hmax + 0.8) * k; const Z = (z) => yG - z * k;
  const g = el('g', { class: 'card lsec' }); gAll.appendChild(g);
  g.appendChild(el('text', { class: 'ptitle', x: x0, y: y0 + 16 }, 'SECTION B–B'));
  const subs = ['ALONG THE BAND · THIS TREE, ITS NEIGHBOURS AND THEIR CELLS · THE CREDITED SOIL AND WHAT THE MAINS TAKE', 'ALONG THE BAND · NEIGHBOURS, CELLS, CREDITED SOIL, MAINS', 'ALONG THE BAND'];
  g.appendChild(el('text', { class: 'psub', x: x0 + 132, y: y0 + 16 }, subs.find((t) => t.length * 6.6 <= W - 140) || subs[2]));   /* the subtitle never runs under the right panel */
  const svgRoot = $('overlay'); let cp = svgRoot.querySelector('#clip-lsec'); if (!cp) { cp = el('clipPath', { id: 'clip-lsec' }); cp.appendChild(el('rect', { id: 'clip-lsec-r' })); svgRoot.querySelector('defs').appendChild(cp); } const cr0 = svgRoot.querySelector('#clip-lsec-r'); cr0.setAttribute('x', x0 + PADL - 2); cr0.setAttribute('y', y0 + HEAD - 4); cr0.setAttribute('width', (u1 - u0) * k + 4); cr0.setAttribute('height', (hmax + 0.8 + DEPTH) * k + 8);
  const gs = el('g', { 'clip-path': 'url(#clip-lsec)' }); g.appendChild(gs);
  gs.appendChild(el('rect', { class: 'sky', x: X(u0), y: y0 + HEAD - 4, width: (u1 - u0) * k, height: (hmax + 0.8) * k + 4, fill: 'url(#pat-sky)' }));
  for (const b of houses) { const us = b.ring_uv.map((q) => q[0]); const a = Math.max(u0, Math.min(...us)), e = Math.min(u1, Math.max(...us)); const hh = Math.min(hmax, b.height_m || 7); if (e - a < 1) continue; const ridge = Math.min(2.6, Math.max(1.2, (e - a) * 0.22)); gs.appendChild(el('path', { class: 'house-el', d: `M${X(a)} ${Z(0)}V${Z(hh)}L${X((a + e) / 2)} ${Z(hh + ridge)}L${X(e)} ${Z(hh)}V${Z(0)}Z` })); }   /* one silhouette per house: wall and gable in a single faint outline */
  /* the trough: the growing medium along the row; per metre the share a clearance takes from its width is drawn red at the bottom */
  const strips = S.band.strips || []; const cutTop = (u) => { const iv = strips.filter((sp) => u >= sp.u0 && u <= sp.u1).map((sp) => [Math.max(sp.v0, bd.v_from), Math.min(sp.v1, bd.v_to)]).filter((a) => a[1] > a[0]).sort((a, b) => a[0] - b[0]); let top = bd.v_from; for (const [a, b] of iv) { if (a <= top + 0.02) top = Math.max(top, b); else break; } return Math.min(top, bd.v_to); };
  const inSeg = (u) => (S.band.segments || []).some((sg) => u >= sg.u_from && u <= sg.u_to); const bw = bd.v_to - bd.v_from;
  for (let u = u0; u < u1; u += 0.5) { const ue = Math.min(u1, u + 0.5); if (!inSeg(u)) { gs.appendChild(el('rect', { class: 'medium', x: X(u), y: Z(0), width: (ue - u) * k + 0.5, height: live.depth * k })); continue; } const frac = Math.max(0, Math.min(1, (cutTop(u) - bd.v_from) / bw)); gs.appendChild(el('rect', { class: 'credited', x: X(u), y: Z(0), width: (ue - u) * k + 0.5, height: live.depth * k })); if (frac > 0.01) gs.appendChild(el('rect', { class: 'cutshare', x: X(u), y: Z(-live.depth * (1 - frac)), width: (ue - u) * k + 0.5, height: live.depth * frac * k })); }
  gs.appendChild(el('rect', { class: 'bodyedge', x: X(u0), y: Z(0), width: (u1 - u0) * k, height: live.depth * k }));
  gs.appendChild(el('rect', { class: 'native', x: X(u0), y: Z(-live.depth), width: (u1 - u0) * k, height: (DEPTH - live.depth) * k, opacity: .5 }));
  /* the cells, each tree's length of band; the selected tree's cell outlined */
  for (const t of trees) { const c = t.cell; if (!c || c.u_from == null) continue; for (const u of [c.u_from, c.u_to]) gs.appendChild(el('line', { class: 'cell' + (t.selected ? ' sel' : ''), x1: X(u), y1: Z(0.4), x2: X(u), y2: Z(-live.depth) })); gs.appendChild(el('text', { class: 'z', x: X((c.u_from + c.u_to) / 2), y: Z(0) - 5, 'text-anchor': 'middle' }, `${fmt(c.u_to - c.u_from, 1)} m`)); }
  /* the mains that cross the band, at the u where they cross it */
  const vm = (bd.v_from + bd.v_to) / 2;
  for (const f of S.facilities || []) { if (!f.path_uv || f.path_uv.length < 2 || f.kind === 'corridor' || f.depth_top_m == null) continue; const pts = f.path_uv; let hit = null; for (let i = 0; i + 1 < pts.length && hit == null; i++) { const [au, av] = pts[i], [bu, bv] = pts[i + 1]; if ((av - vm) * (bv - vm) <= 0 && av !== bv) hit = au + (bu - au) * (vm - av) / (bv - av); } if (hit == null || !inR(hit)) continue; const rr = Math.max(0.12, (f.diameter_mm || 0) / 2000); const zc = -(f.depth_top_m + rr); if (-zc > DEPTH) continue; gs.appendChild(el('circle', { class: 'pipe ' + (f.grade || 'record'), cx: X(hit), cy: Z(zc), r: Math.max(3, rr * k) })); }
  /* the need-box as a length of the band */
  const cb = (S.candidate && S.candidate.box) || (S.need && S.need.box);
  if (cb && cb.u0 != null) { const cut = !!(cb.conflicts && cb.conflicts.length); gs.appendChild(el('rect', { class: 'needbox' + (cut ? ' cut' : '') + (app.hotNeed ? ' hot' : ''), x: X(cb.u0), y: Z(0), width: (cb.u1 - cb.u0) * k, height: (cb.depth_m || live.depth) * k })); const r = resultFor(S); const bh = (cb.depth_m || live.depth) * k; const nbTxt = `NEED-BOX ${fmt(cb.length_m)} m${r.required != null ? ' · ' + r.required + ' m³' : ''}${cut ? ' · CUT' : ''}`; const fits = bh >= 16 && (cb.u1 - cb.u0) * k >= nbTxt.length * 6.6 + 10; gs.appendChild(el('text', { class: 's ctl', x: X((cb.u0 + cb.u1) / 2), y: fits ? Z(-(cb.depth_m || live.depth) / 2) + 4 : Z(0) - 17, 'text-anchor': 'middle' }, nbTxt)); }
  /* the trees along the row: the neighbours as ghosts, this tree in ink (the card's tree over the City's ghost) */
  g.appendChild(el('line', { class: 'grade', x1: X(u0), y1: Z(0), x2: X(u1), y2: Z(0) }));
  const labels = [];
  for (const t of trees) { const sr = t.species_ref || {}; const h = t.height_m || 6; const crR = (t.crown_diameter_m || 3) / 2; if (t.selected) { if (cand) { const gg = el('g', { class: 'ghost' }); treeSection(gg, X, Z, k, t.u, h, crR, sr.form); gs.appendChild(gg); treeSection(gs, X, Z, k, t.u, cand.drawn_height_m || h, (cand.drawn_height_m || h) * (cand.crown_ratio_of_height || 0.6) / 2, cand.form); } else treeSection(gs, X, Z, k, t.u, h, crR, sr.form); }
    else { const gg = el('g', { class: 'ghost' }); treeSection(gg, X, Z, k, t.u, h, crR, sr.form); gs.appendChild(gg); }
    labels.push({ u: t.u, sel: t.selected, txt: `${(sr.common || t.genus || '').toUpperCase().slice(0, 22)}${t.selected && cand ? ' → ' + cand.common.toUpperCase().slice(0, 22) : ''}` }); }
  /* the names under the row: a name that would run into its neighbour drops to a second line */
  labels.sort((a, b) => a.u - b.u); let lastR = [-1e9, -1e9];
  for (const L of labels) { const w = L.txt.length * 6.3; const x = Math.max(X(u0) + w / 2, Math.min(X(u1) - w / 2, X(L.u))); const row = x - w / 2 >= lastR[0] + 6 ? 0 : x - w / 2 >= lastR[1] + 6 ? 1 : 0; lastR[row] = x + w / 2; g.appendChild(el('text', { class: 's' + (L.sel ? '' : ' grey'), x, y: Z(-DEPTH) + 14 + row * 12, 'text-anchor': 'middle' }, L.txt)); }
  for (let m = 0; m <= Math.floor(DEPTH); m++) { g.appendChild(el('line', { class: 'tick', x1: x0 + PADL - 8, y1: Z(-m), x2: x0 + PADL - 2, y2: Z(-m) })); g.appendChild(el('text', { class: 's', x: x0 + PADL - 11, y: Z(-m) + 3.5, 'text-anchor': 'end' }, m + '')); }
  g.appendChild(el('text', { class: 's grey', x: x0 + PADL, y: y0 + HEAD - 8 }, 'ROAD SIDE'));   /* the viewer's side, named at the strip's top left, clear of the cell lengths */
}
// the two tables under the section, as rows (the sheet's PDF prints the same rows): the tree, and the soil and space at it
function treeRows(S, tr, cand, o) {
  const sr = cand || tr.species_ref || {}; const lib = S.library; const req = cand ? (cand.required_m3 != null ? cand.required_m3 : cand.volume_m3 && lib && lib.condition ? cand.volume_m3[lib.condition] : null) : tr.required_m3;
  const haveC = cand && cand.usable_m3 != null ? cand.usable_m3 : o.have; const fits = cand ? ('fits' in cand ? cand.fits : null) : (o.have != null && req != null ? o.have >= req : null);
  const cls2 = cand ? (cand.listed ? cand.class : null) : (tr.table_9_3 && tr.table_9_3.class) || o.live.target || '—';
  const t1 = { title: cand ? 'THE TREE · A CARD IN THIS CELL' : tr.selected ? 'THE TREE · SELECTED' : 'THE TREE · PREVIEW', rows: [
    ['SPECIES', `${sr.common || tr.genus} · ${sr.latin || (tr.genus + ' ' + tr.species)}`], ['HEIGHT', cand ? `${fmt(o.h)} m · City p90 of ${sr.city_count != null ? sr.city_count.toLocaleString() : '—'} trees` : `${fmt(tr.height_m)} m · City record`],
    ['TABLE 9-3 CLASS', o.listed ? (cand ? cand.class : tr.table_9_3.class) : 'not listed · no class'], ['CROWN', `${fmt(o.crownD)} m · ${sr.form || '—'} · nominal`], ['ROOTS', `${o.form} form · nominal`],
    cand ? ['IN PLACE OF', `${(tr.species_ref && tr.species_ref.common) || tr.genus} · ${fmt(tr.height_m)} m`] : ['PLANTED', tr.install_date ? tr.install_date.slice(0, 4) : '—'], ['CITY TREES OF THIS SPECIES', sr.city_count != null ? sr.city_count.toLocaleString() : '—']] };
  const t2 = { title: 'SOIL & SPACE · AT THIS TREE', rows: [
    ['ITS CELL OF THE BAND', tr.cell && tr.cell.u_from != null ? `${fmt(tr.cell.u_to - tr.cell.u_from, 2)} m long` : '—'], ['GROWING MEDIUM', `${fmt(o.bd.v_to - o.bd.v_from, 2)} m wide · ${fmt(o.bd.depth_m, 2)} m deep · ${(o.live.soil || '').replace('_', ' ')}`], ['IN THE CELL', tr.share_m3 != null ? `${fmt(tr.share_m3)} m³` : 'not known'],
    ['UNDER THE SLAB · G9.2', o.zs && o.zs.credited_m3 != null ? `${fmt(o.zs.credited_m3)} m³ · engineered soil, assumed` : '—'], ['CLEARANCE CUT', o.strip ? `${fmt(o.strip.clearance_m, 1)} m · ${(o.strip.dataset || o.strip.kind).replace(/-/g, ' ')}` : 'none at this tree'],
    ['REQUIRED', req != null ? `${req} m³ · Table 9-2, shared row, ${cls2}` : cand && !cand.listed ? 'not in Table 9-3 · no box' : '—'],
    ['MEETS REQUIREMENT', resultLine(resultFor(S)).toLowerCase().replace(/^(yes|not yet|manual review|not known|not in table 9-3 · no box|running the rule …)/, (m) => m.toUpperCase()), { yes: 'yes', no: 'no' }[resultFor(S).state] || '']] };
  return { t1, t2 };
}
// 3 replace · a handle on the section: the curb face moves across (its offset from the centreline), the band's depth moves down; the engine runs when the pointer lets go
function startDrag(e, kind, k) {
  e.preventDefault(); e.stopPropagation(); const S = app.S, st = S.street, bd = S.band.design; const x0 = e.clientX, y0 = e.clientY;
  const file = kind === 'curb' ? st.curb_face_v - st.centreline_v : bd.depth_m; const v0 = kind === 'curb' ? (app.pending && app.pending.curb != null ? app.pending.curb : file) : (app.pending && app.pending.depth != null ? app.pending.depth : file);
  app.drag = { kind, value: v0 }; closeMenu();
  const move = (ev) => {
    if (kind === 'curb') app.drag.value = +Math.max(3, file - 2.0, Math.min(st.property_line_v - st.centreline_v - 3.5, v0 - (ev.clientX - x0) / k)).toFixed(1);   // across: +x on the section is towards the road, i.e. a smaller offset
    else app.drag.value = +Math.max(0.1, Math.min(3, v0 + (ev.clientY - y0) / k)).toFixed(2);
    if (!app.raf) app.raf = requestAnimationFrame(() => { app.raf = null; draw(); });
  };
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); const d = app.drag; app.drag = null; if (!d) return; if (d.value === v0) { draw(); return; } evaluate(d.kind === 'curb' ? { curb: d.value } : { depth: d.value }); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
}
// 3 replace · the choosers: a small paper menu at the pill; the rows and their widths are read from the rules file through the API (R30 = Tables 8-3 / 8-4)
function closeMenu() { const m = $('menu'); app.menuOpen = false; if (m.classList.contains('on')) { m.classList.remove('on'); window.removeEventListener('pointerdown', onMenuOutside); } }
function onMenuOutside(e) { if (!$('menu').contains(e.target)) closeMenu(); }
function openMenu(x, y, groups) {
  const m = $('menu'); m.innerHTML = '';
  for (const gr of groups) { const hh = document.createElement('div'); hh.className = 'mh'; hh.textContent = gr.title; m.appendChild(hh);
    for (const it of gr.items) { const d = document.createElement('div'); d.className = 'mi' + (it.on ? ' on' : '') + (it.off ? ' off' : ''); d.innerHTML = `<b>${it.label}</b>` + (it.sub ? `<span>${it.sub}</span>` : ''); if (!it.off && !it.on) d.onclick = () => { closeMenu(); it.pick(); }; m.appendChild(d); } }
  m.style.left = Math.max(8, Math.min(x, window.innerWidth - 340)) + 'px'; m.style.top = Math.max(8, y) + 'px'; m.classList.add('on'); app.menuOpen = true; setTimeout(() => window.addEventListener('pointerdown', onMenuOutside), 0);
}
async function r30() { if (!app.rules) { try { app.rules = await api.rules(); } catch (e) { app.rules = {}; } const rr = app.rules.rules || app.rules; const list = Array.isArray(rr) ? rr : Object.values(rr || {}); app.rules.r30 = list.find((r) => r && r.rule_id === 'R30') || null; app.ctlKey = ''; if (app.S) draw(); } return app.rules.r30; }
async function landUseMenu(x, y, live) {
  const r = await r30(); const sw = r && r.sidewalk_clear_width_m, bb = r && r.back_boulevard_width_m, rows = r && r.land_use_rows;
  const sub = (lu, lv) => { if (!sw || !sw[lu]) return ''; const w = sw[lu][lv]; if (w == null) return sw[lu].preferred_note || 'not given'; const b = bb && rows && rows[lu] && bb[rows[lu].table_8_4] ? bb[rows[lu].table_8_4][lv] : null; return `sidewalk ${w} m` + (b != null ? ` · back blvd ${b} m` : ''); };
  const off = (lu, lv) => !!(sw && sw[lu] && sw[lu][lv] == null);
  openMenu(x, y, [{ title: 'WHAT THE RULE READS · LAND USE · TABLE 8-3', items: Object.keys(LAND_TXT).map((lu) => ({ label: LAND_TXT[lu], sub: sub(lu, live.width_level), on: lu === live.land_use, off: off(lu, live.width_level), pick: () => evaluate({ land_use: lu }) })) },
    { title: 'WIDTH LEVEL · TABLES 8-3 / 8-4', items: ['constrained', 'minimum', 'preferred'].map((lv) => ({ label: lv.toUpperCase(), sub: sub(live.land_use, lv), on: lv === live.width_level, off: off(live.land_use, lv), pick: () => evaluate({ width_level: lv }) })) }]);
}
function soilMenu(x, y, live) {
  openMenu(x, y, [{ title: 'WHAT THE RULE READS · SOIL TYPE OF THE BAND', items: [['native_soil', 'credited in full'], ['structural_soil', '50 % credited · R06'], ['soil_cell', 'new tree only · manual review · R08–R10'], ['other', 'as the engine reads it']].map(([sv, sub]) => ({ label: SOIL_TXT[sv], sub, on: sv === live.soil, pick: () => evaluate({ soil: sv }) })) }]);
}
// 2 the street: the chunk seen straight down, drawn as SVG at screen resolution in the same language as the city map — paper,
// one ink, the dusty green, a crisp pattern (the rule's answer on this face, as on the checked streets), a line hierarchy,
// trees as discs with their share on a white disc, the surround faded, one text column on the right with one leader each.
// Every number is read from the scene file. Returns true while the layer is opaque (the chunk outline then belongs to it).
const FACE_KIND = { Large: 'cross', Medium: 'diag', Small: 'grid', none: 'grid' };
// the rule's answer on this block face, as the batch defines it (the largest class that more than half the known trees' shares meet):
// read from the citywide file when this face is in the sample, else from the trees' own engine results in the scene file
// standard plan symbols for the City's records at grade, one ink, sized to read at any zoom
function symbol(kind, x, y, title) {
  const g = el('g', { class: 'sym ' + kind }); if (title) { const t = document.createElementNS(svgNS, 'title'); t.textContent = title; g.appendChild(t); }
  if (kind === 'pole') { g.appendChild(el('circle', { cx: x, cy: y, r: 4.2 })); g.appendChild(el('circle', { class: 'f', cx: x, cy: y, r: 1.5 })); }
  else if (kind === 'cb') { g.appendChild(el('rect', { x: x - 5, y: y - 5, width: 10, height: 10 })); g.appendChild(el('line', { x1: x - 5, y1: y - 5, x2: x + 5, y2: y + 5 })); }
  else if (kind === 'mh') { g.appendChild(el('circle', { cx: x, cy: y, r: 5.2 })); g.appendChild(el('line', { x1: x - 5.2, y1: y, x2: x + 5.2, y2: y })); g.appendChild(el('line', { x1: x, y1: y - 5.2, x2: x, y2: y + 5.2 })); }
  else if (kind === 'valve') { g.appendChild(el('rect', { x: x - 3.4, y: y - 3.4, width: 6.8, height: 6.8, transform: `rotate(45 ${x} ${y})` })); }
  else if (kind === 'hyd') { g.appendChild(el('circle', { class: 'f', cx: x, cy: y, r: 3.6 })); g.appendChild(el('circle', { cx: x, cy: y, r: 5.6 })); }
  return g;
}
function faceVerdict(S) {
  const f = app.city && app.city.faces ? app.city.faces.faces.find((x) => x.site_id === S.site_id.split('_')[0]) : null; if (f && f.largest_class_fits) return f.largest_class_fits;
  const known = S.trees.filter((t) => t.share_status === 'KNOWN' && Array.isArray(t.benchmark_classes)); if (!known.length) return null;
  for (const c of ['Large', 'Medium', 'Small']) if (known.filter((t) => t.benchmark_classes.includes(c)).length * 2 > known.length) return c; return 'none';
}
function plan(svg, sc, S, t) {
  const sl = sc.slab, st = S.street, bd = S.band.design, blk = st.block, ex = S.extent; const cl = st.centreline_v, pl = st.property_line_v, curb = st.curb_face_v;
  const op = t < 1 ? smooth((t - (diveT().ts - 0.12)) / 0.2) : t < 4 ? 1 : 1 - smooth((t - 4) / 0.12); if (op <= 0.01) return false;   // in over the map as the dive closes; held through 02–04; out fast before the block appears
  const defs = svg.querySelector('defs');
  if (!svg.querySelector('#p-dots')) { const pt = el('pattern', { id: 'p-dots', width: 10, height: 10, patternUnits: 'userSpaceOnUse' }); pt.appendChild(el('circle', { cx: 5, cy: 5, r: .9, fill: `rgba(${INK},.22)` })); defs.appendChild(pt); }
  const P = (u, v) => sc.project(u, v, 0);
  const rect = (g, u0, u1, v0, v1, attrs) => g.appendChild(poly([P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)], attrs));
  const line = (g, u0, v0, u1, v1, cls) => { const a = P(u0, v0), b = P(u1, v1); g.appendChild(el('line', { class: cls, x1: a.x, y1: a.y, x2: b.x, y2: b.y })); };
  const MARGIN = SHEET.margin; const wx0 = SHEET.rail + SHEET.west, viewX = wx0 + planWAt(t), yTop = SHEET.head, yBot = sc.H - SHEET.foot;   // the plan panel's box; the section panel starts at viewX + gap
  if (!svg.querySelector('#clip-plan')) { const cp = el('clipPath', { id: 'clip-plan' }); cp.appendChild(el('rect', { id: 'clip-plan-r', x: wx0, y: yTop, width: viewX - wx0, height: yBot - yTop })); defs.appendChild(cp); } else { const r = svg.querySelector('#clip-plan-r'); r.setAttribute('x', wx0); r.setAttribute('y', yTop); r.setAttribute('width', viewX - wx0); r.setAttribute('height', yBot - yTop); }
  const gAll = el('g', { class: 'plan' + (app.hotTree ? ' hot' : '') + (app.panning ? ' panning' : ''), opacity: op });
  gAll.appendChild(el('rect', { x: 0, y: 0, width: sc.W, height: sc.H, fill: PAPER }));
  const toolK = smooth((t - 2.75) / 0.25);   /* 04: the plan leaves; the section takes the sheet */
  if (toolK > 0.01) gAll.appendChild(el('rect', { x: 0, y: 0, width: sc.W, height: sc.H, fill: '#E6E3D8', opacity: (toolK * 0.22).toFixed(2) }));   /* 04: the board is toned, a workbench and not a sheet */
  const g = el('g', { 'clip-path': 'url(#clip-plan)', opacity: 1 - toolK }); gAll.appendChild(g);
  const panOn = t < 3 && secOnAt(t) > 0.5;   /* the plan is zoomed to the tree: drag it sideways to reach the other trees; the arrows below step to the neighbours */
  if (panOn) { const pad = el('rect', { class: 'panpad', x: wx0, y: yTop, width: viewX - wx0, height: yBot - yTop }); pad.addEventListener('pointerdown', (e) => startPan(e, sc)); g.appendChild(pad); }
  // ground, back to front: yards and parcels behind the property line, the road to the curb, the sidewalk, the back boulevard, the band
  rect(g, blk.u_from, blk.u_to, pl, pl + 60, { class: 'yard' });
  for (const r of S.parcels || []) g.appendChild(poly(r.map(([u, v]) => P(u, v)), { class: 'parcel' }));
  if (curb != null) { rect(g, ex.u_from - 60, ex.u_to + 60, cl - 40, curb, { class: 'road' }); rect(g, ex.u_from - 60, ex.u_to + 60, cl - 40, curb, { fill: 'url(#p-dots)' }); }
  if (st.sidewalk_v && st.sidewalk_v[0] != null) rect(g, blk.u_from, blk.u_to, st.sidewalk_v[0], st.sidewalk_v[1], { class: 'walk' });
  if (st.back_boulevard_v && st.back_boulevard_v[0] != null) rect(g, blk.u_from, blk.u_to, st.back_boulevard_v[0], st.back_boulevard_v[1], { class: 'yard' });
  const verdict = faceVerdict(S); const kind = verdict && FACE_KIND[verdict];
  if (bd) {
    rect(g, bd.u_from, bd.u_to, bd.v_from, bd.v_to, { class: 'blvd' });                                        // the boulevard itself, grass from curb to sidewalk
    // the soil the rule credits: within each segment, the band above the clearances — the strips are unioned column by
    // column (every 0.25 m), so many overlapping mains give one clean edge; a strip touching the curb side lowers the edge
    const strips = S.band.strips || []; const uLo = blk.u_from, uHi = blk.u_to;   /* the whole block face: at 02 every tree's band is there */
    const cutTop = (u) => { const iv = strips.filter((sp) => u >= sp.u0 && u <= sp.u1).map((sp) => [Math.max(sp.v0, bd.v_from), Math.min(sp.v1, bd.v_to)]).filter((a) => a[1] > a[0]).sort((a, b) => a[0] - b[0]); let top = bd.v_from; for (const [a, b] of iv) { if (a <= top + 0.02) top = Math.max(top, b); else break; } return Math.min(top, bd.v_to); };
    const redEdge = [];
    for (const sg of S.band.segments || []) { const a = Math.max(sg.u_from, uLo), b = Math.min(sg.u_to, uHi); if (b <= a) continue;
      const us = []; for (let u = a; u < b; u += 0.25) us.push(u); us.push(b);
      const lower = us.map((u) => P(u, cutTop(u))), upper = us.map((u) => P(u, bd.v_to));
      const pts = upper.concat(lower.slice().reverse()); g.appendChild(poly(pts, { class: 'band' })); if (kind) g.appendChild(poly(pts, { fill: `url(#${hatchId(svg, kind, hatchSp(kind, 6, false))})` }));
      const run = []; us.forEach((u, i) => { if (cutTop(u) > bd.v_from + 0.02) run.push(lower[i]); else if (run.length) { redEdge.push(run.slice()); run.length = 0; } }); if (run.length) redEdge.push(run); }
    for (const run of redEdge) if (run.length > 1) g.appendChild(el('polyline', { class: 'cutedge', points: run.map((q) => `${q.x},${q.y}`).join(' ') }));
    const zP = (S.band.zones || []).find((z) => z.side === 'property' && z.status === 'KNOWN');
    if (zP) rect(g, bd.u_from, bd.u_to, zP.v_from, zP.v_to, { class: 'zone', fill: `url(#${hatchId(svg, 'diag', 9)})` });   // structural soil under the sidewalk: a typed design assumption, 45° hatch
  }
  for (const b of S.buildings || []) g.appendChild(poly(b.ring_uv.map(([u, v]) => P(u, v)), { class: 'house' }));
  // the lines, in their hierarchy
  line(g, blk.u_from, pl, blk.u_to, pl, 'pl');
  if (st.sidewalk_v && st.sidewalk_v[0] != null) for (const vv of st.sidewalk_v) line(g, blk.u_from, vv, blk.u_to, vv, 'walkedge');
  if (bd) for (const vv of [bd.v_from, bd.v_to]) line(g, bd.u_from, vv, bd.u_to, vv, 'bandedge');
  if (curb != null) { const boc = st.back_of_curb_v != null ? st.back_of_curb_v : curb + (st.widths_m.curb || 0.15); rect(g, ex.u_from - 60, ex.u_to + 60, curb, boc, { class: 'curbstrip' }); line(g, ex.u_from - 60, curb, ex.u_to + 60, curb, 'curb'); line(g, ex.u_from - 60, boc, ex.u_to + 60, boc, 'curbback'); }
  if (st.sidewalk_v && st.sidewalk_v[0] != null) for (let u = Math.ceil(blk.u_from / 1.5) * 1.5; u < blk.u_to; u += 1.5) line(g, u, st.sidewalk_v[0], u, st.sidewalk_v[1], 'score');   // panel joints: a plan convention for concrete, nominal module
  line(g, ex.u_from - 60, cl, ex.u_to + 60, cl, 'cl');
  if (bd) for (const tr of S.trees) { const c = tr.cell; if (!c || c.u_from == null) continue; for (const u of [c.u_from, c.u_to]) if (u >= blk.u_from && u <= blk.u_to) line(g, u, bd.v_from, u, bd.v_to, 'cell' + (tr.selected ? ' sel' : '')); }   // each tree's cell: half-way to each neighbour
  // the trees: a disc the size of the crown (nominal), the soil the rule gives the tree on a white disc; the followed tree ringed
  const ppm = (() => { const a = sc.axis(0, 0, 0, 1, 0, 0); return Math.hypot(a.d.x, a.d.y); })();   // px per metre
  const have = (tr) => (tr.extensions && tr.extensions.share_total_m3 != null ? tr.extensions.share_total_m3 : tr.share_m3);
  const sel = S.trees.find((x) => x.selected); let selR = 0; const candP = t >= 3 ? candidateShown(S) : null;   // existing vs proposed: the City's crown as a dashed ring behind the proposed crown
  for (const tr of S.trees) {
    const p = P(tr.u, tr.v); const r0 = Math.max(6, (tr.crown_diameter_m || 3) / 2 * ppm); const rP = tr.selected && candP ? Math.max(6, (candP.drawn_height_m || tr.height_m || 6) * (candP.crown_ratio_of_height || 0.6) / 2 * ppm) : r0; const r = rP; if (tr.selected) selR = r;
    const gt = el('g', { class: 'tree' + (tr.selected ? ' sel' : '') + (app.hotTree === tr.site_id ? ' hot' : '') });
    if (tr.selected && candP) gt.appendChild(el('circle', { class: 'cityring', cx: p.x, cy: p.y, r: r0 }));
    gt.appendChild(el('circle', { class: 'shadow', cx: p.x + r * 0.07 + 2, cy: p.y + r * 0.09 + 2, r }));
    gt.appendChild(el('circle', { class: 'crown', cx: p.x, cy: p.y, r }));
    gt.appendChild(el('circle', { class: 'core', cx: p.x - r * 0.06, cy: p.y - r * 0.08, r: r * 0.58 }));
    if (tr.selected) gt.appendChild(el('circle', { class: 'ring', cx: p.x, cy: p.y, r: r + 5 }));
    const rd = tr.selected ? 15 : 12.5; const shown2 = tr.selected && candP && candP.usable_m3 != null ? candP.usable_m3 : have(tr); gt.appendChild(el('circle', { class: 'num', cx: p.x, cy: p.y, r: rd })); gt.appendChild(el('text', { x: p.x, y: p.y + 4 }, shown2 != null ? fmt(shown2) : '?'));
    if (t < 3) {                                                                                      // selecting a tree belongs to 02–03; in the scenario builder the trees are read-only
      gt.addEventListener('pointerenter', () => { if (app.hotTree !== tr.site_id) { app.hotTree = tr.site_id; requestDraw(); } });
      gt.addEventListener('pointerleave', () => { if (app.hotTree === tr.site_id) { app.hotTree = null; requestDraw(); } });
      gt.addEventListener('pointerdown', (e) => { e.stopPropagation(); app.treeDown = { id: tr.site_id, x: e.clientX, y: e.clientY }; });   // pointerup, not click: a hover redraws the overlay, so down and up land on different nodes and 'click' never fires
      gt.addEventListener('pointerup', (e) => { e.stopPropagation(); const d = app.treeDown; app.treeDown = null; if (!d || d.id !== tr.site_id || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return; if (app.busy) return; if (!tr.selected) { app.pan = 0; app.pulse = { u: tr.u, v: tr.v }; draw(); evaluate({ site_id: tr.site_id }); } openSection(); });
    } else gt.style.cursor = 'default';
    g.appendChild(gt);
    if (t < 3 && (app.hotTree === tr.site_id || (tr.selected && !app.hotTree))) { const sr = tr.species_ref; const gl = el('g', { class: 'lbl' + (tr.selected ? ' sel' : '') }); const txtL = `${sr ? sr.common.toUpperCase() : tr.genus} · ${fmt(tr.height_m)} m${tr.selected ? ' · SELECTED' : ' · CLICK'}`; const xl = Math.max(wx0 + 150, Math.min(viewX - 150, p.x)), yl = Math.max(p.y + r + 18, P(tr.u, curb - 3.2).y + 24), wl = txtL.length * 7.2 + 16; gl.appendChild(el('rect', { class: 'bg', x: xl - wl / 2, y: yl - 12, width: wl, height: 17, rx: 8.5 })); gl.appendChild(el('text', { x: xl, y: yl, 'text-anchor': 'middle' }, txtL)); gAll.appendChild(gl); }
  }
  if (panOn && sel) { const row = S.trees.slice().sort((a, b) => a.u - b.u); const i = row.indexOf(sel); const yN = yBot + 16;   /* a row under the plan's frame; the scale bar moves down to make room */
    const nmOf = (nb) => ((nb.species_ref && nb.species_ref.common) || nb.genus || '').toUpperCase().slice(0, 26); const wOf = (nb) => (nb ? (nmOf(nb).length + 2) * 7.2 + 18 : 0); const free = (viewX - wx0) - wOf(row[i - 1]) - wOf(row[i + 1]) - 40;
    if (free > 120) gAll.appendChild(el('text', { class: 'ps panhint', x: (wx0 + wOf(row[i - 1]) + viewX - wOf(row[i + 1])) / 2, y: yN, 'text-anchor': 'middle' }, free > 280 ? 'DRAG THE PLAN ⟷ · OR STEP TO A NEIGHBOUR' : 'DRAG ⟷'));   /* the hint only where it fits between the arrows */
    const maxNav = ((viewX - wx0) - 40) / 2;   /* each arrow may take half the plan's width; a longer name is cut */
    for (const [nb, side] of [[row[i - 1], 'prev'], [row[i + 1], 'next']]) { if (!nb) continue; let nm = ((nb.species_ref && nb.species_ref.common) || nb.genus || '').toUpperCase().slice(0, 26); while ((nm.length + 3) * 7.2 + 18 > maxNav && nm.length > 5) nm = nm.replace(/…$/, '').slice(0, -1).trimEnd() + '…'; const txt = side === 'prev' ? `◂ ${nm}` : `${nm} ▸`; const w = txt.length * 7.2 + 18; const x = side === 'prev' ? wx0 + 10 + w / 2 : viewX - 10 - w / 2;
      const gn = el('g', { class: 'nav' + (app.busy ? ' off' : '') }); gn.appendChild(el('rect', { class: 'bg', x: x - w / 2, y: yN - 12, width: w, height: 17, rx: 8.5 })); gn.appendChild(el('text', { x, y: yN, 'text-anchor': 'middle' }, txt));
      gn.addEventListener('pointerdown', (e) => e.stopPropagation()); gn.addEventListener('click', (e) => { e.stopPropagation(); if (app.busy) return; app.pan = 0; app.pulse = { u: nb.u, v: nb.v }; draw(); evaluate({ site_id: nb.site_id }); openSection(); }); gAll.appendChild(gn); } }
  const SURF = { street_lighting_pole: 'pole', sewer_catch_basin: 'cb', manhole: 'mh', valve: 'valve', hydrant: 'hyd' };
  const gs = el('g', { class: 'surface' }); const seenKinds = new Set();
  for (const f of S.facilities) { const k = SURF[f.kind]; if (!k || !f.path_uv || f.path_uv.length !== 1) continue; const [u, v] = f.path_uv[0]; const q = P(u, v); if (q.x < wx0 || q.x > viewX || q.y < 0 || q.y > sc.H) continue; seenKinds.add(k); gs.appendChild(symbol(k, q.x, q.y, f.label)); }
  g.appendChild(gs);
  if (app.pulse) { const q = P(app.pulse.u, app.pulse.v); const c = el('circle', { class: 'pulse', cx: q.x, cy: q.y, r: 8 }); c.appendChild(el('animate', { attributeName: 'r', from: 8, to: 70, dur: '.5s', fill: 'freeze' })); c.appendChild(el('animate', { attributeName: 'opacity', from: .9, to: 0, dur: '.5s', fill: 'freeze' })); g.appendChild(c); setTimeout(() => { app.pulse = null; }, 600); }
  // the chunk: full strength inside, the surround faded, the outline in the ring's green
  const cU = [[sl.u0, sl.v0], [sl.u1, sl.v0], [sl.u1, sl.v1], [sl.u0, sl.v1]].map(([u, v]) => P(u, v));
  g.appendChild(el('path', { class: 'fade', d: `M0 0H${sc.W}V${sc.H}H0Z M` + cU.map((q) => `${q.x} ${q.y}`).join('L') + 'Z', 'fill-rule': 'evenodd', opacity: 1 - smooth((t - 0.78) / 0.2) }));   // the chunk reads during the dive only; on the sheet (02–04) the plan is one even drawing, no wash with a hard edge
  // the sheet: everything beside the drawing waits until the camera has arrived
  const gSheet = el('g', { class: 'sheet', opacity: smooth((t - 0.8) / 0.2) }); gAll.appendChild(gSheet);
  const replace = t >= 3, review = false;   // 04 the scenario builder: the same section, now with its handles and choosers
  const pendTree = app.pending && app.pending.site_id ? S.trees.find((x) => x.site_id === app.pending.site_id) : null; const shown = (!replace && (pendTree || (!app.busy && app.hotTree && S.trees.find((x) => x.site_id === app.hotTree)))) || sel;   /* the clicked tree's cut at once while its run is on; hover previews wait */   // the tree the section is cut through (in replace, always the selected one: the handles stay put)
  // the plan panel's title, scale bar and north
  const gP = el('g', { opacity: 1 - toolK }); gSheet.appendChild(gP);   /* the plan's sheet furniture goes with the plan */
  gP.appendChild(el('text', { class: 'ptitle', x: wx0, y: yTop - 26 }, 'PLAN'));
  gP.appendChild(el('text', { class: 'psub', x: wx0 + 52, y: yTop - 26 }, `${S.title.hblock} · ${S.title.side.toUpperCase()}`));
  gP.appendChild(el('text', { class: 'psub', x: wx0, y: yTop - 9 }, t < 2 ? 'CLICK A TREE · ITS SECTION OPENS BESIDE THE PLAN' : 'THE SELECTED TREE AND ITS NEIGHBOURS'));
  { const bx = viewX - 150, by = yBot + (panOn ? 62 : 22); const m5 = 5 * ppm;   /* the scale bar under the plan, at its right; north beside it */ gP.appendChild(el('rect', { class: 'bar', x: bx, y: by, width: m5, height: 4 })); gP.appendChild(el('rect', { class: 'bar alt', x: bx + m5, y: by, width: m5, height: 4 }));
    [[0, '0'], [m5, '5'], [2 * m5, '10 m']].forEach(([dx, t2]) => gP.appendChild(el('text', { class: 'ps', x: bx + dx, y: by - 5, 'text-anchor': dx ? 'middle' : 'start' }, t2)));
    const nx = S.frame.along_unit_xy[1], ny = S.frame.property_unit_xy[1]; const ang = Math.atan2(nx, ny) * 180 / Math.PI; const gn = el('g', { class: 'key', transform: `translate(${viewX - 14} ${by - 2}) rotate(${ang})` }); gn.appendChild(el('path', { class: 'north', d: 'M0 -14L4.5 5L0 1.5L-4.5 5Z' })); gn.appendChild(el('text', { x: 0, y: -18, 'text-anchor': 'middle' }, 'N')); gP.appendChild(gn); }
  // zone labels on the west paper, level leaders to the drawing's edge (the plan explains the street; the numbers are the file's)
  { const rows = [[pl, 'PROPERTY LINE', null], st.sidewalk_v && [(st.sidewalk_v[0] + st.sidewalk_v[1]) / 2, 'SIDEWALK', `${fmt(st.widths_m.sidewalk_clear, 2)} m`], bd && [(bd.v_from + bd.v_to) / 2, 'THE BAND', `${fmt(bd.v_to - bd.v_from, 2)} × ${fmt(bd.depth_m, 2)} m`], curb != null && [curb, 'CURB', `${fmt(curb - cl, 1)} m FROM ℄`], [curb - 3, 'ROAD', null]].filter(Boolean);
    let ly = -1e9; const xr = wx0 - 28, xc = wx0 - 14;   /* labels end at one edge; a bent leader runs from the text to the dot on the plan's edge, so a label pushed down still points at its line */
    for (const [v, name, sub] of rows) { const yd = P(0, v).y; const y = Math.max(yd, ly + (sub ? 34 : 22)); if (y < yTop + 10 || y > yBot - 6) continue; ly = y; const gl = el('g', { class: 'zl' }); gl.appendChild(el('path', { class: 'lead', d: `M${xr + 6} ${y}H${xc}V${yd}H${wx0 - 3}` })); gl.appendChild(el('circle', { cx: wx0 - 3, cy: yd, r: 2.2 })); gl.appendChild(el('text', { x: xr, y: y + (sub ? -3 : 3), 'text-anchor': 'end' }, name)); if (sub) gl.appendChild(el('text', { class: 'sub', x: xr, y: y + 11, 'text-anchor': 'end' }, sub)); gP.appendChild(gl); } }
  // each tree's cell, a level dimension string on the back boulevard: the length of band the rule reads for that tree
  if (st.back_boulevard_v && st.back_boulevard_v[0] != null && bd) {
    const vS = (st.back_boulevard_v[0] + st.back_boulevard_v[1]) / 2; const gsd = el('g', { class: 'dim spacing' });
    const row = S.trees.filter((tr) => tr.cell && tr.cell.u_from != null && (secOnAt(t) > 0.5 ? (tr.cell.u_from > sl.u0 - 13 && tr.cell.u_to < sl.u1 + 13) : true)).sort((a, b) => a.u - b.u);
    const seen = new Set();
    for (const tr of row) for (const u of [tr.cell.u_from, tr.cell.u_to]) { const k = u.toFixed(2); if (seen.has(k)) continue; seen.add(k); const a = P(u, bd.v_to), b = P(u, vS); gsd.appendChild(el('line', { class: 'ext', x1: a.x, y1: a.y, x2: b.x, y2: b.y - 6 })); gsd.appendChild(el('line', { class: 'tick', x1: b.x - 4, y1: b.y + 4, x2: b.x + 4, y2: b.y - 4 })); }
    for (const tr of row) { const a = P(tr.cell.u_from, vS), b = P(tr.cell.u_to, vS); gsd.appendChild(el('line', { class: 'chain', x1: a.x, y1: a.y, x2: b.x, y2: b.y })); gsd.appendChild(el('text', { x: (a.x + b.x) / 2, y: a.y - 6, 'text-anchor': 'middle' }, fmt(tr.cell.u_to - tr.cell.u_from, 2))); }
    g.appendChild(gsd);
  }
  // 3 replace: the species card's need-box in this cell — its Table 9-2 volume as a length of this band, dashed; red where a clearance cuts it
  const cb = replace && ((S.candidate && S.candidate.box) || (S.need && S.need.box));   // the species card's box, or the question's class's own box while the City's tree stands
  if (cb && bd && cb.u0 != null) { const cut = !!(cb.conflicts && cb.conflicts.length); g.appendChild(poly([P(cb.u0, bd.v_from), P(cb.u1, bd.v_from), P(cb.u1, bd.v_to), P(cb.u0, bd.v_to)], { class: 'needbox' + (cut ? ' cut' : '') + (app.hotNeed ? ' hot' : '') }));
    const vS = bd.v_from + 0.32; const a = P(cb.u0, vS), b = P(cb.u1, vS); const gn = el('g', { class: 'dim need' }); for (const q of [a, b]) gn.appendChild(el('line', { class: 'tick', x1: q.x - 4, y1: q.y + 4, x2: q.x + 4, y2: q.y - 4 })); gn.appendChild(el('line', { class: 'chain', x1: a.x, y1: a.y, x2: b.x, y2: b.y }));
    const txt = `NEED-BOX ${fmt(cb.length_m)} m` + (cut ? ' · CUT' : ''); const tw2 = txt.length * 6.6 + 12; const cx = (a.x + b.x) / 2; gn.appendChild(el('rect', { class: 'tag', x: cx - tw2 / 2, y: a.y + 5, width: tw2, height: 15, rx: 7.5 })); gn.appendChild(el('text', { x: cx, y: a.y + 16, 'text-anchor': 'middle' }, txt)); g.appendChild(gn); }
  // the section line A–A through the tree the right panel shows
  if (shown) {   /* the A–A cut: a spatial state (02 defines WHERE); it drags along the tree's cell, 03's section follows, 05 and Rhino inherit it when the scenario is frozen */
    const uA = shown.u + (app.cutU || 0); const a = P(uA, pl + 3.8), b = P(uA, curb - 3.2);   /* the yard-side marker sits clear of the cell dimension string (its text included) */ const gs2 = el('g', { class: 'secline' + (app.cutDrag ? ' live' : ''), style: 'pointer-events:all;cursor:ew-resize' });
    gs2.appendChild(el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y })); for (const q of [a, b]) { gs2.appendChild(el('circle', { cx: q.x, cy: q.y, r: 9 })); gs2.appendChild(el('text', { x: q.x, y: q.y + 3.5, 'text-anchor': 'middle' }, 'A')); }
    if (Math.abs(app.cutU || 0) >= 0.05) gs2.appendChild(el('text', { class: 'ps', x: a.x + 12, y: a.y - 12 }, `${app.cutU > 0 ? '+' : '−'}${fmt(Math.abs(app.cutU), 1)} m`)); else if (t < 3) gs2.appendChild(el('text', { class: 'ps', x: a.x + 12, y: a.y - 12 }, 'drag A–A along the street · the cut picks the tree'));
    /* the cut defines the tree: A–A drags along the whole block face; where it comes to rest, the tree whose cell holds it becomes the selected tree (a scene switch), and the cut stays where the hand left it */
    const blk = S.street.block; const cellOf = (uAbs) => S.trees.find((q) => q.cell && q.cell.u_from != null && uAbs >= q.cell.u_from && uAbs <= q.cell.u_to) || S.trees.slice().sort((a2, b2) => Math.abs(a2.u - uAbs) - Math.abs(b2.u - uAbs))[0];
    if (app.cutDrag) { const tgt = cellOf(shown.u + (app.cutU || 0)); if (tgt && tgt.site_id !== shown.site_id) gs2.appendChild(el('text', { class: 'ps', x: a.x + 12, y: a.y + 8 }, `→ ${(tgt.species_ref && tgt.species_ref.common) || tgt.genus} · let go to switch`)); }
    gs2.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); if (app.busy) return; const kU = P(shown.u + 1, pl).x - P(shown.u, pl).x; if (!isFinite(kU) || Math.abs(kU) < 1e-6) return; const x0 = e.clientX, c0 = app.cutU || 0; const lo = blk.u_from - shown.u + 0.2, hi = blk.u_to - shown.u - 0.2; app.cutDrag = true;
      const pf0 = sc.planFrame(); const halfP = planWAt(app.t) / 2 / pf0.ppm; const cB = (sc.slab.u0 + sc.slab.u1) / 2; const plo = blk.u_from + halfP - 8 - cB, phi = blk.u_to - halfP + 8 - cB;
      const move = (ev) => { app.cutU = +Math.max(lo, Math.min(hi, c0 + (ev.clientX - x0) / kU)).toFixed(1);
        const xs = P(shown.u + app.cutU, pl).x; let dp = 0; if (xs > viewX - 36) dp = (xs - (viewX - 36)) / kU; else if (xs < wx0 + 36) dp = (xs - (wx0 + 36)) / kU;   /* the plan slides to keep the cut in view */
        if (dp) { app.pan = plo > phi ? 0 : Math.max(plo, Math.min(phi, (app.pan || 0) + dp)); sc._pf = null; sc.setStop(app.t); }
        app.secKey = ''; requestDraw(); };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); app.cutDrag = false; const uAbs = shown.u + (app.cutU || 0); const tgt = cellOf(uAbs);
        if (tgt && tgt.site_id !== shown.site_id && !app.busy) { app.cutNext = +(uAbs - tgt.u).toFixed(1); app.cutKeep = true; app.pulse = { u: tgt.u, v: tgt.v }; app.ctlKey = ''; app.resKey = ''; app.secKey = ''; draw(); evaluate({ site_id: tgt.site_id }); return; }   /* the new tree becomes the frame's origin; the cut relative to it is what the frozen file will carry */
        if (shown.cell && shown.cell.u_from != null) app.cutU = +Math.max(shown.cell.u_from - shown.u, Math.min(shown.cell.u_to - shown.u, app.cutU || 0)).toFixed(1);
        app.ctlKey = ''; app.resKey = ''; app.secKey = ''; draw(); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); });
    g.appendChild(gs2); }
  if (panOn && shown) {   /* the navigator: the whole block face at a glance, so any tree can be chosen and the zoom window placed anywhere */
    const blk2 = S.street.block; const nx0 = wx0 + 10, nx1 = viewX - 10, ny = yTop + 22; const uToX = (u) => nx0 + (u - blk2.u_from) / Math.max(1e-6, blk2.u_to - blk2.u_from) * (nx1 - nx0); const xToU = (x) => blk2.u_from + (x - nx0) / Math.max(1e-6, nx1 - nx0) * (blk2.u_to - blk2.u_from);
    const kN = P(shown.u + 1, pl).x - P(shown.u, pl).x; const uL = shown.u + (wx0 - P(shown.u, pl).x) / kN, uR = shown.u + (viewX - P(shown.u, pl).x) / kN;   /* the zoomed window in street metres */
    const gN = el('g', { class: 'navi', style: 'pointer-events:all;cursor:pointer' });
    gN.appendChild(el('rect', { class: 'bg', x: wx0 + 2, y: yTop + 4, width: viewX - wx0 - 4, height: 36, rx: 3 }));
    gN.appendChild(el('text', { class: 'h', x: nx0, y: yTop + 13 }, `THE BLOCK FACE · ${S.trees.length} TREES · CLICK ONE`));
    gN.appendChild(el('line', { class: 'face', x1: nx0, y1: ny + 6, x2: nx1, y2: ny + 6 }));
    gN.appendChild(el('rect', { class: 'win', x: Math.max(nx0 - 2, uToX(uL)), y: ny - 1, width: Math.max(6, Math.min(nx1 + 2, uToX(uR)) - Math.max(nx0 - 2, uToX(uL))), height: 14, rx: 2 }));
    { const xa = uToX(shown.u + (app.cutU || 0)); gN.appendChild(el('line', { class: 'cut', x1: xa, y1: ny - 4, x2: xa, y2: ny + 16 })); }
    for (const q of S.trees) { const c = el('circle', { class: 'dot' + (q.selected ? ' sel' : '') + (q.site_id === app.hotTree ? ' hot' : ''), cx: uToX(q.u), cy: ny + 6, r: q.selected ? 5 : 3.2 }); c.appendChild(el('title', {}, `${(q.species_ref && q.species_ref.common) || q.genus} · ${fmt(q.height_m)} m`)); gN.appendChild(c); }
    gN.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); if (app.busy) return; const r0 = $('overlay').getBoundingClientRect(); const x = e.clientX - r0.left; const hit = S.trees.slice().sort((a2, b2) => Math.abs(uToX(a2.u) - x) - Math.abs(uToX(b2.u) - x))[0];
      if (hit && Math.abs(uToX(hit.u) - x) <= 7) { if (!hit.selected) { app.pan = 0; app.pulse = { u: hit.u, v: hit.v }; draw(); evaluate({ site_id: hit.site_id }); } openSection(); return; }   /* a dot: that tree */
      const pf = sc.planFrame(); const half = planWAt(app.t) / 2 / pf.ppm; const cB = (sc.slab.u0 + sc.slab.u1) / 2; const lo2 = blk2.u_from + half - 8 - cB, hi2 = blk2.u_to - half + 8 - cB; const clampP = (pp) => (lo2 > hi2 ? 0 : Math.max(lo2, Math.min(hi2, pp)));
      const setTo = (cx) => { app.pan = clampP(xToU(cx) - cB); sc._pf = null; sc.setStop(app.t); requestDraw(); }; setTo(x);   /* elsewhere: the window goes there and follows the hand */
      const mv = (ev) => setTo(ev.clientX - r0.left); const up2 = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up2); draw(); }; window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up2); });
    gAll.appendChild(gN); }
  if (t < 2 && seenKinds.size) { const KEY = { pole: 'STREET-LIGHTING POLE', cb: 'CATCH BASIN (APPROX.)', mh: 'MANHOLE', valve: 'WATER VALVE', hyd: 'HYDRANT' }; let kx = wx0; const yk = sc.H - 22; gP.appendChild(el('text', { class: 'ps', x: kx, y: yk }, 'CITY RECORDS AT GRADE')); kx += 150; for (const k of seenKinds) { gP.appendChild(symbol(k, kx + 6, yk - 4)); gP.appendChild(el('text', { class: 'ps', x: kx + 18, y: yk }, KEY[k])); kx += 24 + KEY[k].length * 6.6 + 30; } }
  // the section panel
  const secOn = secOnAt(t);   /* the section: beside the plan from a click or from 03; alone on the sheet at 04 */
  const x03 = viewX + SHEET.gap, W03 = sc.W - 10 - SHEET.eastRec - x03; const x04 = SHEET.rail + SHEET.toolL + 14, W04 = sc.W - SHEET.toolR - 22 - x04;   /* 03: beside the plan · 04: between the inputs and the outputs */
  const kq = toolK < 0.5 ? 0 : 1;   /* the section is built for 03 or for 04, never for a frame in between: a rebuild of both cuts on every glide frame was the lag at 04; the layer crossfades instead */
  const x0s = lerp(x03, x04, kq); const Ws = lerp(W03, W04, kq); const Hs = lerp(sc.H - 74, splitH(sc, S, W04).Hs, kq);   /* 04: A–A above, B–B below — both cuts are the instrument */
  sectionLayer(sc, S, t, shown, replace, review, x0s, Ws, Hs, kq, op * (1 - 0.6 * Math.sin(Math.PI * toolK)), secOn);
  svg.appendChild(gAll); return op > .99;
}
// the atlas layer of stop 1: the pattern (the second information) and the boundaries, as SVG at screen resolution so every
// mark is a printed line, not a texel. Far: per area, the rule's answer (+ Large fits · / Medium · # only Small or nothing).
// Near: per block, the class the City planted most. Spacing = public trees per hectare. One angle per kind.
const HATCH = { cross: { base: 22, ang: 15, w: .95 }, diag: { base: 13, ang: 45, w: .9 }, grid: { base: 10, ang: 0, w: .8 } };
function hatchId(svg, kind, sp) {
  const id = `pt-${kind}-${sp}`; if (svg.querySelector('#' + id)) return id; const h = HATCH[kind]; const defs = svg.querySelector('defs');
  const pat = el('pattern', { id, width: sp, height: sp, patternUnits: 'userSpaceOnUse', patternTransform: `rotate(${h.ang})` });
  const d = kind === 'cross' ? `M${sp / 2} ${sp * .32}V${sp * .68}M${sp * .32} ${sp / 2}H${sp * .68}` : kind === 'diag' ? `M0 ${sp / 2}H${sp}` : `M0 ${sp / 2}H${sp}M${sp / 2} 0V${sp}`;
  pat.appendChild(el('path', { d, stroke: '#26382C', 'stroke-width': h.w, 'stroke-opacity': .78, fill: 'none' })); defs.appendChild(pat); return id;
}
function hatchSp(kind, dens, tight, zoom = 1) { const f = Math.max(.55, Math.min(1.4, 1.5 - dens / 12)) * (tight ? .65 : 1) * zoom; return Math.max(5, Math.round(HATCH[kind].base * f)); }
function atlas(svg, sc, t) {
  const hw = sc.halfW1 || 4000; const L = (a, b) => smooth((Math.log(a) - Math.log(hw)) / (Math.log(a) - Math.log(b)));
  const ka = 1 - L(6500, 4000), kb = L(3900, 2600);   // in step with the textures: the area fill gives way to the block fill between 6.5 and 2.6 km, so the pattern unit changes with the colour unit   // a hand-off, never two layers at once: the area patterns are gone before the block patterns begin
  const g = el('g', { class: 'atlas' }); const V = { Large: 'cross', Medium: 'diag', Small: 'grid', none: 'grid' };
  const quick = app.moving && !app.report;   /* hundreds of pattern-filled polygons are what a glide frame cannot paint in 16 ms: the hatch waits for the camera to settle, then fades in */
  const gw = el('g', { class: 'hatches' + (app.hatchFresh ? ' in' : '') }); app.hatchFresh = false; g.appendChild(gw);
  if (ka > 0 && !quick) { const ga = el('g', { opacity: ka }); for (const a of sc.areaInfo) { const pts = a.ring.map(([u, v]) => sc.project(u, v, 0)); const kind = a.verdict && V[a.verdict]; if (kind) ga.appendChild(poly(pts, { class: 'hatch', fill: `url(#${hatchId(svg, kind, hatchSp(kind, a.dens, a.verdict === 'none'))})` })); } gw.appendChild(ga); }
  if (kb > 0 && !quick && sc.blockUV && sc.centre1) { const asp = sc.W / sc.H; const cu = sc.centre1.x, cv = sc.centre1.y, ru = hw * 1.15, rv = hw / asp * 1.15; const KIND = { 3: 'cross', 2: 'diag', 1: 'grid' }; const gb = el('g', { opacity: kb }); const zoom = Math.max(1, Math.min(2.2, hw / 650));   // blocks are small at the area level: the marks open up there and tighten as you close in
    for (const b of sc.blockUV) { if (b.box[1] < cu - ru || b.box[0] > cu + ru || b.box[3] < cv - rv || b.box[2] > cv + rv) continue; const pts = b.pts.map(([u, v]) => sc.project(u, v, 0)); gb.appendChild(poly(pts, { class: 'hatch blk', fill: `url(#${hatchId(svg, KIND[b.cls], hatchSp(KIND[b.cls], b.dens, false, zoom))})` })); }
    gw.appendChild(gb); }
  for (const a of sc.areaInfo) { const pts = a.ring.map(([u, v]) => sc.project(u, v, 0)); g.appendChild(poly(pts, { class: 'abound' })); }
  if (ka > 0) { const gl = el('g', { class: 'anames', opacity: ka }); const placed = []; const items = sc.areaInfo.map((a) => ({ a, p: sc.project(a.u, a.v, 0) })).sort((x, y) => (y.a.trees || 0) - (x.a.trees || 0));
    for (const it of items) { const txt = it.a.name.toUpperCase(); const w2 = txt.length * 6.4, h2 = 12; const x = it.p.x - w2 / 2, y = it.p.y - h2 / 2; if (placed.some((r) => x < r.x + r.w && x + w2 > r.x && y < r.y + r.h && y + h2 > r.y)) continue; placed.push({ x, y, w: w2, h: h2 }); gl.appendChild(el('text', { x: it.p.x, y: it.p.y + 4, 'text-anchor': 'middle' }, txt)); }
    g.appendChild(gl); }
  svg.appendChild(g);
}
function legend(svg, right, bottom, op, level, focus) {
  const g = el('g', { class: 'legend', opacity: op }); const W = 330; const x0 = right - W;
  const nF = app.city && app.city.faces ? app.city.faces.faces.filter((f) => f.run_ok).length : 0; const dots = [['Large', 'Large'], ['Medium', 'Medium'], ['Small', 'Small'], ['none', 'none'], ['unknown', '?']];
  const H = level === 'city' ? 148 : 102; const y0 = bottom - H;
  g.appendChild(el('rect', { x: x0 - 60, y: y0 - 70, width: W + 140, height: H + 130, class: 'fade' }));
  const lineRow = (y, title) => { g.appendChild(el('text', { x: x0, y, class: 't' }, title)); dots.forEach(([k2, w2], i) => { const x = x0 + 2 + [0, 54, 116, 166, 218][i]; g.appendChild(el('line', { x1: x, y1: y + 16, x2: x + 14, y2: y + 16, stroke: FACE_COL[k2], 'stroke-width': 3 })); g.appendChild(el('text', { x: x + 18, y: y + 20, class: 's' }, w2)); }); };
  if (level === 'block') { g.appendChild(el('text', { x: x0, y: y0 + 14, class: 't' }, 'EVERY PUBLIC TREE · CLICK ONE TO OPEN IT'));
    g.appendChild(el('circle', { cx: x0 + 6, cy: y0 + 34, r: 3.2, class: 'lg listed' })); g.appendChild(el('text', { x: x0 + 16, y: y0 + 38, class: 's' }, 'a Table 9-3 species'));
    g.appendChild(el('circle', { cx: x0 + 146, cy: y0 + 34, r: 2.4, class: 'lg other' })); g.appendChild(el('text', { x: x0 + 156, y: y0 + 38, class: 's' }, 'another species'));
    lineRow(y0 + 56, 'CHECKED STREETS · THE LARGEST TREE THAT FITS'); svg.appendChild(g); return; }
  if (level === 'city') {
    const sh = app.city && app.city.shares; g.appendChild(el('text', { x: x0, y: y0 + 14, class: 't' }, 'COLOUR · RECOMMENDED SPECIES, AS A SHARE OF PUBLIC TREES'));
    RAMP.forEach((c, i) => g.appendChild(el('rect', { x: x0 + i * 30, y: y0 + 24, width: 30, height: 12, fill: c })));
    g.appendChild(el('text', { x: x0, y: y0 + 50, class: 's' }, sh ? `${Math.round(sh.share_min * 100)} %` : 'less')); g.appendChild(el('text', { x: x0 + 180, y: y0 + 50, class: 's', 'text-anchor': 'end' }, sh ? `${Math.round(sh.share_max * 100)} %` : 'more'));
    g.appendChild(el('text', { x: x0 + 196, y: y0 + 50, class: 's' }, 'per area · per block closer in'));
    g.appendChild(el('text', { x: x0, y: y0 + 76, class: 't' }, 'PATTERN · THE LARGEST TREE THE SOIL RULE ALLOWS, PER AREA'));
    [['cross', 'Large'], ['diag', 'Medium'], ['grid', 'Small or none']].forEach(([kind, w2], i) => { const x = x0 + [0, 96, 206][i]; g.appendChild(el('rect', { x, y: y0 + 84, width: 20, height: 13, class: 'pat ' + kind })); g.appendChild(el('text', { x: x + 25, y: y0 + 94.5, class: 's' }, w2)); });
    lineRow(y0 + 122, `CHECKED STREETS (${nF}) · THE LARGEST TREE THAT FITS`);
  } else {
    g.appendChild(el('text', { x: x0, y: y0 + 14, class: 't' }, 'PATTERN · THE TREE SIZE THE CITY PLANTED MOST, PER BLOCK · DENSER = MORE TREES'));
    [['cross', 'Large'], ['diag', 'Medium'], ['grid', 'Small']].forEach(([kind, w2], i) => { const x = x0 + [0, 90, 180][i]; g.appendChild(el('rect', { x, y: y0 + 22, width: 20, height: 13, class: 'pat ' + kind })); g.appendChild(el('text', { x: x + 25, y: y0 + 32.5, class: 's' }, w2)); });
    lineRow(y0 + 58, `CHECKED STREETS IN ${focus ? focus.name.toUpperCase() : 'THE CITY'} (${focus ? focus.faces : nF}) · THE LARGEST TREE THAT FITS`);
  }
  svg.appendChild(g);
}
function pill(x, y, text, dark) {
  const g = el('g', { class: 'pill' }); const w = text.length * 6.6 + 14;
  g.appendChild(el('rect', { x: x - w / 2, y: y - 9, width: w, height: 18, rx: 9, fill: dark ? '#557F52' : '#fff', stroke: dark ? '#557F52' : '#000' }));
  g.appendChild(el('text', { x, y: y + 4, 'text-anchor': 'middle', fill: dark ? '#fff' : '#000' }, text)); return g;
}
// 4: drag a handle along its own axis (curb: across the street on the lid; depth: down the cut face); release → engine
// ---------- pointer: click a tree (2), drop or click a card onto the section (3), turn the block (4) ----------
const canvas = $('scene');
const inReplace = () => app.t >= 3 && app.t < 4;
canvas.addEventListener('pointermove', (e) => {
  if (!app.S || app.drag) return; const r = canvas.getBoundingClientRect(); const px = e.clientX - r.left, py = e.clientY - r.top; const tip = $('tip');
  if (app.t < diveT().ts && app.scene.treesInView) { let best = null, bd = 9; for (const it of app.scene.treesInView) { const d = Math.hypot(it.p.x - px, it.p.y - py); if (d < bd) { bd = d; best = it.q; } }
    const was = app.hotTreeDot; app.hotTreeDot = best; if (best !== was) requestDraw();
    if (best) { tip.className = 'tip paper on'; tip.innerHTML = `<b>PUBLIC TREE ${best[2]}</b><span class="row"><em>list</em>${best[3] ? 'a Table 9-3 species' : 'not a Table 9-3 species'}</span><span class="go">▸ click to open this tree · 03</span>`; tip.style.left = (px + 16) + 'px'; tip.style.top = (py + 16) + 'px'; canvas.style.cursor = 'pointer'; return; } }
  else if (app.hotTreeDot) { app.hotTreeDot = null; requestDraw(); }
  if (app.t < diveT().ts) { const ar = app.t < diveT().ta + 0.06 ? app.scene.pickArea(px, py) : null; if (ar !== app.hotArea) { app.hotArea = ar; draw(); } const f = app.scene.pickFace(px, py);
    if (!f && ar) { tip.className = 'tip paper on'; const vd = ar.verdict === 'none' ? 'nothing fits' : ar.verdict ? ar.verdict + ' fits' : null; tip.innerHTML = `<b>${ar.name.toUpperCase()}</b><span class="row"><em>trees</em>${(ar.trees || 0).toLocaleString()} public · ${ar.share != null ? Math.round(ar.share * 100) : '?'} % recommended species</span><span class="row"><em>rule</em>${ar.faces ? (vd ? vd + ' on most of ' : 'no clear answer on ') + ar.faces + ' checked streets' : 'no street checked yet'}</span><span class="go">▸ click to fly here</span>`; tip.style.left = (px + 16) + 'px'; tip.style.top = (py + 16) + 'px'; canvas.style.cursor = 'pointer'; return; }
    if (f) { tip.className = 'tip on'; const here = f.site_id === app.S.site_id.split('_')[0]; tip.innerHTML = `<b>${f.hblock}</b> · ${(f.side || '').replace('_', ' ')}<br>${FACE_TXT[f.largest_class_fits] || 'not known'} · ${f.tree_count} trees · band ${fmt(f.band_width_m, 2)} m<br><span style="opacity:.75">${here ? 'this is the block on screen' : 'click to go there'}</span>`; tip.style.left = (px + 14) + 'px'; tip.style.top = (py + 14) + 'px'; tip.classList.add('on'); canvas.style.cursor = here ? 'default' : 'pointer'; return; } tip.className = 'tip'; canvas.style.cursor = 'default'; return; }
  tip.classList.remove('on'); if (app.t < 1) return;
  tip.classList.remove('on');
  canvas.style.cursor = app.t < 3 && app.scene.pickTree(px, py) ? 'pointer' : inReplace() && app.armed ? 'copy' : app.t >= SHEET_ON && app.t < 5 ? 'grab' : 'default';
});
canvas.addEventListener('click', (e) => {
  if (!app.S || app.busy) return; if (app.turned) { app.turned = false; return; }
  if (inReplace() && app.armed) { placeCard(app.armed); return; }
  if (app.t < diveT().ts && app.hotTreeDot) { const q = app.hotTreeDot; app.hotTreeDot = null; $('tip').classList.remove('on'); goTree(q); return; }   /* the block level: a tree dot opens that tree at 03 */
  if (app.t < diveT().ts) { const r0 = canvas.getBoundingClientRect(); const f = app.scene.pickFace(e.clientX - r0.left, e.clientY - r0.top);
    if (!f && app.t < 0.45) { const ar = app.scene.pickArea(e.clientX - r0.left, e.clientY - r0.top); if (ar) goArea(ar); return; }
    if (f) { $('tip').classList.remove('on'); goFace(f.site_id); } return; }
  if (app.t < 1 || app.t >= 3) return; const r = canvas.getBoundingClientRect(); const tr = app.scene.pickTree(e.clientX - r.left, e.clientY - r.top); if (tr && !tr.selected) evaluate({ site_id: tr.site_id });
});
$('fixed').addEventListener('dragover', (e) => { if (app.dragCard && inReplace()) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
$('fixed').addEventListener('drop', (e) => { if (!app.dragCard) return; e.preventDefault(); const id = app.dragCard; app.dragCard = null; if (inReplace()) placeCard(id); else draw(); });
$('overlay').addEventListener('click', (e) => { if (inReplace() && app.armed && !app.busy && e.target.closest('.card')) placeCard(app.armed); });
canvas.addEventListener('pointerdown', (e) => {                       // 6: drag turns the block
  if (!app.S || app.t < SHEET_ON || app.t >= 5) return; const r = canvas.getBoundingClientRect(); let x0 = e.clientX - r.left, y0 = e.clientY - r.top, moved = 0;
  const move = (ev) => { const dx = ev.clientX - r.left - x0, dy = ev.clientY - r.top - y0; moved = Math.max(moved, Math.abs(dx), Math.abs(dy)); app.scene.orbit(-dx * 0.005, dy * 0.004); app.scene.setStop(app.t); draw(); x0 += dx; y0 += dy; canvas.style.cursor = 'grabbing'; };
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); canvas.style.cursor = 'grab'; if (moved > 4) app.turned = true; };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
});
// click an area: the camera drops to it; if this street is not in it, the area's best checked street becomes the street
function goArea(ar) {
  app.pulse = { u: ar.u, v: ar.v }; app.area = ar.name; app.hotArea = null; const sc = app.scene; const total = document.body.scrollHeight - window.innerHeight;
  if (sc.homeArea && sc.homeArea.name === ar.name) { app.ctlKey = ''; scrollToT(0.55); draw(); return; }
  const cands = sc.faceUV.filter((x) => x.f.local_area === ar.name).sort((x, y) => (y.f.known_count || 0) - (x.f.known_count || 0) || (y.f.tree_count || 0) - (x.f.tree_count || 0));
  if (!cands.length) { status('no checked street in ' + ar.name + ' yet'); app.ctlKey = ''; scrollToT(0.55); draw(); return; }
  const it = cands[0]; app.goto = { u: (it.a[0] + it.b[0]) / 2, v: (it.a[1] + it.b[1]) / 2 }; draw(); status('going to ' + ar.name + ' · ' + it.f.hblock + ' …');
  load(it.f.site_id).then(() => { app.goto = null; app.area = null; app.ctlKey = ''; scrollToT(0.55); draw(); });
}
/* the engine's catch-basin hint for the curb (the City labels them 'location approximate'): the median offset, or null */
function curbHint(S) { const k = S.knobs && S.knobs.curb_offset_from_centreline_m; const arr = k && k.hint && k.hint.catch_basin_offsets_from_centreline_m; if (!arr || !arr.length) return null; const a = arr.slice().sort((x, y) => x - y); return +(a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2).toFixed(2); }
/* a public tree anywhere, from a dot at the block level: its street loads (or the engine runs for it, about a minute) and the page lands on that tree at 03 */
function goTree(q) { if (app.busy) return; const asset = q[2]; app.goto = { u: q[0], v: q[1] }; draw(); status('opening tree ' + asset + ' …'); goTo(String(asset), () => { if (!app.needCurb) status('could not open tree ' + asset); }, STOP_T[2]).then(() => { app.goto = null; draw(); }); }   /* the busy ring sits on the chosen tree while its street loads or the engine runs */
/* a checked street, from the map or from the rail's list: its scene loads and the camera flies down to the plan (02) */
function goFace(siteId) {
  if (app.busy || !app.S) return; const here = app.S.site_id.split('_')[0]; if (siteId === here) { scrollToT(1.5); return; }
  const it = app.scene.faceUV ? app.scene.faceUV.find((x) => x.f.site_id === siteId) : null; if (it) { app.goto = { u: (it.a[0] + it.b[0]) / 2, v: (it.a[1] + it.b[1]) / 2 }; draw(); }
  status('going to ' + (it ? it.f.hblock : siteId) + ' …'); load(siteId).then((ok) => { app.goto = null; app.area = null; app.ctlKey = ''; draw(); if (ok) { scrollToT(1.5); return; }
    const f = it ? it.f : (app.city && app.city.faces ? app.city.faces.faces.find((q) => q.site_id === siteId) : null); if (f && f.asset_id) { status(`${f.hblock}: not exported on this server · fetching the street and running the engine, about two minutes …`); goTo(String(f.asset_id), () => status('could not open ' + f.hblock), 1.5); } });   /* a checked street without its scene file here (a fresh clone): run it from the City's data */
}
// the rail: six stages, each a place on the one scroll
$('steps').onclick = (e) => { const li = e.target.closest('li[data-s]'); if (!li) return; scrollToT(STOP_T[+li.dataset.s]); };

// ---------- scroll -> t ----------
function onScroll() { if (app.report) return; const total = document.body.scrollHeight - window.innerHeight; app.tTarget = total > 0 ? Math.min(SCROLL, Math.max(0, window.scrollY / total * SCROLL)) : 0; if (!app.easing) { app.easing = true; requestAnimationFrame(ease); }
  if (app.flyTo != null && Math.abs(app.tTarget - app.flyTo) < 0.01) { app.flyTo = null; app.snapping = false; clearTimeout(app.flyT); }
  clearTimeout(app.snapT); app.snapT = setTimeout(snap, 360); }
/* the wheel has stopped: if the page sits in the no-man's-land near a stage's anchor it settles on the anchor, so a stage is always seen whole */
function snap() { if (app.report || app.busy || app.snapping) return; const t = app.tTarget; const anchors = STOP_T.concat([diveT().ta, diveT().tb]); if (anchors.some((a) => Math.abs(t - a) <= 0.03)) return;   /* resting on an anchor already: nothing to settle (two anchors within one radius must never hand the page back and forth) */
  let best = null; for (const a of anchors) if (Math.abs(t - a) < 0.28 && (best == null || Math.abs(t - a) < Math.abs(t - best))) best = a; if (best == null) return; scrollToT(best); }
/* the camera glides: each frame t closes a fifth of the gap to the scroll position, so a wheel step becomes a short move, not a jump */
function ease() { const d = (app.tTarget == null ? app.t : app.tTarget) - app.t; if (Math.abs(d) < 0.0012) { app.easing = false; if (d !== 0) stepTo(app.tTarget); if (app.moving && !app.settleT) app.settleT = setTimeout(settle, 140); return; } app.moving = true; clearTimeout(app.settleT); app.settleT = null; stepTo(app.t + d * 0.2); requestAnimationFrame(ease); }
/* the camera has been still for a moment: the canvas returns to full resolution and the atlas paints its hatch again (one heavy frame, not one per wheel pause) */
function settle() { app.settleT = null; if (app.easing) return; app.moving = false; app.hatchFresh = true; requestDraw(); }   /* app.moving: the atlas paints no hatch while the camera glides */
/* the zoomed plan (02 with a section open, 03) drags along the street: the camera's centre moves, clamped to the block face */
function startPan(e, sc) {
  if (app.drag || !app.S) return; e.preventDefault(); const blk = app.S.street.block; const pf = sc.planFrame(); const x0 = e.clientX; const pan0 = app.pan || 0;
  const half = planWAt(app.t) / 2 / pf.ppm; const sl = sc.slab; const cB = (sl.u0 + sl.u1) / 2; const lo = blk.u_from + half - 8 - cB, hi = blk.u_to - half + 8 - cB; const clamp = (p) => (lo > hi ? 0 : Math.max(lo, Math.min(hi, p)));
  const move = (ev) => { app.pan = clamp(pan0 - (ev.clientX - x0) / pf.ppm); sc._pf = null; sc.setStop(app.t); requestDraw(); };
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); app.panning = false; draw(); };
  app.panning = true; window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); draw();
}
/* a click on a tree opens its section beside the plan (02): the plan narrows, the section fades in, no scroll needed */
function openSection() { app.sectionOpen = true; if (!app.secAnim) { app.secAnim = true; requestAnimationFrame(secTick); } }
function secTick() { const target = app.sectionOpen ? 1 : 0; const d = target - app.secK; if (Math.abs(d) < 0.01) { app.secK = target; app.secAnim = false; } else app.secK += d * 0.2; app.scene._pf = null; app.scene.setStop(app.t); draw(); if (app.secAnim) requestAnimationFrame(secTick); }
function stepTo(t) { const was = stage(app.t); app.t = t; if (t >= diveT().ts) { $('tip').classList.remove('on'); app.hotArea = null; } if (t < 0.68 || t >= 3) app.hotTree = null; if (app.menuOpen) closeMenu(); if (app.S) { syncScene(); app.scene.setStop(t); draw(); if (was !== stage(t)) question(); } }
window.addEventListener('scroll', onScroll, { passive: true });
window.addEventListener('keydown', (e) => { const tag = (e.target && e.target.tagName) || ''; if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey || app.report) return;
  if (/^[1-6]$/.test(e.key)) { e.preventDefault(); scrollToT(STOP_T[+e.key - 1]); } else if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); scrollToT(STOP_T[Math.min(5, stage(app.t) + 1)]); } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); scrollToT(STOP_T[Math.max(0, stage(app.t) - 1)]); } });   /* the stages are places: 1–6 or the arrows go there */
window.addEventListener('resize', () => { if (app.S) { app.scene._resize(); app.scene.setStop(app.t); draw(); } });

(async function boot() {
  app.scene = new One(canvas);
  Promise.all([loadTreeArt(), loadGroundArt()]).then(() => { if (app.S && app.scene.needsArtRebuild) { app.scene.needsArtRebuild = false; app.scene.build(app.S); app.scene.setStop(app.t); } if (app.S) draw(); });   /* a block built before the tree art arrived is rebuilt with it */
  r30().catch(() => null);                                                                              // the land-use rows' widths (R30) for the inputs panel
  await load(app.site);
  if (params.get('scenario')) { try { const S2 = await api.scene(app.site.split('_')[0] + '_scenario'); app.scenario = S2; await loadModels([...new Set(S2.trees.filter((x) => x.species_ref).map((x) => x.species_ref.model).concat(S2.candidate ? [S2.candidate.model] : []))]); if (params.get('scenario') === 'saved') { app.S = S2; saveScenario(); app.S = app.existing; } } catch (e) { /* no scenario side file yet */ } }   // reviewer links and captures: the last scenario side file as the working scenario (&scenario=saved also saves it as A)
  if (params.get('t')) { const total = document.body.scrollHeight - window.innerHeight; window.scrollTo(0, Math.min(SCROLL, +params.get('t')) / SCROLL * total); }
  onScroll(); app.t = app.tTarget || 0; syncScene(); app.scene.setStop(app.t); draw(); question();   /* no glide on arrival */
  window.__app = app; window.__draw = draw; window.__evaluate = evaluate; window.__capture = capture; window.__sheetPdf = sheetPdf; window.__resultFor = resultFor; window.__save = saveScenario; window.__scrollToT = scrollToT; window.__reportFor = reportFor;
  if (params.get('capture')) setTimeout(() => capture(params.get('capture')), 3000);
})();
async function capture(name, download = false) {
  const sc = app.scene; sc.render(); const W = sc.W, H = sc.H; const out = document.createElement('canvas'); out.width = W; out.height = H; const g = out.getContext('2d');
  g.drawImage(sc.canvas, 0, 0, W, H);
  const css = Array.from(document.styleSheets).filter((s) => { try { return s.cssRules && /scene\.css|one\.css/.test(s.href || ''); } catch (e) { return false; } }).map((s) => Array.from(s.cssRules).map((r) => r.cssText).join('\n')).join('\n');
  /* both SVG layers: the overlay (plan, labels, captions) and the section layer #osec (SECTION A–A and B–B live there since they were split off the per-frame overlay) */
  for (const id of ['overlay', 'osec']) { const src = $(id); if (id === 'osec' && (!src.children.length || +src.style.opacity === 0)) continue;
    const svg = src.cloneNode(true); svg.setAttribute('xmlns', svgNS); svg.setAttribute('width', W); svg.setAttribute('height', H); svg.style.opacity = '';
    if (id === 'osec') { const d = $('overlay').querySelector('defs').cloneNode(true); svg.insertBefore(d, svg.firstChild); }   /* the patterns and clip paths are declared once, in the overlay's defs */
    const style = document.createElementNS(svgNS, 'style'); style.textContent = css.replace(/#overlay /g, ''); svg.insertBefore(style, svg.firstChild);
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' })); const img = new Image();
    await new Promise((res) => { img.onload = res; img.onerror = res; img.src = url; }); g.globalAlpha = id === 'osec' ? Math.max(0, Math.min(1, +src.style.opacity || 1)) : 1; g.drawImage(img, 0, 0, W, H); g.globalAlpha = 1; URL.revokeObjectURL(url); }
  // the question line, the rail, the result panel and the gate: rasterized as the page shows them (html2canvas, cdnjs); hand-drawn text if it cannot load
  if (await rasterHtml(g)) { const data_url0 = out.toDataURL('image/png'); const r0 = await fetch('/api/capture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, data_url: data_url0 }) }).then((x) => x.json()); document.title = 'captured:' + (r0.saved || r0.error); status(download ? 'saved ' + (r0.saved || r0.error) : ''); if (download) { const a = document.createElement('a'); a.href = data_url0; a.download = name + '.png'; a.click(); await sheetPdf(name, data_url0, W, H); } return; }
  g.fillStyle = '#F7F4EC'; g.fillRect(0, 0, W, 46); g.fillStyle = '#000'; g.font = '600 24px "Barlow Condensed", "Arial Narrow", sans-serif'; g.fillText($('q-text').textContent, 250, 32);
  const v = $('q-verdict'); g.font = '600 15px "Barlow Condensed", sans-serif'; const vw = g.measureText(v.textContent).width + 20; g.fillStyle = v.classList.contains('yes') ? '#557F52' : v.classList.contains('no') ? '#B0413E' : '#000'; g.fillRect(W - vw - 22, 10, vw, 24); g.fillStyle = '#fff'; g.fillText(v.textContent, W - vw - 12, 27);
  let y = 40; g.font = '600 15px "Barlow Condensed", sans-serif';
  for (const li of $('steps').children) { g.fillStyle = li.classList.contains('on') ? '#557F52' : li.classList.contains('next') ? '#BEBEBE' : '#000'; g.fillText(`${li.querySelector('b').textContent}  ${li.querySelector('span').textContent}`, 22, y); y += 24; }
  g.fillStyle = '#000'; g.font = '11px "IBM Plex Mono", monospace'; y += 10;
  const wrapTo = (l, x, wmax) => { const words = l.split(' '); let line = ''; for (const w of words) { const test = line ? line + ' ' + w : w; if (g.measureText(test).width > wmax && line) { g.fillText(line, x, y); y += 14; line = w; } else line = test; } if (line) { g.fillText(line, x, y); y += 14; } y += 4; };
  const story = app.t < 3;
  if (story) { const lines = [...$('ctl').children].filter((c) => c.tagName === 'DIV' && !c.classList.contains('tray') && !c.classList.contains('toggle')).map((c) => c.innerText.trim()).filter(Boolean); for (const l of lines) wrapTo(l, 22, 200); }
  else {                                                                                                // the scenario inputs (or the review) as words, and the rule result on the right
    const L = panelLines(app.S); const head = (t) => { g.font = '600 12px "Barlow Condensed", sans-serif'; g.fillStyle = '#000'; g.fillText(t, 22, y + 4); y += 18; g.font = '10px "IBM Plex Mono", monospace'; };
    head(app.report ? `SCENARIO ${app.report.id} · EXISTING → PROPOSED` : 'PROPOSED · SCENARIO INPUTS'); for (const l of L.inputs) wrapTo(l, 22, 240); head('ADVANCED · SITE & RULE CONTEXT'); for (const l of L.advanced) wrapTo(l, 22, 240);
    if (app.report && app.existing) { head('EXISTING'); wrapTo(`the City's tree · existing soil: no City record · no volume counted for today`, 22, 240); }
    const x0 = W - 246; const y1 = y; y = 80; g.fillStyle = '#F7F4EC'; g.fillRect(x0 - 10, 56, 256, 360); g.fillStyle = '#000'; g.font = '600 12px "Barlow Condensed", sans-serif'; g.fillText('RULE CHECK', x0, y); y += 26;
    const r = resultFor(app.S); g.font = '600 22px "Barlow Condensed", sans-serif'; g.fillStyle = r.state === 'yes' ? '#46693F' : r.state === 'no' ? '#B0413E' : r.state === 'review' ? '#A8742A' : '#000'; g.fillText(r.label, x0, y); y += 22; g.fillStyle = '#000'; g.font = '10px "IBM Plex Mono", monospace';
    for (const l of L.result.slice(1)) wrapTo(l, x0, 236); y = y1;
  }
  const data_url = out.toDataURL('image/png');
  const r = await fetch('/api/capture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, data_url }) }).then((x) => x.json());
  document.title = 'captured:' + (r.saved || r.error); status(download ? 'saved ' + (r.saved || r.error) : '');
  if (download) { const a = document.createElement('a'); a.href = data_url; a.download = name + '.png'; a.click(); await sheetPdf(name, data_url, W, H); }
}
async function rasterHtml(g) {
  try {
    if (!window.html2canvas) await new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); });
    for (const id of ['q', 'rail', 'result', 'tool', 'summary']) { const e = $(id); if (!e || (id !== 'q' && id !== 'rail' && !e.classList.contains('on'))) continue; const r = e.getBoundingClientRect(); const c = await window.html2canvas(e, { backgroundColor: null, scale: 1, logging: false, ignoreElements: (x) => x.tagName !== 'DETAILS' && x.tagName !== 'SUMMARY' && !!x.closest('details:not([open])') && !x.closest('summary') }); /* closed details stay closed in the raster */ g.drawImage(c, r.left, r.top); }
    return true;
  } catch (e) { console.warn('html2canvas', e); return false; }
}
// 3 deliver · the information PDF: page 1 the sheet as captured; page 2 the question and verdict, the two tables, what the rule read, the numbered captions, the grades of what is drawn
async function sheetPdf(name, png, W, H) {
  if (!window.jspdf) { status('pdf library not loaded'); return; } const { jsPDF } = window.jspdf; const S = app.S; const tr = S.trees.find((x) => x.selected); if (!tr) return;
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [W, H], hotfixes: ['px_scaling'] }); pdf.addImage(png, 'PNG', 0, 0, W, H);
  pdf.addPage([W, H], 'landscape'); const M = 70; let y = M; const line = (txt, size = 12, bold = false, col = 0) => { pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size); pdf.setTextColor(col); pdf.text(String(txt), M, y); y += size * 1.45; };
  const live = liveKnobs(S); const cand = candidateShown(S); const bd = S.band.design; const zs = tr.extensions && tr.extensions.zones ? tr.extensions.zones.find((z) => z.side === 'property' && z.status === 'KNOWN') : null;
  const strips = S.band.strips || []; const strip = strips.find((x) => tr.u >= x.u0 && tr.u <= x.u1); const have = tr.extensions && tr.extensions.share_total_m3 != null ? tr.extensions.share_total_m3 : tr.share_m3;
  const h = cand ? (cand.drawn_height_m || tr.height_m) : tr.height_m; const crownD = cand ? +(h * (cand.crown_ratio_of_height || 0.6)).toFixed(1) : tr.crown_diameter_m; const form = (cand && cand.roots && cand.roots.form) || (tr.roots && tr.roots.form) || 'heart';
  const rows = treeRows(S, tr, cand, { form, have, listed: cand ? !!cand.listed : !!(tr.table_9_3 && tr.table_9_3.listed), zs, strip, bd, live, h, crownD });
  line($('q-text').textContent, 26, true); line($('q-verdict').textContent, 14, true, $('q-verdict').classList.contains('no') ? '#B0413E' : $('q-verdict').classList.contains('yes') ? '#46693F' : 0); y += 10;
  const col2 = M + (W - 2 * M) / 2 + 20; const y0 = y;
  const tbl = (x, t) => { let yy = y0; pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.setTextColor(0); pdf.text(t.title, x, yy); yy += 18; for (const [a, b] of t.rows) { pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor('#555'); pdf.text(a, x, yy); pdf.setFont('courier', 'normal'); pdf.setFontSize(9.5); pdf.setTextColor(0); pdf.text(String(b), x + 150, yy, { maxWidth: (W - 2 * M) / 2 - 190 }); yy += 16; } return yy; };
  y = Math.max(tbl(M, rows.t1), tbl(col2, rows.t2)) + 16;
  const L = panelLines(S); const r = resultFor(S);
  line('RULE CHECK', 11, true, r.state === 'yes' ? '#46693F' : r.state === 'no' ? '#B0413E' : r.state === 'review' ? '#A8742A' : 0); for (const l of L.result) line(l, 9.5); y += 6;
  if (S !== app.existing && app.existing) {                                                                  // existing vs proposed: the baseline the page never overwrote, beside the scenario
    const ex = app.existing; const rE = resultFor(ex); const kE = knobs(ex), kP = knobs(S); const selE = ex.trees.find((x) => x.selected); const bdE = ex.band.design;
    line('EXISTING → PROPOSED', 11, true);
    line(`existing: ${(selE.species_ref && selE.species_ref.common) || selE.genus} · ${fmt(selE.height_m)} m · ${selE.table_9_3 && selE.table_9_3.listed ? selE.table_9_3.class : 'not in Table 9-3'} · band ${fmt(bdE.v_to - bdE.v_from, 2)} m wide (assumed curb ${fmt(kE.curb, 1)} m from the centreline) · existing soil: no City record · NOT ASSESSABLE`, 9.5); void rE;
    line(`proposed: ${cand ? cand.common + ' · ' + (cand.listed ? cand.class : 'not in Table 9-3') : 'the City\'s tree'} · band ${fmt(bd.v_to - bd.v_from, 2)} × ${fmt(live.depth, 2)} m · ${(live.soil || '').replace('_', ' ')} · curb ${fmt(kP.curb, 1)} m from the centreline · ${resultLine(r)}`, 9.5); y += 6;
  }
  line('SCENARIO INPUTS', 11, true); for (const l of L.inputs) line(l, 9.5); line('ADVANCED · SITE & RULE CONTEXT', 11, true); for (const l of L.advanced) line(l, 9.5); y += 8;
  if (S.captions && S.captions.length) { line('THE SHEET, NUMBERED', 11, true); for (const c of S.captions) { pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9.5); pdf.setTextColor(0); pdf.text(`${c.n}  ${c.title.toUpperCase()}`, M, y); y += 13; pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5); const ls = pdf.splitTextToSize(c.text, W - 2 * M - 20); pdf.text(ls, M + 20, y); y += ls.length * 12 + 6; } }
  y += 6; line('GRADES OF WHAT IS DRAWN', 11, true);
  for (const t of ['City record: positions and depths the City publishes (water mains depth of cover, sewer invert levels).', 'Derived: read from City records (sewer manhole rim minus invert).', 'Nominal: a cited minimum cover or an author-assigned form (crown spread, root form, private corridors) — not a measurement.', 'Design assumption: the knobs, the engineered soil under the slab, the species card — the designer\'s, not the City\'s.', 'Not published: everything in the black — nobody\'s record; never implied to be known.']) { pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor('#333'); const ls = pdf.splitTextToSize('· ' + t, W - 2 * M); pdf.text(ls, M, y); y += ls.length * 11.5; }
  pdf.setFontSize(8); pdf.setTextColor('#777'); pdf.text(`Root Room · ${S.title.hblock}, ${S.title.side} · ${new Date().toISOString().slice(0, 10)} · every number from the scene file ${S.site_id}`, M, H - 30);
  if (window.__pdfDry) { window.__pdfDry.pages = pdf.internal.getNumberOfPages(); window.__pdfDry.bytes = pdf.output('arraybuffer').byteLength; return; }   // a check without a download
  pdf.save(name + '.pdf');
}
