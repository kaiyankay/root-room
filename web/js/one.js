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
import { STATIC, makeStaticApi } from './static-api.js';   /* GitHub Pages: the same page, the engine in the browser */

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
const WATER = '#E4E2D8', LAND = '#F6F3EC', PAPER = '#F6F3EC';   /* water: a warm light grey, a shade below the paper, never a blue against the page's key */   // atlas base: warm paper land, very pale cool water
const INK = '58,56,46';   // the map's one ink (charcoal green) for streets, boundaries and patterns
const VERDICT_HATCH = { Large: 'cross', Medium: 'ring', Small: 'diag', none: 'x' };   // the rule's answer on an area's checked streets, as a pattern over the colour
const REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);   /* the visitor asked for no motion: the camera steps instead of gliding, nothing pulses */
const STOPS = 6;   // one continuous scroll: 01 location · 02 street plan · 03 tree + ground · 04 scenario builder · 05 axonometric results · 06 summary & report
let SCROLL = 5.5;  // t in [0, 5.5]: the page ends on the summary's anchor, nothing to bounce back from; the stage is floor(t) (the dive's last leg, t ≥ 0.8, already belongs to the street)
// one two-panel layout for stages 02–04: rail | zone labels | PLAN (the chunk + margin m either side) | gap | SECTION A–A with its tables | the right column (03 the City's record, 04 the rule result)
const SHEET = { rail: 280, west: 118, planW: 610, gap: 26, margin: 3.0, head: 104, foot: 140, east: 250 };   /* foot: the scale bar (yBot + 22/44) and the key row (H − 22) live here */
// the sheet follows the window: the rail, the zone-label column, the plan, the gap and the right column share the width, and the
// section takes the rest — never less than it needs to draw (the layout was first composed at 2000 × 1100; smaller windows scale it)
function fitSheet() {
  const W = app.scene ? app.scene.W : 2000; if (app.fitW === W) return; app.fitW = W;
  const wide = W >= 1900; SHEET.rail = wide ? 240 : W >= 1500 ? 205 : 190; SHEET.west = wide ? 130 : 118; SHEET.east = wide ? 330 : 310; SHEET.toolL = 0; SHEET.toolR = (wide ? 350 : 332) - 14;   /* 04's two panels: wide enough for one-line labels (2026-10-13) */   /* 04: the same column as 03 (toolR = eastRec - 14) */ SHEET.eastRec = wide ? 330 : 300;   /* 03: the fact sheet (WHAT DO WE KNOW) needs the width */ SHEET.gap = wide ? 26 : 16;   /* the right column: the record (03) is narrow, the tool (04) is two columns wide */
  const avail = W - SHEET.rail - SHEET.west - SHEET.eastRec - SHEET.gap - 10; SHEET.planW = Math.round(Math.max(300, Math.min(560, avail * 0.38)));
  $('rail').style.width = SHEET.rail + 'px'; $('q').style.paddingLeft = (SHEET.rail + 26) + 'px'; $('result').style.width = (SHEET.eastRec - 14) + 'px'; $('summary').style.left = (SHEET.rail + 20) + 'px';
  if (app.scene) app.scene._pf = null;
}
// the state: selectedTree (the scene file's selected tree) · existing (the canonical scene, never touched by a what-if) · workingScenario
// (app.scenario, the last engine run on the section, written to a _scenario side file) · savedScenarios (app.saved, immutable snapshots)
const app = { S: null, site: params.get('site') || 'KE-198571_curb10', t: 0, busy: false, city: null, shade: params.get('shade') || 'species',
              drag: null, dragCard: null, armed: null, ctlKey: '', cityKey: '', resKey: '', sumKey: '',
              existing: null, scenario: null, saved: [], axo: 0, axoFocus: 0, cutU: 0, report: null, sumOpen: false, hotNeed: false, sectionOpen: false, secK: 0, secAnim: false, cls: null,
              chosen: false, area: null, foundNote: null };   /* chosen: the user has picked a street (a card, a map street, a tree dot, an address); until then the loaded street is only the frame the city is drawn in */
const STAGE_TAG = ['THE ATLAS', 'STREET PLAN', 'EXISTING CONDITION', 'WORKING SCENARIO', 'AXONOMETRIC RESULT', 'SUMMARY & REPORT'];
const smoothInv = (y) => { let lo = 0, hi = 1; for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (smooth(m) < y) lo = m; else hi = m; } return (lo + hi) / 2; };
const diveT = () => { const sc = app.scene; const pa = (sc && sc.divePA) || 0.3, ps = (sc && sc.divePS) || 0.85, pb = (sc && sc.divePB) || 0.6; return { ta: smoothInv(pa), tb: smoothInv(pb), ts: smoothInv(ps) }; };   /* ta: the area level · tb: the block level (tree dots) · ts: the street arrives */
const SHOW_FACES = false;   /* checked-street marks on the map (lines in the area, dots on the city): off — the list in the column is the chooser, the map stays a map */
const DOTS_HALF_W = 560;   /* the block level: tree dots are drawn and clickable once the half-width is under this (m) */
const atlasLevel = (t) => { const dv = diveT(); const hw = app.scene && app.scene.halfW1; return t >= dv.ts ? 'street' : (hw != null ? hw < DOTS_HALF_W : t >= dv.tb - 0.05) ? 'block' : t >= dv.ta - 0.1 ? 'area' : 'city'; };
const stage = (t) => (t < diveT().ts ? 0 : Math.min(5, Math.floor(Math.max(1, t))));
// 02 → 03: the plan alone on the sheet (02) becomes a strip across the top (03) as the section comes in (1.72 → 2.0)
const secOnAt = (t) => smooth((t - 1.72) / 0.28);
const toolKAt = (t) => smooth((t - 2.55) / 0.45);   /* 03 → 04: the record column leaves, the inputs arrive, the ribbon and the section move into the instrument's column */
const TRAY_W = 236;   /* 04: the species tray stands on the sheet's left, beside the drawing (a transverse section is tall and narrow: the sheet's width was empty, its height short) */
function box04(sc) { const pw = SHEET.toolR; const toolX = SHEET.rail + 10, trayX = sc.W - pw - 10; const x = toolX + pw + 16; const W = trayX - 16 - x; const yStrip = SHEET.head; const y = SHEET.head + 8; const H = sc.H - y - 22; return { x, W, yStrip, y, H, toolX, trayX, panelW: pw, panelY: 58, panelH: sc.H - 70 }; }   /* 2026-10-12 (the user): the levers on the left, the species on the right, the two panels the same size, the section between them */   /* 2026-10-12: 04 has no ribbon (switching trees is 03's job); the cell's length is a bar over the section's title; the species stand on a tray under the drawing */   /* 2026-10-12: 04 keeps 03's frame — the ribbon and the section where they were, one column on the right; the glide 03 → 04 only swaps the column's content and draws the handles */   /* 04: the ribbon at yStrip, SECTION A–A under it to the foot (B–B left 04 on 2026-10-09: the cell and the need-box are lengths along the band, read on the ribbon) */   /* the section: on the sheet from 03; at 02 the plan is alone and the right column holds the chosen tree's card */
const planWAt = (t) => (app.scene && app.scene.S ? app.scene.planFrame().pw : 600); void planWAt;
const VIEW02 = 23;    /* 02: the plan is this many metres tall (2 m past the centreline to the house fronts), so the band and its trees read; a long block pans */
const STRIP_H = 64;  /* 03: the block face as a locator ribbon of this height — the band, its trees and the A–A mark, to pick and switch; the section takes the rest of the sheet (2026-10-09: was 112, the whole half-street) */
// which scene a stage draws: 01–03 the existing condition; 04 the working scenario (or the existing until something is changed); 05–06 the selected saved scenario
const sceneFor = (t) => (app.report ? app.report.scene : t < 3 ? (app.existing || app.S) : t < 4 ? (app.scenario || app.existing || app.S) : (app.saved[app.axo] ? app.saved[app.axo].scene : (app.scenario || app.existing || app.S)));   /* 05: the chosen frozen scenario, else the working state as it stands (02–04 decide it; saving is optional); 06 compares frozen ones */
function syncScene() { const S = sceneFor(app.t); if (S && S !== app.S) { app.S = S; buildScene(S); app.ctlKey = ''; app.resKey = ''; question(); } else if (S && app.builtFor !== S && !(app.t >= 3 && app.t < 4)) buildScene(S); }   /* a block deferred at 04 is built before it is seen */
const SOIL_NOTE = { native_soil: 'native soil · credited in full', structural_soil: 'structural soil · 50 % credited · R06', soil_cell: 'soil cells · no credit factor in the source (R11) · manual conditions R10', other: 'other soil · as the engine reads it' };
// the sampled block faces (scripts/batch_faces.py): one colour per "largest Table 9-2 class that fits" at the batch knobs
const FACE_COL = { Large: '#748A69', Medium: '#A4B596', Small: '#CBD4BE', none: '#E5E8DC', review: '#F6F3EC', unknown: '#C9C6BC' }   /* a sage ramp, low in chroma, warmed toward the paper: the areas, the water and the sheet are one key */;   /* review: paper with a red dashed edge — the rule stops at this trunk */   // one hue by size; red only for nothing
const FACE_TXT = { Large: 'Large fits', Medium: 'Medium fits', Small: 'only Small', none: 'nothing fits', review: 'manual review', unknown: 'no record' };
const KINDW = { water_main: 'water main', water_main_abandoned: 'abandoned water main', sewer_main: 'sewer main', sewer_service: 'sewer service', electrical_conduit: 'street-lighting conduit', corridor: 'nominal utility corridor', gas_main: 'gas main' };
const KINDL = { water_main: 'WATER', water_main_abandoned: 'ABANDONED WATER', sewer_main: 'SEWER', sewer_service: 'SEWER SERVICE', electrical_conduit: 'ST-LIGHTING CONDUIT', corridor: 'CORRIDOR' };
/* the clearance strips that run through a trunk's position: why the rule counts no soil at that tree (its share is REVIEW_REQUIRED) */
function trunkConflicts(S, tr) { return [...new Set((S.band.strips || []).filter((sp) => sp.u0 <= tr.u && tr.u <= sp.u1 && sp.v0 - 0.02 <= tr.v && tr.v <= sp.v1 + 0.02).map((sp) => sp.kind))]; }
function outsideBand(S, tr) { const bd = S.band && S.band.design; if (!bd) return null; return tr.v < bd.v_from ? bd.v_from - tr.v : tr.v > bd.v_to ? tr.v - bd.v_to : 0; }   /* how far the City's point for the trunk lies outside the band (0 inside) */
function reviewWhy(S, tr) { const ks = trunkConflicts(S, tr).map((k) => KINDW[k] || k.replace(/_/g, ' ')); const out = outsideBand(S, tr); return ks.length ? `a ${ks.join(' and a ')} clearance runs through this trunk's position; the rule counts no soil at this cell.` : out ? `the City's point for this trunk lies ${fmt(out, 1)} m ${tr.v < S.band.design.v_from ? 'on the road side of' : 'behind'} the band · the rule counts no soil at this cell` : 'the rule stops at this cell: its share is left to review'; }
const inPoly = (ring, u, v) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > v) !== (yj > v) && u < (xj - xi) * (v - yi) / (yj - yi) + xi) c = !c; } return c; };
// where the camera stands at the end of each stop (azimuth from the road side, elevation), radians
const A6 = 2 * Math.PI - 0.62, E6 = 0.53; // 05 the axonometric (30° above, the reference sheet's isometric feel): the block seen from the road side, above; drag turns it
const DROP_H = 9;                          // 05: the tree comes down into its pit from this high
const EXPLODE_GAP = 4.0;                   // 05: metres between the exploded layers (the surface stays solid when lifted, so the gap clears the planter under it)
const SHEET_ON = 4.3;                      // the captions and the orbit, once the camera has arrived
const STOP_T = [0, 1.5, 2.5, 3.5, 4.85, 5.5];   // where a click on the rail lands
const SOIL_PAT = { native_soil: 'p4', structural_soil: 'p1', soil_cell: 'p2', other: 'p7' };   // the growing medium's stratum tile by soil type (library swatches)
const SOIL_TXT = { native_soil: 'NATIVE SOIL', structural_soil: 'STRUCTURAL SOIL', soil_cell: 'SOIL CELLS', other: 'OTHER SOIL' };
const SOIL_SHORT = { native_soil: 'NATIVE', structural_soil: 'STRUCTURAL', soil_cell: 'SOIL CELLS', other: 'OTHER' };
const SOIL_FAC = { native_soil: '× 1', structural_soil: '× 0.5', soil_cell: 'by hand', other: '—' };   /* 04: what the rule does with each soil, on the control (the user, 2026-10-12: say the soil's arithmetic first) */
const SOIL_RULE = { native_soil: 'native soil: its whole volume counts', structural_soil: 'structural soil: half its volume counts, and only for a replacement tree', soil_cell: 'soil cells: no factor in the rule source · a person reviews this cell', other: 'other soil: not defined in the rule · nothing counts' };
const LAND_TXT = { residential_detached: 'RESIDENTIAL · DETACHED', residential_low_rise: 'RESIDENTIAL · LOW-RISE', residential_mid_high_rise_ftn_greenway: 'RESIDENTIAL · MID / HIGH-RISE · FTN · GREENWAY', commercial_mixed_use: 'COMMERCIAL · MIXED USE' };
const LAND_SHORT = { residential_detached: 'DETACHED', residential_low_rise: 'LOW-RISE', residential_mid_high_rise_ftn_greenway: 'MID / HIGH-RISE', commercial_mixed_use: 'COMMERCIAL' };

class One extends Scene {
  constructor(canvas) { super(canvas); this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -3000, 3000); this.lidZ = 0; this.dAz = 0; this.dEl = 0; this.cutOn = false; this.renderer.localClippingEnabled = true; this._clipOn = null; this.flatRoots = true; }   /* the page draws the subject's roots itself, as a section in the planter's near face (scene.js builds no three-dimensional roots) */
  /* 05: the block the axonometric cuts out of the street — the file's slab along the street, but only the street's own width
     (a metre of road before the curb face to the property line) and three metres of ground, deeper if a recorded main in it needs it */
  axoBox(S) {
    const sl = this.slab; const st = S.street; const v0 = st.curb_face_v != null ? st.curb_face_v - 1.0 : sl.v0, v1 = st.property_line_v != null ? st.property_line_v : sl.v1;
    /* along the street the block holds the chosen tree and its two neighbours — a row of three, the street's own rhythm (the user, 2026-10-12: one tree alone is poorer than three) — three metres past each neighbour's trunk, held between 16 and 36 m about the chosen trunk */
    const sel = (S.trees || []).find((q) => q.selected); const cu = sel ? sel.u : (sl.u0 + sl.u1) / 2; const others = (S.trees || []).filter((q) => !q.selected && q.height_m);
    const west = others.filter((q) => q.u < cu).sort((a, b) => b.u - a.u)[0], east = others.filter((q) => q.u > cu).sort((a, b) => a.u - b.u)[0];
    let u0 = west ? west.u - 3 : cu - 12, u1 = east ? east.u + 3 : cu + 12;
    u0 = Math.max(u0, cu - 18); u1 = Math.min(u1, cu + 18); if (u1 - u0 < 16) { u0 = Math.min(u0, cu - 8); u1 = Math.max(u1, cu + 8); }
    let D = 3.0; for (const f of S.facilities || []) { if (f.depth_top_m == null || !f.path_uv || f.kind === 'corridor') continue; if (!f.path_uv.some(([u, v]) => u >= u0 && u <= u1 && v >= v0 && v <= v1)) continue; D = Math.max(D, Math.min(4.5, f.depth_top_m + (f.diameter_mm || 200) / 1000 + 0.6)); }
    return { u0: +u0.toFixed(2), u1: +u1.toFixed(2), v0, v1, depth_m: +D.toFixed(1) };
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
    const gotoLL = app.goto && this.lonlatOf ? this.lonlatOf(app.goto.u, app.goto.v) : null;   /* the chosen point, carried across frames */
    const uv = (lon, lat) => { const x = (lon - lon0) * kx, y = (lat - lat0) * ky; return [x * ux + y * uy, x * px + y * py]; }; this.uvOf = uv; if (gotoLL) { const [gu, gv] = uv(gotoLL[0], gotoLL[1]); app.goto = { u: gu, v: gv }; }   /* lon/lat → this frame: a searched tree is flown to before its street is loaded */
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
    this.northUV = new THREE.Vector3(uy, py, 0); { const n = this.northUV.clone().normalize(); let d = Math.PI / 2 - Math.atan2(n.y, n.x); d = ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; this.turnDeg = Math.abs(d) * 180 / Math.PI; }   // north in this frame: the city view stands north-up, the block view street-up
    { const n = this.northUV.clone().normalize(), e = new THREE.Vector3(n.y, -n.x, 0); let e0 = 1e9, e1 = -1e9, n0 = 1e9, n1 = -1e9; for (const a of areaRings) for (const [u, v] of a.ring) { const pe = u * e.x + v * e.y, pn = u * n.x + v * n.y; e0 = Math.min(e0, pe); e1 = Math.max(e1, pe); n0 = Math.min(n0, pn); n1 = Math.max(n1, pn); } this.cityNE = { e0, e1, n0, n1 }; this.cityCentre = new THREE.Vector3().addScaledVector(e, (e0 + e1) / 2).addScaledVector(n, (n0 + n1) / 2); }   /* the city's extent east–west and north–south, as the north-up view sees it */
    this.faceUV = []; if (city.faces) for (const f of city.faces.faces) { if (!f.run_ok || !f.line_lonlat) continue; const [a, b] = f.line_lonlat.map(([lon, lat]) => uv(lon, lat)); this.faceUV.push({ f, a, b }); }
    this.treeUV = city.trees.map((p) => { const [u, v] = uv(p[0], p[1]); return [u, v, p[2], p[3] || 0, p[4] || 0]; });   /* every public tree in this frame: the block level's dots, each one a door to its own 03 */
    const shares = city.shares; const cap = city.capacity; const lo = shares ? shares.share_min : 0.05, hi = shares ? shares.share_max : 0.25;
    const areaShade = (name) => {
      if (shade === 'large') { const a = cap && cap.areas[name]; if (!a || a.large_fits_share == null) return RAMP[0]; return RAMP[Math.min(5, Math.floor(a.large_fits_share * 5.999))]; }
      const ai = this.areaInfo.find((q) => q.name === name); return ai && ai.verdict ? FACE_COL[ai.verdict] : null;   /* the rule's answer on the area's checked streets, a lightness ramp; no checked street yet: the paper */
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
      const paintWater = (alpha) => { if (!rg) return; g.save(); g.globalAlpha = alpha; g.fillStyle = WATER; for (const poly of rg.ocean.concat(rg.water)) { g.beginPath(); for (const r of poly) path(ll(r)); g.fill('evenodd'); } g.restore(); };   /* under the colour in full; over it as a wash, so the shoreline shows through the areas that run into the sea without a hard, ragged cut */
      paintWater(1);
      // 2 · parks and larger green spaces, the faintest context
      if (city.parks) { g.fillStyle = 'rgba(110,146,104,.13)'; for (const f of city.parks.features) { if (!f.geometry) continue; const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates; for (const pp of polys) for (const r of pp) { g.beginPath(); path(ll(r)); g.fill(); } } }
      // 3 · the thematic layer, printed: far = the 22 areas on the ramp, near = the real blocks on the same ramp (share of trees on the City's list)
      const shareIdx = (sh) => Math.max(0, Math.min(5, Math.floor((sh - lo) / (hi - lo + 1e-9) * 6)));
      const soft = (hex) => { const h = hex.replace('#', ''), p = PAPER.replace('#', ''); const k = 0.3; return '#' + [0, 2, 4].map((i) => Math.round(parseInt(h.slice(i, i + 2), 16) * (1 - k) + parseInt(p.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join(''); };   /* closer in, the colour steps back toward the paper: the fabric and the trees read, the area's answer still tints the ground */
      if (!fine) { for (const a of areaRings) { const c2 = areaShade(a.name); if (!c2) continue; g.fillStyle = c2; g.beginPath(); path(a.ring); g.fill(); } }
      else if (city.blocks) { void shareIdx; for (const bk of city.blocks.blocks) { const pts = ll(bk.r); if (!near(pts)) continue; if (bk._ar === undefined) { let su = 0, sv = 0; for (const [u, v] of pts) { su += u; sv += v; } const ar2 = this.areaAt(su / pts.length, sv / pts.length); bk._ar = ar2 ? ar2.name : null; } const c2 = bk._ar ? areaShade(bk._ar) : null; if (!c2) continue; g.fillStyle = soft(c2); g.beginPath(); path(pts); g.fill(); } }
      paintWater(0.28);   /* closer in the blocks are the unit, in their area's colour: one meaning at every level */
      // 4 · the street fabric, one weight system across the whole map, over the colour: neighbours' blocks as their street lines, the City's streets, the regional roads
      g.lineCap = 'round'; g.lineJoin = 'round';
      if (city.regionBlocks) { g.strokeStyle = ink(fine ? .13 : .1); g.lineWidth = w(2.4, fine ? .45 : .55); for (const r of city.regionBlocks.blocks) { const pts = ll(r); if (!near(pts)) continue; g.beginPath(); path(pts); g.stroke(); } }
      if (city.streets) for (const f of city.streets.features) { if (!f.geometry) continue; const res = f.properties.streetuse === 'Residential'; g.strokeStyle = ink(res ? (fine ? .16 : .1) : (fine ? .26 : .22)); g.lineWidth = res ? w(2.4, fine ? .45 : .55) : w(5, fine ? .8 : 1.2); const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates; for (const l of lines) line(l.map(([lon, lat]) => uv(lon, lat))); }
      if (rg) { g.save(); g.beginPath(); g.rect(0, 0, N, N); for (const a of areaRings) path(a.ring); g.clip('evenodd'); for (const rd of rg.roads) { const big = rd.c === 'freeway' || rd.c === 'highway' || rd.c === 'arterial'; g.strokeStyle = ink(big ? (fine ? .24 : .22) : .1); g.lineWidth = big ? w(5, fine ? .8 : 1.3) : w(2.4, .45); line(rd.p.map(([lon, lat]) => uv(lon, lat))); } g.restore(); }
      // 5 · boundaries: blocks fine, areas soft charcoal green (never hard black)
      if (fine && city.blocks) { g.strokeStyle = ink(.28); g.lineWidth = w(.7, .4); for (const bk of city.blocks.blocks) { const pts = ll(bk.r); if (!near(pts)) continue; g.beginPath(); path(pts); g.stroke(); } }
      // 7 · close in: every public tree (on the list = ink, sized by class; the rest faint), and the checked streets
      const DOT = [ink(.25), ink(.6), ink(.72), ink(.85)];
      if (fine) for (const pass of [0, 1]) for (const p of city.trees) { const cls = p[3] || 0; if ((pass === 0) !== (cls === 0)) continue; const [u, v] = uv(p[0], p[1]); if (Math.abs(u - cx) > R || Math.abs(v - cy) > R) continue; g.fillStyle = DOT[cls]; if (fine === 2) { g.beginPath(); g.arc(X(u), Y(v), (cls ? 1.1 : 0.8) * k, 0, 6.2832); g.fill(); } else { const r = cls ? 1.6 : 1.0; g.fillRect(X(u) - r / 2, Y(v) - r / 2, r, r); } }
      /* the checked streets are not painted into the ground: they are the clickable lines of the focused area in the overlay (draw), so no bar is ever left lying in a street */
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.minFilter = THREE.LinearMipmapLinearFilter; return tex;   /* painted in sRGB and read as sRGB: the map's green is the legend's green, not a washed copy of it */
    };
    const RF = 12000, RN = 4200, RB = 1000;
    /* the three textures are painted in a site's frame (origin at the tree, u along the street). Another site has another frame, but the
       ground is the same: a texture already painted is moved rigidly into the new frame (a rotation and a shift) instead of being painted
       again — always for the city (24 km), for the 8.4 km one when the new site is within 2.4 km of the old centre, for the 2 km one within 350 m.
       What must be painted is painted after the first frame, while the camera is still on its way. */
    const frameB = { lon0, lat0, kx, ky, ux, uy, px, py }; const toLonLat = (u, v) => { const x = u * ux + v * px, y = u * uy + v * py; return [lon0 + x / kx, lat0 + y / ky]; }; this.lonlatOf = toLonLat;
    const dTheta = (A) => Math.atan2(A.ux * px + A.uy * py, A.ux * ux + A.uy * uy); const here = (P) => uv(P.centre[0], P.centre[1]);
    const mk = (R, z, order) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(2 * R, 2 * R), new THREE.MeshBasicMaterial({ depthWrite: false, transparent: true, opacity: 0, visible: false })); m.position.z = z; m.renderOrder = order; this.scene.add(m); return m; };
    if (!this.cityPlaneFar) { this.cityPlaneFar = mk(RF, -0.10, -11); this.cityPlane = mk(RN, -0.08, -10); this.cityPlaneNear = mk(RB, -0.06, -9); }
    const place = (m, P) => { const [x, y] = here(P); m.position.x = x; m.position.y = y; m.rotation.z = dTheta(P.frame); m.material.map = P.tex; m.material.visible = true; m.material.needsUpdate = true; };
    const fresh = (m, P, name, cx, cy, R, fine) => { const tex = timed(name, () => paint(cx, cy, R, 4096, fine)); const Q = { tex, frame: frameB, centre: toLonLat(cx, cy) }; this[P] = Q; place(m, Q); return Q; };
    const dist = (P) => { const [x, y] = here(P); return Math.hypot(x, y); };   /* the old texture's centre, seen from the new tree */
    this._repaint = (which, cx, cy) => { if (which === 'mid') fresh(this.cityPlane, 'midP', 'mid 8.4 km', cx, cy, RN, true); else fresh(this.cityPlaneNear, 'nearP', 'near 2 km', cx, cy, RB, 2); if (app.S) { this.setStop(app.t); this.render(); } };   /* the camera has settled far from where the close textures were painted (another area, another block): paint them again around it, so the zoomed map is never the 24 km texture enlarged */
    const TP = performance.now(); const timed = (name, f) => { const t0 = performance.now(); const r = f(); console.debug('city texture ·', name, Math.round(performance.now() - t0), 'ms'); return r; }; void TP;
    const cc = this.cityCentre;
    if (this.farP) place(this.cityPlaneFar, this.farP); else fresh(this.cityPlaneFar, 'farP', 'far 24 km', cc.x, cc.y, RF, false);
    const midOk = this.midP && dist(this.midP) < 2400, nearOk = this.nearP && dist(this.nearP) < 350;
    if (midOk) place(this.cityPlane, this.midP); else this.cityPlane.material.visible = false;
    if (nearOk) place(this.cityPlaneNear, this.nearP); else this.cityPlaneNear.material.visible = false;
    this.cityPlaneFar.material.opacity = 1;
    const gen = (this._cityGen = (this._cityGen || 0) + 1);   /* a later build cancels the deferred paints of an earlier one */
    const later = (fn) => setTimeout(() => { if (this._cityGen === gen) { fn(); if (app.S) { this.setStop(app.t); this.render(); } } }, 30);
    if (!midOk) later(() => { fresh(this.cityPlane, 'midP', 'mid 8.4 km', 0, 0, RN, true); this.cityPlane.material.opacity = 0; if (!nearOk) later(() => fresh(this.cityPlaneNear, 'nearP', 'near 2 km', 0, 0, RB, 2)); });
    else if (!nearOk) later(() => fresh(this.cityPlaneNear, 'nearP', 'near 2 km', 0, 0, RB, 2));
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
  build(S) { this.billboards = []; this._candForm = S.candidate ? S.candidate.form : null; super.build(S); this.buildTufts(S); for (const m of [this.cityPlaneFar, this.cityPlane, this.cityPlaneNear]) if (m) this.scene.add(m); this.g.slab.visible = true; this.g.cut.visible = false; this.slabScale = 1; this._pf = null;
    /* 05: the street's surface (the road, the sidewalk, the kerb, the lines at grade, the protection barrier) is its own layer, lifted first; the planter with its tree and roots second; the mains third; the native ground is the base */
    const surf = new THREE.Group(); for (const k of ['ground', 'above']) for (const o of [...this.g[k].children]) if (o.userData.surf) surf.add(o); this.scene.add(surf); this.g.surf = surf; if (!this.lift) this.lift = [0, 0, 0];
    /* the planting: the subject tree (the species card's tree, else the City's), its bowl and its roots — one group that is lowered into the pit in 05's sequence; the pit itself stays in the planter */
    /* the subject's roots as 03 draws them — a section drawing in the planter's face that faces the camera, few and clear, out of the bowl's sides and bottom; a three-dimensional root system read as a tangle from above (the user, 2026-10-12) */
    { const bd = S.band.design; const sel = S.trees.find((q) => q.selected); const pm = this.plant; if (bd && sel && pm) { const cand = S.candidate; const form = (cand && cand.roots && cand.roots.form) || (sel.roots && sel.roots.form) || 'heart'; const cell = sel.cell && sel.cell.u_from != null ? sel.cell : null; const ax = this.axo || this.slab;
      const u0 = cell ? Math.max(cell.u_from, ax.u0) : ax.u0, u1 = cell ? Math.min(cell.u_to, ax.u1) : ax.u1; const reach = Math.max(1.0, pm.rb / 2 + 1.0); const rootDeep = Math.max(bd.depth_m + 0.35, pm.rd + 1.1); const crossings = (S.band.strips || []).filter((q) => q.type === 'crossing');
      const zone = (u, z) => (z > -0.04 || z < -rootDeep || Math.abs(u - sel.u) > reach + pm.rb / 2 || u < u0 || u > u1 || crossings.some((q) => u >= q.u0 && u <= q.u1)) ? 0 : (z >= -bd.depth_m ? 2 : 1);   /* 2 the credited soil · 1 ground below it (drawn faint) · 0 the cell's end, a crossing, or too far */
      const rl = rootsFew(sel.u, form, zone, 1000 + (+sel.tree_id || 1), pm.rb, pm.rd, reach); const vF = sel.v;   /* the section plane through the trunk: the roots leave the bowl itself */ const sets = this.rootSets[cand ? 'acc' : 'ink']; const buf = { heavy: [], medium: [], thin: [] }; const faint = [];
      for (const [a0, z0, a1, z1, w, zc] of rl.segs) { if (zc === 1) { faint.push(a0, vF, z0, a1, vF, z1); continue; } (w > 0.085 ? buf.heavy : w > 0.05 ? buf.medium : buf.thin).push(a0, vF, z0, a1, vF, z1); }
      const add = (arr, mat) => { if (!arr.length) return; const o = this.segs(arr, mat); o.renderOrder = 6; o.userData.subjRoots = true; o.userData.n = arr.length / 6; this.g.roots.add(o); };
      add(buf.heavy, sets.heavy); add(buf.medium, sets.medium); add(buf.thin, sets.thin); add(faint, this.rootSets.grey.medium); const cut = []; for (const [a, b, c, d] of rl.cut) cut.push(a, vF, b, c, vF, d); add(cut, this.rootCut); } }
    const pl = new THREE.Group(); const subj = this.candGroup || this.selTreeGroup; if (subj) pl.add(subj); for (const o of [...this.g.roots.children]) if (o.userData.ball || o.userData.subjRoots) pl.add(o); this.scene.add(pl); this.g.plant = pl;
    for (const o of [...this.g.slab.children]) if (o.userData.needBox) this.g.roots.add(o);   /* the need-box is the planter's, not the base's: it lifts with it */
    if (this.drop == null) { this.drop = 0; this.grow = 1; this.out = 0; } }
  // 2 the street: the frame holds the chunk and the one row of houses behind it — the far lane at the bottom, the houses' backs
  // at the top, the drawing below the question line, the chunk a little left of centre so the right-hand paper takes the text column
  ppmPlan() { const a = this.axis(0, 0, 0, 1, 0, 0); return Math.hypot(a.d.x, a.d.y); }   /* px per metre of the plan this frame */
  planFrame() {
    fitSheet(); const t = app.t; const k23 = secOnAt(t); const kt = toolKAt(t); const key = `${k23.toFixed(3)}|${kt.toFixed(3)}|${(app.pan || 0).toFixed(2)}|${app.pick || ''}`;
    if (this._pf && this._pfW === this.W && this._pfH === this.H && this._pfKey === key) return this._pf;
    const S = this.S, sl = this.slab, st = S.street, blk = st.block; const cl = st.centreline_v;
    const yTop0 = SHEET.head, yBot = this.H - SHEET.foot; const wx0 = SHEET.rail + SHEET.west; const b4 = box04(this); const yTop = lerp(yTop0, b4.yStrip, kt), wx0e = lerp(wx0, b4.x, kt);   /* 04: the ribbon sits over the instrument's column */
    const spanA = (blk.u_to - blk.u_from) + 8, cA = (blk.u_from + blk.u_to) / 2, cB = (sl.u0 + sl.u1) / 2;
    /* 02: the plan alone, VIEW02 m tall so the band reads; the whole block fits when it can, else the frame sits on the chosen tree and pans */
    const C = S.context || {}; const farCurb = C.far_curb_v != null ? C.far_curb_v : st.curb_face_v != null ? 2 * cl - st.curb_face_v : st.median ? medianOf(S).ocF : cl - 12; const frontV = (() => { const vs = (S.buildings || []).map((b) => Math.min(...b.ring_uv.map((q) => q[1]))).filter((v) => v > st.property_line_v); return vs.length ? Math.min(...vs) : st.property_line_v + 8; })(); const top02 = Math.min(S.extent.v_to, frontV + 20); const bandV = S.band && S.band.design ? (S.band.design.v_from + S.band.design.v_to) / 2 : (st.curb_face_v != null ? st.curb_face_v : cl); const b02 = Math.min(farCurb - 2, bandV - 0.618 * (top02 - bandV)); const view02 = Math.max(VIEW02, top02 - b02);   /* 02: the house fronts and 20 m behind them at the top (apartments and detached alike), the band near the golden section, the far curb in view */
    const pk = pickTree(S); const cB2 = pk ? pk.u : cB;
    const pw02 = this.W - wx0 - SHEET.eastRec - 24; const ppmA = (yBot - yTop) / view02; const fitsA = spanA * ppmA <= pw02; const ccA = fitsA ? cA : cB2 + (app.pan || 0);   /* the column on the right (the chosen tree's card and its section) is kept clear */
    /* 03: the whole block face as a strip across the top, the record column kept clear */
    const pw03 = lerp(this.W - wx0 - SHEET.eastRec - 24, b4.W, kt); const ppmB = Math.min(pw03 / spanA, STRIP_H / 7.5);
    const pw = lerp(pw02, pw03, k23); const ppm = Math.exp(lerp(Math.log(ppmA), Math.log(ppmB), k23)); const cc = lerp(ccA, cA, k23);
    const halfW = this.W / 2 / ppm; const xc = wx0e + pw / 2; const cu = cc + (this.W / 2 - xc) / ppm;
    const yBotP = lerp(yBot, yTop + STRIP_H, k23); const bottomV = lerp(b02, st.median ? medianOf(S).cfF - 2.5 : st.curb_face_v - 2.0, k23);   /* medianOf: st.median carries no cfF (2026-10-09: NaN here blanked the plan at 02 and 03 on every median street) */   /* 03: the ribbon holds the band, the walk and two metres of road */   /* 02: the far curb at the panel's bottom edge; 03: the strip holds the band */
    const cv = bottomV + (yBotP - this.H / 2) / ppm;
    this._pf = { cu, cv, halfW, ppm, pw, viewX: wx0e + pw, yBotP, k23, kt, fitsA, wx0: wx0e, yTop }; this._pfW = this.W; this._pfH = this.H; this._pfKey = key; return this._pf;
  }
  // one camera, framed on a centre with a half-width, from a direction (top: dir (0,0,1); oblique: azimuth/elevation from the road side)
  fitAxo(dir, up, Lf) {
    const sl = this.axo || this.slab; const S = this.S; const D = sl.depth_m; const G = EXPLODE_GAP; const hTop = Math.max(8, ...(S.trees || []).filter((q) => q.u >= sl.u0 - 4 && q.u <= sl.u1 + 4).map((q) => q.height_m || 6), S.candidate ? S.candidate.drawn_height_m || 8 : 0);
    const zP = G * (Lf[1] + Lf[2]), zS = G * (Lf[0] + Lf[1] + Lf[2]); const ex = (Lf[0] + Lf[1] + Lf[2]) / 3; const zs = [-D, 0, G * Lf[2], zP, zS]; const pts = []; for (const z of zs) for (const [u, v] of [[sl.u0, sl.v0], [sl.u0, sl.v1], [sl.u1, sl.v0], [sl.u1, sl.v1]]) pts.push([u, v, z]);
    const sel = (S.trees || []).find((q) => q.selected); const crowns = (S.trees || []).filter((q) => q.u >= sl.u0 - 4 && q.u <= sl.u1 + 4 && !(S.candidate && q.selected)).map((q) => [q.u, q.v, q.height_m || 6, (q.crown_diameter_m || (q.height_m || 6) * 0.6) / 2]); if (S.candidate && sel) crowns.push([sel.u, sel.v, S.candidate.drawn_height_m || 8, (S.candidate.drawn_height_m || 8) * (S.candidate.crown_ratio_of_height || 0.6) / 2]);
    for (const [u, v, h, rr] of crowns) for (const [du, dv] of [[-rr, 0], [rr, 0], [0, -rr], [0, rr]]) pts.push([u + du, v + dv, zP + h]);   /* the real crowns, not a tree-high box over the whole block */
    const c0 = new THREE.Vector3((sl.u0 + sl.u1) / 2, (sl.v0 + sl.v1) / 2, (-D + zP + hTop) / 2); void ex; let halfW = 60; this.frame(halfW, c0, dir, up); this.cam.updateMatrixWorld(true); this.cam.matrixWorldInverse.copy(this.cam.matrixWorld).invert();   /* project() needs the view matrix of this frame, not of the last render */
    const area = { x0: SHEET.rail + 40, x1: this.W - SHEET.eastRec - 24 - 44, y0: 124, y1: this.H - 36 };   /* the drawing area: right of the rail, under the title line, left of the labels' column */   /* the drawing area: right of the rail, under the title line, left of the column (03's position), with room for the layer pins */
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
    const tex = this.treeTexture(asset, tone); const texInk = tone === '#A0A0A0' ? this.treeTexture(asset, '#26382C') : null;   /* a ghost (today's tree under a species card) also carries its ink: at 05 it stands as the real tree until it is taken out */ const span = Math.max(1e-6, asset.ground.y - asset.top.y); const crownD = h * ratio; const Hw = h * asset.h / span, Ww = crownD * asset.w / Math.max(1e-6, asset.right.x - asset.left.x);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(Ww, Hw), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, alphaTest: 0.1 })); m.renderOrder = 4;
    const below = (asset.h - asset.ground.y) * (h / span); m.position.set(u, v, Hw / 2 - below); m.userData.base = new THREE.Vector3(u, v, Hw / 2 - below); m.userData.dx = (asset.w / 2 - asset.ground.x) * (Ww / asset.w); m.userData.tree = tag; m.userData.sprite = true; m.userData.mapGrey = tex; m.userData.mapInk = texInk;
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
  /* the one visible turn of the camera: from north-up (the map) to street-up (the plan) over t 1 → 1.35, a rotation about the page's centre; TURN_DEG is its size, 0 for an east–west street */
  upAt(t) { const n = this.northUV; const UP = new THREE.Vector3(0, 1, 0); if (!n || t >= 1.3) return UP; const k = smooth((t - 1) / 0.3); const a0 = Math.atan2(n.y, n.x); let d = Math.PI / 2 - a0; d = ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; const a = a0 + d * k; return new THREE.Vector3(Math.cos(a), Math.sin(a), 0); }
  setStop(t) {
    this.pose = t; const S = this.S; if (!S) return; const sl = this.slab;
    { const at05 = t >= 4 && t < 5; const ax = this.axo || sl; for (const g of this.treeGroups || []) g.visible = !at05 || (g.userData.u >= ax.u0 - 0.2 && g.userData.u <= ax.u1 + 0.2); }   /* 05: only the trees that stand on the block; a neighbour's crown no longer floats in from beyond its end (the user, 2026-10-13) */
    const cS = new THREE.Vector3((sl.u0 + sl.u1) / 2, (sl.v0 + sl.v1) / 2, 0);   /* the dive and the plan centre on the file's slab; the axonometric frames its own box (fitAxo) */
    const obl = (az, el) => new THREE.Vector3(Math.sin(az) * Math.cos(el), -Math.cos(az) * Math.cos(el), Math.sin(el));
    const TOP = new THREE.Vector3(0, 0, 1), UPTOP = new THREE.Vector3(0, 1, 0), UPZ = new THREE.Vector3(0, 0, 1);
    const c6 = new THREE.Vector3(cS.x, cS.y, -2);
    let halfW, dir, up, centre = cS; let rise = 1, lid = 0, clip = false; const cut = false;
    if (t < 1) {                                                   // 1 the city → its area → the street: three legs, then the tilt
      const asp = this.W / this.H; const ne = this.cityNE || { e0: -12000, e1: 12000, n0: -6500, n1: 6500 };
      const railPx = SHEET.rail, eastPx = LOC_W + 16, topPx = 54; const freeW = Math.max(300, this.W - railPx - eastPx), freeH = Math.max(300, this.H - topPx);   /* the paper between the rail and the column, under the title */
      const halfW0 = Math.max((ne.n1 - ne.n0) / 2 * asp * (this.H / freeH) * 1.02, (ne.e1 - ne.e0) / 2 * (this.W / freeW) * 1.03);   /* the whole city on that paper */
      const wpp = 2 * halfW0 / this.W; const nUp = (this.northUV || UPTOP).clone().normalize(), eRt = new THREE.Vector3(nUp.y, -nUp.x, 0);
      const cityHalfPx = (ne.e1 - ne.e0) / 2 / wpp; const cx = Math.max(railPx + 8 + cityHalfPx, this.W - LOC_W - 6 - cityHalfPx);   /* the city sits against the column: its east boundary line stays in view, 6 px before the column's edge; the paper left of it holds the legend */
      const dx = cx - this.W / 2, dy = (topPx + freeH / 2) - this.H / 2;   /* where the city's centre sits on the screen, from the screen's centre (px) */
      const c0 = this.cityCentre || new THREE.Vector3(0, 0, 0); const cityC = c0.clone().addScaledVector(eRt, -dx * wpp).addScaledVector(nUp, dy * wpp);
      const ar = (app.area && this.areaInfo ? this.areaInfo.find((a) => a.name === app.area) : null) || this.homeArea;
      const aHW = ar ? Math.max(1200, Math.max((ar.box.u1 - ar.box.u0) * 0.62, (ar.box.v1 - ar.box.v0) * 0.62 * asp)) : 1500; const aC = ar ? new THREE.Vector3(ar.u, ar.v, 0) : cS.clone();
      const L = (a, b, k) => Math.exp(lerp(Math.log(a), Math.log(b), k));
      const pf = this.planFrame(); const planC = new THREE.Vector3(pf.cu, pf.cv, 0); const l0 = Math.log(halfW0), l1 = Math.log(pf.halfW); const p = smooth(t);
      halfW = Math.exp(lerp(l0, l1, p));   /* one curve from the city to the plan: no leg ends, no restart */
      const pa = Math.max(0.05, Math.min(0.8, (l0 - Math.log(aHW)) / (l0 - l1))), ps = Math.max(pa + 0.05, Math.min(0.95, (l0 - Math.log(60)) / (l0 - l1))); this.divePA = pa; this.divePS = ps; this.divePB = Math.max(pa + 0.05, Math.min(ps - 0.05, (l0 - Math.log(330)) / (l0 - l1)));   /* where on that curve the area, the block (330 m half-width) and the street are */
      const cS2 = app.goto ? new THREE.Vector3(app.goto.u, app.goto.v, 0) : cS;   /* a tree or street chosen but not loaded yet: the dive goes there, not to the frame's own street */
      const pb = this.divePB || (pa + ps) / 2;   /* the block level: the camera has arrived over the chosen block by then (it used to be half-way between the area's centre and the street, so the block sat off the screen) */
      centre = p < pa ? cityC.clone().lerp(aC, p / pa) : p < pb ? aC.clone().lerp(cS2, (p - pa) / (pb - pa)) : p < ps ? cS2.clone() : cS2.clone().lerp(planC, (p - ps) / (1 - ps));
      dir = TOP; up = (this.northUV || UPTOP).clone().normalize();   /* north-up through the city, the area, the block and the dive's last leg; the turn to street-up is its own beat once the plan is the drawing (upAt) */
      if (app.panUV) { centre = centre.clone(); centre.x += app.panUV.u; centre.y += app.panUV.v; }   /* the wheel's own offset: the map zooms about the pointer, not along the dive's path; it fades out toward the whole city */
      this.halfW1 = halfW; this.centre1 = centre; if (this.cityPlane && this.cityPlane.material.map) this.cityPlane.material.opacity = smooth((Math.log(6500) - Math.log(halfW)) / (Math.log(6500) - Math.log(2600)));   // the 8.4 km texture is fully in by the area level, so the city stipple never shows enlarged
      if (this.cityPlaneNear && this.cityPlaneNear.material.map) this.cityPlaneNear.material.opacity = smooth((Math.log(1400) - Math.log(halfW)) / (Math.log(1400) - Math.log(700)));
      rise = 0; centre = new THREE.Vector3(centre.x, centre.y, 0);
    } else if (t < 4) {                                            // 02 the street plan · 03 tree + ground · 04 the scenario builder: straight down onto the chunk; the plan and the section hold still
      const pf = this.planFrame(); halfW = pf.halfW; dir = TOP; up = this.upAt(t); centre = new THREE.Vector3(pf.cu, pf.cv, 0);
    } else {                                                       // 05 the axonometric: the plan has gone; the block appears under the same frame and the camera walks round to the road side
      const s = smooth((t - 4.1) / 0.6); const pf = this.planFrame(); clip = t > 4.05; const Lf = this.lift || [0, 0, 0]; const ex = (Lf[0] + Lf[1] + Lf[2]) / 3; this.explode = ex;   /* 05: the block opens a layer at a time (app.axoFocus → lift[]), not with the scroll */
      const az = A6 + this.dAz, e = Math.max(0.12, Math.min(1.3, E6 + this.dEl)); const dirF = obl(az, e).normalize();
      /* the block is fitted to the sheet's drawing area — right of the rail, under the title, left of the captions' column — whatever the window and the explode */
      const fit = this.fitAxo(dirF, UPZ, Lf);
      halfW = lerp(pf.halfW, fit.halfW, s); dir = TOP.clone().lerp(dirF, s).normalize(); up = UPTOP.clone().lerp(UPZ, s).normalize(); centre = new THREE.Vector3(pf.cu, pf.cv, 0).lerp(fit.centre, s);
      if (this.cityPlane && this.cityPlane.material.map) this.cityPlane.material.opacity = 1;
    }
    this.g.slab.scale.z = Math.max(0.001, rise); this.g.slab.visible = rise > 0.01;
    const Lx = t >= 4 && t < 5 ? (this.lift || [0, 0, 0]) : [0, 0, 0]; const G5 = EXPLODE_GAP;   /* the three lifts: surface · planter · mains (0 closed, 1 open) */
    for (const o of this.g.slab.children) { if (o.renderOrder >= 5) o.visible = !cut && (o.renderOrder === 7 ? Lx[1] < 0.5 : Lx[2] < 0.5); if (o.userData.bandCut) o.visible = Lx[1] < 0.35; }   /* the X-ray ghosts of the mains leave the block once the mains themselves lift; the band's cut on the end faces once the planter lifts */
    if (this.rootSets) { const k5 = t >= 4 ? 1.0 : 1; if (this._rootK !== k5) { this._rootK = k5; for (const set of Object.values(this.rootSets)) { set.heavy.linewidth = 1.7 * k5; set.medium.linewidth = 0.9 * k5; set.thin.linewidth = 0.55 * k5; } if (this.rootHalo) { this.rootHalo.heavy.linewidth = 1.7 * k5 * 1.9; this.rootHalo.medium.linewidth = 0.9 * k5 * 1.9; this.rootHalo.thin.linewidth = 0.55 * k5 * 1.9; } } }   /* the roots a quarter heavier in the axonometric, still a drawing, never a cable */   /* the roots a weight heavier in the axonometric, where the planter is the subject */
    if (this.slabLid) { const e2 = Lx[0]; this.slabLid.material.opacity = smooth((e2 - 0.15) / 0.5) * 0.96; this.slabLid.visible = e2 > 0.15; }   // the block's lid turns to paper once the surface has lifted off it
    this.g.ground.position.z = lid; this.lidZ = lid;
    { const zM = G5 * Lx[2], zP = G5 * (Lx[1] + Lx[2]), zS = G5 * (Lx[0] + Lx[1] + Lx[2]); this.g.below.position.z = zM; for (const k of ['ground', 'above', 'sel', 'roots']) this.g[k].position.z = (k === 'ground' ? lid : 0) + zP; if (this.g.surf) this.g.surf.position.z = lid + zS; this.liftZ = { surf: zS, planter: zP, mains: zM };
      if (this.g.plant) { const at05 = t >= 4 && t < 5; const dr = at05 ? (this.drop || 0) : 0, gr = at05 ? (this.grow == null ? 1 : this.grow) : 1; this.g.plant.position.z = zP + dr * DROP_H; this.g.plant.visible = !at05 || dr < 0.999;   /* the tree with its bowl hangs above the pit and comes down into it; before the sequence reaches it, it is not there */
        for (const o of this.g.plant.children) if (o.userData.subjRoots && o.geometry) o.geometry.instanceCount = gr >= 1 ? Infinity : Math.round(o.userData.n * gr);
        if (this.ghostGroup) { const out = at05 ? (this.out || 0) : 0; this.ghostGroup.position.z = out * DROP_H * 0.8; this.ghostGroup.visible = out < 0.995; for (const m of this.ghostGroup.children) if (m.material && m.userData.sprite) { m.material.opacity = 1 - out; const want = at05 && m.userData.mapInk ? m.userData.mapInk : m.userData.mapGrey; if (want && m.material.map !== want) { m.material.map = want; m.material.needsUpdate = true; } } } }   /* the City's tree goes first: lifted out and fading, before the new one comes down */
      { const top = t >= 4 && t < 5 && Lx[0] > 0.02; for (const m of this.billboards || []) if (m.userData.sprite) { m.material.depthTest = !top; m.renderOrder = top ? 9 : 4; } }
      if (this.g.surf) for (const o of this.g.surf.children) if (o.userData.surfSlab) { o.material.opacity = Lx[0]; o.visible = Lx[0] > 0.02; } }   /* the pavement structure shows once the surface has lifted off the block */   /* the crowns stand over the lifted surface: once the layers open, the tree sprites draw last and in front, as the reference sheet's trees do */   /* exploded: the native ground (the base) · the mains · the planter with its tree and roots · the surface — each layer rides on the ones below it */
    const near = t < 1 ? smooth((t - 0.55) / 0.3) : t < 4 ? 1 : smooth((t - 4.1) / 0.2);   // the block's own paper appears only once the dive is close; at the axonometric it fades in after the plan has gone
    const exP = Lx[1]; const glass = 0;   /* the surface stays solid when lifted (03's surfaces are solid); the planter's own lid turns to glass once the planter lifts, so the ball and the roots read inside it */
    for (const m of this.groundMeshes) { m.material.opacity = near; m.material.transparent = near < 1; m.material.depthWrite = near > 0.5; }
    for (const o of this.g.ground.children) if (o.isMesh && !this.groundMeshes.includes(o)) { if (o.userData.op0 == null) o.userData.op0 = o.material.opacity; const k = o.userData.kerb || o.userData.tuft ? 1 : o.userData.bandTop ? 1 - exP * 0.86 : o.userData.band ? 1 : 1 - glass; o.material.opacity = o.userData.op0 * k; o.material.transparent = o.material.opacity < 1; o.material.depthWrite = !o.userData.band && glass < 0.1 && !(o.userData.bandTop && exP > 0.1); }   /* the lifted planter's lid is glass: it must not write depth, or the roots under it vanish (a 0.9 m band is seen only through its lid) */
    this.g.above.visible = near > 0.05; this.g.below.visible = near > 0.05; this.g.ground.visible = near > 0.02; this.g.roots.visible = near > 0.05; if (this.g.surf) this.g.surf.visible = near > 0.02;
    if (t < 4.0 || t >= 5) for (const k of ['ground', 'above', 'below', 'sel', 'slab', 'roots', 'surf', 'plant']) if (this.g[k]) this.g[k].visible = false;   // 01–04 are the map and the flat sheet; the modelled block is the axonometric of a saved scenario (05)
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
if (STATIC) Object.assign(api, makeStaticApi({ onStage: runStage }));   /* static host: GETs from the build's files, runs in this browser */
async function cityData() {
  if (app.city) return app.city;
  const [trees, areas, parks, streets, shares] = await Promise.all([
    fetch(STATIC ? 'api/trees_all.json' : '/api/trees_all').then((r) => r.json()), fetch('data/local-area-boundary.geojson').then((r) => r.ok ? r.json() : null).catch(() => null),
    fetch('data/parks-polygon-representation.geojson').then((r) => r.ok ? r.json() : null).catch(() => null), fetch('data/public-streets.geojson').then((r) => r.ok ? r.json() : null).catch(() => null),
    fetch('data/local_area_species.json').then((r) => r.ok ? r.json() : null).catch(() => null)]);
  const regionBlocks = await fetch('data/region_blocks.json').then((r) => r.ok ? r.json() : null).catch(() => null);
  const [capacity, faces, region, blocks] = await Promise.all([fetch('data/local_area_capacity.json').then((r) => r.ok ? r.json() : null).catch(() => null), fetch('data/citywide_faces.json').then((r) => r.ok ? r.json() : null).catch(() => null), fetch('data/region_base.json').then((r) => r.ok ? r.json() : null).catch(() => null), fetch('data/city_blocks.json').then((r) => r.ok ? r.json() : null).catch(() => null)]);
  const street = trees.filter((p) => (p[4] || 0) !== 2);   /* the map's trees: beside a street or in a median; a park tree is not a street tree (the user, 2026-10-09) */
  app.city = { trees: street, areas, parks, streets, shares, capacity, faces, region, blocks, regionBlocks }; return app.city;
}
/* the median of a scene (site_type median): its centre, its half-width (live: the pending curb knob or the file's), its curb faces [near +v, far -v],
   the backs of the curbs (the band's edges) and the roadway's outer curbs (the City's fixtures, assumed; a fallback 3 m short of each property line) */
function medianOf(S, half) { const st = S.street, md = st.median; if (!md) return null; const h = half != null ? half : md.half_width_m; const c = md.centre_v, cw = (st.widths_m && st.widths_m.curb) || 0.15; const oc = (S.context && S.context.outer_curb_v) || [null, null];
  return { c, h, cw, cfN: c + h, cfF: c - h, v_from: c - h + cw, v_to: c + h - cw, ocN: oc[0] != null ? oc[0] : st.property_line_v - 3.0, ocF: oc[1] != null ? oc[1] : (st.property_line_far_v != null ? st.property_line_far_v + 3.0 : st.centreline_v - 14), ocKnown: [oc[0] != null, oc[1] != null], width: 2 * h, file: md }; }
const bandWidth = (S) => (S.band && S.band.design ? S.band.design.v_to - S.band.design.v_from : (S.street.widths_m || {}).front_boulevard);
function knobs(S) { const k = S.knobs; return { site_id: S.site_id.split('_')[0], curb: k.curb_offset_from_centreline_m && k.curb_offset_from_centreline_m.value, depth: k.soil_depth_m && k.soil_depth_m.value, target: k.target_tree_class && k.target_tree_class.value, soil: k.soil_type && k.soil_type.value, land_use: k.land_use && k.land_use.value, width_level: k.width_level && k.width_level.value, replacement: !!(k.tree_state && k.tree_state.value === 'vacant_replacement'), extensions: (S.band.zones || []).map((z) => ({ side: z.side, width_m: z.width_applied_m, soil_type: z.soil_type, provenance: z.provenance, status: z.status })), candidate: S.candidate ? S.candidate.id : null, curb_provenance: k.curb_offset_from_centreline_m && k.curb_offset_from_centreline_m.provenance === 'CONFIRMED_SITE_DATA' ? 'CONFIRMED_SITE_DATA' : null, curb_evidence: k.curb_offset_from_centreline_m && k.curb_offset_from_centreline_m.provenance === 'CONFIRMED_SITE_DATA' ? k.curb_offset_from_centreline_m.evidence : null }; }
async function show(S) {
  for (const f of S.facilities || []) if (f.depth_top_m != null && f.depth_top_m < 0.05 && !f.depth_unusable) { f.depth_unusable = f.depth_top_m; f.depth_top_m = null; f.grade = 'unknown'; f.label = (f.label || '') + ' · depth not usable (derived ' + f.depth_unusable.toFixed(2) + ' m)'; }   /* a derived depth at or above grade (a bad rim or invert) is not a depth: the facility is drawn as depth unknown on every stage (2026-10-09, a combined sewer at −1.07 m hung in the sky) */
  app.swapping = true; app.S = S;   /* the swap: until the city textures, the block and the camera are all in the new street's frame, no frame is drawn (the overlay in one frame over a canvas in the other was the mirrored map seen while a street loaded) */ const ids = new Set(); for (const t of S.trees) if (t.species_ref) ids.add(t.species_ref.model); if (S.candidate) ids.add(S.candidate.model); await loadModels([...ids]);
  const city = await cityData(); const ck = `${S.site_id.split('_')[0]}|${app.shade}`;
  if (ck !== app.cityKey) { const T1 = performance.now(); await app.scene.buildCity(S, city, app.shade); app.cityKey = ck; console.debug('show · city textures', Math.round(performance.now() - T1), 'ms'); }   // the city texture is drawn once per block, not per engine run
  /* at 04 the 3-D block is behind the sections: an engine run redraws the sections now and rebuilds the block when the page is idle
     (or when the scroll reaches it), so a change answers in the time the sections take, not the 0.3–1 s the block takes */
  const same = app.builtFor && app.builtFor.site_id.split('_')[0] === S.site_id.split('_')[0];
  const T2 = performance.now(); if (app.t >= 3 && app.t < 4 && same) scheduleBuild(); else buildScene(S); console.debug('show · block built', Math.round(performance.now() - T2), 'ms');
  app.swapping = false; app.scene.setStop(app.t); question(); app.ctlKey = ''; draw();
}
function buildScene(S) { clearTimeout(app.buildT); app.scene.build(S); app.builtFor = S; }
function scheduleBuild() { clearTimeout(app.buildT); app.buildT = setTimeout(() => { if (app.busy || app.drag) { scheduleBuild(); return; } if (app.S && app.builtFor !== app.S) { buildScene(app.S); app.scene.setStop(app.t); draw(); } }, 1500); }
async function load(site) { runStart('open', 'OPENING THE STREET'); const T0 = performance.now(); try { const S = await api.scene(site); console.debug('load · scene fetched', Math.round(performance.now() - T0), 'ms'); if (!(S && S.band && S.band.design)) throw new Error((S && S.error) || 'no scene for ' + site); app.existing = S; app.scenario = null; app.saved = []; app.axo = 0; app.axoPlayed = ''; app.axoP = 0; app.pan = 0; app.cutU = 0; app.pick = null; await show(S); app.site = site; if (STATIC && STATIC.pilot && site === STATIC.pilot && !app.pilotCard) app.pilotCard = { site, hblock: S.title.hblock, side: S.title.side, n: S.trees.length, cls: bandFit(S).cls || 'unknown' };   /* the online demo's one street: a card of its own at the top of the index */ await restoreSaved(site); draw(); status(''); runEnd(true); return true; } catch (e) { runEnd(false); status(e.message); return false; } }   /* false: no usable scene file on this server (a fresh clone) — the caller may run the tree instead */
// a change: the page shows it at once (app.pending), the engine runs (about 40 s: the block-face engine and the scene exporter), the file replaces it.
// story mode (selecting a tree) runs from the existing baseline's knobs and refreshes the baseline; scenario / review run from the
// scenario's knobs and the server writes the _scenario side file, so the existing condition on disk is never overwritten by a what-if
async function evaluate(patch) {
  if (app.busy) return; app.busy = true; app.pending = patch; closeMenu(); question(); app.ctlKey = ''; app.resKey = ''; draw();
  const runTree = patch.site_id ? ((app.existing || app.S).trees.find((x) => x.site_id === patch.site_id) || null) : null; const runName = runTree ? ((runTree.species_ref && runTree.species_ref.common) || runTree.genus || 'the tree') : '';
  status(patch.candidate_only ? 'placing the tree in the ground …' : runTree ? `reading the ground under ${runName} …` : 'the rule is running …');
  runStart(patch.candidate_only ? 'place' : 'engine', patch.candidate_only ? 'PLACING THE TREE' : runTree ? `READING THE GROUND · ${runName.toUpperCase()}` : 'RUNNING THE RULE');
  const haveNow = (() => { const s0 = (app.S && app.S.trees.find((x) => x.selected)) || null; if (!s0) return null; const E = s0.extensions || {}; return E.share_total_m3 != null ? E.share_total_m3 : s0.share_m3; })(); const ground = app.t >= 3 && !patch.candidate_only; if (ground) app.prevHave = haveNow;   /* 04: the readout shows the last count beside the new one for one run */
  const story = !!patch.canonical || app.t < 3; delete patch.canonical; const base = story ? { ...knobs(app.existing || app.S), candidate: null } : knobs(app.S);   // 02–03: selecting a tree refreshes the existing condition; 04: the working scenario
  try { const S = await api.evaluate({ ...base, ...patch, scenario: !story, scenario_fresh: !app.scenario, base_engine: (app.existing || app.S).engine_file });   /* fresh: no scenario run yet, the working ground is the existing one (the server must not reuse an old side file) */ app.pending = null; if (story) { if (app.cutKeep) { app.cutKeep = false; if (app.cutNext != null) { app.cutU = app.cutNext; app.cutNext = null; } app.pan = 0; } else if (!app.existing || app.existing.site_id.split('_')[0] !== S.site_id.split('_')[0]) app.cutU = 0; app.existing = S; app.scenario = null; app.pick = null; } else { app.scenario = S; if (ground) app.flashAt = performance.now(); } await show(S); if (story) { await restoreSaved(S.site_id); app.hotTree = null; } status(''); runEnd(true);   /* another tree: its own frozen scenarios, not an empty 05; the section shows the chosen tree, not whatever the pan left under the pointer */ } catch (e) { app.pending = null; app.cutKeep = false; app.cutNext = null; runEnd(false); status(e.message); question(); }
  app.busy = false; app.ctlKey = ''; app.resKey = ''; draw();
}
// ---------- the saved scenarios: immutable snapshots of a finished engine run on the section; the axonometric and the report read them ----------
async function saveScenario() {
  const S = app.S; if (!app.scenario || S !== app.scenario || app.busy || app.pending) return;   // only the last finished evaluation of the working scenario
  app.busy = true; status('freezing the scenario …'); runStart('freeze', 'FREEZING THE SCENARIO'); app.ctlKey = ''; draw();
  try {
    const F = await api.freezeScenario({ site_id: S.site_id.split('_')[0], scene: S, subject: resultFor(S).subject, cut_aa_u: app.cutU || 0 });   /* the server writes scene_<site>_<ID>.json and hands the file back: the snapshot is the file */
    app.saved.push(snapshotOf(F)); app.axo = app.saved.length - 1; app.savedHash = JSON.stringify(knobs(S)); app.ctlKey = ''; app.sumKey = ''; runEnd(true); status(`saved as scenario ${F.frozen.scenario_id}`);
    app.busy = false; draw();   /* the page stays at 04: the save is a record, VIEW SPATIAL RESULT is the way on */
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
  let first = null; if (stage(t0) === 5) { try { first = await capture('comparison', false, { quiet: true }); } catch (e) { first = null; } }   /* the comparison as it stands on the page, page 1 */
  app.report = snap; app.t = 3.5; syncScene(); app.scene.setStop(app.t); $('summary').classList.remove('on'); app.ctlKey = ''; app.resKey = ''; question(); draw();
  try { await capture(`scenario_${snap.id}_${app.site}_${new Date().toISOString().slice(0, 10)}`, !dry, { first }); } catch (e) { status(e.message); }
  app.report = null; app.t = t0; syncScene(); app.scene.setStop(app.t); app.ctlKey = ''; app.resKey = ''; app.sumKey = ''; question(); draw(); app.busy = false;
}
/* every move of the camera is explicit: the rail, keys 1–6, the arrows, a stage's own button, a street or a tree chosen at 01; the glide (ease) carries it there. The wheel only zooms the map at 01. */
const scrollToT = (t, dur) => { t = Math.max(0, Math.min(SCROLL, t)); const from = app.t, dist = Math.abs(t - from); app.wheelPt = null; app.tween = dist > 0.02 ? { from, to: t, t0: performance.now(), dur: REDUCED ? 1 : (dur != null ? dur : Math.min(1400, 500 + dist * 500)) + (from < 1 && t >= 1 && app.scene && app.scene.turnDeg > 15 ? 300 : 0) } : null; app.tTarget = t; $('tip').classList.remove('on'); app.hotArea = null; app.hotTreeDot = null; if (!app.easing) { app.easing = true; requestAnimationFrame(ease); } };   /* a timed, eased move: ~1.5 s for a stage, ~2.4 s across the sheet */
const flyTo = scrollToT;
// the rule's answer, one object for the verdict pill, the result panel, the table row, the review and the PDF — read from the engine's
// statuses, never forced to yes / no: KNOWN shares give YES or NOT YET; REVIEW_REQUIRED (a conflict at the tree, the tree outside the
// band) and soil cells (R11 no credit factor, R10 manual conditions) give MANUAL REVIEW; an unlisted species has no box; else NOT KNOWN
function resultFor(S) {
  const sel = S.trees.find((x) => x.selected); const cand = candidateShown(S); const live = liveKnobs(S); const lib = S.library; const cond = (lib && lib.condition) || 'shared_row';
  const r = { state: 'unknown', label: 'NOT ASSESSABLE', cls: '', available: null, required: null, gap: null, treeClass: null, condition: condWord(cond), cand: !!cand,
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
  for (const z of (sel.extensions && sel.extensions.zones) || []) r.why.push(z.status === 'KNOWN' ? { t: `proposed ${zoneWord(S, z.side)} · ${fmt(z.width_applied_m, 2)} m ${(z.soil_type || '').replace('_', ' ')} · ${fmt(z.credited_m3)} m³ credited · ${z.connection === 'PARTIAL' ? 'PARTIAL' : 'CONNECTED'}`, cls: 'grey' }
                            : { t: `proposed ${zoneWord(S, z.side)} · ${(z.status || '').toLowerCase().replace(/_/g, ' ')}${z.note ? ' · ' + z.note : ''}`, cls: 'grey' });
  for (const c of r.conflicts) r.why.push({ t: `need-box cut by the ${(c.dataset || c.kind || '').replace(/[-_]/g, ' ')} · ${fmt(c.clearance_m, 1)} m clearance`, cls: 'red' });
  if (app.pending) { r.state = 'running'; r.label = app.pending.candidate_only ? 'PLACING THE TREE …' : 'RUNNING THE RULE …'; r.cls = 'wait'; }
  return r;
}
const resultLine = (r) => r.label + (r.state === 'yes' || r.state === 'no' ? ` · ${fmt(r.available)} OF ${r.required} m³` : '');
/* the band's own answer (R27, extension-aware when the zones are KNOWN): the Table 9-2 classes whose volume the cell's share meets, read from the engine */
function fitClasses(S, tr) { const sel = tr || S.trees.find((x) => x.selected); if (!sel || sel.share_status !== 'KNOWN') return null; const E = sel.extensions; return (E && E.status === 'KNOWN' && E.benchmark_classes_total) || sel.benchmark_classes || null; }
function bandFit(S, tr) {
  const sel = tr || S.trees.find((x) => x.selected); const live = liveKnobs(S); const r = { cls: null, label: 'NOT ASSESSABLE', vcls: '', available: null };
  if (!sel) return r; const E = sel.extensions; r.available = E && E.share_total_m3 != null ? E.share_total_m3 : sel.share_m3;
  if (app.pending && !app.pending.candidate_only && (!tr || app.pending.site_id === tr.site_id)) { r.label = 'RUNNING THE RULE …'; r.vcls = 'wait'; return r; }
  if (sel.share_status === 'REVIEW_REQUIRED' || live.soil === 'soil_cell') { r.label = 'MANUAL REVIEW'; r.vcls = 'review'; return r; }
  const bc = fitClasses(S, tr); if (!bc) return r;
  r.cls = ['Large', 'Medium', 'Small'].find((c) => bc.includes(c)) || 'none'; r.upto = r.cls === 'none' ? 'NOTHING FITS' : r.cls === 'Small' ? 'ONLY SMALL' : `UP TO ${r.cls.toUpperCase()}`; r.label = (r.available != null ? `${fmt(r.available)} m³ · ` : '') + r.upto; r.vcls = r.cls === 'none' ? 'no' : 'yes'; return r;
}
// the species on the drawing: the engine's candidate, or the card just dropped while the engine runs (a library card: no box, no verdict yet)
function candidateShown(S) { const p = app.pending; if (p && 'candidate' in p) return p.candidate && S.library ? S.library.cards.find((c) => c.id === p.candidate) || null : null; return S.candidate; }
// what the rule reads, live: the handle being dragged, else the value just sent to the engine, else the file's
function liveKnobs(S) {
  const st = S.street, bd = S.band.design, k = S.knobs, d = app.drag, p = app.pending || {}; const v = (key, file) => (p[key] != null ? p[key] : file);
  const md0 = st.median; const half = md0 ? (d && d.kind === 'curb' ? d.value : p.curb != null ? p.curb : md0.half_width_m) : null; const md = md0 ? medianOf(S, half) : null;   /* a median: the curb knob is the half-width about the median's centre */
  const curb = md ? md.cfN : d && d.kind === 'curb' ? st.centreline_v + d.value : p.curb != null ? st.centreline_v + p.curb : st.curb_face_v;
  const depth = d && d.kind === 'depth' ? d.value : p.depth != null ? p.depth : bd.depth_m;
  const kk = knobs(S); return { curb, median: md, half, depth, soil: v('soil', k.soil_type && k.soil_type.value), land_use: v('land_use', k.land_use && k.land_use.value), width_level: v('width_level', k.width_level && k.width_level.value), target: v('target', k.target_tree_class && k.target_tree_class.value), replacement: p.replacement != null ? !!p.replacement : kk.replacement, extensions: p.extensions != null ? p.extensions : kk.extensions };
}
function status(m) { $('status').textContent = m; }
/* a run the user waits for (the engine, the exporter, a fetch, a freeze): one bar along the top of the sheet that fills over the time the
   last run of its kind took (a default before the first), the stage tag names the run and ticks the seconds, the controls that cannot
   answer step back (#fixed.busy). The bar is an estimate, the tick is the truth. */
const RUN_ETA = { engine: 9000, place: 5000, freeze: 4000, fetch: 75000, open: 2500, lookup: 3000 };
function runStart(kind, label) {
  let eta = RUN_ETA[kind] || 8000; try { eta = +localStorage.getItem('rr_eta_' + kind) || eta; } catch (e) { /* storage may be closed */ }
  app.run = { kind, label, t0: performance.now(), eta }; const b = $('prog'); b.style.transition = 'none'; b.style.width = '0%'; b.className = 'prog on'; void b.offsetWidth;
  b.style.transition = `width ${Math.round(eta * 1.2)}ms cubic-bezier(.15,.55,.35,1)`; b.style.width = '92%'; $('fixed').classList.add('busy');
  clearInterval(app.runT); app.runT = setInterval(runTick, 500); runTick();
  clearInterval(app.progT); app.run.t0wall = Date.now() / 1000; if (!STATIC) app.progT = setInterval(async () => { const r = app.run; if (!r) return; try { const p = await fetch('/api/progress').then((x) => x.json()); if (app.run === r && p && p.text && p.t >= r.t0wall - 1 && p.text !== r.note) { r.note = p.text; status(p.text); runTick(); } } catch (e) { /* no feed: the seconds alone */ } }, 700);   /* what the server is doing, in words, while the page waits (the walk of 2026-10-13: a street took 30 s with only a counter) */
}
/* a run's label can change while it waits (a static host: the engine starting in the browser first); null restores it */
function runStage(label, noLearn) { const r = app.run; if (!r) return; if (r.label0 == null) r.label0 = r.label; r.label = label || r.label0; if (noLearn) r.noLearn = true; runTick(); }
function runTick() { const r = app.run; if (!r) return; const s = Math.round((performance.now() - r.t0) / 1000); const m = $('q-mode'); m.textContent = `${r.label} · ${s} s`; m.className = 'mode run'; const n = $('open-note'); if (n) n.textContent = `${r.note || 'reading the City\'s records'} · ${s} s`; }
function runEnd(ok = true) {
  const r = app.run; if (!r) return; const dt = performance.now() - r.t0; if (ok && !r.noLearn) { try { localStorage.setItem('rr_eta_' + r.kind, String(Math.round(dt))); } catch (e) { /* no storage: the default stays */ } }
  app.run = null; clearInterval(app.runT); app.runT = null; clearInterval(app.progT); app.progT = null; app.opening = null; $('fixed').classList.remove('busy'); if (app.S) question();   /* the tag goes back to the stage's */
  const b = $('prog'); b.style.transition = 'width 220ms ease-out'; b.style.width = '100%'; b.className = 'prog on' + (ok ? '' : ' fail');
  setTimeout(() => { if (!app.run) { b.style.transition = 'opacity 400ms ease'; b.className = 'prog'; setTimeout(() => { if (!app.run) { b.style.transition = 'none'; b.style.width = '0%'; } }, 420); } }, ok ? 500 : 1600);
}

// ---------- the question line: one sentence, one verdict, always ----------
function question() {
  const S = app.S; if (!S) return; const st = stage(app.t); const cand = candidateShown(S); const target = liveKnobs(S).target || '—'; const sel = S.trees.find((x) => x.selected);
  const name = cand ? cand.common : (sel && sel.species_ref && sel.species_ref.common) || (sel && sel.genus) || '';
  const snap = axoSnap(); const nS = app.saved.length; let head = 'HOW MUCH TREE CAN THE GROUND CARRY AT', tail = '?', mode = STAGE_TAG[st]; const noChip = st === 0 && !app.chosen;   /* no street in the title until the user has chosen one */
  /* one sentence for the whole tool; what the stage shows is the small tag at the right, never a tail on the sentence */
  if (app.report) mode = `REPORT · SCENARIO ${app.report.id} · ${app.report.subject.toUpperCase()}`;
  else if (st === 0) { head = noChip ? 'HOW MUCH TREE CAN THE GROUND CARRY IN VANCOUVER?' : 'HOW MUCH TREE CAN THE GROUND CARRY IN VANCOUVER? ·'; tail = ''; }
  else if (st === 1) mode = sel && app.sectionOpen && name ? `STREET PLAN, ${name.toUpperCase()}, ${S.trees.length} TREES` : `STREET PLAN, ${S.trees.length} TREES`;
  else if (st === 2) mode = `EXISTING CONDITION · ${name.toUpperCase()}`;
  else if (st === 4) mode = snap && !snap.live ? `AXONOMETRIC · SCENARIO ${snap.id} · ${snap.subject.toUpperCase()}` : app.scenario ? 'AXONOMETRIC · WORKING SCENARIO' : 'AXONOMETRIC · EXISTING CONDITION';
  else if (st === 5) mode = `SUMMARY · ${nS} SAVED SCENARIO${nS === 1 ? '' : 'S'}`;
  $('q-text').innerHTML = `<span id="q-head">${head}</span> ${noChip ? '' : addrChip(S)}<span id="q-tail">${tail}</span>`;
  const chip = $('q-addr'); if (chip) { if (app.t < 2) chip.onclick = editAddress; else { chip.classList.add('locked'); chip.title = 'go back to the location or the street plan to go elsewhere'; } }
  $('q').classList.toggle('city', st === 0);
  const v = $('q-verdict'); const sx = st === 5 ? sumCur() : null; const r = app.report ? app.report.result : st === 3 ? resultFor(S) : st === 4 && snap && !snap.live ? snap.result : sx && !sx.live ? sx.result : null; const bf = st === 3 && !app.report ? bandFit(S) : null; v.textContent = bf ? (bf.vcls === 'wait' || bf.vcls === 'review' || !cand ? bf.label : `${fmt(bf.available)} m³ · ${cand.common.toUpperCase()} · ${r.label}`) : r ? resultLine(r) : ''; v.className = 'verdict ' + (bf ? (cand && bf.vcls !== 'wait' && bf.vcls !== 'review' ? r.cls : bf.vcls) : r ? r.cls : '') + (r ? '' : ' off');
  const m = $('q-mode'); if (app.run) runTick(); else { m.textContent = mode; m.className = 'mode'; }   /* while a run is on, the tag is the run's */
}
function headline() { question(); }

const addrChip = (S) => `<span id="q-addr" class="addr" title="type another address or a tree's asset id">${app.opening ? esc(app.opening.hblock) : S.title.hblock}<i class="caret">▾</i></span>`;   /* while a street opens, the title already names it */
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
async function goTo(q, fail = () => {}, toT = null, dur = null) {
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
        const pick = near.find((x) => x.has_engine_file) || near[0]; asset = pick.asset_id; app.foundNote = { q: hit[0], dist: pick.distance_m, asset };
      }
      let info; { const own = STATIC && !app.run; if (own) runStart('lookup', `TREE ${asset} · THE CITY'S RECORD`); try { info = await api.tree(asset); } finally { if (own) runEnd(true); } }   /* online, a tree the build did not run is read by the engine in this browser: the wait is said */
      app.busy = false; app.opening = { hblock: info.street || ('tree ' + asset), side: '', n: null }; app.resKey = '';
      const siteType = (info.hint || {}).hint === 'median' ? 'median' : 'boulevard';   /* a median tree is a street tree (the user, 2026-10-09): its band is the median, between its two curbs */
      { const h = info.hint || {}; if (h.in_park_polygon) { app.goto = null; app.jump = null; app.ctlKey = ''; draw(); done(null); status(`Tree ${asset} stands inside a City park polygon. A park tree is not a street tree; pick a tree beside a street or in a median.`); return; } }   /* a park tree has no street band: say so before any run */
      /* the tree is known the moment the City answers: fly to it now, name its street, and let the loading or the run happen in view of it */
      { const sc = app.scene; if (sc.uvOf && info.lon != null) { const [u, v] = sc.uvOf(info.lon, info.lat); app.goto = { u, v }; const ar = sc.areaAt ? sc.areaAt(u, v) : null; if (ar) app.area = ar.name; } app.chosen = true; planOnly(); app.ctlKey = ''; if (app.foundNote) app.foundNote.street = info.street; draw(); if (app.t < 1) scrollToT(diveT().tb); }
      let needRun = !info.has_engine_file;
      if (info.has_engine_file) { const S0 = await api.scene(info.site_id); if (S0.band && S0.band.design) {
        const cur = app.existing || app.S; const same = cur && (cur.site_id.split('_')[0] === info.site_id.split('_')[0] || (info.tree_site_id && cur.trees.some((x) => x.site_id === info.tree_site_id))); if (!same) await load(info.site_id);   /* the street on screen already holds the tree: no load */ app.opening = null; app.goto = null; if (toT != null) { app.ctlKey = ''; draw(); scrollToT(toT, dur); }
        /* a tree on a checked street that is not its anchor: the street opens at once and the clicked tree becomes the subject (the same run a click on the plan makes) */
        const E = app.existing || app.S; const tsid = info.tree_site_id; const selId = (E.trees.find((x) => x.selected) || {}).site_id; if (tsid && tsid !== selId && E.trees.some((x) => x.site_id === tsid)) { app.hotTree = null; app.pan = 0; app.pick = tsid; app.resKey = ''; app.ctlKey = ''; draw(); if (stage(app.t) >= 2 || (toT != null && toT >= STOP_T[2])) runPick(); }
      } else needRun = true; }   /* an engine file without a design band (no curb could be set): run again, with the hint or the typed curb */
      if (needRun) { app.busy = true; runStart('fetch', `NEW TREE ${asset} · FETCHING THE STREET · RUNNING THE RULE`); try { const kk = knobs(app.existing || app.S); const run = (curb) => api.runSite({ asset_id: asset, site_type: siteType, target: kk.target, soil: kk.soil, land_use: kk.land_use, width_level: kk.width_level, depth: kk.depth, ...(curb != null ? { curb } : {}) });
        let S2 = await run(app.curbFor && app.curbFor.asset === asset ? app.curbFor.curb : null);
        if (!(S2.band && S2.band.design)) { const hint = curbHint(S2); if (hint != null) { status(`no curb line on ${S2.title.hblock}; the City's ${((S2.knobs.curb_offset_from_centreline_m || {}).hint || {}).suggested_source || 'catch basins'} put ${siteType === 'median' ? 'the median\'s curbs' : 'it'} near ${fmt(hint, 1)} m from the centreline; running with that as a design assumption …`); S2 = await run(hint); } }   /* the City publishes no curb line: the batch's convention is the median catch-basin offset, a DESIGN_ASSUMPTION */
        if (!(S2.band && S2.band.design)) { const hk = ((S2.knobs || {}).curb_offset_from_centreline_m || {}).hint || {}; app.goto = null; app.needCurb = { asset, hblock: S2.title.hblock, pl: +(S2.street.property_line_v - S2.street.centreline_v).toFixed(1), median: siteType === 'median', why: hk.reason_if_none || null, trees: hk.tree_bound_m, outer: hk.outer_curb_m }; app.ctlKey = ''; draw(); runEnd(false); status(siteType === 'median' ? `no City fixture marks the median's curbs on ${S2.title.hblock} · type the median's half-width below, in the right column, to run this tree` : `no curb line and no catch basin on ${S2.title.hblock} · type a curb distance below, in the left column, to run this tree`); done(null); app.busy = false; return; }   /* nothing to infer from: the user types it (the form at 01) */
        app.needCurb = null; app.curbFor = null; app.existing = S2; app.scenario = null; app.saved = []; app.axo = 0; await show(S2); app.site = 'V-' + asset; app.goto = null; if (app.foundNote && app.foundNote.asset === asset && S2.title) app.foundNote.street = S2.title.hblock;   /* the block face the rule read, not the City's nearest-address street */ status(''); runEnd(true); if (toT != null) { app.ctlKey = ''; draw(); scrollToT(toT, dur); } } catch (err) { app.goto = null; runEnd(false); status(err.message); done(null); } app.busy = false; }
    } catch (err) { app.goto = null; app.opening = null; if (/not found on its own face/.test(err.message || '')) { if (app.unreadable) app.unreadable.add(+q); app.jump = null; app.ctlKey = ''; status(''); draw(); } else status(err.message); done(null); app.busy = false; }
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
  const lvl0 = st === 0 ? atlasLevel(t) : ''; const key = `${st}|${lvl0}|${app.chosen ? 1 : 0}|${app.jump || ''}|${app.foundNote ? JSON.stringify(app.foundNote) : ''}|${app.needCurb ? app.needCurb.asset : ''}|${S.site_id}|${app.shade}|${app.area || ''}|${app.scene.homeArea ? app.scene.homeArea.name : ''}|${app.scene.faceUV ? app.scene.faceUV.length : 0}|${cand ? cand.id : ''}|${bd ? bd.depth_m + ':' + bd.v_from : ''}|${app.city ? 1 : 0}|${app.busy ? 1 : 0}|${app.pending ? JSON.stringify(app.pending) : ''}|${live.soil}|${live.land_use}|${live.width_level}|${app.rules ? 1 : 0}|${app.saved.length}|${app.axo}|${app.axoFocus || 0}|${app.scenario === S ? 1 : 0}|${app.cls || ''}|${(S.band.zones || []).map((z) => z.side + z.width_applied_m + z.status).join()}|${S.knobs.tree_state ? S.knobs.tree_state.value : ''}|${S.knobs.curb_offset_from_centreline_m ? S.knobs.curb_offset_from_centreline_m.provenance : ''}|${JSON.stringify(app.extDraft || {})}|${JSON.stringify(app.openCls || {})}`;
  if (key === app.ctlKey) { if (st === 3) syncFields(S); return; } app.ctlKey = key; app.armed = null;
  const c311 = S.ground && S.ground.cases_311 && S.ground.cases_311.since_2022 ? S.ground.cases_311.since_2022.count : null; const sel = S.trees.find((x) => x.selected);
  if (st === 0) { ctl.innerHTML = locateRailHtml(S, lvl0); wireLocate(ctl, app.scene.areaInfo || []); }   /* 01's controls and the one way on (OPEN THE STREET PLAN) are in the rail at every level; the index lives in the right column */   /* the index itself lives in the right column (locatePanel) */
  else if (st === 1) { const fits = app.scene.S ? app.scene.planFrame().fitsA : true; ctl.innerHTML = `<div class="ph">02 · STREET PLAN</div><div class="do">${S.trees.length} trees. Click one for its card.</div>`; void fits; }
  else if (st === 2) ctl.innerHTML = `<div class="ph">03 · TREE + GROUND</div><div class="do">${sel ? esc((sel.species_ref && sel.species_ref.common) || sel.genus) : 'The chosen tree'}, cut at A–A. Click a tree on the strip to switch.</div>`;
  else if (st === 3 && app.report) { if ($('inputs')) $('inputs').innerHTML = ''; if ($('inputsB')) $('inputsB').innerHTML = ''; const L = panelLines(S); ctl.innerHTML = `<div class="ph">REPORT · SCENARIO ${app.report.id}</div><div class="pn">saved ${app.report.savedAt.slice(0, 16).replace('T', ' ')} · the existing condition is the City's record; everything below is the scenario</div><div class="ph">SCENARIO INPUTS</div>${L.inputs.map((l) => `<div class="p">${esc(l)}</div>`).join('')}<div class="ph">ADVANCED · SITE &amp; RULE CONTEXT</div>${L.advanced.map((l) => `<div class="p">${esc(l)}</div>`).join('')}`; }
  else if (st === 3) { const lib = S.library; const cond = (lib && lib.condition) || 'shared_row'; const vol = (cls) => { const c0 = lib ? lib.cards.find((c) => c.listed && c.class === cls) : null; return c0 && c0.volume_m3 ? c0.volume_m3[cond] : '—'; };
    void vol; void cond; ctl.innerHTML = `<div class="ph">04 · SCENARIO BUILDER</div><div class="do">Change the ground on the left, or plant a species on the right; the rule runs on each change.</div>${app.saved.length ? '<div class="ph">SAVED</div>' + app.saved.map((x) => `<div class="sv"><b>${x.id}</b> ${esc(x.subject)} · ${esc((x.knobs.soil || '').replace('_', ' '))} · ${fmt(x.knobs.depth, 2)} m · <span class="${x.result.cls}">${esc(x.result.label)}</span></div>`).join('') + '<div class="pn">5 · their axonometric · 6 · the comparison</div>' : ''}`; inputsPanel($('inputsB'), S); }   /* 04 the scenario builder: the levers in the column's upper part, the answer below */
  else if (st === 4) axoPanel(ctl);                          // 05 the axonometric: the saved scenarios as tabs
  else { const x6 = sumCur(); ctl.innerHTML = `<div class="ph">06 · SUMMARY &amp; REPORT</div><div class="do">${x6 ? 'One column per scenario beside today; a column head makes it the answer, its foot downloads the report.' : 'Nothing to compare yet: today alone. Design the ground at 04.'}</div><div class="do"><a id="su-edit">◂ ${x6 && !x6.live ? 'edit the scenario' : 'design the ground'}</a></div>${x6 ? '<div class="do"><a id="su-axo">◂ its axonometric</a></div>' : ''}`; $('su-edit').onclick = () => scrollToT(STOP_T[3]); if ($('su-axo')) $('su-axo').onclick = () => scrollToT(STOP_T[4]); }
}
const condWord = (c) => (c === 'solitary' ? 'standing alone' : 'in a row');   /* Table 9-2's condition in the visitor's words (the walk of 2026-10-13: "shared row" unexplained) */
const nice = (x) => String(x || '').toLowerCase().replace(/\b(large|medium|small)\b/g, (m) => m[0].toUpperCase() + m.slice(1)).replace(/^./, (m) => m.toUpperCase());   /* a verdict as a phrase: 'Up to Large', 'Manual review' */
const titleCase = (x) => String(x || '').toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Av|St|Dr|Rd|Blvd)\b/g, (m) => m);   /* a City street name in a sentence: Ontario St, W King Edward Av */
const esc = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const PROV = { user: '<span class="prov user">USER INPUT</span>', assumed: '<span class="prov assumed">ASSUMED</span>', derived: '<span class="prov derived">DERIVED</span>', city: '<span class="prov">CITY RECORD</span>' };
// a knob's provenance on the panel: the file's value is the demo's design assumption; a value the user changed is user input
const knobProv = (key, S) => { const ex = app.existing ? knobs(app.existing) : null; const cur = liveKnobs(S); const map = { depth: cur.depth, soil: cur.soil, land_use: cur.land_use, width_level: cur.width_level, curb: +(cur.curb - S.street.centreline_v).toFixed(2) }; return ex && ex[key] != null && Math.abs(+ex[key] - +map[key]) > 1e-6 && ex[key] !== map[key] ? PROV.user : PROV.assumed; };
const r30sub = (lu, lv) => { const r = app.rules && app.rules.r30; if (!r) return ''; const sw = r.sidewalk_clear_width_m, bb = r.back_boulevard_width_m, rows = r.land_use_rows; if (!sw || !sw[lu]) return ''; const w = sw[lu][lv]; if (w == null) return sw[lu].preferred_note || 'not given'; const b = bb && rows && rows[lu] && bb[rows[lu].table_8_4] ? bb[rows[lu].table_8_4][lv] : null; return `sidewalk ${w} m` + (b != null ? ` · back blvd ${b} m` : ''); };
// ====== 04 · three areas: A · WHAT IS HERE (site facts, read) · B · DESIGN THE GROUND (the premise and the levers) · C · WHAT CAN IT SUPPORT? (the engine's answer) ======
const TAG_TIP = { 'EDM §8.4': 'the front boulevard: back of curb to sidewalk (Tables 8-3 / 8-4) · this tree\'s cell half-way to each neighbour', 'TABLE 2-2': 'the utility clearance · that width of the band is not credited', 'TABLE 9-2': 'soil volume by tree class, shared row · the benchmark', 'TABLE 9-3': 'the City\'s species list and its classes', CITY: "the City's record", DERIVED: "computed from the City's record", ASSUMED: 'a table value or a demo assumption · not measured', 'NO RECORD': 'the City publishes no data here · nothing is counted', CONFIRMED: 'measured on site, with evidence', EVIDENCED: 'measured on site, with evidence', NOMINAL: 'a drawing convention, not a measurement', CUT: 'where SECTION A–A is cut' };
const TAGI = (t, k) => `<i class="tag ${k || ''}"${TAG_TIP[t] ? ` title="${TAG_TIP[t]}"` : ''}>${t}</i>`;
const EXT_DEF = { property: { width: 1.8, soil: 'structural_soil' }, road: { width: 2.0, soil: 'structural_soil' } };   /* a proposal's starting values when switched on; the engine decides what it is worth */
const EXT_TXT_BLVD = { property: ['UNDER THE SIDEWALK', 'toward the property line, under the sidewalk and back boulevard'], road: ['UNDER THE PARKING LANE', 'toward the centreline, under the curb and parking lane'] };
const EXT_TXT_MEDIAN = { property: ['UNDER THE NEAR CARRIAGEWAY', 'beyond the near curb, under the carriageway'], road: ['UNDER THE FAR CARRIAGEWAY', 'beyond the far curb, under the carriageway'] };
const extTxt = (S) => (S.street.median ? EXT_TXT_MEDIAN : EXT_TXT_BLVD);
const zoneWord = (S, side) => (S.street.median ? (side === 'property' ? 'under the near carriageway' : 'under the far carriageway') : (side === 'property' ? 'under the sidewalk' : 'under the parking lane'));
/* the engine's feasibility of a proposed zone, as one word: the status is the engine's, the connection too */
const zoneWhy = (z) => { const n = String(z.note || ''); if (/existing_tree/.test(n)) return 'structural soil is for a new tree · switch the premise'; if (/no zone soil connected/.test(n)) return 'no soil reaches the cell past the mains'; return n.split(/[;.] /)[0].replace(/\s*\(.*$/, '').replace(/_/g, ' ').slice(0, 52); };   /* the engine's reason in the visitor's words, one clause; the full text is in the report */
const zoneVerdict = (z) => { if (!z) return null; if (z.status === 'KNOWN') return z.connection === 'PARTIAL' ? ['PARTIAL', 'warn'] : ['CONNECTED', 'ok']; if (z.status === 'NOT_CONNECTED') return ['NOT CONNECTED', 'no']; if (z.status === 'REFUSED') return ['REFUSED', 'no']; if (z.status === 'NOT_COUNTED') return ['NOT COUNTED', 'no']; return [(z.status || 'NO RECORD').replace(/_/g, ' '), 'warn']; };
/* what the page proposes per side: the scene's zones (after a run) or the pending patch, with a per-side draft for the values while a side is off */
function extState(S) { const live = liveKnobs(S); const d = app.extDraft || (app.extDraft = {}); const out = {}; for (const side of ['property', 'road']) { const on = (live.extensions || []).find((z) => z.side === side); const dr = d[side] || (d[side] = { ...EXT_DEF[side] }); if (on) { dr.width = on.width_m; dr.soil = on.soil_type; } out[side] = { on: !!on, width: dr.width, soil: dr.soil }; } return out; }
function sendExt(S, side, patch) {
  const es = extState(S); const d = app.extDraft; Object.assign(d[side], patch); const on = patch.on != null ? patch.on : es[side].on;
  if (!on && !es[side].on) { app.ctlKey = ''; draw(); return; }   /* a draft on a side that is off: nothing for the engine yet */
  const list = []; for (const s2 of ['property', 'road']) { const o = s2 === side ? on : es[s2].on; if (o) list.push({ side: s2, width_m: +d[s2].width, soil_type: d[s2].soil, provenance: 'DESIGN_ASSUMPTION' }); }
  const live = liveKnobs(S); const needsNew = !live.replacement && list.some((z) => z.soil_type === 'structural_soil'); app.premNote = needsNew ? 'structural soil counts for a new tree only (R08) · the premise switched to a replacement tree' : ''; evaluate(needsNew ? { extensions: list, replacement: true } : { extensions: list });   /* a structural zone under KEEP would come back REFUSED: switch the premise with it */
}
/* 03 · how the City's rule counts this cell, as one line of the engine's own numbers (R26 cell × R30 band − Table 2-2 clearance = R04 area · × R05 depth = physical · × the soil's credit = credited → Table 9-2); a factor under the pointer lights its part of the section (2026-10-12: the formula lives at 03, 04 only moves it) */
const CREDIT_TXT = { native_soil: ['× 1', 'native soil'], structural_soil: ['× 0.5', 'structural soil'], soil_cell: ['× ?', 'soil cells · reviewed by hand'], other: ['× ?', 'other soil'] };
function ruleCountParts(S, sel) {
  const st = S.street; const bd = S.band.design; const strips = S.band.strips || []; const atTree = strips.find((x) => sel.u >= x.u0 && sel.u <= x.u1); const soil = (S.knobs.soil_type && S.knobs.soil_type.value) || 'native_soil'; const cr = CREDIT_TXT[soil] || CREDIT_TXT.other;
  const cell = sel.spacing_m != null ? sel.spacing_m : (sel.cell && sel.cell.u_from != null ? sel.cell.u_to - sel.cell.u_from : null); const width = sel.band_width_m != null ? sel.band_width_m : bandWidth(S);
  const known = sel.share_status === 'KNOWN' && sel.soil_area_m2 != null; const bf = bandFit(S, sel); const E = sel.extensions || {}; const have = E.share_total_m3 != null ? E.share_total_m3 : sel.share_m3;
  const f = (key, txt, tip) => `<span class="fac" data-hl="${key}" title="${tip}">${txt}</span>`;
  const line = !known ? `<div class="eqline grey">${bf.vcls === 'review' ? 'the rule stops at this cell · reviewed by hand' : 'the rule has no count for this cell'}</div>`
    : `<div class="eqline"><span class="row">${f('cell', `${fmt(cell, 1)} m`, 'this tree\'s cell · half-way to each neighbour (R26)')} × ${f('width', `${fmt(width, 2)} m`, st.median ? 'the median, curb to curb (R30)' : 'the band · back of curb to sidewalk (R30, Tables 8-3 / 8-4)')}${atTree ? ` − ${f('cut', `${fmt(atTree.clearance_m, 1)} m`, 'the main\'s clearance · not credited (Table 2-2, R28)')}` : ''} = ${f('area', `${fmt(sel.soil_area_m2, 1)} m²`, 'the qualifying area (R04)')}</span><span class="row">× ${f('depth', `${fmt(bd.depth_m, 2)} m`, 'the soil depth · assumed, yours at 04 (R05)')} = ${fmt(sel.physical_soil_volume_m3, 1)} m³ ${f('soil', cr[0], `${cr[1]} (R06 / R07)`)} = <b>${fmt(have, 1)} m³</b></span></div>`;   /* two rows by design: the area, then the volume (the walk of 2026-10-13: the one-line equation wrapped with a font jump) */
  const tail = known ? `→ Table 9-2, trees ${condWord((S.library && S.library.condition) || 'shared_row')}: ${bf.cls === 'none' ? 'below a Small tree' : bf.cls === 'Small' ? 'a Small tree only' : `up to a ${bf.cls} tree`}` : '';
  return { line, tail };
}
function ruleCountHtml(S, sel) { const rc = ruleCountParts(S, sel); return `<div class="gcard read eq"><div class="gt">HOW THE RULE COUNTS IT ${TAGI('TABLE 9-2', 'rule')}<span class="hint">· hover a number</span></div>${rc.line}${rc.tail ? `<div class="gs">${rc.tail}</div>` : ''}</div>`; }
/* 03 · two cards: THE TREE — the City's record, three lines until opened (the tracker's card, for whoever maintains the tree) — and THE GROUND as the rule reads it, the count as its last row (the user, 2026-10-12) */
function recordCards03(S, sel) {
  const st = S.street; const sr = sel.species_ref || {}; const strips = S.band.strips || []; const atTree = strips.find((x) => sel.u >= x.u0 && sel.u <= x.u1); const nStrip = strips.length;
  const cellLen = sel.cell && sel.cell.u_from != null ? sel.cell.u_to - sel.cell.u_from : null; const ex = S.band.existing || {}; const g = S.ground || {}; const sw = g.sidewalk; const c311 = g.cases_311 && g.cases_311.since_2022 ? g.cases_311.since_2022.count : null;
  const listed = sel.table_9_3 && sel.table_9_3.listed; const open = !!app.treeOpen; const pr = sel.protection;
  const nb = S.trees.filter((x) => x !== sel && x.height_m && Math.abs(x.u - sel.u) < 30).sort((a, b) => Math.abs(a.u - sel.u) - Math.abs(b.u - sel.u)); const w = nb.find((x) => x.u < sel.u), e = nb.find((x) => x.u > sel.u);
  const fr = (em, b, small) => `<div class="fr"><em>${em}</em><b>${b}</b>${small ? `<small>${small}</small>` : ''}</div>`;
  const rec = open ? `<div class="rec">
    ${fr('ASSET', esc(sel.site_id.replace(/^(KE|V)-/, '')), `${esc(S.title.hblock)} · ${esc(S.title.side)}`)}
    ${fr('SPECIES', `${esc(sr.common || sel.genus)}`, `${esc(sr.latin || (sel.genus + ' ' + sel.species))}${sel.cultivar ? ' · ' + esc(sel.cultivar) : ''}${sr.city_count != null ? ' · ' + sr.city_count.toLocaleString() + ' in the City' : ''}`)}
    ${fr('PLANTED', sel.install_date ? esc(sel.install_date.slice(0, 10)) : '—')}
    ${fr('HEIGHT · DBH', `${fmt(sel.height_m)} m · ${sel.diameter_cm != null ? fmt(sel.diameter_cm, 1) + ' cm' : '—'}`)}
    ${fr('CLASS', listed ? 'Table 9-3 ' + esc(sel.table_9_3.class) : 'not in Table 9-3')}
    ${fr('CROWN · ROOTS', `${fmt(sel.crown_diameter_m || 3)} m · ${esc((sel.roots && sel.roots.form) || 'heart')} form`, 'nominal, not measured')}
    ${w || e ? fr('NEIGHBOURS', [w ? fmt(Math.abs(w.u - sel.u), 1) + ' m west' : null, e ? fmt(Math.abs(e.u - sel.u), 1) + ' m east' : null].filter(Boolean).join(' · ')) : ''}
    ${pr && pr.radius_m ? fr('PROTECTION', `${fmt(pr.radius_m, 1)} m radius`, 'By-law 9958 Schedule A · a construction distance, not a root extent') : ''}
    ${sw && sw.rating ? fr('SIDEWALK', esc(String(sw.rating).toLowerCase()), 'City survey 2021') : ''}
    ${c311 != null ? fr('3-1-1', `${c311} case${c311 === 1 ? '' : 's'} since 2022`) : ''}
  </div>` : '';
  const tree = `<div class="gcard read tree"><div class="gt">THE TREE <span class="src">the City's record</span><a id="tree-open" class="open">${open ? '▾ less' : '▸ full record'}</a></div>
    <div class="gn">${fmt(sel.height_m)} m <small>· ${sel.diameter_cm != null ? fmt(sel.diameter_cm, 1) + ' cm dbh' : '—'}</small></div><div class="gs">${listed ? 'Table 9-3 ' + esc(sel.table_9_3.class) : 'not in Table 9-3'}${sel.install_date ? ' · planted ' + sel.install_date.slice(0, 4) : ''}</div>${rec}</div>`;
  const grow = (em, b, tag, small) => `<div class="grow"><em>${em}</em><b>${b}</b>${tag ? TAGI(tag[0], tag[1]) : ''}${small ? `<small>${small}</small>` : ''}</div>`;
  const rc = ruleCountParts(S, sel);
  const ground = `<div class="gcard read ground"><div class="gt">THE GROUND <span class="src">as the rule reads it</span></div>
    ${grow('given', `${fmt(bandWidth(S), 2)} × ${cellLen != null ? fmt(cellLen, 2) : '—'} m`, ['EDM §8.4', 'rule'], st.median ? 'the median, curb to curb · this tree\'s cell' : 'back of curb to sidewalk, the City\'s boulevard width · this tree\'s cell, half-way to each neighbour')}
    ${grow('cut', atTree ? `${fmt(atTree.clearance_m, 1)} m` : 'none', ['TABLE 2-2', 'rule'], atTree ? `the ${esc((atTree.dataset || atTree.kind).replace(/-/g, ' ').replace(' mains', ' main'))}'s clearance · ${nStrip} strip${nStrip === 1 ? '' : 's'} on this band` : `no clearance at this tree · ${nStrip} strip${nStrip === 1 ? '' : 's'} elsewhere on this band`)}
    ${grow('existing', ex.available ? `${fmt(ex.width_m || 0, 2)} × ${fmt(ex.depth_m || 0, 2)} m` : 'no record', ex.available ? ['EVIDENCED', 'user'] : ['NO RECORD', 'unk'], ex.available ? '' : 'nothing is counted for today')}
    <div class="grow count"><em>counted</em>${TAGI('TABLE 9-2', 'rule')}${rc.line}${rc.tail ? `<div class="gs">${rc.tail}</div>` : ''}</div></div>`;
  return tree + ground;
}
function wireRuleCount() { const osec = $('osec'); for (const el2 of document.querySelectorAll('.eqline .fac')) { el2.onmouseenter = () => { osec.classList.add('hl-' + el2.dataset.hl); }; el2.onmouseleave = () => { osec.classList.remove('hl-' + el2.dataset.hl); }; } }
/* the one site measurement a person may correct — the curb (a median: its half-width) — with evidence: it rewrites the canonical record, so every stage follows; a change, so it lives at 04 (2026-10-12: 03 reads, 04 changes) */
function fixCurbHtml(S) { const st = S.street; const live = liveKnobs(S); const curbK = S.knobs.curb_offset_from_centreline_m || {}; const curbConf = curbK.provenance === 'CONFIRMED_SITE_DATA'; const curbNow = fmt(live.curb - st.centreline_v, 1);
  return `<details class="adv fix"><summary>${st.median ? 'correct the median\'s half-width' : 'correct a site measurement · curb'}</summary><div class="fx"><input id="fx-curb" type="number" step="0.1" min="${st.median ? 1 : 3}" max="${st.median ? +(st.property_line_v - st.centreline_v - 6).toFixed(1) : +(st.property_line_v - st.centreline_v - 3.5).toFixed(1)}" value="${st.median ? fmt(live.half, 1) : curbNow}"> ${st.median ? 'm from the median\'s centre to either curb' : 'm from the centreline'}<input id="fx-ev" class="ev" type="text" placeholder="evidence · e.g. tape measure 2026-10-02, photo IMG_0412" value="${curbConf ? esc(curbK.evidence || '') : ''}"><button id="fx-go" type="button">APPLY AS CONFIRMED SITE DATA</button><small>no evidence, no change · ${st.median ? 'both curbs follow the half-width' : 'every street edge follows the curb'}</small></div></details>`; }
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
    ${read('THE SOIL IT IS GIVEN', `${fmt(bandWidth(S), 2)} <small>×</small> ${cellLen != null ? fmt(cellLen, 2) : '—'} m`, ['EDM §8.4', 'rule'], st.median ? 'band width × this tree\'s cell · the median, curb to curb, half-way to each neighbour' : 'band width × this tree\'s cell · back of curb to sidewalk, half-way to each neighbour')}
    ${read('WHAT CUTS IT', atTree ? `${fmt(atTree.clearance_m, 1)} m <small>clearance</small>` : 'none <small>at this tree</small>', ['TABLE 2-2', 'rule'], atTree ? `${esc((atTree.dataset || atTree.kind).replace(/-/g, ' ').replace(' mains', ' main'))} · ${nStrip} strip${nStrip === 1 ? '' : 's'} on this band` : `${nStrip} strip${nStrip === 1 ? '' : 's'} elsewhere on this band`)}
    ${read('EXISTING SOIL', ex.available ? `${fmt(ex.width_m || 0, 2)} × ${fmt(ex.depth_m || 0, 2)} m` : 'no record', ex.available ? ['EVIDENCED', 'user'] : ['NO RECORD', 'unk'], ex.available ? '' : 'nothing is counted for today · the scenario starts from zero')}
    ${ruleCountHtml(S, sel)}
  </div>
  <details class="adv"><summary>${st.median ? 'ASSUMPTIONS · the median\'s curbs' : 'ASSUMPTIONS · curb · land use · sidewalk'}</summary><div class="facts">
    ${st.median ? fr('MEDIAN CURBS', `${fmt(live.half, 1)} m to either side of its centre`, curbConf ? ['CONFIRMED', 'user'] : ['ASSUMED', 'assumed'], curbConf ? `measured · ${esc(curbK.evidence || '')}` : null, curbConf ? null : `no City curb line · ${esc((st.median.centre_note || '').split(' (')[0])} · catch basins are location approximate`) : ''}
    ${st.median ? '' : fr('CURB', `${curbNow} m from ℄`, curbConf ? ['CONFIRMED', 'user'] : ['ASSUMED', 'assumed'], curbConf ? `measured · ${esc(curbK.evidence || '')}` : null, curbConf ? null : 'no City curb line · catch basins are location approximate')}
    ${st.median ? fr('NO SIDEWALK', 'nothing deducted', ['RULE', 'derived'], null, 'a median has no sidewalk or back boulevard to deduct · the band runs curb to curb') : fr('LAND USE', esc((LAND_TXT[lu] || lu || '').toLowerCase()), ['ASSUMED', 'assumed'], null, 'Table 8-3 row chosen for the demo · zoning not read')}
    ${st.median ? '' : fr('SIDEWALK', `${fmt(st.widths_m.sidewalk_clear, 2)} m clear · back blvd ${fmt(st.widths_m.back_boulevard, 2)} m`, ['ASSUMED', 'assumed'], null, `Table 8-3 / 8-4 · ${esc(wl)} widths · not measured`)}
  </div></details>
  <div class="facts fold"></div>`;
}
function wireFacts(S) {
  const go = $('fx-go'); if (!go) return;
  go.onclick = () => { if (app.busy) return; const v = +(+$('fx-curb').value).toFixed(1); const ev = $('fx-ev').value.trim(); if (!isFinite(v)) return; if (!ev) { status('a confirmed curb needs an evidence reference'); $('fx-ev').focus(); return; } evaluate({ curb: v, curb_provenance: 'CONFIRMED_SITE_DATA', curb_evidence: ev, canonical: true }); };   /* a site fact: the canonical record, from 03 or 04 alike */
}
/* the species cards' icons: one <symbol> per crown form from the library's tree art, used by every card (the tray rebuilds often; the paths are parsed once) */
function treeIconDefs() { let svg = $('tico'); if (!svg) { svg = el('svg', { id: 'tico', width: 0, height: 0, style: 'position:absolute;width:0;height:0' }); document.body.appendChild(svg); } for (const [form, a] of TREE_ART) { if (svg.querySelector('#tico-' + form)) continue; const sy = el('symbol', { id: 'tico-' + form, viewBox: `0 0 ${a.w} ${a.h}`, overflow: 'visible' }); const gs0 = a.groups.filter((g) => g.id === 'silhouette'); for (const g of (gs0.length ? gs0 : a.groups)) for (const d of g.d) sy.appendChild(el('path', { d, fill: 'none', stroke: '#26382C', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round' })); svg.appendChild(sy); } }   /* as attributes: a stylesheet rule on the symbol does not reach a <use> instance */   /* the outline only: at 40 px the inner foliage lines merge into a black blot */
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
      ${term(st.median ? 'NEAR ROAD' : 'SIDEWALK', zLine(zp), 'R31 · proposed', zp && zp.status === 'KNOWN' ? '' : 'grey', `engineered soil ${zoneWord(S, 'property')}, credited by the same rules and added (R31)`)}${op('+')}
      ${term(st.median ? 'FAR ROAD' : 'PARKING LANE', zLine(zr), 'R31 · proposed', zr && zr.status === 'KNOWN' ? '' : 'grey', `engineered soil ${zoneWord(S, 'road')}, credited by the same rules and added (R31)`)}${op('=')}
      ${term('CREDITED', num(have, 1, ' m³'), 'against Table 9-2', 'sum', 'what the rule reads for this cell against Table 9-2')}
    </div>`;
  const fitting = ['Small', 'Medium', 'Large'].filter((cls) => fitsCls && fitsCls.includes(cls)); void fitting; const known = !!fitsCls && !run;
  const provTag = (key) => (knobProv(key, S).includes('user') ? TAGI('USER INPUT', 'user') : TAGI('ASSUMED', 'assumed'));
  const r = resultFor(S); const kHash = JSON.stringify(knobs(S)); const canSave = !!app.scenario && S === app.scenario && !app.busy && !app.pending && app.savedHash !== kHash; const savedAs = app.savedHash === kHash && app.saved.length ? app.saved[app.saved.length - 1].id : null; const repl = !!live.replacement;
  /* B · the premise and the levers; a proposal is checked by the engine and comes back with a feasibility */
  const es = extState(S);
  const prop = (side) => { const e = es[side]; const z = e.on && !run ? zoneOf(side) : null; const v = zoneVerdict(z); const mdx = live.median; const maxW = mdx ? +(Math.max(0.5, (side === 'property' ? mdx.ocN - mdx.cfN : mdx.cfF - mdx.ocF) - 0.5)).toFixed(1) : side === 'property' ? +(st.property_line_v - st.sidewalk_v[0]).toFixed(1) : +(st.curb_face_v - st.centreline_v - 0.5).toFixed(1);
    const stp = (t, cls) => `<div class="st${cls ? ' ' + cls : ''}">${t}</div>`;
    const steps = !e.on ? ''
      : (run ? stp('checking utilities …', 'run') : !z ? stp('not evaluated yet', 'grey')
        : `${stp(`${TAGI(v[0], v[1])} ${z.status === 'KNOWN' ? `<b>${fmt(z.credited_m3)} m³</b>${z.soil_type === 'structural_soil' ? ' · ×0.5' : ''}` : z.blocked_by && z.blocked_by.length ? `${esc(z.blocked_by[0].replace(/-/g, ' '))}${z.blocked_by.length > 1 ? ' +' + (z.blocked_by.length - 1) : ''}` : z.note ? esc(zoneWhy(z)) : ''}`, v[1])}`);   /* one line: the status and what it credits; the engine's full reason is in the report */   /* one clause of the engine's reason; the full text is in the review and the report */
    return `<div class="prop${e.on ? '' : ' off'}" data-side="${side}" title="${esc(extTxt(S)[side][1])}"><div class="ph2"><label><input type="checkbox" class="x-on"${e.on ? ' checked' : ''}${dis}> ${extTxt(S)[side][0]}</label>${e.on ? '' : `<span class="dim">${fmt(e.width, 1)} m · ${SOIL_SHORT[e.soil]}</span>`}</div>
      <div class="pr"${e.on ? '' : ' style="display:none"'}><input type="number" class="x-w" step="0.1" min="0.3" max="${maxW}" value="${fmt(e.width, 1)}"${dis}> m wide <div class="segs">${['structural_soil', 'soil_cell'].map((k2) => `<button type="button" class="seg x-soil${k2 === e.soil ? ' on' : ''}" data-soil="${k2}"${dis}>${SOIL_SHORT[k2]}</button>`).join('')}</div></div>${steps ? `<div class="steps">${steps}</div>` : ''}</div>`; };
  const designHtml = `<div class="gh">DESIGN THE GROUND</div>
    <div class="f"><div class="fl"><label>PREMISE</label></div><div class="segs"><button type="button" class="seg prem${repl ? '' : ' on'}" data-repl="0"${dis}>KEEP THE CITY'S TREE</button><button type="button" class="seg prem${repl ? ' on' : ''}" data-repl="1"${dis}>REPLACEMENT TREE</button></div></div>
    <div class="f"><div class="fl"><label>DEPTH <i class="rng">0.3 – 2.0 m</i></label><b>${fmt(isFinite(live.depth) ? live.depth : S.band.design.depth_m, 2)} m</b>${provTag('depth')}</div><input id="f-depth-r" type="range" step="0.05" min="0.3" max="2" value="${fmt(isFinite(live.depth) ? live.depth : S.band.design.depth_m, 2)}"${dis}>${busy && app.pending && !app.pending.candidate_only ? '<div class="fs"><span><b class="run">the rule is running</b></span></div>' : ''}<input id="f-depth" type="number" step="0.05" min="0.3" max="2" value="${fmt(isFinite(live.depth) ? live.depth : S.band.design.depth_m, 2)}" class="hid"></div>
    <div class="f"><div class="fl"><label>SOIL SYSTEM</label>${provTag('soil')}</div><div class="segs four">${Object.keys(SOIL_TXT).map((k2) => { const swap = !repl && k2 === 'structural_soil'; return `<button type="button" class="seg soil${k2 === live.soil ? ' on' : ''}${swap ? ' swap' : ''}" data-soil="${k2}" title="${esc(swap ? 'structural soil counts for a new tree only (R08): choosing it makes this a replacement tree' : SOIL_NOTE[k2] || '')}"${dis}>${SOIL_SHORT[k2]}<i>${swap ? 'new tree' : SOIL_FAC[k2]}</i></button>`; }).join('')}</div><div class="fs"><span${app.premNote ? ' class="note"' : ''}>${app.premNote ? esc(app.premNote) : SOIL_RULE[live.soil] || ''}</span></div></div>
    <div class="gh">PROPOSE MORE SOIL <span>checked against the mains</span></div>${prop('property')}${prop('road')}
    <div class="reset"><a id="f-reset">↺ RESET TO THE CITY'S GROUND</a></div>
    ${fixCurbHtml(S)}`;   /* the reset and the curb correction share the panel's last rows */
  /* C · what the engine says the ground can support */
  const exAv = !!(S.band.existing && S.band.existing.available);
  const readout = run ? `<b class="n wait">counting …</b>` : bf.vcls === 'review' ? `<b class="n">reviewed by hand</b> <span>${live.soil === 'soil_cell' ? 'soil cells carry no factor in the rule source' : 'a main through the trunk, or the tree stands outside the band'}</span>` : !known ? `<b class="n">not assessable</b>`
    : `${!run && have != null && app.prevHave != null && Math.abs(app.prevHave - have) > 0.05 ? `<s>${fmt(app.prevHave, 1)}</s> → ` : ''}<b class="n${app.flashAt && performance.now() - app.flashAt < 1600 ? ' flash' : ''}">${num(have, 1, ' m³')}</b> <span>· ${bf.cls === 'none' ? 'no Table 9-2 tree' : bf.cls === 'Small' ? 'a Small tree only' : `up to a ${bf.cls} tree`}</span>`;   /* one line: the number and the class it reaches; the ruler under it says the same in Table 9-2's terms */
  const zonesPhys = ['property', 'road'].map((s2) => zoneOf(s2)).filter((z) => z && z.status === 'KNOWN' && z.physical_m3 != null);
  const nums = `<div class="nums"><div class="n"><em>PHYSICAL SOIL</em><b>${num(sel.physical_soil_volume_m3, 1, ' m³')}</b><small>in the cell${zonesPhys.length ? zonesPhys.map((z) => `<br>+ ${fmt(z.physical_m3, 1)} m³ ${zoneWord(S, z.side)}`).join('') : ''}</small></div>
    <div class="n"><em>CREDITED SOIL</em><b>${num(have, 1, ' m³')}</b><small>${SOIL_SHORT[live.soil] || ''} ${cr[0]}${E.share_total_m3 != null ? ' + zones (R31)' : ''} · ${known && !run ? (bf.cls === 'none' ? 'carries no Table 9-2 tree' : bf.cls === 'Small' ? 'carries a Small tree only' : `carries up to a ${bf.cls} tree`) : run ? 'counting …' : 'capacity not known'}</small></div></div>`;
  const caps = ['Small', 'Medium', 'Large'].map((cls) => { const f = fitsCls ? fitsCls.includes(cls) : null; const top = known && bf.cls === cls; return `<span class="cap${f ? ' ok' : f === false ? ' no' : ''}${top ? ' top' : ''}" title="${f ? 'fits' : f === false ? 'no room' : ''}"><em>${cls.toUpperCase()}</em><b>${vol(cls) != null ? vol(cls) + ' m³' : '—'}</b></span>`; }).join('') + `<span class="capt">${run ? TAGI('PENDING') : !fitsCls ? (bf.vcls === 'review' ? TAGI('REVIEW', 'review') : TAGI('NO RECORD')) : ''}</span>`;   /* the three classes on one line: the ones that fit in ink, the one reached in the accent, no room struck through */
  const chipsOf = (cls) => cards.filter((c) => c.listed && c.class === cls).map((c) => `<button type="button" class="tchip${c.id === cid ? ' on' : ''}${c.fit && c.fit.fits === false ? ' nofit' : ''}" data-id="${esc(c.id)}" title="${esc(c.latin || '')} · ${(c.city_count || 0).toLocaleString()} in the City${c.on_this_face ? ' · on this street' : ''}"${dis}>${esc(c.common)}</button>`).join('');
  const openCls = app.openCls || {};
  const spHere = sel.spacing_m != null ? sel.spacing_m : (sel.cell && sel.cell.u_from != null ? sel.cell.u_to - sel.cell.u_from : null);   /* Table 9-2's spacing range (R02) beside the measured spacing: reference only, never judged */
  const classRows = ['Large', 'Medium', 'Small'].map((cls) => { const f = fitsCls ? fitsCls.includes(cls) : null; const nSp = cards.filter((c) => c.listed && c.class === cls).length; const sp = (cards.find((c) => c.listed && c.class === cls && c.spacing_m) || {}).spacing_m; const open = f && (openCls[cls] != null ? openCls[cls] : false);   /* 2026-10-12: closed until asked — the species list is the longest thing in the column and secondary until a species is wanted */ return `<div class="crow${f === false ? ' nofit' : ''}"><div class="crh" data-cls="${cls}" data-open="${open ? 1 : 0}"><em>${cls.toUpperCase()}</em><span>${vol(cls) != null ? vol(cls) + ' m³' : ''} · ${nSp} species${sp ? ` · spacing ${sp.min}–${sp.max} m${spHere != null ? ` (here ${fmt(spHere, 1)})` : ''}` : ''}</span>${f ? TAGI('FITS', 'ok') : TAGI('NO ROOM', 'no')}${f ? `<u>${open ? '▾' : '▸'}</u>` : ''}</div>${open ? `<div class="chips">${chipsOf(cls)}</div>` : ''}</div>`; }).join('');
  const spLabel = cs ? `${esc(cs.common)} · ${esc(r.label)}` : repl ? 'choose a species' : 'or a replacement species';
  const chooser = `<div class="spdrawer"><a id="sp-toggle" class="sptog"><u>${app.spOpen ? '▾' : '▸'}</u> ${spLabel}${cs ? ` <a class="tchip x" data-id="">× none</a>` : ''}</a>${app.spOpen ? (known ? `<div class="rl grey">Table 9-3 · a class that fits opens its species${!repl ? ' · a species makes this a replacement tree' : ''}</div><div class="crows">${classRows}</div>` : `<div class="rl grey">${run ? 'the rule is running' : bf.vcls === 'review' ? 'this cell is reviewed by hand' : 'the capacity of this cell is not known'}</div>`) : ''}</div>`;   /* the species as a drawer: one line until asked, the longest thing in the column stays folded */
  const resultBox = cs
    ? `<div class="res"><div class="rv ${r.cls}">${esc(r.label)}</div><div class="rl">${esc(cs.common)} · ${r.treeClass ? esc(r.treeClass) : 'not in Table 9-3'}${r.required != null ? ` · needs ${r.required} m³` : ''}${r.available != null ? ` · the ground gives ${fmt(r.available)} m³` : ''}${r.gap != null ? ` · ${r.gap >= 0 ? '+' : '−'}${fmt(Math.abs(r.gap))} m³` : ''}</div>${r.conflicts.length ? `<div class="rl red">need-box cut by ${r.conflicts.map((c) => (c.dataset || c.kind || '').replace(/[-_]/g, ' ')).join(', ')}</div>` : ''}</div>`
    : `<div class="res"><div class="rv ${repl ? bf.vcls : r.cls}">${known ? esc(repl ? (bf.upto || '') : r.label) : run ? 'COUNTING …' : bf.vcls === 'review' ? 'MANUAL REVIEW' : 'NOT ASSESSABLE'}</div><div class="rl">${repl ? 'the ground alone · no species chosen yet' : `the City's tree · ${r.required != null ? 'needs ' + r.required + ' m³' : 'no required volume'}${r.available != null ? ' · the ground gives ' + fmt(r.available) + ' m³' : ''}`}</div></div>`;
  const nextId = String.fromCharCode(65 + app.saved.length); const busyNow = app.busy || app.pending;
  const saveBtn = `${canSave ? `<button id="f-savesc" class="cta sec"${busyNow ? ' disabled' : ''}>${app.busy && !app.pending ? 'SAVING …' : `SAVE AS SCENARIO ${nextId}`}<small>${app.busy && !app.pending ? 'a moment' : 'keeps this ground for 05 and the comparison at 06'}</small></button>` : ''}<button id="f-save" class="cta big"${busyNow ? ' disabled' : ''}>${busyNow ? (app.pending && app.pending.candidate_only ? 'PLACING THE TREE …' : app.pending ? 'THE RULE IS RUNNING …' : 'SAVING …') : 'VIEW SPATIAL RESULT →'}<small>${busyNow ? 'a few seconds' : savedAs ? `scenario ${savedAs}, in three dimensions` : canSave ? 'the working ground, not yet saved' : app.scenario ? 'the working ground' : 'the ground as it stands · change a lever or plant a species to make a scenario'}</small></button>`;   /* saving is its own button, named (A, B, C …); the forward button only goes forward */   /* never a dead button: with nothing changed it shows today's ground at 05 (the walk of 2026-10-13: disabled on arrival with no note) */   /* the button says the state; the hint rides on its title (2026-10-12: the column must not scroll at 1500×800) */
  const V = $('verdict'); if (V) { V.innerHTML = ''; V.className = 'vbox top'; }   /* the title names the street and the instrument's subtitle the tree: no paragraph over the levers (2026-10-09) */
  ctl.innerHTML = designHtml;
  const B = $('inputsB'), C = $('inputsC');
  void caps; const vols = ['Small', 'Medium', 'Large'].map((cls) => [cls, vol(cls)]).filter((q) => q[1] != null); const vmax = Math.max(20, ...vols.map((q) => q[1])) * 1.3; const rmax = Math.max(vmax, (have || 0) * 1.12); const pc = (v) => Math.max(0, Math.min(100, v / rmax * 100)).toFixed(1);
  const ruler = `<div class="ruler${run ? ' wait' : ''}" title="Table 9-2 · trees ${condWord(cond)} · the credited soil against the three classes"><div class="bar">${known && have != null ? `<div class="reach" style="width:${pc(have)}%"></div>` : ''}${vols.map(([cls, v]) => { const f = fitsCls ? fitsCls.includes(cls) : null; const top = known && bf.cls === cls; return `<div class="tick${f ? ' ok' : f === false ? ' no' : ''}${top ? ' top' : ''}${vols.indexOf(vols.find((q) => q[0] === cls)) % 2 ? ' alt' : ''}" style="left:${pc(v)}%"><i><b>${v}</b> ${cls.toUpperCase()}</i></div>`; }).join('')}${known && have != null ? `<div class="needle${app.flashAt && performance.now() - app.flashAt < 1600 ? ' flash' : ''}" style="left:${pc(have)}%"></div>` : `<div class="noneedle">${run ? 'counting …' : bf.vcls === 'review' ? '' : 'no record'}</div>`}</div></div>`;   /* Table 9-2 as a ruler: the three volumes as ticks, the credited soil as the needle, the reached class in the accent */
  void B; void chooser; void resultBox;
  const whyRev = bf.vcls === 'review' ? (live.soil === 'soil_cell' ? 'soil cells have no factor in the rule: a person counts this cell' : reviewWhy(S, sel).replace(/\.$/, '')) : '';   /* the review's reason, said once in the column (the walk of 2026-10-13: "reviewed by hand" three times) */
  const countline = run ? `<div class="countline"><span>counting …</span><b class="n wait">…</b></div>` : !known ? `<div class="countline"><span>${bf.vcls === 'review' ? `<b class="rev">MANUAL REVIEW</b> ${esc(whyRev)}` : 'no count for this cell'}</span></div>`
    : `<div class="countline"><span>${num(sel.soil_area_m2, 1, ' m²')} × ${fmt(live.depth, 2)} m ${cr[0] === 'manual' ? '· reviewed' : (CREDIT_TXT[live.soil] || CREDIT_TXT.other)[0]}${E.share_total_m3 != null ? ' + zones' : ''} =</span>${have != null && app.prevHave != null && Math.abs(app.prevHave - have) > 0.05 ? `<s>${fmt(app.prevHave, 1)}</s>` : ''}<b class="n${app.flashAt && performance.now() - app.flashAt < 1600 ? ' flash' : ''}">${num(have, 1, ' m³')}</b></div>`;   /* 03's last row, alive: the same count, the number moving under the hand */
  const classline = run || bf.vcls === 'review' ? '' : `<div class="classline">${!known ? 'not assessable' : bf.cls === 'none' ? 'no Table 9-2 tree' : bf.cls === 'Small' ? 'a Small tree only' : `up to a ${bf.cls} tree`}</div>`;
  const verdict = cs ? `<div class="res line"><b class="rv ${r.cls}">${esc(r.label)}</b><span class="rl">${esc(cs.common)} · ${r.treeClass ? esc(r.treeClass) : 'not in Table 9-3'}${r.required != null ? ` · needs ${r.required} m³` : ''}${r.gap != null ? ` · ${r.gap >= 0 ? '+' : '−'}${fmt(Math.abs(r.gap))} m³` : ''}${r.conflicts.length ? ` · <span class="red">the need-box crosses the ${r.conflicts.map((c) => (c.dataset || c.kind || '').replace(/[-_]/g, ' ').replace(/ mains$/, ' main')).join(' and the ')} clearance</span> (already out of the count)` : ''}</span></div>`: '';   /* the species' verdict as one line: the column must not scroll at 1500×800 */
  if (C) C.innerHTML = `<div class="gh">WHAT IT CARRIES <span>Table 9-2</span></div>${countline}${classline}${ruler}${verdict}${saveBtn}`;
  /* the tray under the drawing: the three classes as tiles, the chips of one class in rows — every species in view, nothing to pull down */
  { const Y = $('tray'); if (Y) { const rev = bf.vcls === 'review' && !run; const tcls = app.trayCls && ((fitsCls && fitsCls.includes(app.trayCls)) || rev) ? app.trayCls : (known ? bf.cls : rev ? 'Medium' : null); const tiles = ['Small', 'Medium', 'Large'].map((cls) => { const f = fitsCls ? fitsCls.includes(cls) : null; const n = cards.filter((c) => c.listed && c.class === cls).length; return `<button type="button" class="ttile${f ? ' ok' : f === false ? ' no' : ''}${tcls === cls ? ' on' : ''}" data-cls="${cls}"${f || rev ? '' : ' disabled'}><em>${cls.toUpperCase()}</em><b>${vol(cls) != null ? vol(cls) + ' m³' : '—'}</b><i>${f == null ? (run ? 'pending' : rev ? n + ' species · review' : 'no record') : f ? n + ' species' : 'no room'}</i></button>`; }).join('');
      treeIconDefs(); const chips = tcls ? cards.filter((c) => c.listed && c.class === tcls).map((c) => `<button type="button" class="tchip tcard${c.id === cid ? ' on' : ''}${c.fit && c.fit.fits === false ? ' nofit' : ''}" draggable="true" data-id="${esc(c.id)}" title="${esc(c.latin || '')} · ${(c.city_count || 0).toLocaleString()} in the City${c.on_this_face ? ' · on this street' : ''} · drag it into the section, or click"${dis}><svg class="ico"><use href="#tico-${TREE_ART.has(c.form) ? c.form : 'round'}"/></svg><b>${esc(c.common)}</b><i>${c.volume_m3 && c.volume_m3[cond] != null ? c.volume_m3[cond] + ' m³' : ''}${c.drawn_height_m != null ? ' · ' + fmt(c.drawn_height_m) + ' m tall' : ''}</i></button>`).join('') : '';
      Y.innerHTML = `<div class="th"><b>${repl ? 'PLANT A SPECIES' : 'OR A REPLACEMENT SPECIES'}</b><span>Table 9-3 · ${rev ? 'the rule stops at this cell: a species can be placed, its answer stays a manual review' : repl ? 'the classes this ground carries' : 'a species makes this a replacement tree'}</span></div><div class="ttiles">${tiles}</div>${cs ? `<a class="tchip x none" data-id="">× ${esc(cs.common)} · none</a>` : ''}<div class="tchips">${chips || `<span class="grey">${run ? 'the rule is running' : known ? 'nothing fits this ground' : bf.vcls === 'review' ? 'no class to choose from until a person has counted this cell' : 'the capacity of this cell is not known'}</span>`}</div>`;
      for (const b of Y.querySelectorAll('.ttile')) b.onclick = () => { app.trayCls = b.dataset.cls; app.ctlKey = ''; draw(); };
      for (const c of Y.querySelectorAll('.tcard')) { c.addEventListener('dragstart', (e) => { if (app.busy) { e.preventDefault(); return; } app.dragCard = c.dataset.id; app.armed = null; e.dataTransfer.setData('text/plain', c.dataset.id); e.dataTransfer.effectAllowed = 'copy'; draw(); }); c.addEventListener('dragend', () => { app.dragCard = null; draw(); }); } } }   /* a card dragged over the section lights the cell; dropped, it stands in the ground (the #fixed drop handler, placeCard) */
  /* the handlers */
  wireFacts(S);
  { const sv = $('f-save'); if (sv) sv.onclick = () => { if (!app.busy) scrollToT(STOP_T[4]); }; const ss = $('f-savesc'); if (ss) ss.onclick = saveScenario; const l3 = $('to-03b'); if (l3) l3.onclick = () => scrollToT(STOP_T[2]); 
    for (const h of $('tool').querySelectorAll('.crh')) h.onclick = () => { const cls = h.dataset.cls; app.openCls = { Large: false, Medium: false, Small: false, [cls]: h.dataset.open !== '1' }; app.ctlKey = ''; draw(); };   /* one class open at a time: the column never outgrows the window */ }
  const root = $('fixed');
  const commitNum = (id, key, d, cur) => { const inp = $(id); if (!inp) return; const go = () => { const v = +(+inp.value).toFixed(d); if (!isFinite(v) || app.busy) return; if (Math.abs(v - cur) < 1e-9) { inp.value = fmt(cur, d); return; } evaluate({ [key]: v }); }; inp.onchange = go; inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } }; };
  for (const b of root.querySelectorAll('.tchip[data-id]')) b.onclick = (e) => { e.stopPropagation(); if (app.busy) return; const id = b.dataset.id; if (id) placeCard(id); else evaluate({ candidate: null, candidate_only: true }); };
  for (const b of ctl.querySelectorAll('.seg.soil')) b.onclick = () => { if (app.busy || b.dataset.soil === live.soil) return; app.premNote = ''; if (!repl && b.dataset.soil === 'structural_soil') { app.premNote = 'structural soil counts for a new tree only (R08) · the premise switched to a replacement tree'; evaluate({ soil: b.dataset.soil, replacement: true }); } else evaluate({ soil: b.dataset.soil }); };   /* under KEEP, structural soil is a dead end in the rule: the click switches the premise and says so, instead of ending in a manual review (the walk of 2026-10-13) */
  for (const b of ctl.querySelectorAll('.seg.prem')) b.onclick = () => { const want = b.dataset.repl === '1'; if (app.busy || want === repl) return; app.premNote = ''; const toNative = !want && live.soil === 'structural_soil'; if (toNative) app.premNote = 'back to the City\'s tree: structural soil does not count for it, so the soil is native again'; evaluate(want ? { replacement: true } : { replacement: false, candidate: null, ...(toNative ? { soil: 'native_soil' } : {}) }); };   /* the premise changes the rule path: a run, and no species card for the City's tree */
  for (const p of ctl.querySelectorAll('.prop')) { const side = p.dataset.side; const cb = p.querySelector('.x-on'), w = p.querySelector('.x-w');
    cb.onchange = () => { if (app.busy) { cb.checked = !cb.checked; return; } sendExt(S, side, { on: cb.checked, width: +w.value }); };
    w.onchange = () => { if (app.busy) return; const v = +(+w.value).toFixed(1); if (!isFinite(v) || v <= 0) return; sendExt(S, side, { width: v }); }; w.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); w.blur(); } };
    for (const b of p.querySelectorAll('.x-soil')) b.onclick = () => { if (app.busy) return; sendExt(S, side, { soil: b.dataset.soil }); }; }
  { const r0 = $('f-depth-r'), d0 = $('f-depth'); if (r0) { r0.oninput = () => { d0.value = (+r0.value).toFixed(2); app.drag = { kind: 'depth', value: +r0.value }; const b = r0.parentNode.querySelector('.fl b'); if (b) b.textContent = (+r0.value).toFixed(2) + ' m'; requestDraw(); }; r0.onchange = () => { const v = +(+r0.value).toFixed(2); app.drag = null; if (!app.busy && Math.abs(v - +(app.pending && app.pending.depth != null ? app.pending.depth : S.band.design.depth_m)) > 1e-9) evaluate({ depth: v }); else draw(); }; } }
  commitNum('f-depth', 'depth', 2, +(app.pending && app.pending.depth != null ? app.pending.depth : S.band.design.depth_m));
  $('f-reset').onclick = () => { if (app.busy || !app.existing) return; app.premNote = ''; app.extDraft = null; app.cls = null; app.openCls = null; const k0 = knobs(app.existing); evaluate({ depth: k0.depth, soil: k0.soil, curb: k0.curb, curb_provenance: k0.curb_provenance || null, curb_evidence: k0.curb_evidence || null, extensions: [], replacement: k0.replacement, candidate: null, land_use: k0.land_use, width_level: k0.width_level }); };
}
// a handle being dragged writes the field it belongs to (the field is the primary input; the handle the secondary one)
function syncFields(S) { const live = liveKnobs(S); { const dz = app.drag; if (dz && dz.kind === 'zone') { const w = document.querySelector(`.prop[data-side="${dz.side}"] .x-w`); if (w) w.value = fmt(dz.value, 1); } } const d = $('f-depth'); if (d && document.activeElement !== d && isFinite(live.depth)) d.value = fmt(live.depth, 2); const dr = $('f-depth-r'); if (dr && document.activeElement !== dr && isFinite(live.depth)) dr.value = fmt(live.depth, 2); const c = $('f-curb'); if (c && document.activeElement !== c) c.value = fmt(live.curb - S.street.centreline_v, 1); const cr = $('f-curb-r'); if (cr && document.activeElement !== cr) cr.value = fmt(live.curb - S.street.centreline_v, 1); }
// what the panels say, as lines (the capture and the PDF print the same words)
function panelLines(S) {
  const live = liveKnobs(S); const cs = candidateShown(S); const st = S.street; const sel = S.trees.find((x) => x.selected); const zones = (sel && sel.extensions && sel.extensions.zones) || [];
  const r = resultFor(S); const exSel = sel; const k = S.knobs; const curbK = k.curb_offset_from_centreline_m || {}; const ex = S.band.existing || {};
  const zl = (side) => { const z = zones.find((q) => q.side === side); return z ? `${fmt(z.width_applied_m, 2)} m ${(z.soil_type || '').replace('_', ' ')} · ${z.status === 'KNOWN' ? fmt(z.credited_m3) + ' m³ credited · ' + (z.connection === 'PARTIAL' ? 'partial' : 'connected') : (z.status || '').toLowerCase().replace(/_/g, ' ')}${z.blocked_by && z.blocked_by.length ? ' · blocked by ' + z.blocked_by.join(', ').replace(/-/g, ' ') : ''}` : 'not proposed'; };
  return { inputs: [`premise: ${live.replacement ? 'replacement tree at this position (scenario, R08/R09)' : "keep the City's tree (benchmark R20)"}`, `tree: ${cs ? cs.common + (cs.listed ? ' · ' + cs.class : ' · not in Table 9-3') : 'the City\'s tree · ' + ((exSel.species_ref && exSel.species_ref.common) || exSel.genus)}`, `soil system: ${(live.soil || '').replace('_', ' ')}`, `soil depth: ${fmt(live.depth, 2)} m`, `proposed ${zoneWord(S, 'property')}: ${zl('property')}`, `proposed ${zoneWord(S, 'road')}: ${zl('road')}`],
           advanced: [`tree class: ${r.treeClass || 'not listed'} (derived)`, st.median ? `median curbs: ${fmt(live.half, 1)} m to either side of the median's centre · ${curbK.provenance === 'CONFIRMED_SITE_DATA' ? 'confirmed site data · ' + (curbK.evidence || '') : 'assumed · the City publishes no curb line'}` : `curb face: ${fmt(live.curb - st.centreline_v, 1)} m from the centreline · ${curbK.provenance === 'CONFIRMED_SITE_DATA' ? 'confirmed site data · ' + (curbK.evidence || '') : 'assumed · the City publishes no curb line'}`, st.median ? `median ${fmt(st.median.width_m, 2)} m wide · band ${fmt(bandWidth(S), 2)} m between the backs of its curbs · no sidewalk or back boulevard deducted (R30 not applied)` : `sidewalk ${fmt(st.widths_m.sidewalk_clear, 2)} m · back boulevard ${fmt(st.widths_m.back_boulevard, 2)} m · Table 8-3 / 8-4 row ${(LAND_TXT[live.land_use] || live.land_use || '').toLowerCase()} · width level ${live.width_level} (assumed, not measured)`, st.median ? `band ${fmt(bandWidth(S), 2)} m (derived)` : `front boulevard ${fmt(st.widths_m.front_boulevard, 2)} m (derived, R30)`, `Table 9-2 condition: ${r.condition}`, `existing soil: ${ex.available ? 'evidenced' : 'no City record · ' + ((ex.missing || []).join(', ').replace(/existing /g, '') || 'nothing supplied')}`],
           result: [`rule check: ${resultLine(r)}`, `available ${r.available != null ? fmt(r.available) + ' m³' : '—'} · required ${r.required != null ? r.required + ' m³' : '—'} · ${r.gap == null ? '' : (r.gap >= 0 ? 'surplus +' : 'gap ') + fmt(r.gap) + ' m³'}`].concat(r.why.map((w) => '· ' + w.t)) };
}
function reviewPanel(ctl, S) {
  const ex = app.existing || S; const rE = resultFor(ex), rP = resultFor(S); const kE = knobs(ex), kP = knobs(S); const selE = ex.trees.find((x) => x.selected), selP = S.trees.find((x) => x.selected); const cs = candidateShown(S);
  const bdE = ex.band.design, bdP = S.band.design; const stE = ex.street, stP = S.street; const L = panelLines(S);
  const row = (k, v) => `<div class="r"><em>${k}</em><span>${v}</span></div>`; const name = (t) => (t.species_ref && t.species_ref.common) || t.genus;
  const grades = {}; for (const f of S.facilities || []) { const g = f.depth_top_m == null ? 'not published' : (f.grade || 'record'); grades[g] = (grades[g] || 0) + 1; }
  const np = (S.not_published || []).map((x) => (typeof x === 'string' ? x : x.label || x.kind || '')).filter(Boolean);
  ctl.innerHTML = `<div class="rv ghost"><div class="rh ghost">EXISTING <span class="tag">THE CITY'S TREE</span></div>${row('TREE', `${esc(name(selE))} · ${fmt(selE.height_m)} m`)}${row('CLASS', selE.table_9_3 && selE.table_9_3.listed ? esc(selE.table_9_3.class) : 'not in Table 9-3')}${row('SOIL', 'existing soil · no City record of width, depth or type')}${row('CURB', `${fmt(stE.curb_face_v - stE.centreline_v, 1)} m from ℄ · assumed`)}${row('SOIL VOLUME', `no record · needs ${rE.required != null ? rE.required : '—'} m³ · ${esc(rE.treeClass || '')}`)}${row('VERDICT', 'NOT ASSESSABLE · no record of the existing ground')}</div>
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
// 01 · the right column: where. ① an area (the map or the list) → ② one of its checked streets (the map or a card) → OPEN THE STREET PLAN; or any address or tree id.
// Choosing never jumps: an area flies the camera to the area, a street to its block (ringed), and the one button opens the plan. A tree (a dot, an address) is already a subject: it opens the plan.
const LOC_W = 300;   /* 01: the index is a narrow column at the map's right, the width of the rail; the map takes the rest */
/* the card that asks for the one measure the City does not publish: a boulevard's curb, or a median's half-width (the distance from its centre to either curb) */
function needCurbHtml(nc) {
  if (nc.median) { const oc = nc.outer || {}; const road = oc.near != null ? ` The road's outer curb is ${fmt(oc.near, 1)} m out` + (nc.trees ? `, its trees stand within ${fmt(nc.trees - 0.8, 1)} m.` : '.') : ''; const guess = Math.max(1.5, +((nc.trees || 1.5) + 1.5).toFixed(1));
    return `<div class="needcurb"><b>No curb line on the median of ${esc(titleCase(nc.hblock))}</b><span>The City publishes none${nc.why ? ' and ' + esc(nc.why.replace(/; type the half-width$/, '')) : ''}.${road} Give the median's half-width, centre to curb, to run this tree.</span><div class="row"><input id="nc-curb" type="number" step="0.1" min="1" max="${Math.max(2, nc.pl - 6)}" value="${guess}"> m to either curb <button type="button" id="nc-go">RUN WITH THIS MEDIAN</button><a id="nc-x">×</a></div></div>`; }
  return `<div class="needcurb"><b>No curb line on ${esc(titleCase(nc.hblock))}</b><span>The City publishes none and no catch basin is near. The property line is ${nc.pl} m from the centreline; give the curb's distance to run this tree.</span><div class="row"><input id="nc-curb" type="number" step="0.1" min="2" max="${Math.max(3, nc.pl - 2)}" value="${Math.max(2, +(nc.pl - 6.9).toFixed(1))}"> m from ℄ <button type="button" id="nc-go">RUN WITH THIS CURB</button><a id="nc-x">×</a></div></div>`;
}
function locatePanel(S) {
  const el2 = $('result'); if (stage(app.t) !== 0 || app.report) { if (el2.classList.contains('locate')) { el2.classList.remove('locate', 'on'); app.resKey = ''; } return; }   /* 01's one column, at every level of the map: the way on first, then the address, then the index of checked streets (the walk of 2026-10-13: the action was buried and the list changed sides) */
  el2.classList.add('on', 'locate'); el2.classList.remove('record', 'tool', 'axo'); el2.style.width = (LOC_W - 10) + 'px'; el2.style.left = 'auto'; el2.style.right = '10px';
  const sc = app.scene; const t = app.t; const lvl0 = atlasLevel(t); const faces = (app.city && app.city.faces ? app.city.faces.faces : []).filter((f) => f.run_ok); const nTrees = app.city && app.city.trees ? app.city.trees.length : null;
  const focus = (app.area && sc.areaInfo ? sc.areaInfo.find((a) => a.name === app.area) : null) || (app.chosen ? sc.homeArea : null); const here = S.site_id.split('_')[0]; const op = app.opening;
  const key = `loc|${lvl0}|${app.area || ''}|${app.chosen ? 1 : 0}|${here}|${app.busy ? 1 : 0}|${app.run ? 1 : 0}|${app.jump || ''}|${op ? op.hblock : ''}|${app.foundNote ? JSON.stringify(app.foundNote) : ''}|${app.needCurb ? app.needCurb.asset : ''}|${app.city ? 1 : 0}|${sc.faceUV ? sc.faceUV.length : 0}|${S.trees.length}|${focus ? focus.name : ''}`; if (key === app.resKey) return; app.resKey = key;
  const areas = (sc.areaInfo || []).slice().sort((x, y) => x.name.localeCompare(y.name)); const nAreas = new Set(faces.map((f) => f.local_area)).size;
  const mine = focus ? faces.filter((f) => f.local_area === focus.name).sort((a, b) => (b.known_count || 0) - (a.known_count || 0) || (b.tree_count || 0) - (a.tree_count || 0)) : [];
  const sw = (k) => `<i class="vsw" style="background:${FACE_COL[k] || FACE_COL.unknown}"></i>`;
  const fn = app.foundNote; const foundHtml = fn ? `<div class="found"><b>${esc(fn.q)}</b> → ${fn.street ? `the nearest boulevard tree is on <b>${esc(fn.street)}</b>` : `tree ${fn.asset}`}${fn.dist != null ? ` · ${fmt(fn.dist, 0)} m away` : ''}</div>` : '';
  const needCurb = app.needCurb ? needCurbHtml(app.needCurb) : '';
  const sideWord = (x) => String(x || '').replace('_side', '').replace(' side', '').replace('_', ' ');
  const open = app.needCurb ? '' : (app.busy || app.run) && op ? `<button type="button" class="cta big wait" disabled>OPENING ${esc(op.hblock)} …<small id="open-note">${esc((app.run && app.run.note) || 'reading the City\'s records')}</small></button>`
    : app.jump ? `<div class="pn run">opening tree ${app.jump} …</div>` : app.busy ? `<div class="pn run">opening …</div>`
    : app.chosen ? `<button type="button" id="go-02" class="cta big">OPEN THE STREET PLAN →<small>${esc(S.title.hblock)} · ${esc(sideWord(S.title.side))} side · ${S.trees.length} trees</small></button>` : '';   /* the one action, first in the column; while a street opens the button already carries its name and says what is being read */
  const faceKey = (f) => (f.largest_class_fits === 'unknown' && f.review_count && f.review_count === f.tree_count ? 'review' : f.largest_class_fits);   /* every tree of the face went to a person: say so, not "no record" (the user, 2026-10-13) */
  const cardsOf = (list) => `<div class="list faces">${list.map((f) => `<button type="button" class="sp fc${f.site_id === here && app.chosen ? ' on' : ''}" data-site="${esc(f.site_id)}" title="${faceKey(f) === 'review' ? 'every tree here ends in a manual review: the City\'s tree points fall outside the assumed band, or a utility clearance runs through the trunk' : ''}">${sw(faceKey(f))}<span class="hb">${esc(f.hblock)}</span><i>${esc(sideWord(f.side))} side · ${f.tree_count} trees · ${FACE_TXT[faceKey(f)] || 'not known'}${f.site_id === here && app.chosen ? ' · chosen' : ''}</i></button>`).join('')}</div>`;
  const addr = `<form id="f-go" class="go"><input id="f-q" type="text" placeholder="an address, or a tree's asset id" title="any of ${nTrees ? nTrees.toLocaleString() : "the City's"} public trees · a street not checked yet is fetched and run first, about half a minute" autocomplete="off"><button type="submit">GO</button></form>`;
  const reads = `<details class="reads"><summary>WHAT THE TOOL READS <span>${DATA_READ.reduce((n, g) => n + g.items.length, 0)} CITY LAYERS · 4 RULE SOURCES</span></summary>${DATA_READ.map((g) => `<div class="rg"><b>${g.head}</b>${g.items.map((it) => `<span>${esc(it)}</span>`).join('<em> · </em>')}</div>`).join('')}</details>`;
  const pc = app.pilotCard; const demo = pc ? `<div class="gh">START HERE <span>a street already fetched · opens at once</span></div><div class="list faces demo"><button type="button" class="sp fc${here === pc.site.split('_')[0] && app.chosen ? ' on' : ''}" data-site="${esc(pc.site)}">${sw(pc.cls)}<span class="hb">${esc(pc.hblock)}</span><i>${esc(sideWord(pc.side))} side · ${pc.n} trees${here === pc.site.split('_')[0] && app.chosen ? ' · chosen' : ''}</i></button></div>` : '';
  const index = `${demo}<div class="gh">THE CHECKED STREETS <span>${faces.length} · ${nAreas} AREAS</span></div>${STATIC ? '<div class="pn">any City tree runs here: a street opened for the first time fetches its City layers (about a minute), then it is kept for this visit</div>' : ''}
    <div class="areas">${areas.map((a) => { const on = focus && a.name === focus.name; return `<button type="button" class="ar${on ? ' on' : ''}${a.faces ? '' : ' none'}" data-area="${esc(a.name)}" title="${a.faces ? a.faces + ' checked streets · click to list them' : 'no checked street yet · the map flies there'}">${sw(a.verdict || 'unknown')}<span>${esc(a.name)}</span><b>${a.faces || '–'}</b></button>${on ? (mine.length ? cardsOf(mine) : '<div class="pn">none checked here yet · type an address to check one</div>') : ''}`; }).join('')}</div>`;
  el2.innerHTML = `<div class="ctl loc">${open}${foundHtml}${needCurb}${addr}${index}${reads}</div>`;
  wireLocate(el2, areas);
  { const on = el2.querySelector('.ar.on'); const box = el2.querySelector('.areas'); if (on && box) requestAnimationFrame(() => { if (box.scrollHeight > box.clientHeight) box.scrollTop = Math.max(0, on.offsetTop - box.offsetTop - 2); }); }
}
/* 01 in the rail: the stage, the level, one instruction — the column holds everything else */
function locateRailHtml(S, lvl0) {
  const LV = { city: ['CITY', 'Click an area on the map, or pick a checked street on the right.'], area: ['AREA', 'Pick one of its streets on the right, or wheel in to its trees.'], block: ['BLOCK', 'Click a tree to open its street.'], street: ['STREET', ''] }; void S;
  return `<div class="ph">01 · LOCATION</div><div class="lvls">${['city', 'area', 'block'].map((k) => `<button type="button" class="lv${lvl0 === k ? ' on' : ''}" data-lv="${k}">${LV[k][0]}</button>`).join('')}</div><div class="do">${LV[lvl0] ? LV[lvl0][1] : ''}</div>`;
}
function wireLocate(el2, areas) {
  for (const b of el2.querySelectorAll('.lv')) b.onclick = () => { const dv = diveT(); scrollToT(b.dataset.lv === 'city' ? 0 : b.dataset.lv === 'area' ? dv.ta : Math.min(dv.tb, wheelMax())); };
  for (const b of el2.querySelectorAll('.ar')) b.onclick = () => { const ar = (areas || []).find((a) => a.name === b.dataset.area); if (ar) goArea(ar); };
  for (const b of el2.querySelectorAll('.fc')) b.onclick = () => goFace(b.dataset.site);
  if ($('f-go')) $('f-go').onsubmit = (e) => { e.preventDefault(); const q = $('f-q').value.trim(); if (q) { app.foundNote = null; goTo(q, () => {}, STOP_T[1]); } };
  if ($('go-02')) $('go-02').onclick = () => goStage(1);
  if ($('nc-go')) { requestAnimationFrame(() => { const b = $('nc-go'); if (b && b.scrollIntoView) b.scrollIntoView({ block: 'nearest' }); }); $('nc-go').onclick = () => { const v = +$('nc-curb').value; if (!(v > 0)) return; const a = app.needCurb.asset; app.curbFor = { asset: a, curb: v }; app.needCurb = null; app.resKey = ''; draw(); planOnly(); goTo(String(a), () => status('could not open tree ' + a), STOP_T[1]); }; $('nc-x').onclick = () => { app.needCurb = null; app.resKey = ''; status(''); draw(); }; }
}
// 03 · the City's record of the selected tree and the ground at it, in the right column: what the City knows, lightly tagged — the full provenance is in VIEW FULL INFORMATION and the PDF
/* 02 · the block face under the chosen tree: the block, its trees, the right of way, and what the band carries tree by tree (the discs' colours) */
function faceBlockHtml(S, row2) {
  const st = S.street, blk = st.block, C = S.context || {}; const len = blk ? blk.u_to - blk.u_from : null; const curb = st.curb_face_v, cl = st.centreline_v; const farCurb = C.far_curb_v != null ? C.far_curb_v : curb != null ? 2 * cl - curb : null;
  const sp = S.trees.map((x) => x.spacing_m).filter((x) => x != null).sort((a, b) => a - b); const med = sp.length ? sp[Math.floor(sp.length / 2)] : null;
  const clsOf = (tr) => (tr.share_status === 'KNOWN' && Array.isArray(tr.benchmark_classes) ? (['Large', 'Medium', 'Small'].find((c) => tr.benchmark_classes.includes(c)) || 'none') : tr.share_status === 'REVIEW_REQUIRED' ? 'review' : 'unknown'); const n = {}; for (const tr of S.trees) n[clsOf(tr)] = (n[clsOf(tr)] || 0) + 1;
  const dots = [['Large', 'Large'], ['Medium', 'Medium'], ['Small', 'Small'], ['none', 'none'], ['review', 'manual review'], ['unknown', 'no record']].filter(([k]) => n[k]).map(([k, w]) => `<span><i class="vsw" style="background:${FACE_COL[k] || FACE_COL.unknown}"></i>${n[k]} ${w}</span>`).join('');
  const rev = S.trees.filter((t) => t.share_status === 'REVIEW_REQUIRED'), kn = S.trees.filter((t) => t.share_status === 'KNOWN' && t.share_m3 != null); const parts = [];
  if (rev.length) { const cf = rev.filter((t) => trunkConflicts(S, t).length), ob = rev.filter((t) => !trunkConflicts(S, t).length && outsideBand(S, t)); const ks = [...new Set(cf.flatMap((t) => trunkConflicts(S, t)))].map((k) => KINDW[k] || k.replace(/_/g, ' ')); const because = cf.length && ob.length ? `${ks.join(' or ')} clearances run under ${cf.length}, ${ob.length} stand outside the band` : cf.length ? `${ks.length > 1 ? ks.join(' or ') + ' clearances run' : 'a ' + ks[0] + ' clearance runs'} under them` : ob.length ? 'they stand outside the band' : 'the rule stops there'; parts.push(`${rev.length} of ${S.trees.length} trees go to manual review: ${because}.`); }
  if (kn.length) { const sh = kn.map((t) => t.share_m3).sort((a, b) => a - b); const fits = kn.filter((t) => (t.benchmark_classes || []).length); parts.push(`${rev.length ? 'The rest' : `All ${kn.length}`} get ${sh.length > 1 && fmt(sh[0]) !== fmt(sh[sh.length - 1]) ? `${fmt(sh[0])}–${fmt(sh[sh.length - 1])}` : fmt(sh[0])} m³ against ${kn[0].required_m3} m³${S.need && S.need.class ? ` for a ${S.need.class}` : ''}${fits.length ? '' : '; nothing fits'}.`); }
  const sentence = parts.join(' ');   /* at most two sentences, about 25 words: what the band carries along this face and why */
  return `<div class="k top">This block face</div>
      <div class="facerow">${sentence ? `<p>${sentence}</p>` : ''}<div class="dots">${dots}</div></div>
      <div class="rows">${row2('Block', `${titleCase(S.title.cross_west || '')} to ${titleCase(S.title.cross_east || '')}${len != null ? `, ${fmt(len, 0)} m` : ''}`, ['', 'CITY'])}${row2('Trees', `${S.trees.length}${med != null ? `, ${fmt(med, 1)} m apart` : ''}`, ['', 'CITY'])}
      ${C.right_of_way && C.right_of_way.width_m != null ? row2('Right of way', `${fmt(C.right_of_way.width_m, 1)} m, line to line`, ['', 'CITY']) : ''}${curb != null && farCurb != null ? row2('Curb to curb', `${fmt(curb - farCurb, 1)} m`, ['assumed', 'ASSUMED']) : ''}${st.median ? row2('Median', `${fmt(st.median.width_m, 1)} m wide, between two carriageways`, ['assumed', 'ASSUMED']) : ''}</div>`;
}
function recordPanel(S) {
  const el2 = $('result'); const pendId = app.pending && app.pending.site_id; const stg = stage(app.t); if (stg === 4 && !app.report) { axoColumn(el2); return; }   /* 05 owns the column too: the scenario's layer cards */ const sel = (stg === 1 && pickTree(S)) || (pendId && S.trees.find((x) => x.site_id === pendId)) || S.trees.find((x) => x.selected); const recOn = stg === 2 || stg === 1;   /* 02: the chosen tree's card (the clicked tree at once, the run's numbers follow) · 03: the City's record */ if (!recOn || !sel) { el2.classList.remove('record'); return; } el2.classList.add('on', 'record'); el2.classList.remove('tool', 'locate', 'axo'); if ($('axogo')) $('axogo').classList.remove('on');   /* the column changes hands here: 01's index class goes too, or locatePanel would hide the card on the next draw (a landing on ?t=1.5 showed no card) */ el2.style.width = (SHEET.eastRec - 14) + 'px'; el2.style.left = 'auto'; el2.style.right = '10px';   /* 02 and 03 own the column here; the result panel owns it at 04 */
  const k = S.knobs; const curbK = k.curb_offset_from_centreline_m || {};
  const key = `rec|${stg}|${S.site_id}|${sel.site_id}|${app.pick || ''}|${curbK.provenance}|${app.treeOpen ? 1 : 0}|${app.busy ? 1 : 0}|${app.pending ? JSON.stringify(app.pending) : ''}|${(app.cutU || 0).toFixed(1)}`; if (key === app.resKey) return; app.resKey = key;
  const sr = sel.species_ref || {}; const st = S.street; const strips = S.band.strips || []; const cell = sel.cell || {};
  if (stg === 1) {   /* 02 · the chosen tree: what the band carries here and why, then who the tree is, its measures, the block face — all open, the column has the room */
    const bf = bandFit(S, sel); const run = !!pendId && pendId === sel.site_id; const cellLen = cell.u_from != null ? cell.u_to - cell.u_from : null; const listed = sel.table_9_3 && sel.table_9_3.listed;
    const row2 = (kk, v, tag) => `<div class="r"><em>${kk}</em><b>${v}${tag ? ` ${TAGI(tag[1], tag[0] === 'assumed' ? 'assumed' : '')}` : ''}</b></div>`;
    const condW = condWord((S.need && S.need.condition) || (S.library && S.library.condition)); const nm = sr.common || sel.genus;
    const why = run ? 'the rule is reading this cell' : bf.available != null ? `${fmt(bf.available)} m³ of credited soil, the ground assumed${S.need && S.need.class && sel.required_m3 != null ? (listed ? `; a ${S.need.class} tree ${condW} needs ${sel.required_m3} m³` : `. ${nm} is not in Table 9-3, so the rule checks it as a ${S.need.class} tree: ${sel.required_m3} m³ ${condW}`) : ''}` : bf.vcls === 'review' ? reviewWhy(S, sel) : 'no share on record for this cell';   /* the benchmark said once, with its reason (the walk of 2026-10-13: "Up to Large" over "against 15 m³ for a Medium") */
    el2.innerHTML = `<div class="carry first ${run ? 'wait' : bf.vcls}"><em>The band carries here${run ? '<i class="prov run">reading its ground …</i>' : ''}</em><b>${run ? 'counting …' : esc(nice(bf.upto || bf.label))}</b><small>${why.replace(/^./, (m) => m.toUpperCase()).replace(/\s·\s/g, '; ').replace(/([^.])$/, '$1.')}</small></div>
      <div class="k">The chosen tree</div><div class="v small">${esc(sr.common || sel.genus)}</div><div class="sub">${esc(sr.latin || (sel.genus + ' ' + sel.species))}, tree ${esc(sel.site_id.replace(/^(KE|V)-/, ''))}</div>
      <div class="rows">${row2('Height, trunk', `${fmt(sel.height_m)} m, ${sel.diameter_cm != null ? fmt(sel.diameter_cm, 1) + ' cm' : '—'}`, ['', 'CITY'])}${row2('Table 9-3', listed ? esc(sel.table_9_3.class) : 'not listed', ['', 'CITY'])}${row2('Its cell of the band', `${fmt(bandWidth(S), 2)} × ${cellLen != null ? fmt(cellLen, 2) : '—'} m`, ['derived', 'DERIVED'])}</div>
      ${faceBlockHtml(S, row2)}
      <div class="siteread"><button id="go-03" class="cta big"${run ? ' disabled' : ''}>SEE ITS GROUND →<small>the section at A–A and the City's record</small></button></div>`;
    $('go-03').onclick = () => goStage(2); return; }
  const constraints = strips.filter((x) => cell.u_from != null && x.u1 >= cell.u_from && x.u0 <= cell.u_to);   /* the clearance strips that touch this tree's cell: what the design will have to work around */
  const g = {}; for (const f of S.facilities || []) { const kk = f.depth_top_m == null ? 'not published' : (f.grade || 'record'); g[kk] = (g[kk] || 0) + 1; }
  const sw = S.ground && S.ground.sidewalk; const c311 = S.ground && S.ground.cases_311 && S.ground.cases_311.since_2022 ? S.ground.cases_311.since_2022.count : null; const bh = S.ground && S.ground.borehole;
  const row = (kk, v, tag) => `<div class="r"><em>${kk}</em><b>${v}${tag ? ` ${TAGI(tag[1], tag[0] === 'assumed' ? 'assumed' : '')}` : ''}</b></div>`; const ex = S.band.existing || {};
  const run = !!app.pending; const curbConf = curbK.provenance === 'CONFIRMED_SITE_DATA';
  el2.innerHTML = `<div class="k">WHAT THE CITY KNOWS HERE${pendId && !sel.selected ? '<i class="prov run">READING ITS GROUND …</i>' : ''}</div><div class="v small">${esc(sr.common || sel.genus)}</div><div class="sub">${esc(sr.latin || (sel.genus + ' ' + sel.species))} · tree ${esc(sel.site_id.replace(/^(KE|V)-/, ''))}</div>
    ${recordCards03(S, sel)}
    <div class="siteread">
      <button id="go-04" class="cta big"${run ? ' disabled' : ''}>${run ? 'THE RECORD IS UPDATING …' : 'DESIGN A SCENARIO →'}</button></div>`;
  wireFacts(S); wireRuleCount(); { const o = $('tree-open'); if (o) o.onclick = () => { app.treeOpen = !app.treeOpen; app.resKey = ''; draw(); }; }
  $('go-04').onclick = () => scrollToT(STOP_T[3]);
}
// 05 · the axonometric: the rail says how the block opens; the column (axoColumn) carries the scenario and one card per layer
const AXO_LAYERS = ['THE SURFACE', 'THE PLANTER', 'THE MAINS', 'THE NATIVE GROUND'];   /* the block's layers, top down: what the pins and the cards are numbered by */
function axoPanel(ctl) {
  const x = axoSnap(); const n = app.axoFocus || 0; const r = x ? x.result : null;
  const head = x ? `<div class="sv2"><em>${x.live ? (app.scenario ? 'working scenario · not saved' : 'the existing condition') : 'scenario ' + x.id + (x.savedAt ? ' · saved ' + x.savedAt.slice(0, 10) : '')}</em><b>${esc(x.subject)}</b><span class="${r.cls || ''}">${r.available != null ? fmt(r.available) + ' m³' : '—'}${r.required != null ? ' of ' + r.required + ' m³' : ''} · ${esc(r.label)}</span></div>${app.saved.length > 1 ? `<div class="tabs">${app.saved.map((y, i) => `<button class="tab${i === app.axo ? ' on' : ''}" data-i="${i}">${y.id}</button>`).join('')}</div>` : ''}` : '';   /* the scenario named in the rail: the column is gone, the notes stand on the drawing (the user, 2026-10-13) */
  const stn = x ? (AXO_NAMES[app.axoCallout == null ? 0 : app.axoCallout] || 'the story') : '';
  ctl.innerHTML = `<div class="ph">05 · AXONOMETRIC RESULTS</div>${head}${x ? `<div class="stn"><em>STATION</em>${esc(stn)}</div>` : ''}<div class="do">${x ? 'One notch, one station. Past the last, the page goes on to 06; before the first, back to 04. Drag to turn the block.' : ''}</div>
    <div class="do"><a id="ax-all">${app.axoDone && (app.axoP || 0) > 0.02 ? '◂ close the block' : app.axoDone ? '▸ play it again' : '▸ play it for me'}</a></div><div class="do"><a id="ax-edit">◂ ${x && x.live ? 'design the ground' : 'edit the scenario'}</a></div>`;
  $('ax-all').onclick = () => { clearTimeout(app.axoPlayT); clearTimeout(app.axoCloseT); app.axoCallout = 0; if (app.axoDone && (app.axoP || 0) > 0.02) setAxoP(0, 1200); else { app.axoDone = false; app.axoMaxP = 0; applyAxoP(0); setAxoP(1, axoTimes().dur || 12000, true, true); } }; void n; $('ax-edit').onclick = () => scrollToT(STOP_T[3]);
  for (const b of ctl.querySelectorAll('.tabs .tab[data-i]')) b.onclick = () => { app.axo = +b.dataset.i; app.ctlKey = ''; app.sumKey = ''; app.resKey = ''; syncScene(); app.scene.setStop(app.t); draw(); };
}
/* 05's sequence as one progress p ∈ [0, 1]. With a species card in (04's scenario): the surface lifts (0–.15) · the planter rises and the pit opens (.15–.30) · the City's tree is
   lifted out (.30–.45) · the new tree with its bowl comes down into the pit (.45–.65) · the roots grow out of the bowl (.65–.85) · the mains lift and the base is bare (.85–1).
   Without one (the existing condition): the tree stays where it is; the surface (0–.18), the planter (.18–.36), the roots grow (.40–.70), the mains (.75–1).
   The first arrival plays it through; the wheel and ↓ ↑ scrub it; the rail plays or closes it; afterwards the numbers on the layers open their callouts. */
function axoTimes() { if (app.axoDone) return { cand: false, done: true, l0: [0, 0.3], l1: [0.3, 0.6], out: null, drop: null, grow: null, l2: [0.7, 1], P: [0, 0.3, 0.6, 0.6, 1, 1], S: [[0, 0], [0.3, 1], [0.6, 2], [0.6, 3], [1, 4], [1, 5], [1, 9]] };   /* the story told: the block opens to a station and closes again; the tree stays planted */
  const x = axoSnap(); const c = !!(x && x.scene.candidate); return c ? { cand: true, dur: 14000, l0: [0, 0.10], l1: [0.10, 0.20], out: [0.24, 0.36], drop: [0.40, 0.52], grow: [0.56, 0.76], l2: [0.80, 0.92], P: [0, 0.10, 0.20, 0.52, 0.92, 0.92], S: [[0, 0], [0.10, 1], [0.20, 2], [0.36, -1], [0.52, 3], [0.76, -3], [0.92, 4], [1, 5], [1, 9]] } : { cand: false, dur: 11000, l0: [0, 0.14], l1: [0.14, 0.28], out: null, drop: null, grow: [0.34, 0.62], l2: [0.68, 0.84], P: [0, 0.14, 0.28, 0.62, 0.84, 0.84], S: [[0, 0], [0.14, 1], [0.28, 2], [0.62, 3], [0.84, 4], [1, 5], [1, 9]] }; }   /* 9: the overview after the last station — the whole block open, every number and note lit */   /* the beats and the holds between them: 14 s with a species card, 11 s without */
const sm01 = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const segK = (p, w) => (w ? sm01((p - w[0]) / (w[1] - w[0])) : 0);
function axoKeys(p) { const T = axoTimes(); if (T.done) { const x = axoSnap(); const c = !!(x && x.scene.candidate); return { T, l0: segK(p, T.l0), l1: segK(p, T.l1), out: c ? 1 : 0, drop: 0, grow: 1, l2: segK(p, T.l2) }; } const pS = Math.max(p, app.axoMaxP || 0);   /* the story's beats follow the furthest point reached: the wheel up lowers the layers, it never un-plants the tree (the user, 2026-10-12) */
  return { T, l0: segK(p, T.l0), l1: segK(p, T.l1), out: segK(pS, T.out), drop: T.drop ? (pS < T.drop[0] - 0.03 ? 1 : 1 - segK(pS, T.drop)) : 0, grow: segK(pS, T.grow), l2: segK(p, T.l2) }; }
const AXO_P_OF = (n) => axoTimes().P[Math.max(0, Math.min(5, n))];
const focusOf = (p) => (p < 0.03 ? 0 : p < 0.995 ? 3 : 5);
function applyAxoP(p) { const sc = app.scene; app.axoMaxP = Math.max(app.axoMaxP || 0, p); const K = axoKeys(p); app.axoP = p; sc.lift = [K.l0, K.l1, K.l2]; sc.drop = K.drop; sc.grow = K.grow; sc.out = K.out; const f = focusOf(p); if (f !== app.axoFocus) { app.axoFocus = f; app.resKey = ''; app.ctlKey = ''; }
  if (!app.axoDone && !app.axoPlaying && p >= 0.985) { app.axoDone = true; app.ladderT0 = performance.now(); app.ctlKey = ''; ladderFade(); } }   /* scrubbed to the end by hand: the story is told, the ladder appears; the block stays as the hand left it */
function setAxoP(target, dur, linear, play) { target = Math.max(0, Math.min(1, target)); const from = app.axoP || 0; app.axoPlaying = !!play; if (!play) app.axoEndT0 = 0; app.axoTarget = null; if (Math.abs(target - from) < 1e-4) { draw(); return; } app.axoTw = { from, to: target, t0: performance.now(), dur: REDUCED ? 1 : (dur != null ? dur : 600), linear: !!linear }; if (!app.axoRaf) app.axoRaf = requestAnimationFrame(axoTick); }
function axoTick() { app.axoRaf = 0; const tw = app.axoTw; if (!tw) return; const k = Math.min(1, (performance.now() - tw.t0) / tw.dur); const e2 = tw.linear ? k : k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; applyAxoP(lerp(tw.from, tw.to, e2));
  if (k >= 1) { app.axoTw = null; if (app.axoPlaying && !app.axoEndT0) axoFinish(); }
  if (app.t >= 4 && app.t < 5 && app.S) { app.scene.setStop(app.t); draw(); } if (k < 1) app.axoRaf = requestAnimationFrame(axoTick); }
/* the story's last beat: the callouts fade over 0.8 s, then the block closes slowly on the planted tree (2.4 s) while the ladder of numbers fades in at its corner — a whole axonometric again */
function axoFinish() { app.axoEndT0 = performance.now(); const step = () => { if (!app.axoPlaying) { app.axoEndT0 = 0; return; } const k = (performance.now() - app.axoEndT0) / 800; draw(); if (k < 1) { requestAnimationFrame(step); return; }
  app.axoPlaying = false; app.axoEndT0 = 0; app.axoDone = true; app.axoCallout = 0; app.ladderT0 = performance.now(); if (stage(app.t) === 4) setAxoP(0, 2400); }; requestAnimationFrame(step); }
/* the first arrival at 05 for a scenario: once the camera has walked round (≈1.7 s), the sequence plays through in about nine seconds; any wheel, key or number stops the play and takes over */
function axoAutoPlay() { const x = axoSnap(); const key = x ? `${x.id || 'live'}|${x.scene.site_id}` : ''; if (!key) return; if (app.axoPlayed === key) { app.axoDone = true; applyAxoP(0); return; }   /* told already: the whole block, the numbers at its corner */ app.axoDone = false; app.axoMaxP = 0; app.axoPlayed = key; clearTimeout(app.axoPlayT); app.axoPlayT = setTimeout(() => { if (stage(app.t) === 4 && !app.axoTw && (app.axoP || 0) < 0.01 && !app.busy && !app.report) setAxoP(axoTimes().l0[1] + 0.01, 1600); }, 900); }   /* the first station opens by itself so the mechanism is seen (the walk of 2026-10-13: the block stayed closed, the rows dim); the rest is the hand's */   /* the hand drives the sequence (the wheel, ↓ ↑); ▸ play in the rail runs it for a viewer who would rather watch (the user, 2026-10-12: a forced play was too fast and ended abruptly) */
/* the wheel and the arrows: one notch, one station (the user, 2026-10-12: "scroll one, and number 1 with its words") — the sequence glides to the next station in 0.9 s, its number and its note arriving with it; notches during the glide are ignored */
const AXO_NAMES = { 0: 'the block, closed', 1: '1 · the surface', 2: '2 · the planter', 3: '3 · the tree', 4: '4 · the mains', 5: '5 · the native ground', 9: 'the whole block · every layer open' };
/* the station the sequence stands at: by its number when the progress matches it (two stations can share one p), else the last station at or before p */
/* the ladder fades in over 1.2 s: frames are drawn for that long, whatever else is still (a glide that ends first left it half-drawn) */
function ladderFade() { if (app.ladderRaf) return; const t0 = performance.now(); const step = () => { app.ladderRaf = 0; if (stage(app.t) !== 4) return; draw(); if (performance.now() - t0 < 1300) app.ladderRaf = requestAnimationFrame(step); }; app.ladderRaf = requestAnimationFrame(step); }
function axoStation(S) { const p = app.axoP || 0; const byN = S.findIndex((q) => q[1] === app.axoCallout && Math.abs(q[0] - p) < 0.005); if (byN >= 0) return byN; let i = 0; for (let k = 0; k < S.length; k++) if (S[k][0] <= p + 0.005) i = k; return i; }
/* one notch, one station: 'step' when the sequence moved, 'edge' when there is no station further that way (the page scrolls on from there), 'wait' during a glide */
const axoScrub = (d) => { { const tw = app.axoTw; if (tw && performance.now() - tw.t0 >= tw.dur) { app.axoTw = null; applyAxoP(tw.to); } }   /* a glide whose time is up but whose last frame has not run (a throttled tab): land it */ if (app.axoTw || performance.now() - (app.axoStepAt || 0) < 150) return 'wait';
  const S = axoTimes().S; const i = axoStation(S); let j = i + (d > 0 ? 1 : -1); if (d < 0) while (j > 0 && S[j][1] < 0) j--;   /* up: the story's beats are not replayed backwards; every station is */
  if (j < 0 || j >= S.length) return 'edge';
  app.resKey = ''; app.ctlKey = ''; clearTimeout(app.axoPlayT); clearTimeout(app.axoCloseT); app.axoPlaying = false; app.axoEndT0 = 0;
  app.axoStepAt = performance.now(); app.axoCallout = S[j][1]; if (S[j][1] === 9 && !app.axoDone) { app.axoDone = true; app.ladderT0 = performance.now(); ladderFade(); } setAxoP(S[j][0], 600); return 'step'; };
/* the wheel or ↓ ↑ at 05: a step inside the sequence, or, standing at an end and asked again, the page moves on — down past the overview to 06, up before the first station back to 04 */
function axoWheel(d) { const r = axoScrub(d); if (r !== 'edge') return; const now = performance.now(); if (now - (app.axoStepAt || 0) < 700 || now - (app.axoEdgeAt || 0) < 900) return; app.axoEdgeAt = now; goStage(d > 0 ? 5 : 3); }
const axoBigMain = (F, ax) => (F.facilities || []).filter((f) => f.kind !== 'corridor' && f.depth_top_m != null && f.path_uv && f.path_uv.length > 1 && f.path_uv.some(([u, v]) => u >= ax.u0 && u <= ax.u1 && v >= ax.v0 && v <= ax.v1)).sort((p, q) => (q.diameter_mm || 0) - (p.diameter_mm || 0))[0];
// the four cards, written from the snapshot: what each layer of the block holds, with its tag (CITY · ASSUMED · the rule's table · NOMINAL)
function axoCards(snap) {
  const r = snap.result, k = snap.knobs; const F = snap.scene; const sel = F.trees.find((x) => x.selected); const cand = F.candidate; const bd = F.band.design; const st = F.street; const ax = app.scene.axo || app.scene.slab;
  const inBox = (f) => f.path_uv && f.path_uv.some(([u, v]) => u >= ax.u0 && u <= ax.u1 && v >= ax.v0 && v <= ax.v1);
  const fac = (F.facilities || []).filter((f) => f.kind !== 'corridor' && inBox(f)); const withDepth = fac.filter((f) => f.depth_top_m != null).length, noDepth = fac.length - withDepth; const corr = (F.corridors || []).length; const np = (F.not_published || []).length;
  const cuts = [...new Set((r.conflicts || []).map((c) => `${fmt(c.clearance_m, 1)} m ${(c.kind || c.dataset || '').replace(/[-_]/g, ' ').replace(' mains', ' main')}`))];
  const nb = (cand && cand.box) || (F.need && F.need.box); const big = axoBigMain(F, ax);
  const w = st.widths_m || {}; const curbK = F.knobs.curb_offset_from_centreline_m || {}; const curbConf = curbK.provenance === 'CONFIRMED_SITE_DATA';
  const strips = F.band.strips || []; const cellStrips = sel && sel.cell && sel.cell.u_from != null ? strips.filter((q) => q.u1 >= sel.cell.u_from && q.u0 <= sel.cell.u_to) : []; const kinds = [...new Set(cellStrips.map((q) => (q.dataset || q.kind || '').replace(/-/g, ' ').replace(' mains', ' main')))];
  const sw = F.ground && F.ground.sidewalk; const pr = sel && sel.protection; const zone = (F.band.zones || []).find((z) => z.side === 'property') || null;
  const cellLen = sel && sel.cell && sel.cell.u_from != null ? fmt(sel.cell.u_to - sel.cell.u_from, 1) + ' m' : '—'; const today = ((sel && sel.species_ref) || {}).common || (sel && sel.genus) || 'the City\'s tree';
  const plToCurb = w.property_line_to_curb_face != null ? w.property_line_to_curb_face : st.curb_face_v != null ? st.property_line_v - st.curb_face_v : null;
  const deepMain = ax.depth_m > 3.05;
  return [
    { n: 1, title: AXO_LAYERS[0], tag: curbConf ? ['CONFIRMED', 'user'] : ['ASSUMED', 'assumed'], gn: plToCurb != null ? `${fmt(plToCurb, 2)} m <small>curb face to property line</small>` : `${fmt(st.median ? st.median.width_m : 0, 2)} m <small>the median</small>`, lines: [
      `the curb ${fmt(w.curb != null ? w.curb : 0.15, 2)} m, the boulevard ${fmt(w.front_boulevard != null ? w.front_boulevard : bandWidth(F), 2)} m, the sidewalk ${w.sidewalk_clear != null ? fmt(w.sidewalk_clear, 2) : '—'} m, the back boulevard ${w.back_boulevard != null ? fmt(w.back_boulevard, 2) : '—'} m (the City's standard widths)`,
      `${sw && sw.rating ? `sidewalk ${esc(String(sw.rating).toLowerCase())} (City ${sw.survey_year || ''})` : 'sidewalk unrated'} · ${cellStrips.length} clearance strip${cellStrips.length === 1 ? '' : 's'} on the lid`,
      pr && pr.radius_m ? `protection barrier ${fmt(pr.radius_m, 1)} m · By-law 9958, not a root extent` : null].filter(Boolean) },
    { n: 2, title: AXO_LAYERS[1], tag: ['TABLE 9-2', 'rule'], gn: `${r.available != null ? fmt(r.available) : '—'} m³ <small class="${r.cls || ''}">${r.required != null ? 'of ' + r.required + ' m³ · ' : ''}${esc(r.label)}</small>`, lines: [
      `${esc((k.soil || '').replace('_', ' '))}, ${bd ? fmt(bd.v_to - bd.v_from, 2) : '—'} m wide and ${fmt(k.depth, 2)} m deep; this tree's cell is ${cellLen} long${zone && zone.status === 'KNOWN' ? `, plus ${fmt(zone.credited_m3)} m³ under the sidewalk` : ''}`,
      cand ? `${esc(cand.common)}, ${cand.listed ? esc(cand.class) : 'not listed'}, drawn ${fmt(cand.drawn_height_m)} m tall, in place of ${esc(today)}` : `${esc(today)} stays, ${sel ? fmt(sel.height_m) : '—'} m tall`,
      nb ? `the required volume drawn as a box ${fmt(nb.length_m)} m long${cuts.length ? ', crossing a clearance' : ''}; the roots are nominal, in the credited soil only` : 'no box: the species is not in Table 9-3'] },
    { n: 3, title: AXO_LAYERS[2], tag: ['CITY', ''], gn: `${withDepth} <small>recorded with depth</small>`, lines: [
      `${noDepth} more without a depth, ${corr} nominal corridor${corr === 1 ? '' : 's'}, ${np} kind${np === 1 ? '' : 's'} the City does not publish`,
      big ? `the largest: a ${esc((big.dataset || big.kind || '').replace(/-/g, ' ').replace(' mains', ' main'))}, Ø${big.diameter_mm || '—'} mm, its top ${fmt(big.depth_top_m, 2)} m down (${esc(big.grade || 'record')})` : null,
      cuts.length ? `the roots stop at the ${cuts.join(' and the ')} clearance (Table 2-2)` : 'no clearance crosses the box'].filter(Boolean) },
    { n: 4, title: AXO_LAYERS[3], tag: ['NOMINAL', 'unk'], gn: `no record <small>${fmt(ax.depth_m, 1)} m drawn</small>`, lines: [
      'no City record · the strata are a drawing convention, not data',
      deepMain ? 'drawn to clear the deepest recorded main' : 'drawn three metres deep, the sheet\'s convention'] },
  ];
}
/* the five labels of 05, in the order the sequence reaches them; each anchored to a point on its own layer and faded in with it */
const plainOf = (h) => h.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
function axoLabels(snap, S, ax, K, zS, zP, zM) { const p0 = app.axoP || 0;
  const C = axoCards(snap); const F = snap.scene; const sel = F.trees.find((x) => x.selected); const cand = F.candidate; const bd = F.band.design; const r = snap.result;
  const big = axoBigMain(S, ax); const zMain = big ? -((big.depth_top_m || 0) + Math.max(0.12, (big.diameter_mm || 0) / 2000)) : -1.0;
  const h = cand ? (cand.drawn_height_m || 8) : (sel ? sel.height_m || 6 : 6); const planted = 1 - K.drop; const T = K.T;
  const tree = cand ? [`${cand.common}, ${cand.listed ? 'Table 9-3 ' + cand.class : 'not in Table 9-3'}, ${fmt(cand.drawn_height_m)} m drawn · needs ${r.required != null ? r.required + ' m³' : '—'}`, `the roots are nominal: in the credited soil only, cut where a clearance begins`]
    : [`${((sel && sel.species_ref) || {}).common || (sel && sel.genus) || 'the City\'s tree'} · ${sel ? fmt(sel.height_m) : '—'} m · ${sel && sel.table_9_3 && sel.table_9_3.listed ? 'Table 9-3 ' + sel.table_9_3.class : 'not in Table 9-3'}`, 'the roots are nominal: in the credited soil only, cut where a clearance begins'];
  const done = !!app.axoDone; const today = ((sel && sel.species_ref) || {}).common || (sel && sel.genus) || 'the City\'s tree'; const winOp = (w, lead = 0.03, tail = 0.06) => (w && !done ? Math.max(app.axoPlaying ? 0 : (app.axoCallout < 0 ? 1 : 0), sm01((p0 - w[0] + lead) / 0.04) * (1 - sm01((p0 - w[1] - tail) / 0.05))) : 0);
  const beats = T.cand ? [
    { n: -1, title: 'TODAY\'S TREE TAKEN OUT', tag: 'CITY', lines: [`${today} · ${sel ? fmt(sel.height_m) : '—'} m · ${sel && sel.install_date ? 'planted ' + sel.install_date.slice(0, 4) : 'the City\'s record'}`, '04\'s scenario replaces it'], z: zP + 2.5 + (K.out || 0) * DROP_H * 0.8, op: winOp(T.out), win: 2 },
    { n: -2, title: 'THE NEW TREE GOES IN', tag: 'TABLE 9-3', lines: [`${cand.common}, ${cand.listed ? cand.class : 'not listed'} · needs ${r.required != null ? r.required + ' m³' : '—'}`, 'the rootball in its pit · Park Board 8-01, nominal'], z: zP + 1.5 + (K.drop || 0) * DROP_H, op: winOp(T.drop, 0.0, 0.03), win: 2 },
    { n: -3, title: 'THE ROOTS TAKE THE CREDITED SOIL', tag: 'TABLE 2-2', lines: ['they stop where a clearance begins (the red ticks) · nominal, not measured'], z: zP - 0.6, op: winOp(T.grow, -0.02, 0.02), win: 2 }] : [
    { n: -3, title: 'THE ROOTS IN THE CREDITED SOIL', tag: 'TABLE 2-2', lines: ['they stop where a clearance begins (the red ticks) · nominal, not measured'], z: zP - 0.6, op: winOp(T.grow, -0.02, 0.02), win: 2 }];
  return beats.concat([
    { n: 1, title: C[0].title, tag: C[0].tag[0], lines: [plainOf(C[0].gn), C[0].lines[0]], z: zS + 0.02, op: done ? 1 : K.l0, win: T.l0[1] + 0.1 },
    { n: 2, title: C[1].title, tag: C[1].tag[0], lines: [plainOf(C[1].gn), C[1].lines[0]], z: zP + 0.02, op: done ? 1 : K.l1, win: T.l1[1] + 0.1 },
    { n: 3, title: cand ? 'THE TREE PLANTED' : 'THE TREE', tag: cand ? 'TABLE 9-3' : 'CITY', lines: tree, z: zP - Math.max(0.5, (app.scene.plant ? app.scene.plant.rd : 0.8) * 0.6), op: done ? 1 : T.cand ? sm01((planted - 0.9) / 0.1) : sm01(K.grow / 0.3), win: (T.drop ? T.drop[1] : T.grow ? T.grow[0] : 1) + 0.12 },
    { n: 4, title: C[2].title, tag: C[2].tag[0], lines: [plainOf(C[2].gn), C[2].lines[C[2].lines.length - 1]], z: zM + Math.max(-ax.depth_m + 0.4, zMain), op: done ? 1 : K.l2, win: 1.2 },
    { n: 5, title: C[3].title, tag: C[3].tag[0], lines: [plainOf(C[3].gn), C[3].lines[0]], z: -ax.depth_m + 0.7, op: done ? 1 : K.l2, win: 1.2 },
  ]);
}
/* 05 · the column in 03's position: the scenario (the saved ones as tabs), one card per layer of the block, COMPARE & REPORT → at the foot */
function axoGo(n) { clearTimeout(app.axoPlayT); clearTimeout(app.axoCloseT); app.axoPlaying = false; app.axoEndT0 = 0; if (!app.axoDone) app.axoDone = true; app.ctlKey = ''; app.axoStepAt = performance.now(); if (app.axoCallout === n && n > 0) { app.axoCallout = 0; setAxoP(0, 900); } else { app.axoCallout = n; setAxoP(AXO_P_OF(Math.max(1, n)), 900); } }   /* a number or a row: the block opens to that station; the same again closes it */
function axoColumn(el2) {
  const x = axoSnap(); el2.classList.remove('on', 'record', 'axo'); let go = $('axogo'); if (!go) { go = document.createElement('div'); go.id = 'axogo'; go.className = 'axogo'; $('fixed').appendChild(go); }
  if (!x) { go.classList.remove('on'); return; }
  const key = `axogo|${app.saved.length}|${app.busy ? 1 : 0}`; if (key !== app.resKey) { app.resKey = key; go.innerHTML = `<button id="go-06" class="cta big">COMPARE &amp; REPORT →<small>${app.saved.length ? `${app.saved.length} saved scenario${app.saved.length === 1 ? '' : 's'} against today` : 'the summary · a saved scenario makes a report'}</small></button>`; $('go-06').onclick = () => goStage(5); }
  go.style.right = '10px'; go.classList.add('on');   /* 05 has no column: the drawing has the width, the notes stand beside the block, the way on is at the sheet's foot */
}
// 06 · the summary: compact cards of the saved scenarios, VIEW FULL INFORMATION (the review's content for one), DOWNLOAD REPORT
/* 06 · the comparison table (the user, 2026-10-13: the cards were right but not visual enough, two sections too visual, then: a
   web reader does not read three equal blocks — one sentence, one table). One table over the whole sheet, a column per scenario
   with TODAY first: the column's head is the card (the credited volume as a number and as a bar on one shared scale against the
   required tick, the verdict), under it a row of ground stamps at one scale (02's mini section, drawn in #osec through the bare
   cells), then the metric rows, DATA & ASSUMPTIONS folded at the foot, DOWNLOAD REPORT in each scenario's column foot. Above the
   table one sentence: the current scenario's answer. No right column at 06: nothing is drawn beside the table. */
function sumList() { const live = !app.saved.length && app.scenario ? liveSnap() : null; return app.saved.length ? app.saved : live ? [live] : []; }
function sumCur() { const list = sumList(); return list.length ? list[Math.max(0, Math.min(app.axo, list.length - 1))] : null; }
function todayOf() { const ex = app.existing || app.S; if (!ex) return null; const sel = ex.trees.find((t) => t.selected); if (!sel) return null; const av = !!(ex.band.existing && ex.band.existing.available); const r0 = resultFor(ex); const r = av ? r0 : { ...r0, available: null, gap: null, label: 'NOT ASSESSABLE', cls: '' }; const K0 = knobs(ex); return { ex, sel, av, r, K: av ? K0 : { ...K0, soil: null, depth: null } }; }   /* today: the City has no record of the existing soil, so no volume, no soil, no verdict */
const sumKnobKey = (x) => (x ? `${x.live ? 'live' : x.id}:${x.scene.site_id}:${x.scene.exported_on || ''}:${JSON.stringify(x.knobs)}` : '');
function sumCols() {
  const T = todayOf(); if (!T) return null; const list = sumList(); const x = sumCur(); const sel = T.sel; const sp = ((sel.species_ref || {}).common) || sel.genus || '';
  const cols = [{ h: 'TODAY', sub: T.av ? "the City's record" : 'no record of the soil', K: T.K, R: T.r, bd: T.ex.band.design, cls: sel.table_9_3 && sel.table_9_3.listed ? sel.table_9_3.class : 'not listed', sp, ex: true, S: T.ex, i: -1, on: !x }]
    .concat(list.map((y, i) => ({ h: y.live ? 'WORKING · NOT SAVED' : 'SCENARIO ' + y.id, sub: y.live ? 'not saved' : y.savedAt ? 'saved ' + y.savedAt.slice(0, 10) : '', K: y.knobs, R: y.result, bd: y.scene.band.design, cls: (/^the City's tree/.test(y.subject || '') ? 'kept' + (y.result.treeClass ? ', checked as ' + y.result.treeClass : '') : y.result.treeClass || 'not listed'), sp: (y.subject || '').replace(/^the City's tree · /, ''), on: y === x, live: !!y.live, S: y.scene, i, snap: y })));
  return { T, list, x, cols };
}
const soilWord = (k) => (k ? String(k).replace(/_/g, ' ') : '');
function summaryBoard() {
  const el2 = $('summary'); const on = stage(app.t) === 5 && !app.report; el2.classList.toggle('on', on); if (!on) { app.sumKey = ''; return; }
  const C = sumCols(); if (!C) return; const { T, x, cols } = C;
  el2.style.left = (SHEET.rail + 24) + 'px'; el2.style.right = '24px';
  const key = `${app.saved.length}|${app.axo}|${sumKnobKey(x)}|${T.ex.site_id}|${T.ex.exported_on || ''}|${app.busy ? 1 : 0}|${app.sumOpen ? 1 : 0}|${SHEET.rail}`; if (key === app.sumKey) return; app.sumKey = key;
  if (!x) { el2.innerHTML = `<div class="wrap"><div class="k">SCENARIO COMPARISON <span class="sub">${esc(app.S.title.hblock)} · ${esc(app.S.title.side)}</span></div>
    <p class="lead"><b>Nothing to compare yet.</b> Today the City has ${T.av ? 'a record' : 'no record'} of the soil under ${esc(cols[0].sp)}${T.r.label === 'MANUAL REVIEW' ? ', and the rule stops at this cell' : ''}, so there is no volume to put beside a design.</p>
    <div class="empty"><button class="cta go04">DESIGN THE GROUND AT 04 →<small>change the soil, its depth or the tree, save it as a scenario, and it stands beside today here</small></button></div></div>`;
    el2.querySelector('button.go04').onclick = () => scrollToT(STOP_T[3]); app.secKey = ''; return; }   /* the empty state says one thing (the user, 2026-10-13) */
  const vmax = Math.max(1, ...cols.map((c) => Math.max(c.R.required || 0, c.R.available || 0))) * 1.06; const pct = (v) => Math.max(0, Math.min(100, v / vmax * 100)).toFixed(1);   /* one scale for every bar: the longest of the credited volumes and the required */
  const bar = (a, q, vc) => { const col = vc === 'yes' ? 'var(--accent)' : vc === 'no' ? 'var(--red)' : vc === 'review' ? '#A8742A' : 'var(--grey)'; return (q != null ? `linear-gradient(90deg, transparent 0 ${(q - 0.4).toFixed(1)}%, var(--ink) ${(q - 0.4).toFixed(1)}% ${(q + 0.4).toFixed(1)}%, transparent ${(q + 0.4).toFixed(1)}%), ` : '') + `linear-gradient(90deg, ${col} 0 ${a}%, #EFECE3 ${a}% 100%)`; };   /* the bar as two gradients, no positioned children (html2canvas painted an absolute fill as a box over the next card) */
  const cc = (c) => `${c.ex ? 'ex' : ''}${c.on ? ' on' : ''}${c.live ? ' live' : ''}`;
  const head = (c) => { const r = c.R; const av = r.available != null; const vc = r.cls || ''; const gap = r.gap; return `<th class="hc ${cc(c)}"${c.i >= 0 ? ` data-i="${c.i}" title="${c.on ? 'the scenario this page answers for' : 'answer for this scenario'}"` : ''}>
    <div class="ch"><b>${c.h}</b><span>${esc(c.sub)}</span></div><div class="cn">${esc(c.sp)} <small>· ${esc(c.cls)}</small></div>
    <div class="big ${vc}${av ? '' : ' nr'}">${av ? fmt(r.available) + '<small>m³ credited</small>' : 'no record<small>of the soil</small>'}</div>
    <div class="track" style="background:${bar(av ? +pct(r.available) : 0, r.required != null ? +pct(r.required) : null, vc)}"></div><div class="bl"><span>${av ? 'credited' : 'no volume'}</span><span>${r.required != null ? 'required ' + r.required + ' m³ at the tick' : 'no table row'}</span></div>
    <div class="cv"><b class="verdict ${vc}">${esc(r.label)}</b><span>${gap == null ? '' : (gap >= 0 ? 'surplus +' : 'short by ') + fmt(Math.abs(gap)) + ' m³'}</span></div></th>`; };
  const tr = (label, f, cls) => `<tr${cls ? ` class="${cls}"` : ''}><th class="m">${label}</th>${cols.map((c) => `<td class="${cc(c)}">${f(c)}</td>`).join('')}</tr>`;
  const zones = (c) => (c.ex ? 'none' : (c.K.extensions || []).length ? c.K.extensions.map((z) => zoneWord(c.S, z.side) + ' ' + fmt(z.width_m, 1) + ' m' + (z.status ? ' · ' + z.status.toLowerCase().replace(/_/g, ' ') : '')).join(' · ') : 'none');
  const grades = (S) => { const g = {}; for (const f of S.facilities || []) { const kk = f.depth_top_m == null ? 'not published' : (f.grade || 'record'); g[kk] = (g[kk] || 0) + 1; } return g; };
  const open = !!app.sumOpen;
  const dataRows = open ? tr('premise', (c) => (c.ex ? "the City's tree as it stands" : c.K.replacement ? 'replacement tree' : "keep the City's tree")) + tr('proposed zones', zones) + tr('band width', (c) => fmt(c.bd.v_to - c.bd.v_from, 2) + ' m') + tr('curb from the centreline', (c) => fmt(c.K.curb, 1) + ' m' + (c.K.curb_provenance ? ' · confirmed' : ' · assumed')) + tr('City record', (c) => { const g = grades(c.S); return `${c.S.trees.length} trees · the street's widths · ${g.record || 0} mains at record depth`; }, 'data') + tr('nominal', (c) => { const g = grades(c.S); return `${g.nominal || 0} mains at cited cover · crown and roots by habit`; }, 'data') + tr('assumed', (c) => (c.ex ? 'the curb · the land-use row' : 'the soil and its depth · the curb · the land-use row' + (c.S.candidate ? ' · the species card, drawn at the City\'s 90th-percentile height' : '')), 'data') + tr('no record', (c) => { const g = grades(c.S); return `the existing soil · ${g['not published'] || 0} mains without a depth · the native ground`; }, 'data') : '';
  const foot = `<tr class="foot"><th class="m"></th>${cols.map((c) => `<td class="${cc(c)}">${c.ex ? (x ? '' : '<button class="cta go04">◂ DESIGN THE GROUND AT 04<small>what it carries compares with today here</small></button>') : `<button class="cta pdf" data-i="${c.i}"${app.busy || c.live ? ' disabled' : ''}>⤓ DOWNLOAD REPORT (PDF)<small>${c.live ? 'VIEW SPATIAL RESULT at 04 saves it first' : 'this comparison, the scenario\'s sheet, the numbers'}</small></button>`}</td>`).join('')}</tr>`;
  const kept = (y) => /^the City's tree/.test(y.subject || ''); const spOf = (y) => (y.subject || '').replace(/^the City's tree · /, '');
  const lead = x ? `<b>${x.live ? 'The working scenario' : 'Scenario ' + x.id}</b> ${kept(x) ? `keeps the City's ${esc(spOf(x))}${x.result.treeClass ? ', checked as a ' + esc(x.result.treeClass) + ' tree' : ''}` : `plants ${x.subject ? 'a ' + esc(x.subject) : 'nothing'}${x.result.treeClass ? ' (' + esc(x.result.treeClass) + ')' : ', not in Table 9-3'}`}: <b class="${x.result.cls || ''}">${x.result.available != null ? fmt(x.result.available) : '—'} of ${x.result.required != null ? x.result.required : '—'} m³</b> · <span class="verdict ${x.result.cls || ''}">${esc(x.result.label)}</span>`
    : `<b>Nothing to compare yet.</b> Today the City has ${T.av ? 'a record' : 'no record'} of the soil under ${esc(cols[0].sp)}; design the ground at 04 and its answer stands beside today here.`;
  el2.innerHTML = `<div class="wrap"><div class="k">SCENARIO COMPARISON <span class="sub">${esc(app.S.title.hblock)} · ${esc(app.S.title.side)} · ${app.saved.length ? app.saved.length + ' saved scenario' + (app.saved.length === 1 ? '' : 's') + ' beside today' : x ? 'the working scenario beside today, not saved' : 'today alone'}</span></div>
    <p class="lead">${lead}</p>
    <table class="cmp"><thead><tr><th class="m"></th>${cols.map(head).join('')}</tr></thead><tbody>
    <tr class="stamps"><th class="m">section A–A<small>the ground, one scale for every column</small></th>${cols.map((c, j) => `<td class="${cc(c)} stamp" data-col="${j}"></td>`).join('')}</tr>
    ${tr('species', (c) => esc(c.sp))}${tr('Table 9-3 class', (c) => esc(c.cls))}${tr('soil system', (c) => (c.K.soil ? esc(soilWord(c.K.soil)) : 'no record'))}${tr('soil depth', (c) => (c.K.depth != null ? fmt(c.K.depth, 2) + ' m' : 'no record'))}
    ${tr('credited soil', (c) => (c.R.available != null ? fmt(c.R.available) + ' m³' : 'no record'))}${tr('required · Table 9-2', (c) => (c.R.required != null ? c.R.required + ' m³ · ' + esc(c.R.condition || '') : '—'))}${tr('surplus / gap', (c) => (c.R.gap == null ? '—' : `<b class="${c.R.gap >= 0 ? 'yes' : 'no'}">${c.R.gap >= 0 ? '+' : '−'}${fmt(Math.abs(c.R.gap))} m³</b>`))}${tr('rule result', (c) => `<b class="${c.R.cls}">${esc(c.R.label)}</b>`)}
    <tr class="fold"><th class="m"><a id="su-data">${open ? '▾' : '▸'} data &amp; assumptions</a></th>${cols.map((c) => `<td class="${cc(c)}"></td>`).join('')}</tr>${dataRows}${foot}</tbody></table></div>`;
  for (const c of el2.querySelectorAll('th.hc[data-i]')) c.onclick = () => { const i = +c.dataset.i; if (app.saved.length && i !== app.axo) { app.axo = i; app.ctlKey = ''; app.resKey = ''; app.sumKey = ''; app.secKey = ''; syncScene(); app.scene.setStop(app.t); question(); } draw(); };
  $('su-data').onclick = () => { app.sumOpen = !app.sumOpen; app.sumKey = ''; app.secKey = ''; draw(); };
  for (const b of el2.querySelectorAll('button.pdf')) b.onclick = () => { const y = sumList()[+b.dataset.i]; if (y && !y.live && !app.busy) reportFor(y); };
  const up = el2.querySelector('button.go04'); if (up) up.onclick = () => scrollToT(STOP_T[3]);
  app.secKey = '';   /* the stamps are placed from the cells' rectangles, so a new table means new stamps */
  if (!el2.dataset.scrollWired) { el2.dataset.scrollWired = '1'; el2.addEventListener('scroll', () => { requestDraw(); }); }
}
/* the stamps: SECTION A–A through each column's tree in 02's mini manner, one scale, drawn in the section layer through the table's bare cells */
function summaryStamp(sc) {
  const osec = $('osec'); const C = sumCols(); const cells = [...document.querySelectorAll('#summary td.stamp')]; if (!C || !cells.length) { if (app.secKey) { app.secKey = ''; for (const ch of [...osec.children]) ch.remove(); } return; }
  const sm = $('summary'); const sT = sm.scrollTop; const smb = sm.getBoundingClientRect();
  const rects = cells.map((td) => { const b = td.getBoundingClientRect(); return [Math.round(b.left) + 6, Math.round(b.top + sT) + 4, Math.round(b.width) - 12, Math.round(b.height) - 8]; });   /* in the summary's content space: the stamps are drawn once and move with the scroll */
  const key = ['06', sc.W, sc.H, C.cols.map((c) => c.S.site_id + ':' + (c.S.exported_on || '')).join(','), sumKnobKey(C.x), rects.join(';'), (app.cutU || 0).toFixed(2), GROUND.pat ? 1 : 0, TREE_ART.size, Math.round(smb.top), Math.round(smb.bottom)].join('|');
  osec.style.opacity = 1; if (osec.style.transform) osec.style.transform = '';
  { const gOld = osec.querySelector('g.stamps'); if (key === app.secKey && gOld) { gOld.setAttribute('transform', `translate(0 ${(-sT).toFixed(0)})`); return; } }   /* a scroll frame: the stamps slide, nothing is redrawn (the user: the drawing was unstable while scrolling) */
  app.secKey = key; for (const ch of [...osec.children]) ch.remove();
  { const defs = $('overlay').querySelector('defs'); let cp = defs.querySelector('#clip-sum'); if (!cp) { cp = el('clipPath', { id: 'clip-sum' }); cp.appendChild(el('rect')); defs.appendChild(cp); } const rr = cp.firstChild; rr.setAttribute('x', 0); rr.setAttribute('y', Math.round(smb.top)); rr.setAttribute('width', sc.W); rr.setAttribute('height', Math.max(0, Math.round(smb.bottom - smb.top))); }
  const gA = el('g', { class: 'plan', 'clip-path': 'url(#clip-sum)' }); osec.appendChild(gA); const gS = el('g', { class: 'sheet stamps', transform: `translate(0 ${(-sT).toFixed(0)})` }); gA.appendChild(gS);
  const top = smb.top + sT; app.stampSky = 2.2; app.stampDepth = Math.min(3.2, Math.max(...C.cols.map((c) => (c.S.band.design ? c.S.band.design.depth_m : 0.9))) + 0.6);   /* 06's stamps: little sky, the deepest band of the set plus its floor, one scale across the row */
  C.cols.forEach((c, j) => { const [x0, y0, W, H] = rects[j]; const tr = c.S.trees.find((t) => t.selected); if (!tr || W < 40 || H < 40 || y0 < top) return; const g = el('g', { class: 'stamp' + (c.on ? ' on' : '') }); gS.appendChild(g);
    app.secClip = '-c' + j; sectionPanel(g, sc, c.S, tr, x0, y0, W, H, false, false, true); app.secClip = '';
    const cr = document.getElementById('clip-sec-c' + j + '-r'); if (cr) { const dx = Math.round((W - +cr.getAttribute('width')) / 2 - (+cr.getAttribute('x') - x0)); if (dx > 0) g.setAttribute('transform', `translate(${dx} 0)`); }
    const tt = g.querySelector('text.ptitle'); if (tt) tt.textContent = 'A–A · ' + c.h; });
  app.stampSky = 0; app.stampDepth = 0;
}
function resultPanel(S) {
  const el2 = $('result'); const st = stage(app.t); const recOn = st === 2 || st === 1 || (st === 4 && !app.report); if (!recOn) { el2.classList.remove('on', 'record', 'tool', 'axo'); if ($('axogo')) $('axogo').classList.remove('on'); if (st !== 0) el2.classList.remove('locate'); if (!recOn) app.resKey = ''; }   /* 02 and 03 own #result; 04's one column is #tool (2026-10-12: the levers above the answer, the drawing beside) */
  $('tool').classList.toggle('on', st === 3 && !app.report); $('tray').classList.toggle('on', st === 3 && !app.report); void S;
}
// 5: the City's list as compact rows (the library of the scene file); drag one onto the cell, or click it then the cell
function tray(S) {
  const L = document.createElement('div'); L.className = 'tray'; const lib = S.library; if (!lib) return L; const cs = candidateShown(S); const cid = cs && cs.id;
  const order = { Large: 0, Medium: 1, Columnar: 2, Small: 3 };
  const cards = lib.cards.slice().sort((a, b) => (a.listed ? 0 : 1) - (b.listed ? 0 : 1) || (order[a.class] ?? 9) - (order[b.class] ?? 9) || a.common.localeCompare(b.common));
  for (const c of cards) {
    const d = document.createElement('div'); d.className = 'sc' + (c.listed ? '' : ' grey') + (c.fit && c.fit.fits === false ? ' nofit' : '') + (c.id === cid ? ' placed' : ''); d.draggable = true; d.dataset.id = c.id;
    const vol = c.listed && c.volume_m3 && lib.condition ? `${c.volume_m3[lib.condition]} m³` : '';
    d.title = `${c.latin} · ${c.city_count.toLocaleString()} in the City · drawn ${c.drawn_height_m != null ? fmt(c.drawn_height_m) + ' m' : '—'} (the City's 90th-percentile height) · ${c.form} crown, nominal · ${c.fit ? c.fit.reason : ''}`;
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
  if (app.swapping) return;
  if (app.drag && app.S && app.t >= 3 && app.t < 4 && !app.report && app.secKey) {   /* a handle or slider drag at 04: only the instrument moves; the overlay and the panels stay as they are */
    const sc = app.scene, S = app.S; const shown = S.trees.find((x) => x.selected); if (shown) { fitSheet(); syncFields(S); const b4 = box04(sc); sectionLayer(sc, S, app.t, shown, true, false, b4.x, b4.y, b4.W, b4.H, 1, 1, 1); return; } }
  fitSheet(); syncScene();
  const svg = $('overlay'); for (const ch of [...svg.children]) if (ch.tagName !== 'defs') ch.remove(); const S = app.S; const sc = app.scene; if (!S || !sc.slab) return; const t = app.t; const sl = sc.slab; const st = S.street; const bd = S.band.design;
  const dv = diveT(); const tR = t >= dv.ts ? Math.max(t, 1) : t;                        // the rail and the headline turn to the street together, when the plan is the drawing
  const stepNow = stage(t);
  for (const li of $('steps').querySelectorAll('li[data-s]')) { const s = +li.dataset.s; li.classList.toggle('on', s === stepNow); li.classList.toggle('done', s < stepNow); }
  if (t >= 1) $('rail').classList.remove('onmap');
  resultPanel(S); recordPanel(S); locatePanel(S); ctlFor(tR, S); summaryBoard();   /* the result panel builds the right column's frame before the inputs fill it */
  $('hint').textContent = t < 1 ? 'the wheel zooms the map; keys 1 to 6' : 'keys 1 to 6, or the arrow keys';
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
    for (const it of (SHOW_FACES ? sc.faceUV : [])) {   /* the checked streets are chosen from the column's list; the map carries no marks for them (the user: every area had little dashes, not needed) */
      const a = sc.project(it.a[0], it.a[1], 0), b = sc.project(it.b[0], it.b[1], 0); const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; if (m.x < -20 || m.x > sc.W + 20 || m.y < -20 || m.y > sc.H + 20) continue;
      const own = focus && it.f.local_area === focus.name; const op = Math.max(own ? areaOp : 0, cityOp); if (op < 0.02) continue;
      const p1 = { x: lerp(m.x, a.x, k), y: lerp(m.y, a.y, k) }, p2 = { x: lerp(m.x, b.x, k), y: lerp(m.y, b.y, k) }; const col = FACE_COL[it.f.largest_class_fits] || FACE_COL.unknown;
      const gg = el('g', { opacity: op }); gg.appendChild(el('line', { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, stroke: col })); g.appendChild(gg);
    }
    svg.appendChild(g);
    if (app.hotArea && t < dv.ta + 0.06) { const pts = app.hotArea.ring.map(([u, v]) => sc.project(u, v, 0)); const d = `M0 0H${sc.W}V${sc.H}H0Z M` + pts.map((q) => `${q.x} ${q.y}`).join('L') + 'Z'; svg.appendChild(el('path', { class: 'dim', d, 'fill-rule': 'evenodd' })); svg.appendChild(poly(pts, { class: 'area hot' })); }
    if (app.pulse) { const q = sc.project(app.pulse.u, app.pulse.v, 0); const c = el('circle', { class: 'pulse', cx: q.x, cy: q.y, r: 6 }); if (!REDUCED) { c.appendChild(el('animate', { attributeName: 'r', from: 6, to: 60, dur: '.5s', fill: 'freeze' })); c.appendChild(el('animate', { attributeName: 'opacity', from: .9, to: 0, dur: '.5s', fill: 'freeze' })); } svg.appendChild(c); setTimeout(() => { app.pulse = null; }, 600); }
    // the block on the city: a ring (or the face just clicked, while its scene is being made)
    const at = app.goto || { u: (sl.u0 + sl.u1) / 2, v: (sl.v0 + sl.v1) / 2 }; const c = sc.project(at.u, at.v, 0); const rop = app.goto ? 1 : 1 - smooth((t - (dv.ts - 0.2)) / 0.14);
    if (rop > 0.01 && (app.goto || app.chosen)) { const gg = el('g', { class: 'ring' + (app.goto ? ' busy' : ''), opacity: rop }); gg.appendChild(el('circle', { cx: c.x, cy: c.y, r: 11 })); gg.appendChild(el('circle', { cx: c.x, cy: c.y, r: 2.2, class: 'dot' })); svg.appendChild(gg); }
    if (focus && (areaOp > 0.02 || (cityOp > 0.02 && app.area))) { const pts = focus.ring.map(([u, v]) => sc.project(u, v, 0)); svg.appendChild(poly(pts, { class: 'area focus', opacity: Math.max(areaOp, app.area ? cityOp : 0) })); }   /* the area chosen in the index is outlined on the city too */
    /* the block level: every public tree as a dot (ink = Table 9-3 species, grey = other); hover lifts one, a click opens its street plan (02) with it selected */
    if (hw < DOTS_HALF_W && app.S && app.S.context) { const opX = smooth((DOTS_HALF_W - hw) / 120); const S0 = app.S, C0 = S0.context, st0 = S0.street, blk0 = st0.block; const gx = el('g', { class: 'ctx', opacity: opX.toFixed(2) });   /* the block level is a place: the houses, the lanes, the civic numbers and the street names of the chosen street's own scene, and its face in the accent */
      const Pp = (pts) => pts.map(([u, v]) => { const q = sc.project(u, v, 0); return `${q.x.toFixed(1)},${q.y.toFixed(1)}`; }).join(' ');
      for (const ln of C0.lanes || []) if (ln.length > 1) gx.appendChild(el('polyline', { class: 'lane', points: Pp(ln) }));
      for (const b of (S0.buildings || []).concat(C0.buildings || [])) gx.appendChild(el('polygon', { class: 'house', points: Pp(b.ring_uv) }));
      const axU = sc.axis(0, 0, 0, 1, 0, 0); const upright = (a) => { a = ((a % 180) + 180) % 180; return a > 90 ? a - 180 : a; }; const ang = upright(Math.atan2(axU.d.y, axU.d.x) * 180 / Math.PI); const ppm0 = Math.hypot(axU.d.x, axU.d.y);   /* names read along their street, never upside down */
      if (ppm0 >= 1.3) for (const [u, v, num] of C0.addresses || []) { if (!num) continue; const q = sc.project(u, v, 0); gx.appendChild(el('text', { class: 'num', x: q.x, y: q.y + 3, transform: `rotate(${ang.toFixed(1)} ${q.x.toFixed(1)} ${q.y.toFixed(1)})` }, num)); }
      { const fv = st0.median ? st0.median.centre_v : st0.curb_face_v; if (blk0 && fv != null && app.chosen) { const a = sc.project(blk0.u_from, fv, 0), b = sc.project(blk0.u_to, fv, 0); gx.appendChild(el('line', { class: 'face', x1: a.x, y1: a.y, x2: b.x, y2: b.y })); } }
      { const q = sc.project(blk0 ? (blk0.u_from + blk0.u_to) / 2 : 0, st0.centreline_v != null ? st0.centreline_v : 0, 0); gx.appendChild(el('text', { class: 'st', x: q.x, y: q.y + 4, transform: `rotate(${ang.toFixed(1)} ${q.x.toFixed(1)} ${q.y.toFixed(1)})` }, S0.title.street)); }
      for (const cs of st0.cross_streets || []) { if (!cs || !cs.name || cs.u == null) continue; const q = sc.project(cs.u, (st0.centreline_v || 0) - 34, 0); const a2 = upright(ang + 90); gx.appendChild(el('text', { class: 'st', x: q.x, y: q.y + 4, transform: `rotate(${a2.toFixed(1)} ${q.x.toFixed(1)} ${q.y.toFixed(1)})` }, cs.name)); }
      svg.appendChild(gx); }
    sc.treesInView = null;
    if (sc.treeUV && hw < DOTS_HALF_W) { const op = smooth((DOTS_HALF_W - hw) / 120); const c0 = sc.centre1 || { x: 0, y: 0 }; const hh = hw * sc.H / sc.W; const inView = []; const paths = ['', '', ''];
      const unread = app.unreadable || (app.unreadable = new Set((app.city && app.city.faces ? app.city.faces.faces : []).flatMap((f) => (f.trees || []).filter((t) => t.status !== 'KNOWN').map((t) => +String(t.site_id || '').replace(/^[A-Z]+-/, '')))));   /* the checked faces' trees the rule stopped at: not on the map (the user, 2026-10-13) */
      for (const q of sc.treeUV) { if (unread.has(q[2])) continue; if (Math.abs(q[0] - c0.x) > hw + 10 || Math.abs(q[1] - c0.y) > hh + 10) continue; const p = sc.project(q[0], q[1], 0); inView.push({ q, p }); const r = q[3] ? 3.2 : 2.4; paths[q[4] === 1 ? 2 : q[3] ? 1 : 0] += `M${(p.x - r).toFixed(1)} ${p.y.toFixed(1)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`; }
      const g2 = el('g', { class: 'tdots', opacity: op }); if (paths[0]) g2.appendChild(el('path', { class: 'other', d: paths[0] })); if (paths[1]) g2.appendChild(el('path', { class: 'listed', d: paths[1] })); if (paths[2]) g2.appendChild(el('path', { class: 'median', d: paths[2] }));
      if (app.hotTreeDot) { const p = sc.project(app.hotTreeDot[0], app.hotTreeDot[1], 0); g2.appendChild(el('circle', { class: 'hot', cx: p.x, cy: p.y, r: 9 })); }
      svg.appendChild(g2); sc.treesInView = inView; }
    const lvl = atlasLevel(t); const lvlOp = lvl === 'block' ? smooth((DOTS_HALF_W - hw) / 120) : 0;
    if (cityOp > 0.01) legend(svg, SHEET.rail + 24 + 330, sc.H - 28, cityOp, 'city', focus);   /* beside the rail, which is long at 01 now (the street cards) */
    else if (lvlOp > 0.01) legend(svg, SHEET.rail + 24 + 330, sc.H - 28, lvlOp, 'block', focus);
    else if (areaOp > 0.01) legend(svg, SHEET.rail + 24 + 330, sc.H - 28, areaOp, 'area', focus);
  }
  if (t >= dv.ts - 0.12 && t < 4.2) plan(svg, sc, S, t); else if (stepNow === 5 && !app.report) summaryStamp(sc); else if (app.secKey) { app.secKey = ''; for (const ch of [...$('osec').children]) ch.remove(); }   /* 06: a row of ground stamps through the table's bare cells, in the section layer */                 // 02–04: the plan | section sheet, drawn flat in the atlas's language
  if (t >= SHEET_ON && t < 5) {   /* 05: the exploded axonometric — the block opens a layer at a time (app.axoFocus); numbered pins on a rod at the block's near corner, one per layer, the cards in the column (axoColumn); the construction lines of the lifted planter */
    const ax = sc.axo || sl; const bd0 = S.band.design; const Lf = sc.lift || [0, 0, 0]; const G = EXPLODE_GAP; const P = (u, v, z) => sc.project(u, v, z); const pt = (q) => `${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
    const zM = G * Lf[2], zP = G * (Lf[1] + Lf[2]), zS = G * (Lf[0] + Lf[1] + Lf[2]);
    const segs = bd0 ? (S.band.segments || []).map((q) => [Math.max(q.u_from, ax.u0), Math.min(q.u_to, ax.u1)]).filter(([q0, q1]) => q1 - q0 > 0.3) : [];
    /* the ladder: the numbers on a rod beside the block's nearest corner, each at its layer's height (stacked apart while the block is closed), each appearing with its layer while the story is told and all of them afterwards; the notes are the column's list — no leaders (the reference sheet's numbers and its list correspond by number alone) */
    { const snap = axoSnap(); const p = app.axoP || 0; const K = axoKeys(p); const L = axoLabels(snap, S, ax, K, zS, zP, zM).filter((q) => q.n > 0);
      const cs = [[ax.u0, ax.v0], [ax.u1, ax.v0], [ax.u0, ax.v1], [ax.u1, ax.v1]].map(([u, v]) => ({ u, v, p: P(u, v, 0) })); const cNear = cs.reduce((m, q) => (q.p.y > m.p.y ? q : m)); const cEast = cs.reduce((m, q) => (q.p.x > m.p.x ? q : m)); const roomR = sc.W - cEast.p.x - 40; const useEast = roomR >= 300; const c = useEast ? cEast : cNear; const cx = cs.reduce((m, q) => m + q.p.x, 0) / 4; const right = c.p.x >= cx; const rodX = c.p.x + (right ? 28 : -28);   /* the rod stands at the block's east corner when the notes have room to its right; else at the near corner */
      const ys = L.map((q) => P(c.u, c.v, q.z).y); for (let i = ys.length - 2; i >= 0; i--) ys[i] = Math.min(ys[i], ys[i + 1] - 72);   /* room for a note beside each number */
      const items = L.map((q, i) => ({ ...q, y: ys[i], op: app.axoDone ? q.op * (app.ladderT0 ? sm01((performance.now() - app.ladderT0) / 1200) : 1) : q.op })); const shown = items.filter((q) => q.op > 0.02);
      if (shown.length > 1) svg.appendChild(el('line', { class: 'axo-rod', x1: rodX, y1: shown[0].y - 14, x2: rodX, y2: shown[shown.length - 1].y + 14, opacity: Math.min(...shown.map((q) => q.op)).toFixed(2) }));
      const labRight = useEast ? true : right ? true : !(rodX - 340 > SHEET.rail + 16); const lx = labRight ? rodX + 18 : rodX - 18; const anchor = labRight ? 'start' : 'end';   /* outer side of the rod when the block's corner has no room to the east */
      for (const it of shown) { const d = el('g', { class: 'axo-num' + (app.axoCallout === it.n || app.axoCallout === 9 ? ' on' : ''), 'data-n': it.n, opacity: it.op.toFixed(2) }); d.appendChild(el('circle', { cx: rodX, cy: it.y, r: 10 })); d.appendChild(el('text', { x: rodX, y: it.y + 3.5 }, `${it.n}`)); d.appendChild(el('title', {}, `${it.n} · ${it.title}`)); d.onclick = () => axoGo(it.n); svg.appendChild(d);
        const lab = el('g', { class: 'axo-lab' + (app.axoCallout === it.n || app.axoCallout === 9 ? ' on' : ''), opacity: it.op.toFixed(2) }); const tt = el('text', { class: 't', x: lx, y: it.y - 6, 'text-anchor': anchor }, it.title); const tg = el('tspan', { class: 'tag', dx: 8 }, it.tag); tt.appendChild(tg); lab.appendChild(tt);
        const lines = it.lines.flatMap((l) => wrap(String(l), 58)).slice(0, 4); lines.forEach((l, i) => lab.appendChild(el('text', { class: 'l', x: lx, y: it.y + 8 + i * 13, 'text-anchor': anchor }, l))); lab.onclick = () => axoGo(it.n); svg.appendChild(lab); } }   /* the note stands beside its number and appears with its station (the user, 2026-10-13: the text was cut off from the animation in a fixed column) */
  }
}
/* the section's own SVG layer (#osec), composited apart from the overlay: rebuilt only when what it shows changes, so a scroll
   frame or a hover never repaints the ground; during a handle or slider drag it rebuilds at most every 90 ms with a trailing frame */
function sectionLayer(sc, S, t, shown, replace, review, x0s, y0s, Ws, Hs, toolK, op, secOn, box, mini) {
  const osec = $('osec'); const lv = liveKnobs(S); const cs = candidateShown(S); const d = app.drag;
  const key = shown && secOn > 0.01 ? [S.site_id, S.exported_on, S === app.S ? 1 : 0, shown.site_id, (app.cutU || 0).toFixed(2), lv.curb, lv.depth, lv.soil, lv.land_use, lv.width_level, lv.target, Math.round(x0s), Math.round(y0s), Math.round(Hs), Math.round(Ws), mini ? 'm' : '', toolK.toFixed(2), replace ? 1 : 0, app.busy ? 1 : 0, d ? d.kind + ':' + (d.side || '') + ':' + d.value : '', app.dragCard || '', app.armed || '', cs ? cs.id : '', app.pending ? 'p' : '', app.hotNeed ? 1 : 0, app.bb ? 1 : 0, sc.W, sc.H, GROUND.pat ? 1 : 0, TREE_ART.size, app.report ? 'r' : ''].join('|') : '';
  if (key !== app.secKey) {
    const now = performance.now();
    if (d && now - (app.secAt || 0) < 90) { clearTimeout(app.secT); app.secT = setTimeout(() => { app.secT = null; draw(); }, 95); }
    else { app.secKey = key; app.secAt = now; for (const ch of [...osec.children]) ch.remove();
      if (key) { const gA = el('g', { class: 'plan' }); osec.appendChild(gA); const gS = el('g', { class: 'sheet' }); gA.appendChild(gS); const gSec = el('g'); gS.appendChild(gSec);
        sectionPanel(gSec, sc, S, shown, x0s, y0s, Ws, Hs, replace, review, mini);
        } } }
  osec.style.opacity = key ? (op * smooth((t - 0.8) / 0.2) * secOn).toFixed(3) : 0;
  /* the move 03 → 04 is a CSS transform of the whole layer (composited, no re-rasterising of the strata patterns), never an SVG transform inside it */
  if (box && (Math.abs(box.x - x0s) > 0.5 || Math.abs(box.y - y0s) > 0.5 || Math.abs(box.W - Ws) > 0.5 || Math.abs(box.H - Hs) > 0.5)) { const sx = box.W / Ws, sy = box.H / Hs; osec.style.transformOrigin = '0 0'; osec.style.transform = `translate(${(box.x - x0s * sx).toFixed(1)}px, ${(box.y - y0s * sy).toFixed(1)}px) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`; } else if (osec.style.transform) osec.style.transform = '';
  if (replace) { const b4 = box04(sc); const T = $('tool'), Y = $('tray'); for (const [E, x] of [[T, b4.toolX], [Y, b4.trayX]]) { E.style.left = x + 'px'; E.style.top = b4.panelY + 'px'; E.style.width = b4.panelW + 'px'; E.style.height = ''; E.style.maxHeight = b4.panelH + 'px'; } }   /* as tall as what they hold, never taller than the sheet (the walk of 2026-10-13: the border ran to the page foot) */   /* two panels of one size either side of the drawing */
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
// the roots as a landscape section draws them when the base is the City's planting detail: five to seven structural roots that
// leave the rootball's sides and bottom by habit (heart · flat · tap), each a tapering stroke with one or two forks, living only
// where `inside` says and ending with a red tick where the credited soil ends. Few and clear (the 2026-10-09 judgement on the
// Wurzelatlas spray: "our roots are ugly" against G11.3's base). A drawing, not a measurement.
function rootsFew(vT, form, zone, seed, rb, rd, reach) {
  const R = rng2(seed); const segs = [], cut = [];
  const LMAX = reach * 1.15 + rd;   /* the farthest a root travels: the width falls to 12 % there, whatever the forks */
  const grow = (p, a, len, w0, gen, d0 = 0) => { let cur = p; const step = 0.13; let zc = zone(cur[0], cur[1]) || 2; const a0 = a; let dist = d0; const wAt = (dd) => w0 * Math.max(0.12, 1 - 0.88 * Math.min(1, dd / LMAX)) / Math.max(0.12, 1 - 0.88 * Math.min(1, d0 / LMAX));
    let turn = (R() - .5) * 0.3;
    for (let i = 0; i < len; i++) { const w = wAt(dist); dist += step; turn = turn * 0.7 + (R() - .5) * 0.42; a += turn + (form === 'flat' ? (a > -Math.PI / 2 ? -0.01 : 0.01) : (a > -Math.PI / 2 ? 0.012 : -0.012)) * (gen === 0 ? 1 : 0.5); if (a - a0 > 1.1) a = a0 + 1.1; if (a - a0 < -1.1) a = a0 - 1.1; if (Math.sin(a) > 0.25) a -= 0.2;   /* winding, never straight; held within 50° of its heading, never climbing back toward the grade */
      if (cur[1] < -1.0 && gen === 0) a += (a > -Math.PI / 2 ? 0.07 : -0.07);   /* the long roots flatten with distance: most of a street tree's roots live in the top metre */
      const nxt = [cur[0] + Math.cos(a) * step, cur[1] + Math.sin(a) * step]; const zn = zone(nxt[0], nxt[1]);
      if (zn !== zc) { let lo = cur, hi = nxt; for (let q = 0; q < 6; q++) { const m = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2]; if (zone(m[0], m[1]) === zc) lo = m; else hi = m; } if (Math.hypot(lo[0] - cur[0], lo[1] - cur[1]) > 0.02) segs.push([cur[0], cur[1], lo[0], lo[1], w, zc]); if (zc === 2 && zn !== 2) { const t = 0.07; cut.push([lo[0] - Math.sin(a) * t, lo[1] + Math.cos(a) * t, lo[0] + Math.sin(a) * t, lo[1] - Math.cos(a) * t]); } if (zn === 0) return; segs.push([lo[0], lo[1], nxt[0], nxt[1], w, zn]); zc = zn; cur = nxt; continue; }
      segs.push([cur[0], cur[1], nxt[0], nxt[1], w, zc]); cur = nxt;
      if (gen < 3 && i >= 2 && zc === 2 && R() < (gen === 0 ? 0.24 : 0.2)) { const nf = R() < 0.4 ? 1 : R() < 0.75 ? 2 : 3; const sgn = R() < .5 ? 1 : -1; for (let q = 0; q < nf; q++) { const spread = 0.35 + R() * 0.7; const ang = nf === 1 ? sgn * spread : (q - (nf - 1) / 2) * spread * 1.3 + (R() - .5) * 0.3; grow(cur, a + ang, Math.max(4, Math.floor(len * (0.35 + R() * 0.4))), w * (0.6 + R() * 0.3), gen + 1, dist); } } } };   /* a fork throws one, two or three roots, each thinner, to the third order: a root grows at random */
  const n = Math.round((form === 'tap' ? 6 : 12) * Math.min(1, 0.5 + rb / 2));
  for (let i = 0; i < n; i++) { const side = i % 2 ? 1 : -1; const t = Math.min(1, Math.max(0, (Math.floor(i / 2) + 0.5) / Math.ceil(n / 2) + (R() - .5) * 0.25));
    const z0 = -rd * (0.06 + 0.55 * t), v0 = vT + side * (rb / 2 - 0.03 - (t > 0.6 ? rb * 0.12 : 0)); const dip = form === 'flat' ? 0.15 + t * 0.35 : form === 'tap' ? 0.5 + t * 0.5 : 0.45 + t * 0.85; const a = side > 0 ? -dip : -Math.PI + dip;
    grow([v0, z0], a, Math.round(reach / 0.13 * (0.45 + R() * 0.7)), (0.13 - t * 0.06) * (0.7 + R() * 0.5), 0); }   /* the primaries leave the bowl's sides, the lower ones its rounded corners, 0.09–0.17 m thick at the flare, dipping and then running out about the crown's radius */
  const sinkers = form === 'tap' ? [[0, 1.6, 0.12], [-0.3, 0.9, 0.06], [0.3, 0.9, 0.06]] : form === 'flat' ? [[-0.3, 0.6, 0.06], [0.3, 0.6, 0.06]] : [[-0.35, 1.0, 0.07], [-0.1, 1.3, 0.08], [0.15, 1.2, 0.08], [0.4, 0.9, 0.06]];
  for (const [fx, fl, fw] of sinkers) grow([vT + fx * rb, -rd + 0.02], -Math.PI / 2 + fx * 0.8 + (R() - .5) * 0.3, Math.round(fl / 0.13 * (0.8 + R() * 0.4)), fw, 0);   /* sinkers out of the bowl's bottom, straight down and winding */
  return { segs, cut };
}
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
// the rootball of Park Board sheet 8-01 (TREE PLANTING), its 219 ink strokes taken from the PDF and normalised to a unit box (x 0–1 left→right, y 0–1 top→bottom; the trunk base at x = 0.543): the lumpy outline, the basket's ribs and rings with the top third removed, drawn by hand. Stretched to the ball's size on the sheet, never redrawn.
const BALL_801 = { d: 'M0.208 0.021L0.115 0.052L0.067 0.119L0.036 0.178L0.011 0.269L0.000 0.409L0.006 0.509L0.043 0.631L0.082 0.724L0.123 0.803L0.158 0.890L0.195 0.936L0.207 0.941L0.271 0.983L0.475 1.000L0.726 0.991L0.745 0.978L0.837 0.902L0.908 0.763L0.938 0.648M0.236 0.490L0.228 0.526L0.206 0.653L0.217 0.751L0.236 0.800L0.237 0.934L0.252 0.970M0.237 0.490L0.229 0.527L0.208 0.653L0.220 0.750L0.238 0.800L0.239 0.933L0.253 0.969M0.455 0.550L0.456 0.622L0.447 0.637L0.458 0.998M0.457 0.550L0.459 0.623L0.449 0.638L0.461 0.998M0.899 0.321L0.934 0.368L0.955 0.478L0.947 0.613M0.898 0.323L0.932 0.370L0.952 0.478L0.944 0.612M0.682 0.519L0.681 0.531L0.684 0.581L0.689 0.602L0.688 0.730L0.681 0.774L0.673 0.791L0.675 0.916L0.667 0.970L0.654 0.994M0.685 0.519L0.684 0.531L0.687 0.580L0.692 0.602L0.690 0.731L0.684 0.776L0.675 0.792L0.678 0.916L0.669 0.971L0.656 0.996M0.077 0.396L0.076 0.400L0.066 0.433L0.046 0.506L0.052 0.619L0.066 0.666L0.090 0.683L0.128 0.806L0.151 0.846M0.079 0.397L0.079 0.401L0.069 0.434L0.049 0.507L0.055 0.619L0.068 0.663L0.093 0.681L0.131 0.804L0.153 0.844M0.461 0.807L0.553 0.809L0.641 0.812L0.742 0.803L0.815 0.778L0.924 0.670M0.461 0.803L0.553 0.806L0.641 0.809L0.742 0.800L0.813 0.774L0.923 0.668M0.064 0.679L0.089 0.702L0.106 0.708L0.171 0.759L0.285 0.783L0.290 0.791L0.395 0.810L0.461 0.802M0.064 0.677L0.091 0.699L0.108 0.706L0.172 0.756L0.287 0.780L0.292 0.789L0.395 0.807L0.460 0.799M0.876 0.366L0.909 0.302L0.935 0.228L0.942 0.178L0.949 0.149M0.008 0.312L0.066 0.388L0.108 0.418L0.184 0.464L0.238 0.491L0.249 0.504L0.260 0.503L0.277 0.521L0.375 0.552L0.604 0.547L0.679 0.526L0.684 0.517L0.763 0.482L0.778 0.464L0.835 0.432L0.878 0.367M0.938 0.648L0.949 0.621L0.997 0.503L1.000 0.326L0.968 0.196L0.942 0.132L0.882 0.073L0.855 0.059L0.795 0.027M0.026 0.213L0.362 0.284L0.627 0.287L0.791 0.250L0.859 0.199L0.942 0.132M0.027 0.210L0.184 0.243L0.362 0.281L0.627 0.283L0.790 0.247L0.857 0.197L0.941 0.130M0.236 0.490L0.214 0.402L0.216 0.354L0.218 0.317L0.249 0.261M0.237 0.489L0.217 0.402L0.219 0.354L0.220 0.318L0.251 0.262M0.079 0.397L0.072 0.344L0.066 0.297L0.086 0.249L0.089 0.227M0.077 0.397L0.070 0.344L0.064 0.297L0.083 0.248L0.086 0.227M0.457 0.550L0.459 0.457L0.456 0.351L0.454 0.286M0.455 0.550L0.457 0.457L0.454 0.351L0.452 0.286M0.684 0.517L0.692 0.454L0.689 0.381L0.687 0.310L0.681 0.274M0.681 0.516L0.689 0.454L0.687 0.381L0.684 0.310L0.679 0.274M0.898 0.323L0.898 0.264L0.886 0.226L0.868 0.191M0.895 0.323L0.895 0.266L0.883 0.228L0.866 0.193M0.407 0.000L0.326 0.011L0.382 0.003L0.372 0.040L0.406 0.034L0.429 0.031L0.480 0.064L0.513 0.054L0.530 0.049L0.555 0.041L0.621 0.072L0.682 0.050L0.641 0.038L0.663 0.027L0.706 0.023L0.720 0.022L0.645 0.012L0.600 0.000L0.570 0.000M0.882 0.073L0.796 0.028L0.718 0.000L0.406 0.000L0.209 0.022L0.116 0.052L0.068 0.120L0.037 0.179L0.012 0.270L0.000 0.409L0.006 0.510L0.056 0.663L0.129 0.819L0.159 0.890L0.207 0.942L0.281 0.986L0.462 0.999L0.667 0.994L0.727 0.991L0.838 0.902L0.909 0.764L0.939 0.649L0.998 0.504L1.000 0.326L0.968 0.197L0.941 0.130L0.882 0.073', hullPts: [[0.000,0.409],[0.011,0.269],[0.026,0.213],[0.036,0.178],[0.067,0.119],[0.115,0.052],[0.208,0.021],[0.406,0.000],[0.718,0.000],[0.795,0.027],[0.882,0.073],[0.941,0.130],[0.942,0.132],[0.949,0.149],[0.968,0.196],[1.000,0.326],[0.998,0.504],[0.909,0.764],[0.838,0.902],[0.745,0.978],[0.727,0.991],[0.656,0.996],[0.475,1.000],[0.281,0.986],[0.271,0.983],[0.195,0.936],[0.158,0.890],[0.082,0.724],[0.056,0.663],[0.043,0.631],[0.006,0.510]], tx: 0.543, ratio: 0.794 };
const TREE_FORMS = ['round', 'oval', 'vase', 'columnar', 'conical', 'weeping', 'cov'];   /* 'cov': the tree of Park Board sheet 8-01, in the sheet's pen, for 03's detail */
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
// the tree with a break in its trunk: the base at the detail's scale, the crown brought down to the sheet, the removed length
// marked by the drafting convention (two zigzag edges, paper between). The height is the City's; the trunk's note carries it.
function treeBroken(gs, X, Z, k, vT, h, crownR, form, z1, z2) {
  const asset = TREE_ART.get(form) || TREE_ART.get('round'); if (!asset) return;
  const svgRoot = $('overlay'); const defs = svgRoot.querySelector('defs'); const mk = (id, y, hh) => { let cp = svgRoot.querySelector('#' + id); if (!cp) { cp = el('clipPath', { id }); cp.appendChild(el('rect')); defs.appendChild(cp); } const r = cp.firstChild; r.setAttribute('x', -100000); r.setAttribute('width', 200000); r.setAttribute('y', y); r.setAttribute('height', hh); };
  const dy = (z2 - z1) * k; mk('clip-tree-lo', Z(z1), 100000); mk('clip-tree-hi', -100000, 100000 + Z(z2));
  const place = () => { const t = placeTree(asset, { x0: X(vT), yGround: Z(0), height: h * k, crownSpread: crownR * 2 * k }); if (Math.abs(app.cutU || 0) > 0.6) t.setAttribute('opacity', '0.28'); return t; };
  const lo = el('g', { 'clip-path': 'url(#clip-tree-lo)' }); lo.appendChild(place()); gs.appendChild(lo);
  const hiOuter = el('g', { transform: `translate(0 ${dy.toFixed(1)})` }); const hi = el('g', { 'clip-path': 'url(#clip-tree-hi)' }); hi.appendChild(place()); hiOuter.appendChild(hi); gs.appendChild(hiOuter);
  const tw = Math.max(14, 0.03 * h * k); const x = X(vT), y = Z(z1); const zz = (yy) => `M${(x - tw).toFixed(1)} ${yy.toFixed(1)}l${(tw * 0.5).toFixed(1)} 0 ${(tw * 0.25).toFixed(1)} -4 ${(tw * 0.5).toFixed(1)} 8 ${(tw * 0.25).toFixed(1)} -4 ${(tw * 0.5).toFixed(1)} 0`;
  gs.appendChild(el('rect', { class: 'brk', x: x - tw - 2, y: y - 10, width: 2 * tw + 4, height: 16 })); gs.appendChild(el('path', { class: 'brkline', d: zz(y - 6) + zz(y + 3) }));
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
// the hatches of the City's standard details (G4.4 trenching, G9.2 engineered soil, G11.3 median planting), ink on paper, built
// for one cell size `c` (8 px is the screen default; a section at a larger scale asks for a larger cell so the hatch keeps reading
// as a material, suffix '-<c>'): h-w45 diagonal basket weave = growing medium (G11.3) and pipe bedding / haunching (G4.4);
// h-w45f the same finer = the tree pit; h-w0 orthogonal weave = subgrade, native ground (G11.3), foundation (G4.4); h-circ open
// circles = engineered soil (G9.2), general backfill (G4.4); h-grav dense circles = granular base (G9.2, G4.4); h-conc dots and
// triangles = concrete (G9.2 slab, curbs); h-stip fine dots = initial backfill (G4.4), topsoil; h-mulch dense fine lines = mulch
// (G11.3); h-clear red 135° lines = the Table 2-2 clearance strip (the tool's own legend)
function buildHatches(defs, sfx, c) {
  const f = c / 8; const ink = '#1E2D23'; const wl = c >= 10 ? .9 : .7;
  const weave = (id, cc, rot, w) => { const pt = el('pattern', { id: id + sfx, patternUnits: 'userSpaceOnUse', width: 2 * cc, height: 2 * cc, patternTransform: rot ? `rotate(${rot})` : '' }); const ln = (x1, y1, x2, y2) => pt.appendChild(el('line', { x1, y1, x2, y2, stroke: ink, 'stroke-width': w })); for (const [qx, qy, horiz] of [[0, 0, 1], [cc, cc, 1], [cc, 0, 0], [0, cc, 0]]) for (let i = 0; i < 3; i++) { const o = cc * (2 * i + 1) / 6; if (horiz) ln(qx + 0.08 * cc, qy + o, qx + cc - 0.08 * cc, qy + o); else ln(qx + o, qy + 0.08 * cc, qx + o, qy + cc - 0.08 * cc); } defs.appendChild(pt); };
  weave('h-w45', c, 45, wl); weave('h-w45f', c * 0.68, 45, wl * .85); weave('h-w0', c, 0, wl);
  const pat = (id, w, h, extra) => { const pt = el('pattern', { id: id + sfx, patternUnits: 'userSpaceOnUse', width: w * f, height: h * f, ...(extra || {}) }); defs.appendChild(pt); return pt; };
  { const pt = pat('h-circ', 9, 7.8); for (const [cx, cy] of [[2.25, 1.95], [6.75, 5.85]]) pt.appendChild(el('circle', { cx: cx * f, cy: cy * f, r: 1.9 * f, fill: 'none', stroke: ink, 'stroke-width': .7 })); }
  { const pt = pat('h-grav', 5, 5); for (const [cx, cy, r] of [[1.4, 1.4, 1.1], [3.9, 3.7, .9], [4.2, 1.2, .6]]) pt.appendChild(el('circle', { cx: cx * f, cy: cy * f, r: r * f, fill: 'none', stroke: ink, 'stroke-width': .6 })); }
  { const pt = pat('h-conc', 16, 12); for (const [cx, cy] of [[2, 3], [9, 9], [13, 2], [6, 7]]) pt.appendChild(el('circle', { cx: cx * f, cy: cy * f, r: .55 * f, fill: ink })); pt.appendChild(el('path', { d: 'M5 2l2 0l-1 -1.8z M12 8l1.8 0l-0.9 1.7z', transform: `scale(${f})`, fill: 'none', stroke: ink, 'stroke-width': .45 / f })); }
  { const pt = pat('h-stip', 4, 4); for (const [cx, cy] of [[1, 1], [3, 3]]) pt.appendChild(el('circle', { cx: cx * f, cy: cy * f, r: .35 * f, fill: ink })); }
  { const pt = pat('h-mulch', 3, 3, { patternTransform: 'rotate(45)' }); pt.appendChild(el('line', { x1: 0, y1: 1.5 * f, x2: 3 * f, y2: 1.5 * f, stroke: ink, 'stroke-width': .7 })); }
  weave('h-w0f', c * 0.62, 0, wl * .85);   /* compacted subgrade under the growing medium: the subgrade's weave, finer */
  { const pt = pat('h-cross', 5, 5); pt.appendChild(el('path', { d: `M0 ${5 * f}L${5 * f} 0M0 0L${5 * f} ${5 * f}`, fill: 'none', stroke: ink, 'stroke-width': .35 })); }   /* 8-01's crosshatch inside the ball */
  { const pt = pat('h-road', 7, 7); pt.appendChild(el('path', { d: `M0 ${7 * f}L${7 * f} 0M0 0L${7 * f} ${7 * f}`, fill: 'none', stroke: ink, 'stroke-width': .5 })); pt.appendChild(el('circle', { cx: 3.5 * f, cy: 3.5 * f, r: .6 * f, fill: ink })); }   /* G11.3 pavement / road structure */
  { const pt = pat('h-clear', 11, 11, { patternTransform: 'rotate(135)' }); pt.appendChild(el('line', { x1: 0, y1: 5.5 * f, x2: 11 * f, y2: 5.5 * f, stroke: '#B0413E', 'stroke-width': .7 })); }
}
function ensureGroundDefs(svgRoot) {
  const defs = svgRoot.querySelector('defs'); if (!defs || defs.querySelector('#pat-sky')) return;
  /* the hatches of the City's standard details (G4.4 trenching, G9.2 engineered soil, G11.3 median planting), ink on paper:
     h-w45 diagonal basket weave = growing medium (G11.3) and pipe bedding / haunching (G4.4); h-w0 orthogonal weave = subgrade, native
     ground (G11.3), foundation (G4.4); h-circ open circles = engineered soil (G9.2), general backfill (G4.4); h-grav dense circles =
     granular base (G9.2, G4.4); h-conc dots and triangles = concrete (G9.2 slab, curbs); h-stip fine dots = initial backfill (G4.4),
     topsoil; h-mulch dense fine lines = mulch (G11.3); h-clear red 135° lines = the Table 2-2 clearance strip (the tool's own legend) */
  buildHatches(defs, '', 8);
  const sky = el('pattern', { id: 'pat-sky', patternUnits: 'userSpaceOnUse', width: 40, height: 6 }); sky.appendChild(el('line', { x1: 0, y1: 3, x2: 40, y2: 3, stroke: '#26382C', 'stroke-width': .35 })); defs.appendChild(sky);
  if (GROUND.pat) for (const [name, t] of Object.entries(GROUND.pat)) { const w = t.w / t.zoom * PSCALE, h = t.h / t.zoom * PSCALE; const pt = el('pattern', { id: 'pat-' + name, patternUnits: 'userSpaceOnUse', width: w, height: h }); pt.appendChild(el('image', { href: t.href || `assets/patterns/${name}.png`, width: w, height: h, preserveAspectRatio: 'none' })); defs.appendChild(pt); }
  GROUND.pebbles.forEach((p, i) => { const sy = el('symbol', { id: 'peb-' + i, viewBox: p.vb, overflow: 'visible' }); for (const q of p.paths) sy.appendChild(el('path', { d: q.d, fill: q.fill, 'vector-effect': 'non-scaling-stroke' })); defs.appendChild(sy); });
  if (GROUND.person) { const sy = el('symbol', { id: 'fig-person', viewBox: GROUND.person.vb, overflow: 'visible' }); sy.appendChild(el('path', { d: GROUND.person.d, fill: '#F6F3EC', 'vector-effect': 'non-scaling-stroke' })); defs.appendChild(sy); }
}
function sectionPanel(gAll, sc, S, tr, x0, y0, W, H, replace = false, review = false, mini = false) {
  const uCut = tr.u + (app.cutU || 0);   /* SECTION A–A is cut at the A–A line the plan carries (02 sets it); the tree is drawn faint when the cut is not through it */
  const st = S.street, B = S.band; const pl = st.property_line_v, cl = st.centreline_v; if (!S.band.design || (st.curb_face_v == null && !st.median)) return;
  // 3 replace: what the rule reads, live — the dragged handle, or the value just sent to the engine, overrides the file's until the result lands
  const live = liveKnobs(S); const curb = live.curb; const curbW = st.widths_m.curb || 0.15; const md = live.median; const bd = md ? { ...S.band.design, v_from: md.v_from, v_to: md.v_to, depth_m: live.depth } : { ...S.band.design, v_from: curb + curbW, depth_m: live.depth };   /* a median: both curbs follow the live half-width */
  const inRoad = (v) => (md ? v > md.cfN || v < md.cfF : v < curb);
  const habit0 = (tr.roots && tr.roots.form) || 'heart'; const hr0 = habit0 === 'flat' ? 0.65 : habit0 === 'tap' ? 0.95 : BALL_801.ratio; const plant0 = { rb: Math.max(0.6, Math.min(bd.v_to - bd.v_from - 0.2, (bd.depth_m + 0.3) / hr0, (tr.diameter_cm || 15) * 0.10)) }; plant0.rd = plant0.rb * hr0;   /* the ball in the City's proportion — 8-01's ball measures 68 × 54, a bowl, height 0.8 × width (flat habit 0.65, tap 0.95); the width ten times the caliper (ANSI Z60.1) but held so the bowl fits the band's depth + 0.3, its floor in the subgrade as 8-01's is */ plant0.pd = plant0.rd + 0.15; plant0.tp = plant0.rb / 2 + Math.max(0.08, Math.min(0.45, (bd.v_to - bd.v_from) / 2 - plant0.rb / 2 - 0.04)); plant0.bp = plant0.rb / 2 + Math.max(0.04, Math.min(0.2, plant0.tp - plant0.rb / 2 - 0.04));   /* the standard's rootball, nominal: the roots leave from it in every mode */
  const cand = tr.selected ? candidateShown(S) : null;              // the species card standing in for this tree, if one is in the cell
  const sr = cand || tr.species_ref || {}; const listed = cand ? !!cand.listed : !!(tr.table_9_3 && tr.table_9_3.listed); const zonesAll = (tr.extensions && tr.extensions.zones) || []; const dz = app.drag && app.drag.kind === 'zone' ? app.drag : null;
  const zoneOf = (side) => { let z = zonesAll.find((q) => q.side === side) || null; if (dz && dz.side === side && z) z = side === 'property' ? { ...z, v_to: z.v_from + dz.value, width_applied_m: dz.value, status: 'DRAG' } : { ...z, v_from: z.v_to - dz.value, width_applied_m: dz.value, status: 'DRAG' }; return z; };   /* a zone's far edge under the hand: its width follows, the rule counts it when the pointer lets go */
  const zP = zoneOf('property'), zR = zoneOf('road'); const zOk = (z) => !!(z && (z.status === 'KNOWN' || z.status === 'DRAG')); const zs = zOk(zP) ? zP : null, zrOk = zOk(zR) ? zR : null; const zrD = zrOk ? (zrOk.depth_m || S.band.design.depth_m) : 0;
  const have = tr.extensions && tr.extensions.share_total_m3 != null ? tr.extensions.share_total_m3 : tr.share_m3; const h = cand ? (cand.drawn_height_m || tr.height_m || 6) : (tr.height_m || 6); const seed = 1000 + (+tr.tree_id || 1); const R = rng2(seed + 7);
  const tool = replace && !review; const wide = !tool && !mini; const detail = wide || tool; const narrow = W <= 720;   /* detail: the drawing manner (the tiers, the planting, the outlines, the string) at 03 and 04; wide: 03's extent (the house, the breaks, the borehole, the fence, the records) */ const bh0 = S.ground && S.ground.borehole; const boreIn = false; void bh0;   /* 2026-10-12: the provincial log left the sheet (the user: 03 too full); the native ground says NOT PUBLISHED */   /* the provincial log stands beside the scale only when it reaches into the sheet's ground */
  const TBL = mini ? 0 : wide ? 22 : tool ? 22 : 36, HEAD = mini ? 22 : tool ? 118 : detail ? 92 : 58, LAB = mini ? 0 : tool ? 260 : W > 720 ? (wide ? 302 : 290) : W > 560 ? 238 : 198, PADL = mini ? 14 : wide ? (boreIn ? 100 : 66) : 40; /* the notes column gives way first in a narrow window; at 03 the head holds the dimension string, the left margin the side string, the depth scale and the borehole column, the foot the borehole's caption */
  /* the cut runs from inside the nearest house to the street's centreline at 03 (the whole half-street: the house, the yard, the walk, the band, the road), band-tight at 04 (the instrument) and at 02 (the stamp) */
  const houses = (S.buildings || []).filter((b) => { const us = b.ring_uv.map((q) => q[0]); return Math.min(...us) - 3 <= tr.u && Math.max(...us) + 3 >= tr.u && (!md || Math.min(...b.ring_uv.map((q) => q[1])) > pl); }); const houseV = houses.length ? Math.min(...houses.map((b) => Math.min(...b.ring_uv.map((q) => q[1])))) : null; const houseH = houses.length ? (houses[0].height_m || 8) : 8;
  let vL = md ? (wide ? Math.min(md.ocN, md.cfN + 1.3) : md.cfN + 1.6) : wide ? pl + 0.3 : tool ? pl + 0.3 : pl + 0.5, vR = md ? (wide ? Math.max(md.ocF, md.cfF - 1.3) : md.cfF - 1.6) : wide ? curb - 0.9 : tool ? st.curb_face_v - 1.6 : st.curb_face_v - 2.4;   /* 04: band-tight, 1.6 m of road past the curb (the gutter and the parking lane's edge), so the notes keep their room */ let DEPTH = tool ? 3.5 : mini ? (app.stampDepth || 3.0) : 4.5;   /* a median at 03: the median and three metres of the carriageway each side (the ground stays the heavy region); at 04 band-tight */
  /* 03: the half-street is drawn with two breaks, as a standard detail breaks a VARIES length — the yard (the house wall stays) and the road (the curb and the centreline stay); every width still reads whole on the string */
  const brk = []; const GAP = 18; if (detail && md) { const keep = 3.5; if (md.cfN - 0.6 - (tr.v + keep) > 1.0) brk.push([tr.v + keep, md.cfN - 0.6]); if ((tr.v - keep) - (md.cfF + 0.6) > 1.0) brk.push([md.cfF + 0.6, tr.v - keep]); }   /* a wide median: broken either side of the tree, 3.5 m kept each side, the curbs kept; the width reads whole on the string */ const cutW = brk.reduce((s, [a, b]) => s + (b - a), 0);
  const kw = (W - PADL - LAB - 10 - brk.length * GAP) / (vL - vR - cutW), hroom = H - HEAD - TBL - (mini ? 10 : 44);
  if (detail) { const deep = Math.max(0, ...S.facilities.filter((f) => f.depth_top_m != null && f.path_uv && f.path_uv.some((q) => Math.abs(q[0] - uCut) < 8 && q[1] >= vR && q[1] <= vL)).map((f) => f.depth_top_m + (f.diameter_mm || 0) / 1000)); DEPTH = tool ? Math.min(4.0, Math.max(3.0, S.band.design.depth_m + 1.2, Math.ceil((deep + 0.5) * 2) / 2)) : Math.min(4.0, Math.max(bd.depth_m + 1.2, plant0.rd + 1.2, Math.ceil((deep + 0.5) * 2) / 2)); }   /* 04: the frame is set by the file's depth, not the handle's, so the ground line stays put during a drag */   /* 03 · the detail's ground: the growing medium, the subgrade under it, the mains that cross here; the provincial log beyond this depth is in the caption */
  let treeBrk = null, skyNeed = 3.6; const crownH = h * (cand ? (cand.crown_ratio_of_height || 0.6) : ((tr.species_ref && tr.species_ref.crown_ratio_of_height) || 0.6)), zc = h - crownH;
  if (mini && zc > (app.stampSky || 3.0) - 0.6) treeBrk = { z1: 0.8, z2: zc + crownH * 0.35 };   /* 06's stamps: a tall tree's crown is brought down to the stamp with a break in its trunk, the drafting convention for a small frame (the walk of 2026-10-13: the TODAY stamp showed a trunk only) */
  if (detail) { const skyW = hroom / Math.min(tool ? 80 : 96, kw) - 1.0 - DEPTH; skyNeed = tool ? h + 0.4 : Math.min(h + 0.4, Math.max(3.6, skyW)); }   /* 04: the whole tree, always — the scale gives way before the crown does (the user, 2026-10-12: at the design stage a cut tree is a big problem; at 03 a small one) */   /* 03: the tree whole where the width's scale leaves it room; otherwise its crown is cut by the sheet's top edge, as a landscape section cuts it — the trunk break of the fifth pass was set aside (the user, 2026-10-13); the height reads on the trunk's note */
  const k = Math.min(tool ? 80 : wide ? 96 : 60, hroom / ((mini ? (app.stampSky || 3.0) : skyNeed) + 1.0 + DEPTH), kw);   /* 03: the width sets the scale, the sky takes what is left (at least 4.5 m; the crown and the house are cut by the sheet as a landscape section cuts them); 5 m of sky at 04 */   /* one scale for every tree: the tree's height never sets the scale */
  if (!(k > 6)) return;                                            // the panel is not laid out yet (a first frame at the pane's own size)
  if (wide && !md) { const slack0 = Math.max(0, W - PADL - LAB - 10 - (vL - vR) * k); let extra = slack0 / k; const vR2 = Math.max(st.centreline_v, vR - extra * 0.55); extra -= vR - vR2; vR = vR2; const vLmax = houseV != null && houseV > pl + 0.5 ? houseV + 0.9 : pl + 2.6; vL = Math.min(vLmax, vL + extra); }   /* 03: the width the sheet has beyond the tree's own strip goes to the street — the road out to its centreline first, then the yard up to the house wall (the user, 2026-10-13: the room beside the section was unused) */
  if (detail) { const slack = Math.max(0, W - PADL - LAB - 10 - (vL - vR - cutW) * k - brk.length * GAP); x0 += slack / 2; W -= slack; }   /* 03: the drawing and its notes sit in the middle of the panel; 04: A–A and B–B share one left edge */
  const below = DEPTH * k; const secW = (vL - vR - cutW) * k + brk.length * GAP; const above = H - HEAD - TBL - (mini ? 10 : 44) - below;   /* the sky's room is fixed, so the ground line stays put from tree to tree; a tall crown is clipped at the top */
  const g = el('g', { class: 'card' }); gAll.appendChild(g);
  if (tool) {   /* the cell's length along the band and the need-box inside it, as a bar over the title: 04's only along-band fact (the ribbon stays at 03) */
    const cellL = tr.spacing_m != null ? tr.spacing_m : (tr.cell && tr.cell.u_from != null ? tr.cell.u_to - tr.cell.u_from : null); const cb = (S.candidate && S.candidate.box) || (S.need && S.need.box);
    if (cellL) { const yb = y0 + 44; const xa = x0 + PADL, xb = x0 + W - LAB - 10; const gB = el('g', { class: 'cellbar' }); gB.appendChild(el('line', { class: 'dline', x1: xa, y1: yb, x2: xb, y2: yb })); for (const x of [xa, xb]) gB.appendChild(el('line', { class: 'dtick', x1: x, y1: yb - 5, x2: x, y2: yb + 5 }));
      const cut = !!(cb && cb.conflicts && cb.conflicts.length); gB.appendChild(el('text', { class: 'dnum', x: xa, y: yb - 6 }, `THIS TREE'S CELL · ${fmt(cellL, 1)} m ALONG THE BAND${cb && cb.length_m ? ` · NEED-BOX ${fmt(cb.length_m)} m${cut ? ' · CUT' : ''}` : ''}`));
      if (cb && cb.length_m) { const w = Math.min(xb - xa, (xb - xa) * cb.length_m / cellL); const xm = (xa + xb) / 2; gB.appendChild(el('rect', { class: 'needseg' + (cut ? ' cut' : ''), x: xm - w / 2, y: yb - 3, width: w, height: 6 })); }
      g.appendChild(gB); } }   /* one row under the title: the cell's length and the need-box inside it; the string sits lower at 04 */
  g.appendChild(el('text', { class: mini ? 'ptitle mini' : 'ptitle', x: x0, y: y0 + (mini ? 12 : 16) }, 'SECTION A–A' + (!mini && Math.abs(app.cutU || 0) >= 0.05 ? ` · ${fmt(Math.abs(app.cutU), 1)} m ${app.cutU > 0 ? 'EAST' : 'WEST'} OF THE TREE` : mini ? ' · THE GROUND UNDER IT' : '')));
  if (!mini) g.appendChild(el('text', { class: 'psub' + (cand ? ' swap' : ''), x: x0 + 132 + (Math.abs(app.cutU || 0) >= 0.05 ? 170 : 0), y: y0 + 16 }, cand ? `${cand.common.toUpperCase()} · ${(cand.latin || '').toUpperCase()} · IN PLACE OF ${((tr.species_ref && tr.species_ref.common) || tr.genus || '').toUpperCase()}` : `${(sr.common || tr.genus || '').toUpperCase()} · ${(sr.latin || (tr.genus + ' ' + tr.species)).toUpperCase()}${tr.selected ? '' : ' · READING ITS GROUND …'}${detail ? ` · 1:${Math.round(1000 / (k * 25.4 / 96))} ON THIS SCREEN` : ''}`));
  const sx = x0 + PADL, yG = y0 + HEAD + above; const X = (v) => { let x = sx + (vL - v) * k; for (const [a, b] of brk) { if (v <= a) x -= (b - a) * k - GAP; else if (v < b) x -= (b - v) * k - GAP * (b - v) / (b - a); } return x; }, Z = (z) => yG - z * k;   /* v runs left→right from the property line to the road; z up; a break removes its metres and leaves a gap */
  const svgRoot = $('overlay'); const cid = 'clip-sec' + (app.secClip || ''); let cp = svgRoot.querySelector('#' + cid); if (!cp) { cp = el('clipPath', { id: cid }); cp.appendChild(el('rect', { id: cid + '-r' })); svgRoot.querySelector('defs').appendChild(cp); } const cr0 = svgRoot.querySelector('#' + cid + '-r'); cr0.setAttribute('x', sx - 2); cr0.setAttribute('y', y0 + HEAD - 4); cr0.setAttribute('width', secW + 4); cr0.setAttribute('height', above + below + 8);
  const gs = el('g', { 'clip-path': `url(#${cid})` }); g.appendChild(gs);
  // ---- the ground, drawn in the library's language (Landscape Illustration tutorial): a heavy grade line, bodies as bands
  // filled with one of the seven strata patterns, pebbles growing with depth in the native ground, wavy hand-drawn strata
  // lines in the native ground, straight edges on built layers. What each body means is unchanged. ----
  ensureGroundDefs(svgRoot); const hc = Math.max(7, Math.min(18, Math.round(k * 0.2))); const hs = hc === 8 ? '' : '-' + hc; if (hs && !svgRoot.querySelector('#h-w45' + hs)) buildHatches(svgRoot.querySelector('defs'), hs, hc);   /* the hatch cell follows the scale (G11.3's weave is about 1/40 of its width) */
  const box = (v0, v1, d0, d1) => { const xa = X(Math.min(v1, vL)), xb = X(Math.max(v0, vR)); return xb > xa && d1 > d0 ? { x: xa, y: Z(-d0), w: xb - xa, h: (d1 - d0) * k } : null; };
  const HATCH = { native: 'h-w0', topsoil: 'h-stip', medium: 'h-w45', credited: 'h-w45', subbase: 'h-w0f', slab: 'h-conc', base: 'h-grav', engineered: 'h-circ', asphalt: null, road: 'h-road', backfill: 'h-circ', bedding: 'h-w45' };   /* the body's hatch as the City's sheets draw it (see ensureGroundDefs) */
  const DIM = new Set(['native', 'road', 'asphalt', 'slab', 'base', 'subbase', 'topsoil']);   /* 04: the ground the hand cannot move is toned down; the band, the pit and the proposals keep their ink */
  const wash = (v0, v1, d0, d1, cls, pat, op) => { const b = box(v0, v1, d0, d1); if (!b) return null; const dm = tool && DIM.has(cls.split(' ')[0]) ? 0.45 : 1; gs.appendChild(el('rect', { class: cls, x: b.x, y: b.y, width: b.w, height: b.h, opacity: dm })); const hid = HATCH[cls.split(' ')[0]]; if (hid) gs.appendChild(el('rect', { class: 'pat', x: b.x, y: b.y, width: b.w, height: b.h, fill: `url(#${hid}${hs})`, opacity: (cls === 'native' ? .5 : cls === 'subbase' ? .7 : 1) * dm })); if (wide && cls !== 'native') gs.appendChild(el('rect', { class: 'bodyedge', x: b.x, y: b.y, width: b.w, height: b.h })); return b; };   /* 03: a line between any two materials, as the sheets draw it */
  const edge = (v0, v1, d0, d1, cls) => { const b = box(v0, v1, d0, d1); if (b) gs.appendChild(el('rect', { class: cls || 'bodyedge', x: b.x, y: b.y, width: b.w, height: b.h })); };
  const wave = (v0, v1, d, amp, cls) => { const xa = X(Math.min(v1, vL)), xb = X(Math.max(v0, vR)); if (xb <= xa) return; const n = Math.max(2, Math.round((xb - xa) / 70)); const pts = []; for (let i = 0; i <= n; i++) pts.push([xa + (xb - xa) * i / n, Z(-d) + (R() - .5) * 2 * amp]); let dd = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`; for (let i = 1; i < pts.length; i++) { const [px0, py0] = pts[i - 1], [px1, py1] = pts[i]; const cx = (px0 + px1) / 2; dd += `C${cx.toFixed(1)} ${py0.toFixed(1)} ${cx.toFixed(1)} ${py1.toFixed(1)} ${px1.toFixed(1)} ${py1.toFixed(1)}`; } gs.appendChild(el('path', { class: cls || 'stratum', d: dd })); };
  const pebbles = (b, n, dMin) => { if (!b || !GROUND.pebbles.length) return; const placed = []; for (let i = 0; i < n * 3 && placed.length < n; i++) { const t = Math.pow(R(), 0.6); const y = b.y + b.h * (dMin + (1 - dMin) * t), x = b.x + R() * b.w; const j = Math.floor(R() * GROUND.pebbles.length); const [, , vw, vh] = GROUND.pebbles[j].vb.split(/\s+/).map(Number); const w = (0.09 + 0.4 * t * t) * k * (0.75 + R() * 0.5), hh = w * vh / vw; if (x - w / 2 < b.x + 2 || x + w / 2 > b.x + b.w - 2 || y + hh / 2 > b.y + b.h - 2) continue; if (placed.some(([qx, qy, qr]) => Math.hypot(qx - x, qy - y) < qr + w * 0.75)) continue; placed.push([x, y, w * 0.75]); gs.appendChild(el('use', { class: 'peb', href: '#peb-' + j, x: x - w / 2, y: y - hh / 2, width: w, height: hh, transform: `rotate(${((R() - .5) * 50).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})` })); } };
  const sw = st.sidewalk_v && st.sidewalk_v[0] != null ? st.sidewalk_v : null, bb = st.back_boulevard_v && st.back_boulevard_v[0] != null ? st.back_boulevard_v : null; const boc = curb + curbW; const zD = zs ? (zs.depth_m || bd.depth_m) : 0; const soilPat = SOIL_PAT[live.soil] || 'p4';
  // the sky: the library's hairlines, faint; the trees and figures stand white against it
  // native ground (nobody publishes it): coarse stipple, two strata lines, pebbles that grow with depth
  wash(vR, vL, 0, DEPTH, 'native');   /* the native ground as G11.3 draws the subgrade: the orthogonal weave, no strata, no pebbles (the library's stipple and pebbles gave way to the City's hatch, 2026-10-09) */
  // topsoil under turf, yard and back boulevard: fine stipple, a wavy base
  if (!md) { wash(pl, vL, 0, 0.22, 'topsoil'); } if (bb) { wash(bb[0], bb[1], 0, 0.22, 'topsoil'); }
  if (md && wide && vL > md.ocN) { wash(md.ocN, vL, 0, 0.22, 'topsoil'); } if (md && wide && vR < md.ocF) { wash(vR, md.ocF, 0, 0.22, 'topsoil'); }   /* a strip of a boulevard, only where the cut reaches past an outer curb */
  // the growing medium the rule credits (0.90 m, the knob): grain; the credited part keeps the dusty green wash under the same grain
  const strips = B.strips || []; const iv = strips.filter((sp) => uCut >= sp.u0 && uCut <= sp.u1).map((sp) => [Math.max(sp.v0, bd.v_from), Math.min(sp.v1, bd.v_to)]).filter((a) => a[1] > a[0]).sort((a, b) => a[0] - b[0]);
  let cutTop = bd.v_from; for (const [a, b] of iv) { if (a <= cutTop + 0.02) cutTop = Math.max(cutTop, b); else break; } cutTop = Math.min(cutTop, bd.v_to);
  const inSeg = (B.segments || []).some((sg) => tr.u >= sg.u_from && tr.u <= sg.u_to);
  { wash(bd.v_from, bd.v_to, 0, bd.depth_m, 'medium'); if (detail) { wash(bd.v_from, bd.v_to, 0, 0.12, 'topsoil'); wash(bd.v_from, bd.v_to, bd.depth_m, bd.depth_m + 0.3, 'subbase'); edge(bd.v_from, bd.v_to, bd.depth_m, bd.depth_m + 0.3, 'bodyedge'); const d = []; for (let v = bd.v_from + 0.15; v < bd.v_to; v += 0.3) d.push(`M${X(v).toFixed(1)} ${Z(-bd.depth_m).toFixed(1)}v6`); gs.appendChild(el('path', { class: 'scar', d: d.join('') })); }   /* the tiers under the tree: topsoil under the turf, the growing medium, 300 of compacted subgrade with the sub-base scarified (G9.2 / 8-01), the native below */
    edge(bd.v_from, bd.v_to, 0, bd.depth_m); if (cutTop > bd.v_from) { const bc = box(bd.v_from, cutTop, 0, bd.depth_m); if (bc) gs.appendChild(el('rect', { class: 'pat', x: bc.x, y: bc.y, width: bc.w, height: bc.h, fill: `url(#h-clear${hs})` })); }   /* the strip the clearance takes: the legend's red 135° hatch over the weave */
  if (detail) { gs.appendChild(el('path', { class: 'pitfill', fill: `url(#h-w45f${hs})`, d: `M${X(tr.v + plant0.tp).toFixed(1)} ${Z(0)}L${X(tr.v + plant0.bp).toFixed(1)} ${Z(-plant0.pd).toFixed(1)}H${X(tr.v - plant0.bp).toFixed(1)}L${X(tr.v - plant0.tp).toFixed(1)} ${Z(0)}Z` })); }   /* the pit's growing medium as its own tone (G11.3 gives it its own hatch) */
    if (cutTop > bd.v_from) { const xa = X(cutTop), xb = X(bd.v_from); gs.appendChild(el('path', { class: 'clearedge', d: `M${xa} ${Z(0)}V${Z(-bd.depth_m)}H${xb}V${Z(0)}` })); } }
  // the sidewalk as the City builds it (G9.2): slab left blank, granular base as pebbles in fines, filter fabric, engineered soil as the compacted weave, scarified native
  if (sw) { wash(sw[0], sw[1], 0, 0.1, 'slab'); wash(sw[0], sw[1], 0.1, 0.2, 'base', 'p1', .8); edge(sw[0], sw[1], 0.1, 0.2);
    if (zs) { wash(zs.v_from, zs.v_to, 0.2, 0.2 + zD, 'engineered', 'p2', .5); edge(zs.v_from, zs.v_to, 0.2, 0.2 + zD); gs.appendChild(el('line', { class: 'fabric', x1: X(zs.v_to), y1: Z(-0.2), x2: X(zs.v_from), y2: Z(-0.2) })); for (let v = zs.v_from + 0.15; v < zs.v_to; v += 0.3) gs.appendChild(el('line', { class: 'scar', x1: X(v), y1: Z(-(0.2 + zD)), x2: X(v), y2: Z(-(0.2 + zD + 0.07)) })); } }
  // the curb and the road: asphalt as the densest fines on a granular base (typical)
  const curbs = md ? [[md.cfN - md.cw, md.cfN], [md.cfF, md.cfF + md.cw]] : [[curb, boc]]; const roads = md ? [[md.cfN, Math.min(md.ocN, vL)], [Math.max(md.ocF, vR), md.cfF]] : [[vR, curb]];
  for (const [a, b] of curbs) wash(a, b, -0.15, 0.45, 'slab'); for (const [a, b] of roads) if (b > a) { wash(a, b, 0, 0.08, 'asphalt'); wash(a, b, 0.08, 0.45, 'road'); edge(a, b, 0, 0.45); }   /* asphalt on the road structure (G11.3's pavement / road structure, its own hatch) */
  if (zrOk) { wash(zrOk.v_from, zrOk.v_to, 0.45, 0.45 + zrD, 'engineered', 'p2', .5); edge(zrOk.v_from, zrOk.v_to, 0.45, 0.45 + zrD); }   /* the proposal under the parking lane (or the far carriageway): engineered soil under the road structure, where the rule connects it */
  if (tool) for (const z of [zP, zR]) if (z && !zOk(z)) { const d0 = z.side === 'property' ? 0.2 : 0.45; const bz = box(z.v_from, z.v_to, d0, d0 + (z.depth_m || bd.depth_m)); if (bz) gs.appendChild(el('rect', { class: 'zonefail', x: bz.x, y: bz.y, width: bz.w, height: bz.h })); }   /* a proposal the rule refuses or cannot connect: its outline, dashed red, where it would have been */
  for (const [a, b] of curbs) { const face = md ? (a < tr.v ? b : a) : a; const dir = md ? (a < tr.v ? 1 : -1) : -1; const g0 = face, g1 = face + dir * 0.3; wash(Math.min(g0, g1), Math.max(g0, g1), 0, 0.15, 'slab'); }   /* the gutter apron at the curb's foot, 0.3 m into the road, nominal (G11.3: refer to the curb standard detail) */
  if (md && wide) { if (vL > md.ocN) wash(md.ocN, md.ocN + md.cw, -0.15, 0.45, 'slab'); if (vR < md.ocF) wash(md.ocF - md.cw, md.ocF, -0.15, 0.45, 'slab'); }   /* an outer curb, assumed, where the cut reaches it */
  // the mains that cross this section, each in its trench (G4.4: bedding, backfill), the private corridors at nominal cover
  const items = []; const crossings = [];
  for (const f of S.facilities) { if (!f.path_uv || f.path_uv.length < 2 || f.kind === 'corridor') continue; const pts = f.path_uv; let hit = null;
    for (let i = 0; i + 1 < pts.length && !hit; i++) { const [au, av] = pts[i], [bu, bv] = pts[i + 1]; if ((au - uCut) * (bu - uCut) <= 0 && au !== bu) hit = av + (bv - av) * (uCut - au) / (bu - au); }
    if (hit == null) { const du = Math.abs(pts[0][0] - pts[pts.length - 1][0]), dv = Math.abs(pts[0][1] - pts[pts.length - 1][1]); if (dv > 3 && du < 1.5 && Math.abs(pts[0][0] - uCut) < 2.5 && f.depth_top_m != null) { const v0 = Math.min(pts[0][1], pts[pts.length - 1][1]), v1 = Math.max(pts[0][1], pts[pts.length - 1][1]); crossings.push({ f, bar: [v0, v1], rr: Math.max(0.1, (f.diameter_mm || 0) / 2000) }); } continue; }
    if (hit < vR || hit > vL || brk.some(([a, b]) => hit > a && hit < b)) continue; crossings.push({ f, v: hit, rr: Math.max(0.12, (f.diameter_mm || 0) / 2000) }); }
  for (const c of crossings) { const f = c.f; if (f.depth_top_m == null || c.bar || f.grade === 'nominal') continue; const Be = 2 * c.rr; const d0 = inRoad(c.v) ? 0.1 : 0.0, dBot = f.depth_top_m + Be + 0.15; if (dBot > DEPTH) continue; const hw = Be / 2 + 0.3;
    wash(c.v - hw, c.v + hw, d0, dBot, 'backfill', 'p6', .6); wash(c.v - hw, c.v + hw, f.depth_top_m + Be / 2, dBot, 'bedding', 'p1', .7);
    gs.appendChild(el('path', { class: 'trench', d: `M${X(c.v + hw)} ${Z(-d0)}V${Z(-dBot)}H${X(c.v - hw)}V${Z(-d0)}` })); c.trench = true; }
  const kindName = (f) => wide ? ({ water_main: 'WATER MAIN', water_main_abandoned: 'ABANDONED WATER MAIN', sewer_main: ((f.properties && f.properties.effluent) || 'SEWER').toString().toUpperCase().replace(/ SEWER$/, '') + ' SEWER', sewer_service: 'SERVICE', electrical_conduit: 'CONDUIT', transit: 'TRANSIT' }[f.kind] || f.kind.replace(/_/g, ' ').toUpperCase()) : f.label.split(' · ')[0].toUpperCase();
  for (const c of crossings) { const f = c.f; const short = kindName(f);
    if (c.bar) { const b = wash(c.bar[0], c.bar[1], f.depth_top_m, f.depth_top_m + 2 * c.rr, 'pipe bar'); items.push({ v: (c.bar[0] + c.bar[1]) / 2, z: -(f.depth_top_m + c.rr), t: `${short} · ${fmt(f.depth_top_m, 2)} m` }); continue; }
    if (f.depth_top_m != null) { const zc = -(f.depth_top_m + c.rr); if (-zc > DEPTH) continue; gs.appendChild(el('circle', { class: 'pipe ' + f.grade, cx: X(c.v), cy: Z(zc), r: Math.max(4, c.rr * k) })); if (c.rr * k > 9) gs.appendChild(el('circle', { class: 'pipein', cx: X(c.v), cy: Z(zc), r: c.rr * k * 0.78 })); items.push({ v: c.v, z: zc, t: `${wide ? short : short.replace('WATER ', '')}${f.diameter_mm ? ' Ø' + f.diameter_mm : ''} · ${fmt(f.depth_top_m, 2)} m · ${f.grade.toUpperCase()}` }); }
    else { gs.appendChild(el('rect', { class: 'unknown', x: X(c.v) - 5, y: Z(-0.2), width: 10, height: 2.5 * k })); items.push({ v: c.v, z: -1.5, t: `${short} · NO DEPTH` }); } }
  for (const c of S.corridors || []) { const v0 = Math.max(c.corridor_v[0], vR), v1 = Math.min(c.corridor_v[1], vL); if (v1 <= v0) continue; gs.appendChild(el('line', { class: 'corridor', x1: X(v1), y1: Z(-c.depth_top_m), x2: X(v0), y2: Z(-c.depth_top_m) })); }
  if (S.corridors && S.corridors.length && !wide) items.push({ v: (bd.v_from + bd.v_to) / 2, z: -Math.min(...S.corridors.map((c) => c.depth_top_m)), t: `${S.corridors.map((c) => c.utility.toUpperCase()).join(' · ')} · NOT PUBLISHED`, cls: 'nominal', drop: true });
  // the roots, in the credited soil only, cut where it ends
  const form = (cand && cand.roots && cand.roots.form) || (tr.roots && tr.roots.form) || 'heart';
  { const credited = (v, z) => (inSeg && v >= cutTop && v <= bd.v_to && z >= -bd.depth_m) || (zs && v >= zs.v_from && v <= zs.v_to && z <= -0.2 && z >= -(0.2 + zD));
    const crR = (cand ? h * (cand.crown_ratio_of_height || 0.6) : (tr.crown_diameter_m || 3)) / 2; const reach = Math.max(1.0, plant0.rb / 2 + 1.0);   /* the roots gather round the ball and go down (the user, 2026-10-09): the envelope is the ball's radius + 1 m, not the crown's */ const rootDeep = Math.min(DEPTH - 0.15, Math.max(bd.depth_m + 0.35, plant0.rd + 1.1));   /* the root system as wide as the crown and a little more, in the top metre: the biology, not the rule */
    const blocked = (v, z) => (sw && v >= sw[0] && v <= sw[1] && z > -0.2) || (inRoad(v) && z > -0.45) || (curbs.some(([a, b]) => v >= a && v <= b) && z > -0.45) || (md && wide ? false : v > vL) || v < vR;   /* a root does not run through the slab, the road structure or the curb */
    const pipes = crossings.filter((c) => c.v != null && c.f.depth_top_m != null).map((c) => [c.v, -(c.f.depth_top_m + c.rr), c.rr + 0.12]); const inPipe = (v, z) => pipes.some(([pv, pz, pr]) => Math.hypot(v - pv, z - pz) < pr);
    const zone = (v, z) => (z > -0.04 || z < -rootDeep || Math.abs(v - tr.v) > reach || blocked(v, z) || inPipe(v, z)) ? 0 : credited(v, z) ? 2 : 1;
    const rl = rootsFew(tr.v, form, zone, seed, plant0.rb, plant0.rd, reach); const byW = new Map(), faint = new Map(); for (const [v0, z0, v1, z1, wm, zn] of rl.segs) { const w = Math.min(4.5, Math.max(0.5, wm * k));   /* a root is a pen line with a light core at any scale: wider, the primaries fanning out of the ball read as white flames (the user's crops, 2026-10-12) */ const key = Math.max(0.5, Math.round(w * 4) / 4); const mp = zn === 1 ? faint : byW; if (!mp.has(key)) mp.set(key, []); mp.get(key).push(`M${X(v0).toFixed(1)} ${Z(z0).toFixed(1)}L${X(v1).toFixed(1)} ${Z(z1).toFixed(1)}`); }
    for (const [w, d] of [...faint.entries()].sort((a, b) => b[0] - a[0])) { const da = `${(3 + w * 2.2).toFixed(1)} ${(2 + w * 0.7).toFixed(1)}`; gs.appendChild(el('path', { class: 'rootfaint', 'stroke-width': w * 0.8 + 0.8, 'stroke-dasharray': da, d: d.join('') })); if (w > 1.6) gs.appendChild(el('path', { class: 'rootfaintpaper', 'stroke-width': w * 0.8 - 1.0, 'stroke-dasharray': da, d: d.join('') })); }   /* a root in ground the rule does not credit keeps its width; only the manner is dashed */   /* a root in ground the rule does not credit: dashed, the same tree */
    const heavy = [...byW.entries()].sort((a, b) => b[0] - a[0]);   /* one manner for every root: an ink stroke a little wider than the root, a paper core that thins away as the root does — no switch from body to line */
    for (const [w, d] of heavy) gs.appendChild(el('path', { class: 'rootink', 'stroke-width': w + 1.0, d: d.join('') }));
    for (const [w, d] of heavy) if (w > 1.3) gs.appendChild(el('path', { class: 'rootpaper', 'stroke-width': w - 0.9, d: d.join('') }));
    if (detail) { edge(bd.v_from, bd.v_to, 0, bd.depth_m); edge(bd.v_from, bd.v_to, bd.depth_m, bd.depth_m + 0.3); if (zs) edge(zs.v_from, zs.v_to, 0.2, 0.2 + zD); if (zrOk) edge(zrOk.v_from, zrOk.v_to, 0.45, 0.45 + zrD); if (sw) edge(sw[0], sw[1], 0.1, 0.2); for (const c of crossings) if (c.trench) { const f = c.f; const Be = 2 * c.rr; const d0 = inRoad(c.v) ? 0.1 : 0.0, dBot = f.depth_top_m + Be + 0.15; const hw = Be / 2 + 0.3; gs.appendChild(el('path', { class: 'trench', d: `M${X(c.v + hw)} ${Z(-d0)}V${Z(-dBot)}H${X(c.v - hw)}V${Z(-d0)}` })); } }   /* the ground's outlines over the roots: a root runs behind a boundary, never erases it (the user, 2026-10-09) */
    if (rl.cut.length && !detail) gs.appendChild(el('path', { class: 'rootcut', d: rl.cut.map(([a, b, c, d]) => `M${X(a).toFixed(1)} ${Z(b).toFixed(1)}L${X(c).toFixed(1)} ${Z(d).toFixed(1)}`).join('') })); }
  if (wide && houseV != null && vL > houseV) {   /* the nearest house, cut: its front wall, floor, eave and a run of roof; the footprint is the City's, the height nominal */
    const hx0 = X(vL), hx1 = X(houseV); const eave = houseH, ridge = houseH + 1.8; const gH = el('g', { class: 'house-sec' });
    gH.appendChild(el('path', { class: 'body', d: `M${hx0} ${Z(0)}V${Z(ridge)}L${hx1 + (hx0 - hx1) * 0.55} ${Z(ridge)}L${hx1} ${Z(eave)}V${Z(0)}Z` }));
    gH.appendChild(el('rect', { class: 'wall', x: hx1, y: Z(eave), width: Math.max(2, 0.25 * k), height: Z(0) - Z(eave) })); gH.appendChild(el('line', { class: 'floor', x1: hx0, y1: Z(0.45), x2: hx1, y2: Z(0.45) })); gH.appendChild(el('rect', { class: 'wall', x: hx1, y: Z(0), width: Math.max(2, 0.25 * k), height: 0.9 * k }));   /* a shallow footing, nominal */
    gs.appendChild(gH); }
  if (wide) { const xc = X(cl); gs.appendChild(el('line', { class: 'cl', x1: xc, y1: Z(0.25), x2: xc, y2: Z(-DEPTH) })); }   /* the street's centreline */
  // the ground line, grass on the band, the tree, a person for scale
  gs.appendChild(el('line', { class: 'grade', x1: X(vL), y1: Z(0), x2: X(vR), y2: Z(0) }));   /* in the drawing's group: the trunk and the collar paint over it (the user's crop, 2026-10-12: the grade cut the collar in two) */
  { const d = []; for (let v = bd.v_from + 0.06; v < bd.v_to; v += 0.09) { if (detail && Math.abs(v - tr.v) < plant0.tp) continue; const x = X(v); const hh = 3 + R() * 5; d.push(`M${x.toFixed(1)} ${Z(0)}l${((R() - .5) * 3).toFixed(1)} ${(-hh).toFixed(1)}`); } gs.appendChild(el('path', { class: 'grass', d: d.join('') })); if (bb) { const d2 = []; for (let v = bb[0] + 0.05; v < bb[1]; v += 0.1) d2.push(`M${X(v).toFixed(1)} ${Z(0)}l${((R() - .5) * 2).toFixed(1)} ${(-(2 + R() * 3)).toFixed(1)}`); for (let v = pl + 0.05; v < vL; v += 0.1) d2.push(`M${X(v).toFixed(1)} ${Z(0)}l${((R() - .5) * 2).toFixed(1)} ${(-(2 + R() * 3)).toFixed(1)}`); gs.appendChild(el('path', { class: 'grass', d: d2.join('') })); }
    if (md && wide && (vL > md.ocN || vR < md.ocF)) { const d3 = []; for (let v = md.ocN + 0.2; v < vL; v += 0.1) d3.push(`M${X(v).toFixed(1)} ${Z(0)}l${((R() - .5) * 2).toFixed(1)} ${(-(2 + R() * 3)).toFixed(1)}`); for (let v = vR + 0.05; v < md.ocF - 0.15; v += 0.1) d3.push(`M${X(v).toFixed(1)} ${Z(0)}l${((R() - .5) * 2).toFixed(1)} ${(-(2 + R() * 3)).toFixed(1)}`); gs.appendChild(el('path', { class: 'grass', d: d3.join('') })); } }
  const crownD = cand ? +(h * (cand.crown_ratio_of_height || 0.6)).toFixed(1) : (tr.crown_diameter_m || 3); const cr = crownD / 2;
  if (cand && tr.height_m) { const gg = el('g', { class: 'ghost' }); treeSection(gg, X, Z, k, tr.v, tr.height_m, (tr.crown_diameter_m || 3) / 2, tr.species_ref && tr.species_ref.form); gs.appendChild(gg); }   // the City's tree stays as a ghost behind the card's
  /* the planting itself, as the City's planting standard draws it (Park Board 8-01; G11.3 on a median): the rootball flush with grade, the pit a shallow saucer twice its width with scarified sides, 300 mm compacted subgrade under the ball, 50 mm mulch over the pit kept 100 mm off the trunk — STANDARD, nominal for this tree, never a record of it */
  /* the planting as the City's own sheets draw it — COV Standard Detail G11.3 (median planting) and Park Board 8-01 (tree planting): the rootball a wire basket (round bottom, ribs, two rings) flush with grade, the pit a trapezoid whose sides splay to grade, scarified, 300 mm compacted subgrade under the ball, 50 mm mulch over the pit kept 100 mm off the trunk. STANDARD, nominal for this tree — a 20-year-old trunk has no basket; the drawing says how the City plants, not what is there */
  const plant = { ...plant0, pw: plant0.tp * 2 }; let flareAt = null;
  if (detail) { const { rb, rd, tp, bp, pd } = plant; const gp = el('g', { class: 'planting' }); const vT = tr.v; const xR = (v) => X(v).toFixed(1); const yT = Z(0), yB = Z(-rd), yP = Z(-pd), xL = X(vT + rb / 2), xRt = X(vT - rb / 2), Wb = xRt - xL, y1 = yT + 0.4 * (yB - yT);
    gp.appendChild(el('path', { class: 'pit', d: `M${xR(vT + tp)} ${yT}L${xR(vT + bp)} ${yP.toFixed(1)}H${xR(vT - bp)}L${xR(vT - tp)} ${yT}` }));
    { const d = []; for (let i = 1; i <= 5; i++) { const t = i / 6; for (const s of [1, -1]) { const v = vT + s * (tp - (tp - bp) * t), z = -pd * t; d.push(`M${xR(v)} ${Z(z).toFixed(1)}l${(s * 5).toFixed(0)} 2`); } } for (let i = 1; i <= 4; i++) { const v = vT - bp + (2 * bp) * i / 5; d.push(`M${xR(v)} ${yP.toFixed(1)}l0 5`); } gp.appendChild(el('path', { class: 'scar', d: d.join('') })); }   /* scarify sides and bottom (8-01) */
    { const d = []; for (let v = vT - bp + 0.06; v < vT + bp; v += 0.13) d.push(`M${xR(v)} ${(yP + 2).toFixed(1)}l1 ${Math.max(3, 0.3 * k - 3).toFixed(1)}`); d.push(`M${xR(vT + bp)} ${(yP + 0.3 * k).toFixed(1)}H${xR(vT - bp)}`); gp.appendChild(el('path', { class: 'subgrade', d: d.join('') })); }   /* 300 mm compacted subgrade under the ball */
    { const Wp = xRt - xL, Hp = yB - yT; const tf = `translate(${(X(vT) - BALL_801.tx * Wp).toFixed(1)} ${yT.toFixed(1)}) scale(${Wp.toFixed(2)} ${Hp.toFixed(2)})`; const hx = X(vT) - BALL_801.tx * Wp; const hd = 'M' + BALL_801.hullPts.map(([a, b]) => `${(hx + a * Wp).toFixed(1)} ${(yT + b * Hp).toFixed(1)}`).join('L') + 'Z'; gp.appendChild(el('path', { class: 'ballfill', d: hd })); gp.appendChild(el('path', { class: 'pat', d: hd, fill: `url(#h-cross${hs})` })); gp.appendChild(el('path', { class: 'ball801', d: BALL_801.d, transform: tf })); }   /* the ball as sheet 8-01 draws it, stretched to its size here */
    flareAt = { rb, dbh: Math.max(0.12, ((tr.diameter_cm || 15) / 100) * 1.15) };
    const mulch = (a, b) => { const r = { x: X(b), y: Z(0), width: Math.max(0, X(a) - X(b)), height: Math.max(6, 0.05 * k) }; gp.appendChild(el('rect', { class: 'mulch', ...r })); gp.appendChild(el('rect', { class: 'pat', ...r, fill: `url(#h-mulch${hs})` })); }; mulch(vT - tp, vT - 0.1); mulch(vT + 0.1, vT + tp);
    gs.appendChild(gp); }
  /* the protection distance at grade (By-law 9958 Schedule A, already in the scene as tree.protection): the fence each side of the trunk, held 0.6 m off the curb and 0.3 m off the walk as G10.1 draws it — a construction distance, not a root extent */
  let fence = null; if (false && wide && tr.protection && tr.protection.radius_m) {   /* 2026-10-12: the fence left the sheet with the folds (03 too full) */ const r = tr.protection.radius_m; const o = tr.protection.offsets_m || { from_curb: 0.6, from_sidewalk_edge: 0.3 }; const fP = md ? Math.min(tr.v + r, md.cfN - o.from_curb) : Math.min(tr.v + r, (sw ? sw[0] : pl) - o.from_sidewalk_edge), fR = md ? Math.max(tr.v - r, md.cfF + o.from_curb) : Math.max(tr.v - r, curb + o.from_curb);
    if (fP > tr.v + 0.2 && fR < tr.v - 0.2) { fence = [fP, fR, r, o]; const gf = el('g', { class: 'fenceg' }); for (const v of [fP, fR]) { gf.appendChild(el('path', { class: 'fence', d: `M${X(v).toFixed(1)} ${Z(0)}V${Z(1.4).toFixed(1)}` })); gf.appendChild(el('path', { class: 'fencecap', d: `M${(X(v) - 4).toFixed(1)} ${Z(1.4).toFixed(1)}h8` })); } gf.appendChild(el('path', { class: 'fencerail', d: `M${X(fP).toFixed(1)} ${Z(1.4).toFixed(1)}H${X(fR).toFixed(1)}` })); gs.appendChild(gf); } }
  const artForm = sr.form;   /* (the user, 2026-10-13) */
  if (treeBrk) treeBroken(gs, X, Z, k, tr.v, h, cr, artForm, treeBrk.z1, treeBrk.z2); else treeSection(gs, X, Z, k, tr.v, h, cr, artForm);
  if (flareAt && !treeBrk) {   /* the root flare over the tree: its top as wide as the drawn trunk is at 0.4 m (measured on the art's silhouette), so the trunk's two lines run into the collar and never through it (the user's crop, 2026-10-12) */
    const { rb, dbh } = flareAt; const xc = X(tr.v); const yT0 = Z(0) - 0.02 * k, yD2 = Z(-0.16); const hw0 = dbh * k / 2; let E = [xc - hw0, xc + hw0];
    try { const inv = gs.getCTM().inverse(); const best = [null, null]; const sil = gs.querySelectorAll('.treeart .silhouette path'); for (const pth of sil.length ? sil : gs.querySelectorAll('.treeart path')) { const bb = pth.getBBox(); const m = pth.getCTM(); const top = new DOMPoint(bb.x, bb.y).matrixTransform(m).matrixTransform(inv), bot = new DOMPoint(bb.x, bb.y + bb.height).matrixTransform(m).matrixTransform(inv); if (Math.min(top.y, bot.y) > yT0 + 2 || Math.max(top.y, bot.y) < yT0 - 2) continue; const L = pth.getTotalLength(); if (!L) continue; const n = Math.min(900, Math.max(120, Math.round(L / 3)));
        for (let q = 0; q <= n; q++) { const pt = pth.getPointAtLength(L * q / n); const sp = new DOMPoint(pt.x, pt.y).matrixTransform(m).matrixTransform(inv); if (Math.abs(sp.x - xc) > 0.8 * k) continue; const i = sp.x < xc ? 0 : 1; const d = Math.abs(sp.y - yT0); if (d < 0.05 * k && (!best[i] || d < best[i].d)) best[i] = { d, x: sp.x }; } }
      if (best[0] && best[1]) E = [best[0].x, best[1].x]; } catch (e) { /* no geometry API: the dbh's width about the centre */ }   /* the drawn trunk's two base lines where they meet the ground (only the silhouette path, only where it reaches grade) */
    const hf = Math.max((E[1] - E[0]) / 2 + 0.08 * k, Math.min(rb * 0.3, dbh * 1.0) * k / 2); const gf = el('g', { class: 'planting' });   /* the collar: from grade down into the ball only, its top exactly the trunk's base, a little wider at the ball; no line over the trunk, none across the bottom */
    const F = (x, y) => `${x.toFixed(1)} ${y.toFixed(1)}`; const side = (i) => { const sg = i ? 1 : -1; return `M${F(E[i], yT0)}C${F(E[i], Z(0) + 0.04 * k)} ${F(xc + sg * hf, Z(0) + 0.06 * k)} ${F(xc + sg * hf, yD2)}`; };
    const up = `L${F(xc + hf, yD2)}C${F(xc + hf, Z(0) + 0.06 * k)} ${F(E[1], Z(0) + 0.04 * k)} ${F(E[1], yT0)}Z`;
    gf.appendChild(el('path', { class: 'flarefill', d: side(0) + up })); gf.appendChild(el('path', { class: 'flareedge', d: side(0) + side(1) })); gs.appendChild(gf); }   /* the whole tree at City height (a card: the species' City p90), the crown at its nominal spread; roots below share the trunk base */
  const figV = sw ? (sw[0] + sw[1]) / 2 + 0.4 : md && wide ? (brk.length ? tr.v + Math.min(2.2, md.cfN - 0.7 - tr.v) : md.cfN - 0.9) : null;   /* on a median: the figure stands on the median's grass at its near curb */   /* the figure for scale: on the sidewalk, or on the boulevard beside a median's outer curb */
  if (tool) { const gH = el('g', { class: 'hgrid' }); for (let z = 5; z <= h + 0.4 && Z(z) > y0 + HEAD + 6; z += 5) { gH.appendChild(el('line', { x1: X(vL), y1: Z(z), x2: X(vR), y2: Z(z) })); gH.appendChild(el('text', { class: 's grey', x: sx - 11, y: Z(z) + 3.5, 'text-anchor': 'end' }, `${z} m`)); } gs.insertBefore(gH, gs.firstChild); }   /* 04: a height grid behind the tree, every 5 m, read on the depth scale's axis (the user, 2026-10-12: a background reference, not a dimension on the tree) */   /* 04: the tree's height as a dimension beside it (the user, 2026-10-12: the part above ground needs a measure too) */
  if (figV != null && GROUND.person && !mini) { const [, , vw, vh] = GROUND.person.vb.split(/\s+/).map(Number); const hP = 1.7 * k, wP = hP * vw / vh; const px = X(figV); gs.appendChild(el('use', { class: 'fig', href: '#fig-person', x: px - wP / 2, y: Z(0) - hP, width: wP, height: hP })); if (tool) g.appendChild(el('text', { class: 's grey', x: px, y: Z(1.7) - 6, 'text-anchor': 'middle' }, '1.7 m')); }   /* the figure as the second reference */
  const fixNotes = []; if (wide && k >= 60) { const gF = el('g', { class: 'fixture' }); for (const f of S.facilities) { if (!f.path_uv || f.path_uv.length !== 1) continue; const [fu, fv] = f.path_uv[0]; const du = fu - uCut; if (Math.abs(du) > 4 || fv < vR + 0.15 || fv > vL - 0.15 || brk.some(([a, b]) => fv > a && fv < b)) continue; const x = X(fv); const side = `${fmt(Math.abs(du), 1)} m ${du > 0 ? 'EAST' : 'WEST'} OF THE CUT`;
      if (f.kind === 'street_lighting_pole') { const hP = 9.0, arm = 1.6 * (fv > (md ? tr.v : curb) ? -1 : 1); gF.appendChild(el('path', { d: `M${(x - 3).toFixed(1)} ${Z(0)}h6l-1 ${(-hP * k).toFixed(1)}h-4z` })); gF.appendChild(el('path', { d: `M${x.toFixed(1)} ${Z(hP - 0.6).toFixed(1)}q${(arm * k * 0.5).toFixed(1)} ${(-0.6 * k).toFixed(1)} ${(arm * k).toFixed(1)} ${(-0.6 * k).toFixed(1)}` })); gF.appendChild(el('rect', { x: (x + arm * k - (arm > 0 ? 0.5 * k : 0)).toFixed(1), y: Z(hP + 0.1).toFixed(1), width: (0.5 * k).toFixed(1), height: (0.2 * k).toFixed(1) })); fixNotes.push({ z: hP * 0.55, v: fv, t: `LIGHT POLE · ${side} · HEIGHT NOMINAL · CITY` }); }
      else if (f.kind === 'hydrant') { const hH = 0.75; gF.appendChild(el('path', { d: `M${(x - 0.12 * k).toFixed(1)} ${Z(0)}v${(-hH * k * 0.8).toFixed(1)}q0 ${(-0.2 * k).toFixed(1)} ${(0.12 * k).toFixed(1)} ${(-0.2 * k).toFixed(1)}q${(0.12 * k).toFixed(1)} 0 ${(0.12 * k).toFixed(1)} ${(0.2 * k).toFixed(1)}v${(hH * k * 0.8).toFixed(1)}z` })); gF.appendChild(el('path', { d: `M${(x - 0.2 * k).toFixed(1)} ${Z(hH * 0.5).toFixed(1)}h${(0.4 * k).toFixed(1)}` })); fixNotes.push({ z: hH * 0.6, v: fv, t: `HYDRANT · ${side} · CITY` }); } }
    if (gF.children.length) gs.appendChild(gF); }
  if (mini) return;   /* the stamp: the drawing alone */
  if (brk.length) { const yT = y0 + HEAD - 4, yB = Z(-DEPTH) + 2; const zz = (x) => { const m1 = Z(Math.min(2.4, above / k * 0.45)), m2 = Z(-DEPTH * 0.55); return `M${x} ${yT}V${m1 - 6}l-4 3 8 6 -4 3V${m2 - 6}l-4 3 8 6 -4 3V${yB}`; };
    for (const [a, b] of brk) { const xa = X(b).toFixed(1), xb = X(a).toFixed(1); g.appendChild(el('path', { class: 'brk', d: `M${xa} ${yT}H${xb}V${yB}H${xa}Z` })); g.appendChild(el('path', { class: 'brkline', d: zz(xa) + zz(xb) })); } }
  // the depth scale on the left, the height mark
  for (let m = 0; m <= DEPTH; m++) { g.appendChild(el('line', { class: 'tick', x1: sx - 8, y1: Z(-m), x2: sx - 2, y2: Z(-m) })); g.appendChild(el('text', { class: 's', x: sx - 11, y: Z(-m) + 3.5, 'text-anchor': 'end' }, m + (detail && m === Math.floor(DEPTH) ? ' m' : ''))); }
  if (!detail) g.appendChild(el('text', { class: 's grey', x: sx - 11, y: Z(-DEPTH) + 16, 'text-anchor': 'end' }, 'm'));
  if (wide) {   /* the side string: the band's depth as the drawing's own dimension, the planting standard's 900 mm as a grey tick beside it — a reference, never a verdict */
    const dz = bd.depth_m; g.appendChild(el('line', { class: 'tick', x1: sx - 10, y1: Z(-dz), x2: sx - 2, y2: Z(-dz) })); g.appendChild(el('line', { class: 'tickstd', x1: sx - 14, y1: Z(-0.9), x2: sx - 10, y2: Z(-0.9) }));
    const yd = Z(-dz / 2); g.appendChild(el('text', { class: 's', x: sx - 28, y: yd - 7, 'text-anchor': 'end' }, fmt(dz, 2))); g.appendChild(el('text', { class: 's grey', x: sx - 28, y: yd + 4, 'text-anchor': 'end' }, 'ASSUMED')); g.appendChild(el('text', { class: 's cite', x: sx - 28, y: yd + 15, 'text-anchor': 'end' }, 'STD 900'));
    /* the native ground's one provincial record: the nearest GWELLS lithology log as a thin grey column beside the depth scale — that well's ground, 700 m away, never this site's */
    const bh = S.ground && S.ground.borehole; if (boreIn) { const bx = sx - 96, bw = 10; g.appendChild(el('rect', { class: 'borecol', x: bx, y: Z(0), width: bw, height: Z(-DEPTH) - Z(0) }));
      for (const iv of bh.intervals) { const d0 = Math.max(0, iv.from_m), d1 = Math.min(DEPTH, iv.to_m); if (d1 <= d0) continue; g.appendChild(el('rect', { class: 'borelog', x: bx, y: Z(-d0), width: bw, height: (d1 - d0) * k })); }
      const yb = Z(-DEPTH) + 15; const first = bh.intervals[0]; g.appendChild(el('text', { class: 's grey', x: bx, y: yb }, `WELL ${bh.well_tag_number} · ${fmt(bh.distance_m, 0)} m AWAY`)); g.appendChild(el('text', { class: 's grey', x: bx, y: yb + 11 }, `${(first.text || '').toUpperCase()} ${fmt(first.from_m, 2)}–${fmt(first.to_m, 2)} m`)); } }
  if (!detail && Z(h) > y0 + HEAD) { const hy = Z(h); const sd = sx - x0 > 96 ? -1 : 1;   /* the height on the trunk's left, or on its right when the left would run under the panel */ g.appendChild(el('line', { class: 'tick', x1: sx + sd * 8, y1: hy, x2: sx + sd * 2, y2: hy })); g.appendChild(el('line', { class: 'hdim', x1: sx + sd * 5, y1: hy, x2: sx + sd * 5, y2: Z(0) })); g.appendChild(el('text', { class: 's', x: sx + sd * 11, y: hy + 3.5, 'text-anchor': sd < 0 ? 'end' : 'start' }, `${fmt(h)} m`)); g.appendChild(el('text', { class: 's grey', x: sx + sd * 11, y: hy + 15, 'text-anchor': sd < 0 ? 'end' : 'start' }, cand ? 'CITY P90' : 'CITY RECORD')); }
  // zone pills above the ground: the street's parts, named
  // in replace, two pills are choosers (a caret, the accent, a row higher so they never collide): the sidewalk's land-use row and the band's soil type
  if (detail) {   /* 03 · the dimension string across the top: a tick at every edge, the width on the baseline, the City's name for the part under it, its tag under that (ASSUMED Table 8-3 / 8-4 · DERIVED band · the curb's provenance · CITY ℄); a part too narrow for its width carries it above the line */
    const yS = y0 + (tool ? 72 : 46); const segs = []; let aboveEnd = !md && !tool && vL > pl ? X(pl) + 14 : -1e9, aboveRow = 0;   /* P/L sits above the line at the left: the first narrow label gives way to it */ const curbK = S.knobs && S.knobs.curb_offset_from_centreline_m; const curbTag = curbK && curbK.provenance === 'CONFIRMED_SITE_DATA' ? 'CONFIRMED' : curbK && curbK.provenance === 'USER_INPUT' ? 'TYPED' : 'ASSUMED';
    const seg = (v0, v1, num, name, short, tag, tagS) => { const a = Math.max(v0, vR), b = Math.min(v1, vL); if (b - a > 0.02) segs.push({ v0: a, v1: b, num, name, short, tag, tagS, openR: v0 < vR - 0.01, openL: v1 > vL + 0.01 }); };
    if (md) { if (vL > md.ocN) seg(md.ocN, vL, null, 'BOULEVARD', 'BLVD'); seg(md.cfN, md.ocN, fmt(md.ocN - md.cfN, 1), 'ROAD', 'ROAD', md.ocKnown[0] ? 'CITY' : 'ASSUMED', null); seg(md.cfN - md.cw, md.cfN, fmt(md.cw, 2), 'CURB', 'CURB', 'ASSUMED', 'ASSUMED'); seg(bd.v_from, bd.v_to, fmt(bd.v_to - bd.v_from, 2), 'THE MEDIAN', 'MEDIAN', `${curbTag} · ${fmt(md.h, 1)} m EACH SIDE OF ITS ℄`, curbTag); seg(md.cfF, md.cfF + md.cw, fmt(md.cw, 2), 'CURB', 'CURB', 'ASSUMED', 'ASSUMED'); seg(md.ocF, md.cfF, fmt(md.cfF - md.ocF, 1), 'ROAD', 'ROAD', md.ocKnown[1] ? 'CITY' : 'ASSUMED', null); if (vR < md.ocF) seg(vR, md.ocF, null, 'BOULEVARD', 'BLVD'); }
    else { seg(pl, vL, null, 'YARD', 'YARD');
      if (bb) seg(bb[0], bb[1], fmt(st.widths_m.back_boulevard, 2), 'BACK BOULEVARD', 'BLVD', 'ASSUMED · TABLE 8-4', 'ASSUMED'); if (sw) seg(sw[0], sw[1], fmt(st.widths_m.sidewalk_clear, 2), 'SIDEWALK', 'WALK', 'ASSUMED · TABLE 8-3', 'ASSUMED');
      seg(bd.v_from, bd.v_to, fmt(bd.v_to - bd.v_from, 2), 'THE BAND', 'BAND', 'DERIVED', 'DERIVED'); seg(curb, boc, fmt(curbW, 2), 'CURB', 'CURB', 'ASSUMED · TABLE 8-4', 'ASSUMED'); seg(cl, curb, fmt(curb - cl, 1), 'ROAD TO ℄', 'ROAD', `${curbTag} CURB · CITY ℄`, curbTag); }
    const gD = el('g', { class: 'dstr' }); g.appendChild(gD); gD.appendChild(el('path', { class: 'dline', d: `M${X(vL).toFixed(1)} ${yS}H${X(vR).toFixed(1)}` }));
    for (const [a, b] of brk) { const xa = X(b); gD.appendChild(el('rect', { class: 'dgap', x: xa + 1, y: yS - 7, width: GAP - 2, height: 14 })); gD.appendChild(el('path', { class: 'dline', d: `M${(xa + 1).toFixed(1)} ${yS}h${GAP / 2 - 4}l-3 -5 6 10 -3 -5h${GAP / 2 - 4}` })); }
    const edges = new Set(), open = new Set(); for (const s of segs) { if (s.openR) open.add(s.v0); else edges.add(s.v0); if (s.openL) open.add(s.v1); else edges.add(s.v1); } for (const v of edges) if (!open.has(v)) gD.appendChild(el('line', { class: 'dtick', x1: X(v).toFixed(1), y1: yS - 6, x2: X(v).toFixed(1), y2: yS + 6 }));
    for (const v of open) { const x = X(v); const dir = v <= vR + 0.01 ? 1 : -1; gD.appendChild(el('path', { class: 'dline', d: `M${(x - dir * 7).toFixed(1)} ${yS - 3.5}L${x.toFixed(1)} ${yS}L${(x - dir * 7).toFixed(1)} ${yS + 3.5}` })); }   /* the dimension runs on past the sheet: an arrow, no tick */
    const CH = 7.05; const txt = (x, y, t, cls) => gD.appendChild(el('text', { class: cls, x: x.toFixed(1), y, 'text-anchor': 'middle' }, t));
    for (const s of segs) { const xa = X(s.v1), xb = X(s.v0); const w = xb - xa, cx = (xa + xb) / 2; const fits = (t) => t && t.length * CH <= w - 4;
      const r1 = s.num || s.name; if (!fits(r1)) { if (s.num) { const t = tool ? `${s.short} ${s.num}` : s.name + ' ' + s.num + (s.tagS ? ' · ' + s.tagS : ''); const tw = t.length * CH; let yy = yS - 11; if (cx - tw / 2 < aboveEnd + 8) { aboveRow = aboveRow ? 0 : 1; yy = aboveRow ? yS - 25 : yS - 11; } else aboveRow = 0; aboveEnd = cx + tw / 2; txt(cx, yy, t, 'dnum'); } continue; }   /* a part too narrow for its width: the label above the line, a row higher when it would run into the last one */
      txt(cx, yS + 15, r1 + (s.openR ? ' →' : '') , 'dnum'); if (s.num) { const nm = fits(s.name) ? s.name : fits(s.short) ? s.short : null; if (nm) txt(cx, yS + 26, nm, 'dname'); } const tg = tool ? null : fits(s.tag) ? s.tag : fits(s.tagS) ? s.tagS : null; if (tg) txt(cx, yS + 37, tg, 'dtag'); }   /* 04: widths and names only; the tags are read at 03 */
    if (!md && !tool && vL > pl) txt(X(pl), yS - 11, 'P/L', 'dnum'); if (vR < cl && vL > cl) txt(X(cl), yS - 11, '℄', 'dnum');
  } else {

  const pillW = (t, pick) => t.length * 6.4 + 12 + (pick ? 14 : 0);
  /* the zone string under the ground: one line with a tick at every zone edge, the width (or a short name) on one baseline, the long name below it where it fits; the band's name is the soil chooser */
  const yStr = Z(-DEPTH) + 12;
  const pill2 = (v0, v1, t, pick, dx = 0, row = 0) => { const a = X(Math.min(v1, vL)), b = X(Math.max(v0, vR)); if (b - a < 6) return; const m = t.match(/(\d+\.\d+)/); const num = m ? m[1] : null; const name = t.replace(/\s*\d+\.\d+\s*/, ' ').replace(/\s*·\s*$/, '').replace(/^\s*·\s*/, '').trim(); const cx2 = (a + b) / 2;
    const gp = el('g', { class: 'zpill' + (pick ? ' pick' : '') });
    gp.appendChild(el('path', { class: 'chain', d: `M${a.toFixed(1)} ${yStr - 4}V${yStr + 2}M${a.toFixed(1)} ${yStr - 1}H${b.toFixed(1)}M${b.toFixed(1)} ${yStr - 4}V${yStr + 2}` }));
    const line1 = num || name; const w1 = line1.length * 6.4; if (w1 <= b - a + 26) gp.appendChild(el('text', { x: cx2, y: yStr + 14, 'text-anchor': 'middle' }, line1));
    if (num && name) { const label = name + (pick ? ' ▾' : ''); const w2 = label.length * 6.4; if (w2 <= b - a + 30) { const tx = el('text', { class: 'name', x: cx2, y: yStr + 27, 'text-anchor': 'middle' }, label); gp.appendChild(tx); if (pick) { gp.addEventListener('click', (e) => { e.stopPropagation(); pick(cx2 - w2 / 2, yStr + 32); }); } } }
    g.appendChild(gp); };
  if (md) { if (wide) { if (vL > md.ocN) pill2(md.ocN, vL, 'BOULEVARD'); pill2(md.cfN, Math.min(md.ocN, vL), vL < md.ocN ? 'ROAD' : `${fmt(md.ocN - md.cfN, 1)} · ROAD${md.ocKnown[0] ? '' : ' · ASSUMED'}`); } }   /* the width only when the whole carriageway is in the cut */
  else if (wide && houseV != null && vL > houseV) { pill2(houseV, vL, 'HOUSE'); pill2(pl, houseV, `${fmt(houseV - pl, 1)} · SETBACK`); } else pill2(pl, vL, 'P/L');
  if (bb) pill2(bb[0], bb[1], fmt(st.widths_m.back_boulevard, 2));
  const tSw = sw ? `SIDEWALK ${fmt(st.widths_m.sidewalk_clear, 2)}` + (replace ? ` · ${LAND_SHORT[live.land_use] || live.land_use}` : '') : '', tBd = `THE BAND ${fmt(bd.v_to - bd.v_from, 2)}` + (replace ? ` · ${SOIL_SHORT[live.soil] || live.soil}` : '');
  let dxBd = 0, rowBd = 0; if (sw && replace) { const cS = (X(Math.min(sw[1], vL)) + X(Math.max(sw[0], vR))) / 2, cB = (X(Math.min(bd.v_to, vL)) + X(Math.max(bd.v_from, vR))) / 2; const over = cS + pillW(tSw, true) / 2 + 8 - (cB - pillW(tBd, true) / 2); if (over > 0) { if (W > 720) dxBd = over; else rowBd = 1; } }
  if (sw) pill2(sw[0], sw[1], tSw, null);                                                                   // land use is rule context: it lives in the panel's Advanced block, the pill is a label
  pill2(bd.v_from, bd.v_to, md ? `THE MEDIAN ${fmt(bd.v_to - bd.v_from, 2)}` + (replace ? ` · ${SOIL_SHORT[live.soil] || live.soil}` : '') : tBd, replace && !review && !app.busy ? (x, y) => soilMenu(x, y, live) : null, dxBd, rowBd);   // the soil pill stays a chooser, second to the field
  if (md) { if (wide) { pill2(Math.max(md.ocF, vR), md.cfF, vR > md.ocF ? 'ROAD' : `${fmt(md.cfF - md.ocF, 1)} · ROAD${md.ocKnown[1] ? '' : ' · ASSUMED'}`); if (vR < md.ocF) pill2(vR, md.ocF, 'BOULEVARD'); } } else pill2(vR, curb, wide ? `${fmt(curb - cl, 1)} · ROAD TO ℄` : 'ROAD');
  }
  // notes on the paper to the right, in depth order, each with a level leader to its thing
  const lx = sx + secW + 44; items.sort((a, b) => b.z - a.z); let ly = wide ? y0 + HEAD + 18 : Z(0) + 6; const notes = [];   /* 03: the column may start under the string (the crown's note keeps the first line), 04: under the grade */
  const LP = wide ? 11 : 12, LG = wide ? 2 : 4; const NCH = tool ? Math.max(18, Math.floor((x0 + W - lx - 10) / 6.9)) : LAB > 230 ? Math.max(30, Math.floor((LAB - 50) / 7.05)) : LAB > 190 ? 36 : 29;   /* 04: the column's real room (the drawing is width-bound, the notes take what is left of the panel) */
  const vk = (v) => { for (const [a, b] of brk) if (v > a && v < b) return v - a < b - v ? a - 0.05 : b + 0.05; return v; };
  const lab = (z, v, t, cls, drop) => { const y = Math.max(Z(z), ly); const lines = wrap(t, NCH); notes.push({ z, v: Math.min(vL - 0.1, Math.max(vR + 0.1, vk(v))), y, lines, cls, drop });   /* a leader always lands inside the frame (a main running along the street may centre outside it) */ ly = y + lines.length * LP + LG; };
  const crownNote = () => { const first = notes.length ? Math.min(...notes.map((n) => n.y)) - notesLift : Infinity; const cy0 = Math.min(Math.max(y0 + HEAD + (wide ? 5 : 12), Z(treeBrk ? zc + crownH * 0.5 - (treeBrk.z2 - treeBrk.z1) : h * 0.72)), first - 13); g.appendChild(el('path', { class: 'll', d: `M${(X(tr.v) + cr * k).toFixed(1)} ${cy0.toFixed(1)}H${lx - 22}H${lx - 4}` })); const ct = tool ? `TREE ${fmt(h)} · CROWN ${fmt(crownD)} · NOMINAL` : `CROWN ${fmt(crownD)} m · ${(sr.form || 'form').toUpperCase()} · NOMINAL`; wrap(ct, tool ? NCH : 60).forEach((l, i) => g.appendChild(el('text', { class: 's', x: lx, y: cy0 + 3.5 + i * LP }, l))); };   /* drawn with the notes: it keeps a line above the column's first note when the column lifts */
  let notesLift = 0; const N = []; const note = (z, v, t, cls, drop) => N.push({ z, v, t, cls: cls || '', drop: !!drop });
  if (replace && !detail) { if (md) note(-0.15, md.cfN, `MEDIAN CURBS ${fmt(md.h, 1)} m EITHER SIDE OF ITS CENTRE`, 'ctl'); else note(-0.15, curb, `CURB ${fmt(curb - cl, 1)} m FROM ℄`, 'ctl'); }   /* with the dimension string the curb and its tag are on the sheet; no curb handle (a site fact, corrected at 03) */
  if (wide) {   /* 03 · the brief of 2026-10-09: every layer named in the City's words, each note with one level leader, a standard's number as a grey citation only on the notes that come from it; the mains keep their trenches and labels */
    const std = md ? 'COV G11.3' : 'PARK BOARD 8-01'; const bh = S.ground && S.ground.borehole; const swr = S.ground && S.ground.sidewalk; const c311 = S.ground && S.ground.cases_311 && S.ground.cases_311.since_2022 ? S.ground.cases_311.since_2022.count : null;
    for (const fx of fixNotes) note(fx.z, fx.v, fx.t, 'grey', true); 
    if (zs) note(-(0.2 + zD) / 2 - 0.1, (zs.v_from + zs.v_to) / 2, `UNDER THE SLAB${zs.credited_m3 != null ? ' · ' + fmt(zs.credited_m3) + ' m³' : ''} · ASSUMED`, 'zone');
    if (inSeg && cutTop < bd.v_to) note(-bd.depth_m / 2, (cutTop + bd.v_to) / 2, `CREDITED SOIL${tr.share_m3 != null ? ' · ' + fmt(tr.share_m3) + ' m³' : ''} · ASSUMED`, 'soil');
  } else {   /* 04 · the hand's words only: each proposal with what the rule credits it, the credited soil as this cut times the cell, the rest of the ground's explanation stays in 03 */
  const zNote = (z, d0, zdep) => { if (!z) return; const name = extTxt(S)[z.side][0]; const zc = -(d0 + zdep / 2) - 0.1, zv = (z.v_from + z.v_to) / 2; if (z.status === 'DRAG') note(zc, zv, `${name} · ${fmt(z.width_applied_m, 1)} m · LET GO → THE RULE RUNS`, 'ctl'); else if (zOk(z)) note(zc, zv, `${name} · ${z.credited_m3 != null ? fmt(z.credited_m3) + ' m³' : 'PROPOSED'}`, 'zone'); else note(zc, zv, `${name} · ${(zoneVerdict(z) || ['NOT COUNTED'])[0]}`, 'red'); };
  zNote(zP, 0.2, (zP && zP.depth_m) || bd.depth_m); zNote(zR, 0.45, (zR && zR.depth_m) || bd.depth_m);
  if (inSeg && cutTop < bd.v_to) { const cell = tr.spacing_m != null ? tr.spacing_m : (tr.cell && tr.cell.u_from != null ? tr.cell.u_to - tr.cell.u_from : null); note(-bd.depth_m / 2, (cutTop + bd.v_to) / 2, app.drag ? 'CREDITED · COUNTED WHEN YOU LET GO' : `CREDITED${tr.share_m3 != null ? ' ' + fmt(tr.share_m3) + ' m³' : ''}${cell != null ? ` × ${fmt(cell, 1)} m CELL` : ''}`, 'soil'); }
  }
  if (replace) note(-bd.depth_m, bd.v_from + 0.25, review ? `DEPTH ${fmt(bd.depth_m, 2)} m` : app.drag && app.drag.kind === 'depth' ? `DEPTH ${fmt(bd.depth_m, 2)} m · LET GO → THE RULE RUNS` : `DEPTH ${fmt(bd.depth_m, 2)} m ↕`, 'ctl');
  if (cutTop > bd.v_from) { const sp = strips.find((x) => uCut >= x.u0 && uCut <= x.u1); note(-bd.depth_m * 0.7, (bd.v_from + cutTop) / 2, wide ? `NOT CREDITED (RED) · ${sp && sp.clearance_m ? fmt(sp.clearance_m, 1) + ' m' : ''} OFF MAIN` : tool ? `NOT CREDITED · ${sp && sp.clearance_m ? fmt(sp.clearance_m, 1) + ' m' : ''} OFF MAIN` : `NOT CREDITED · ${sp && sp.clearance_m ? fmt(sp.clearance_m, 1) + ' m ' : ''}CLEARANCE`, 'red'); }
  if (!tool) { const its = []; for (const it of items) { const m = wide ? its.find((x) => x.t === it.t && Math.abs(x.z - it.z) < 0.03) : null; if (m) m.n++; else its.push({ ...it, n: 1 }); }   /* 03: the same main at the same depth, several times, is one note with a count */
    for (const it of its) note(it.z, it.v, it.n > 1 ? it.t.replace(' · ', ` ×${it.n} · `) : it.t, it.cls || '', !!it.drop); if (!wide) note(-bd.depth_m * 0.45, tr.v + 1.0, `ROOTS · ${form.toUpperCase()} · NOMINAL`, 'grey');
    const bh2 = S.ground && S.ground.borehole; note(-DEPTH + 0.6, (vL + vR) / 2, wide && bh2 && bh2.intervals && bh2.intervals.length ? `NATIVE GROUND · NOT PUBLISHED` : 'NATIVE GROUND · NOT PUBLISHED', 'grey'); }   /* 04 is the instrument: the ground's explanation stays in 03 */
  if (detail) N.sort((a, b) => b.z - a.z); for (const n of N) lab(n.z, n.v, n.t, n.cls, n.drop);
  /* the notes column, in depth order; when a tall tree leaves little ground the whole column lifts so it ends inside the panel (every leader then climbs at the same slope) */
  const ty = y0 + H - TBL + 10;
  if (detail && notes.length) { const top = Math.min(...notes.map((n) => n.y)), need = ly + 2 - (ty - 16); if (need > 0) { const headY = y0 + HEAD + 18; const lift = Math.min(need, Math.max(0, top - headY)); const hb = (n) => n.lines.length * LP; { const availT = (ty - 16) - (top - lift); let tot = notes.reduce((q, n) => q + hb(n), 0) + 2 * notes.length; for (let g = 0; tot > availT && g < 6; g++) { const i = notes.map((n, j) => [n, j]).filter(([n]) => n.drop).map(([, j]) => j).pop(); if (i == null) break; tot -= hb(notes[i]) + 2; notes.splice(i, 1); } }   /* the droppable notes (fixtures, the neighbours, a zero count, the corridors) give way, lowest first, when the text alone cannot fit the sheet */
    const ord = [...notes].sort((a, b) => a.y - b.y); let sumH = 0, sumG = 0; for (let i = 0; i < ord.length; i++) { sumH += hb(ord[i]); if (i) sumG += Math.max(0, ord[i].y - (ord[i - 1].y + hb(ord[i - 1]))); } const avail = (ty - 16) - (top - lift); const f = sumG > 0 ? Math.max(0, Math.min(1, (avail - sumH) / sumG)) : 1; let y = top - lift; for (let i = 0; i < ord.length; i++) { if (i) y += Math.max(0, ord[i].y - (ord[i - 1].y + hb(ord[i - 1]))) * f + hb(ord[i - 1]); ord[i]._y = y; } for (const n of ord) n.y = n._y; ly = y + hb(ord[ord.length - 1]); } }   /* only the gaps between notes compress; a text block keeps its lines */   /* 03: the column lifts to the head, then its spacing compresses so the foot stays inside the sheet */
  { const lift = Math.min(Math.max(0, ly + 2 - (ty - 16)), notes.length ? Math.max(0, Math.min(...notes.map((n) => n.y)) - (y0 + HEAD + 18)) : 0); notesLift = lift; if (!wide) crownNote(); const xc = lx - 22; for (const n of notes) { const y = n.y - lift; g.appendChild(el('path', { class: 'll ' + (n.cls === 'ctl' ? 'ctl' : ''), d: `M${X(n.v).toFixed(1)} ${Z(n.z).toFixed(1)}H${xc}V${y.toFixed(1)}H${lx - 4}` })); n.lines.forEach((l, i) => { const tx = el('text', { class: 's ' + (n.cls || ''), x: lx, y: y + 3.5 + i * LP }); for (const part of l.split(/(\([^)]*\)?|^[^(]*\))/).filter(Boolean)) { const sp = el('tspan', part.startsWith('(') || part.endsWith(')') ? { class: 'cite' } : {}, part); tx.appendChild(sp); } g.appendChild(tx); }); } }
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
    const grips = []; for (const z of [zP, zR]) { if (!zOk(z)) continue; const side = z.side; const far = side === 'property' ? z.v_to : z.v_from; if (far < vR + 0.05 || far > vL - 0.05) continue; const d0 = side === 'property' ? 0.2 : 0.45; const zdd = z.depth_m || bd.depth_m; const xz = X(far), yz = Z(-(d0 + zdd / 2)); const gz = el('g', { class: 'shandle zone' + (dz && dz.side === side ? ' live' : '') });
      gz.appendChild(el('line', { class: 'hunder', x1: xz, y1: Z(-d0), x2: xz, y2: Z(-(d0 + zdd)) })); gz.appendChild(el('line', { class: 'hline', x1: xz, y1: Z(-d0), x2: xz, y2: Z(-(d0 + zdd)) })); gz.appendChild(el('circle', { cx: xz, cy: yz, r: 8 })); gz.appendChild(el('path', { class: 'arrow', d: `M${xz - 14} ${yz}h-9m3-3-3 3 3 3M${xz + 14} ${yz}h9m-3-3 3 3-3 3` }));
      if (!busy) gz.addEventListener('pointerdown', (e) => startDrag(e, 'zone', k, side)); g.appendChild(gz); grips.push(side); }   /* a proposal's far edge is the drawing's to move: a design input, not a site fact (the curb has no handle) */
    g.appendChild(el('text', { class: 'psub swap', x: x0, y: y0 + H - 6 }, grips.length ? 'DRAG · DEPTH ↕ · A ZONE\'S EDGE ⟷ · LET GO: THE RULE RUNS' : 'DRAG THE HANDLE · DEPTH ↕ · LET GO: THE RULE RUNS'));
    if (app.flashAt && performance.now() - app.flashAt < 1600 && !app.drag) { for (const bz of [box(bd.v_from, bd.v_to, 0, bd.depth_m)].concat([zs, zrOk].filter(Boolean).map((z) => box(z.v_from, z.v_to, z.side === 'property' ? 0.2 : 0.45, (z.side === 'property' ? 0.2 : 0.45) + (z.depth_m || bd.depth_m))))) if (bz) g.appendChild(el('rect', { class: 'flash', x: bz.x, y: bz.y, width: bz.w, height: bz.h })); }   /* what the run changed lights once: the ground the hand moved, the number in the readout at the same moment */
    if (app.dragCard || app.armed) { const x1 = X(tr.v) - Math.max(cr * k, 40) - 14, x2 = X(tr.v) + Math.max(cr * k, 40) + 14; g.appendChild(el('rect', { class: 'dropzone hot', x: x1, y: Z(h) - 14, width: x2 - x1, height: Z(-bd.depth_m) - Z(h) + 14, rx: 6 })); g.appendChild(pill(X(tr.v), Z(h) - 30, app.dragCard ? 'DROP THE SPECIES HERE' : 'CLICK HERE TO PLANT IT', true)); }
  }
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
function startDrag(e, kind, k, side) {
  e.preventDefault(); e.stopPropagation(); const S = app.S, st = S.street, bd = S.band.design; const x0 = e.clientX, y0 = e.clientY;
  if (kind === 'zone') {   /* a proposal's far edge: the width follows the hand (the field too), the rule runs on release through the same path as the field */
    const es = extState(S); const v0 = +es[side].width; const md = liveKnobs(S).median; const maxW = md ? +(Math.max(0.5, (side === 'property' ? md.ocN - md.cfN : md.cfF - md.ocF) - 0.5)).toFixed(1) : side === 'property' ? +(st.property_line_v - st.sidewalk_v[0]).toFixed(1) : +(st.curb_face_v - st.centreline_v - 0.5).toFixed(1);
    app.drag = { kind, side, value: v0 }; closeMenu();
    const move = (ev) => { const dx = (ev.clientX - x0) / k; app.drag.value = +Math.max(0.3, Math.min(maxW, side === 'property' ? v0 - dx : v0 + dx)).toFixed(1); if (!app.raf) app.raf = requestAnimationFrame(() => { app.raf = null; draw(); }); };   /* the property side grows leftward on the sheet (toward the house), the road side rightward (toward the centreline) */
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); const d = app.drag; app.drag = null; if (!d) return; if (d.value === v0) { draw(); return; } sendExt(S, side, { width: d.value }); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); return; }
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
  const pf = sc.planFrame(); const k23 = pf.k23; const MARGIN = SHEET.margin; const wx0 = pf.wx0, viewX = pf.viewX, yTop = pf.yTop, yBot = pf.yBotP;   // the plan panel's box: the sheet at 02, the strip at 03
  if (!svg.querySelector('#clip-plan')) { const cp = el('clipPath', { id: 'clip-plan' }); cp.appendChild(el('rect', { id: 'clip-plan-r', x: wx0, y: yTop, width: viewX - wx0, height: yBot - yTop })); defs.appendChild(cp); } else { const r = svg.querySelector('#clip-plan-r'); r.setAttribute('x', wx0); r.setAttribute('y', yTop); r.setAttribute('width', viewX - wx0); r.setAttribute('height', yBot - yTop); }
  const gAll = el('g', { class: 'plan' + (app.hotTree ? ' hot' : '') + (app.panning ? ' panning' : ''), opacity: op });
  const arrEl = app.arriveT0 ? performance.now() - app.arriveT0 : 1e9; const arrive = arrEl < 2600 && !REDUCED; if (arrive) gAll.classList.add('arrive'); const arrDelay = (sec) => (arrive ? `animation-delay:${(sec - arrEl / 1000).toFixed(2)}s` : '');   /* one arrival: the band at 1.0 s after the stage line (the turn has ended), the trees at 1.35 s, the card at 1.45 s */
  const hotEls = new Map(); const hotOn = (id, on) => { const h = hotEls.get(id); if (!h) return; gAll.classList.toggle('hot', on); h.gt.classList.toggle('hot', on); if (h.dot) h.dot.classList.toggle('hot', on); for (const [id2, h2] of hotEls) { const show = on ? id2 === id : h2.sel; if (h2.lbl) h2.lbl.classList.toggle('on', show); if (h2.row) h2.row.classList.toggle('on', show); } };   /* a hover is a class, not a redraw: the crown, the name and the cell's length answer in 150 ms, the rest dims */
  gAll.appendChild(el('rect', { x: 0, y: 0, width: sc.W, height: sc.H, fill: PAPER }));
  const toolK = toolKAt(t);   /* 03 → 04: the plan leaves and the section slides into the workbench over the second half of the move */
  if (toolK > 0.01) gAll.appendChild(el('rect', { x: 0, y: 0, width: sc.W, height: sc.H, fill: '#E6E3D8', opacity: (toolK * 0.22).toFixed(2) }));   /* 04: the board is toned, a workbench and not a sheet */
  const g = el('g', { 'clip-path': 'url(#clip-plan)', opacity: (1 - toolK).toFixed(3), 'pointer-events': toolK > 0.5 ? 'none' : 'all' }); gAll.appendChild(g);   /* 2026-10-12: the ribbon is 03's (switch a tree there); at 04 the cell reads on a bar over the section */
  const panOn = k23 < 0.5 && !pf.fitsA;   /* 02, a long block: the plan is on the chosen tree; drag it sideways, step to a neighbour, or click a dot on the strip above */
  if (panOn) { const pad = el('rect', { class: 'panpad', x: wx0, y: yTop, width: viewX - wx0, height: yBot - yTop }); pad.addEventListener('pointerdown', (e) => startPan(e, sc)); pad.addEventListener('pointerenter', () => { app.hotPlan = true; const h = gAll.querySelector('.panhint'); if (h && !app.pannedOnce) h.classList.add('on'); }); pad.addEventListener('pointerleave', () => { app.hotPlan = false; const h = gAll.querySelector('.panhint'); if (h) h.classList.remove('on'); }); g.appendChild(pad); }   /* the operating hint shows while the hand is on the plan, until the plan has been dragged once */
  // ground, back to front: yards and parcels behind the property line, the road to the curb, the sidewalk, the back boulevard, the band
  const C = S.context || {}; const md = st.median ? medianOf(S, liveKnobs(S).half) : null; const farCurb = C.far_curb_v != null ? C.far_curb_v : curb != null ? 2 * cl - curb : md ? md.ocF : cl - 12; const farPl = st.property_line_far_v != null ? st.property_line_far_v : C.right_of_way && C.right_of_way.width_m ? pl - C.right_of_way.width_m : 2 * cl - pl;   /* the far curb mirrors the near one about the centreline (ASSUMED); the far property line from the City's right-of-way width */
  const vLo = (C.extent ? C.extent.v_from : cl - 40) - 60, vHi = ex.v_to + 60;
  /* the cross streets: the right of way beyond the block's ends, the neighbouring blocks drawn over it */
  for (const [a, b] of [[ex.u_from - 60, blk.u_from], [blk.u_to, ex.u_to + 60]]) rect(g, a, b, vLo, vHi, { class: 'row' });
  for (const ln of C.lanes || []) if (ln.length > 1) g.appendChild(el('polyline', { class: 'lane', points: ln.map(([u, v]) => { const q = P(u, v); return `${q.x},${q.y}`; }).join(' '), 'stroke-width': Math.max(2, 6 * sc.ppmPlan()) }));   /* a lane: 6 m nominal, the blocks beside it cut its edges */
  if (C.blocks && C.blocks.length) for (const r of C.blocks) g.appendChild(poly(r.map(([u, v]) => P(u, v)), { class: 'yard' })); else rect(g, blk.u_from, blk.u_to, pl, pl + 60, { class: 'yard' });
  for (const r of (S.parcels || []).concat(C.parcels || [])) g.appendChild(poly(r.map(([u, v]) => P(u, v)), { class: 'parcel' }));
  if (curb != null) { rect(g, ex.u_from - 60, ex.u_to + 60, farPl, farCurb, { class: 'blvd far' }); rect(g, ex.u_from - 60, ex.u_to + 60, farCurb, curb, { class: 'road' }); rect(g, ex.u_from - 60, ex.u_to + 60, farCurb, curb, { fill: 'url(#p-dots)' }); }
  if (md) {   /* a median: a carriageway each side of it, the boulevards beyond the outer curbs as the far side is drawn (context) */
    rect(g, ex.u_from - 60, ex.u_to + 60, farPl, md.ocF, { class: 'blvd far' }); rect(g, ex.u_from - 60, ex.u_to + 60, md.ocN, pl, { class: 'blvd far' });
    for (const [a, b] of [[md.ocF, md.cfF], [md.cfN, md.ocN]]) { rect(g, ex.u_from - 60, ex.u_to + 60, a, b, { class: 'road' }); rect(g, ex.u_from - 60, ex.u_to + 60, a, b, { fill: 'url(#p-dots)' }); } }
  if (st.sidewalk_v && st.sidewalk_v[0] != null) rect(g, blk.u_from, blk.u_to, st.sidewalk_v[0], st.sidewalk_v[1], { class: 'walk' });
  if (st.back_boulevard_v && st.back_boulevard_v[0] != null) rect(g, blk.u_from, blk.u_to, st.back_boulevard_v[0], st.back_boulevard_v[1], { class: 'yard' });
  const verdict = faceVerdict(S); const kind = verdict && FACE_KIND[verdict];
  const gBd = el('g', { class: 'g-band', style: arrDelay(0.7) });
  if (bd) {
    rect(g, bd.u_from, bd.u_to, bd.v_from, bd.v_to, { class: 'blvd' }); g.appendChild(gBd);                                        // the boulevard itself, grass from curb to sidewalk
    // the soil the rule credits: within each segment, the band above the clearances — the strips are unioned column by
    // column (every 0.25 m), so many overlapping mains give one clean edge; a strip touching the curb side lowers the edge
    const strips = S.band.strips || []; const uLo = blk.u_from, uHi = blk.u_to;   /* the whole block face: at 02 every tree's band is there */
    const cutTop = (u) => { const iv = strips.filter((sp) => u >= sp.u0 && u <= sp.u1).map((sp) => [Math.max(sp.v0, bd.v_from), Math.min(sp.v1, bd.v_to)]).filter((a) => a[1] > a[0]).sort((a, b) => a[0] - b[0]); let top = bd.v_from; for (const [a, b] of iv) { if (a <= top + 0.02) top = Math.max(top, b); else break; } return Math.min(top, bd.v_to); };
    const redEdge = [];
    for (const sg of S.band.segments || []) { const a = Math.max(sg.u_from, uLo), b = Math.min(sg.u_to, uHi); if (b <= a) continue;
      const us = []; for (let u = a; u < b; u += 0.25) us.push(u); us.push(b);
      const lower = us.map((u) => P(u, cutTop(u))), upper = us.map((u) => P(u, bd.v_to));
      const pts = upper.concat(lower.slice().reverse()); gBd.appendChild(poly(pts, { class: 'band' })); if (kind && !app.moving) gBd.appendChild(poly(pts, { fill: `url(#${hatchId(svg, kind, hatchSp(kind, 6, false))})` }));   /* the hatch waits for the camera to settle, as the atlas's does */
      const run = []; us.forEach((u, i) => { if (cutTop(u) > bd.v_from + 0.02) run.push(lower[i]); else if (run.length) { redEdge.push(run.slice()); run.length = 0; } }); if (run.length) redEdge.push(run); }
    for (const run of redEdge) if (run.length > 1) gBd.appendChild(el('polyline', { class: 'cutedge', points: run.map((q) => `${q.x},${q.y}`).join(' ') }));
    const zP = (S.band.zones || []).find((z) => z.side === 'property' && z.status === 'KNOWN');
    if (zP) rect(g, bd.u_from, bd.u_to, zP.v_from, zP.v_to, { class: 'zone', fill: `url(#${hatchId(svg, 'diag', 9)})` });   // structural soil under the sidewalk: a typed design assumption, 45° hatch
  }
  for (const b of S.buildings || []) g.appendChild(poly(b.ring_uv.map(([u, v]) => P(u, v)), { class: 'house' }));
  for (const b of C.buildings || []) g.appendChild(poly(b.ring_uv.map(([u, v]) => P(u, v)), { class: 'house far' }));
  // the lines, in their hierarchy
  line(g, blk.u_from, pl, blk.u_to, pl, 'pl');
  if (st.sidewalk_v && st.sidewalk_v[0] != null) for (const vv of st.sidewalk_v) line(g, blk.u_from, vv, blk.u_to, vv, 'walkedge');
  if (bd) { const gBe = el('g', { class: 'g-band', style: arrDelay(0.7) }); g.appendChild(gBe); for (const vv of [bd.v_from, bd.v_to]) line(gBe, bd.u_from, vv, bd.u_to, vv, 'bandedge'); }
  if (curb != null) { const boc = st.back_of_curb_v != null ? st.back_of_curb_v : curb + (st.widths_m.curb || 0.15); rect(g, ex.u_from - 60, ex.u_to + 60, curb, boc, { class: 'curbstrip' }); line(g, ex.u_from - 60, curb, ex.u_to + 60, curb, 'curb'); line(g, ex.u_from - 60, boc, ex.u_to + 60, boc, 'curbback'); line(g, ex.u_from - 60, farCurb, ex.u_to + 60, farCurb, 'curb far'); }
  if (md) { for (const [cf, boc] of [[md.cfN, md.cfN - md.cw], [md.cfF, md.cfF + md.cw]]) { rect(g, blk.u_from, blk.u_to, cf, boc, { class: 'curbstrip' }); line(g, blk.u_from, cf, blk.u_to, cf, 'curb'); line(g, blk.u_from, boc, blk.u_to, boc, 'curbback'); }   /* the median's two curbs, the block long */
    for (const oc of [md.ocN, md.ocF]) line(g, ex.u_from - 60, oc, ex.u_to + 60, oc, 'curb far'); }   /* the roadway's outer curbs: the City's fixtures, assumed */
  if (st.sidewalk_v && st.sidewalk_v[0] != null && !app.moving) for (let u = Math.ceil(blk.u_from / 1.5) * 1.5; u < blk.u_to; u += 1.5) line(g, u, st.sidewalk_v[0], u, st.sidewalk_v[1], 'score');   // panel joints: a plan convention for concrete, nominal module; not while the camera glides
  line(g, ex.u_from - 60, cl, ex.u_to + 60, cl, 'cl');
  if (bd) for (const tr of S.trees) { const c = tr.cell; if (!c || c.u_from == null) continue; for (const u of [c.u_from, c.u_to]) if (u >= blk.u_from && u <= blk.u_to) line(g, u, bd.v_from, u, bd.v_to, 'cell' + (tr.site_id === (app.pick || (tr.selected ? tr.site_id : null)) ? ' sel' : '')); }   // each tree's cell: half-way to each neighbour
  // the trees: a disc the size of the crown (nominal), the soil the rule gives the tree on a white disc; the followed tree ringed
  const ppm = (() => { const a = sc.axis(0, 0, 0, 1, 0, 0); return Math.hypot(a.d.x, a.d.y); })();   // px per metre
  const have = (tr) => (tr.extensions && tr.extensions.share_total_m3 != null ? tr.extensions.share_total_m3 : tr.share_m3);
  /* the rule's answer per tree, as a colour on its disc: the largest Table 9-2 class its share meets (the same colours as the checked streets on the map) */
  const clsOf = (tr) => (tr.share_status === 'KNOWN' && Array.isArray(tr.benchmark_classes) ? (['Large', 'Medium', 'Small'].find((c) => tr.benchmark_classes.includes(c)) || 'none') : tr.share_status === 'REVIEW_REQUIRED' ? 'review' : 'unknown');
  const sel = S.trees.find((x) => x.selected); let selR = 0; const candP = t >= 3 ? candidateShown(S) : null;   // existing vs proposed: the City's crown as a dashed ring behind the proposed crown
  const pendT0 = app.pending && app.pending.site_id ? S.trees.find((x) => x.site_id === app.pending.site_id) : null; const pickT = (t < 3 && (pickTree(S) || pendT0)) || sel; const pickId = pickT ? pickT.site_id : null; const isP = (tr) => tr.site_id === pickId;   /* the tree in hand: the pick at 02, the running tree at 03, the file's at 04 */
  /* the other public trees of the City in this box (the far side, the cross streets, the medians): context, no card */
  const ctDiscs = [];   /* every disc on the plan (this face's trees and the far side's), so a main's label can stand clear of them */
  for (const t0 of S.trees) { const q = P(t0.u, t0.v); ctDiscs.push([q.x, q.y, Math.max(8, ((t0.crown_diameter_m || 6) / 2) * ppm)]); }
  for (const q0 of C.trees || []) { const q = P(q0[0], q0[1]); if (q.x < wx0 - 20 || q.x > viewX + 20 || q.y < yTop - 20 || q.y > yBot + 20) continue; const r = Math.max(3.5, (q0[2] || 6) * 0.5 / 2 * ppm); ctDiscs.push([q.x, q.y, r]); const gc = el('g', { class: 'ctree' }); gc.appendChild(el('circle', { class: 'crown', cx: q.x, cy: q.y, r })); gc.appendChild(el('title', {}, `${q0[3] || 'public tree'} · ${q0[2] != null ? fmt(q0[2]) + ' m' : ''} · City`)); g.appendChild(gc); }
  const gTr = el('g', { class: 'g-trees', style: arrDelay(0.95) }); g.appendChild(gTr);
  for (const tr of S.trees) {
    const p = P(tr.u, tr.v); const r0 = Math.max(6, (tr.crown_diameter_m || 3) / 2 * ppm); const rP = tr.selected && candP ? Math.max(6, (candP.drawn_height_m || tr.height_m || 6) * (candP.crown_ratio_of_height || 0.6) / 2 * ppm) : r0; const r = rP; if (isP(tr)) selR = r;
    const gt = el('g', { class: 'tree' + (isP(tr) ? ' sel' : '') + (app.hotTree === tr.site_id ? ' hot' : '') });
    if (tr.selected && candP) gt.appendChild(el('circle', { class: 'cityring', cx: p.x, cy: p.y, r: r0 }));
    gt.appendChild(el('circle', { class: 'shadow', cx: p.x + r * 0.07 + 2, cy: p.y + r * 0.09 + 2, r }));
    gt.appendChild(el('circle', { class: 'crown', cx: p.x, cy: p.y, r }));
    gt.appendChild(el('circle', { class: 'core', cx: p.x - r * 0.06, cy: p.y - r * 0.08, r: r * 0.58 }));
    if (isP(tr)) gt.appendChild(el('circle', { class: 'ring', cx: p.x, cy: p.y, r: r + 5 }));
    const showNum = k23 < 0.5 && (isP(tr) || t >= 3);   /* the number on the tree in hand; a hovered tree says it in its label */ const rd = showNum ? Math.max(13, Math.min(17, r * 0.4)) : Math.max(4.5, Math.min(9, r * 0.3)); const shown2 = tr.selected && candP && candP.usable_m3 != null ? candP.usable_m3 : have(tr);
    gt.appendChild(el('circle', { class: 'num ' + (showNum ? 'open' : 'cls') + ' ' + clsOf(tr), cx: p.x, cy: p.y, r: rd, fill: FACE_COL[clsOf(tr)] || FACE_COL.unknown })); if (showNum && (shown2 != null || clsOf(tr) !== 'review')) gt.appendChild(el('text', { x: p.x, y: p.y + 4 }, shown2 != null ? fmt(shown2) : '?'));   /* a review disc says it with its edge, not a question mark */   /* the disc is the answer (colour); the number only on the tree in hand */
    if (t < 3) {                                                                                      // selecting a tree belongs to 02–03; in the scenario builder the trees are read-only
      gt.addEventListener('pointerenter', () => { app.hotTree = tr.site_id; hotOn(tr.site_id, true); });
      gt.addEventListener('pointerleave', () => { if (app.hotTree === tr.site_id) app.hotTree = null; hotOn(tr.site_id, false); });
      gt.addEventListener('pointerdown', (e) => { e.stopPropagation(); app.treeDown = { id: tr.site_id, x: e.clientX, y: e.clientY }; });   // pointerup, not click: a hover redraws the overlay, so down and up land on different nodes and 'click' never fires
      gt.addEventListener('pointerup', (e) => { e.stopPropagation(); const d = app.treeDown; app.treeDown = null; if (!d || d.id !== tr.site_id || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return; if (app.busy) return; if (stage(app.t) === 1) { if (isP(tr)) goStage(2); else { app.pick = tr.site_id; app.pan = 0; app.pulse = { u: tr.u, v: tr.v }; app.resKey = ''; app.ctlKey = ''; app.hotTree = null; draw(); } } else if (!tr.selected) { app.pan = 0; app.pulse = { u: tr.u, v: tr.v }; draw(); evaluate({ site_id: tr.site_id }); } });   /* 02: a click chooses the tree at once (its card fills the right column, no run); a second click on it goes to its ground, where the rule runs for it */
    } else gt.style.cursor = 'default';
    gTr.appendChild(gt); hotEls.set(tr.site_id, { gt, sel: isP(tr) });
    if (t < 3 && k23 < 0.5) { const sr = tr.species_ref; const gl = el('g', { class: 'lbl' + (isP(tr) ? ' sel' : '') + (isP(tr) ? (app.hotTree && app.hotTree !== tr.site_id ? '' : ' on') : app.hotTree === tr.site_id ? ' on' : '') }); const vt = tr.share_status === 'KNOWN' && tr.share_m3 != null ? `, ${fmt(tr.share_m3)} of ${tr.required_m3} m³` : tr.share_status === 'REVIEW_REQUIRED' ? ', manual review' : ''; const txtL = `${sr ? sr.common.toUpperCase() : tr.genus}, ${fmt(tr.height_m)} m${vt}${isP(tr) ? ', chosen' : ''}`; const xl = Math.max(wx0 + 150, Math.min(viewX - 150, p.x)), yl = Math.min(yBot - 8, Math.max(p.y + r + 18, P(tr.u, curb - 3.2).y + 24)), wl = txtL.length * 7.2 + 16; gl.appendChild(el('rect', { class: 'bg', x: xl - wl / 2, y: yl - 12, width: wl, height: 17, rx: 8.5 })); gl.appendChild(el('text', { x: xl, y: yl, 'text-anchor': 'middle' }, txtL)); gAll.appendChild(gl); hotEls.get(tr.site_id).lbl = gl; }
  }
  if (panOn && pickT) { const row = S.trees.slice().sort((a, b) => a.u - b.u); const i = row.indexOf(pickT); const yN = yBot + 16;   /* a row under the plan's frame; the scale bar moves down to make room */
    const nmOf = (nb) => ((nb.species_ref && nb.species_ref.common) || nb.genus || '').toUpperCase().slice(0, 26); const wOf = (nb) => (nb ? (nmOf(nb).length + 2) * 7.2 + 18 : 0); const free = (viewX - wx0) - wOf(row[i - 1]) - wOf(row[i + 1]) - 40;
    if (free > 120) gAll.appendChild(el('text', { class: 'ps panhint' + (app.hotPlan && !app.pannedOnce ? ' on' : ''), x: (wx0 + wOf(row[i - 1]) + viewX - wOf(row[i + 1])) / 2, y: yN, 'text-anchor': 'middle' }, free > 280 ? 'drag the plan, or step to a neighbour' : 'drag'));   /* the hint only where it fits between the arrows, and only while the hand is on the plan */
    const maxNav = ((viewX - wx0) - 40) / 2;   /* each arrow may take half the plan's width; a longer name is cut */
    for (const [nb, side] of [[row[i - 1], 'prev'], [row[i + 1], 'next']]) { if (!nb) continue; let nm = ((nb.species_ref && nb.species_ref.common) || nb.genus || '').toUpperCase().slice(0, 26); while ((nm.length + 3) * 7.2 + 18 > maxNav && nm.length > 5) nm = nm.replace(/…$/, '').slice(0, -1).trimEnd() + '…'; const txt = side === 'prev' ? `◂ ${nm}` : `${nm} ▸`; const w = txt.length * 7.2 + 18; const x = side === 'prev' ? wx0 + 10 + w / 2 : viewX - 10 - w / 2;
      const gn = el('g', { class: 'nav' + (app.busy ? ' off' : '') }); gn.appendChild(el('rect', { class: 'bg', x: x - w / 2, y: yN - 12, width: w, height: 17, rx: 8.5 })); gn.appendChild(el('text', { x, y: yN, 'text-anchor': 'middle' }, txt));
      gn.addEventListener('pointerdown', (e) => e.stopPropagation()); gn.addEventListener('click', (e) => { e.stopPropagation(); if (app.busy) return; app.pan = 0; app.pulse = { u: nb.u, v: nb.v }; if (stage(app.t) === 1) { app.pick = nb.site_id; app.resKey = ''; app.ctlKey = ''; draw(); } else { draw(); evaluate({ site_id: nb.site_id }); } }); gAll.appendChild(gn); } }
  const SURF = { street_lighting_pole: 'pole', sewer_catch_basin: 'cb', manhole: 'mh', valve: 'valve', hydrant: 'hyd' };
  const gs = el('g', { class: 'surface' }); const seenKinds = new Set();
  for (const f of S.facilities) { const k = SURF[f.kind]; if (!k || !f.path_uv || f.path_uv.length !== 1) continue; const [u, v] = f.path_uv[0]; const q = P(u, v); if (q.x < wx0 || q.x > viewX || q.y < 0 || q.y > sc.H) continue; seenKinds.add(k); gs.appendChild(symbol(k, q.x, q.y, f.label)); }
  /* the ground: every main, conduit and corridor the City records, drawn in plan with the section's grades (record · derived · nominal · depth not published); each names itself on hover */
  const mainRows = [];   /* the along-street mains name themselves in the west column with the street's parts (never over the drawing) */
  { const gM = el('g', { class: 'mains' }); const GR = (f) => (f.depth_top_m == null ? 'unknown' : (f.grade || 'record')); const labs = [];
    for (const f of S.facilities || []) { const pu = f.path_uv; if (!pu || pu.length < 2) continue; const pts = pu.map(([u, v]) => P(u, v)); if (!pts.some((q) => q.x > wx0 - 8 && q.x < viewX + 8 && q.y > yTop - 8 && q.y < yBot + 8)) continue;
      const w = f.kind === 'corridor' ? Math.max(3, 0.8 * ppm) : Math.max(1, Math.min(4, (f.diameter_mm || 150) / 1000 * ppm)); const ln = el('polyline', { class: `main ${GR(f)} ${f.kind}`, points: pts.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' '), 'stroke-width': w.toFixed(1) }); ln.appendChild(el('title', {}, f.label || f.kind)); gM.appendChild(ln);
      const vs = pu.map((q) => q[1]), us = pu.map((q) => q[0]); if (k23 < 0.5 && Math.max(...vs) - Math.min(...vs) < 1.5 && Math.max(...us) - Math.min(...us) > 8) labs.push({ f, v: (Math.max(...vs) + Math.min(...vs)) / 2, x0: Math.min(...pts.map((q) => q.x)), x1: Math.max(...pts.map((q) => q.x)) }); }
    const roadLabs = []; if (labs.length && !app.moving) { const groups = new Map(); const inBand = (v) => curb != null && v >= curb - 0.3 && v <= pl + 0.5;
      for (const L of labs) { if (L.f.kind === 'sewer_service') continue; const key = `${L.f.kind}|${GR(L.f)}|${inBand(L.v) ? 'b' : 'r'}`; const G = groups.get(key); if (!G) groups.set(key, { f: L.f, vs: [L.v], x1: L.x1, ds: L.f.depth_top_m == null ? [] : [L.f.depth_top_m], dia: new Set(L.f.diameter_mm ? [L.f.diameter_mm] : []), n: 1 }); else { G.vs.push(L.v); G.x1 = Math.max(G.x1, L.x1); if (L.f.depth_top_m != null) G.ds.push(L.f.depth_top_m); if (L.f.diameter_mm) G.dia.add(L.f.diameter_mm); G.n += 1; } }   /* one name per kind and grade: SEWER ×4, 2.0–4.2 m, derived */
      for (const G of groups.values()) { const f = G.f; const v = G.vs.sort((a, b) => a - b)[Math.floor(G.vs.length / 2)]; const gr = GR(f); const lab = (f.label || '').toLowerCase();
        const base = f.kind === 'corridor' ? (lab.includes('gas') ? 'GAS CORRIDOR' : lab.includes('hydro') || lab.includes('electric') ? 'HYDRO CORRIDOR' : lab.includes('tele') ? 'TELECOM CORRIDOR' : 'CORRIDOR') : f.kind === 'water_main' ? 'WATER' : f.kind === 'water_main_abandoned' ? 'ABANDONED WATER' : f.kind === 'sewer_main' ? 'SEWER' : f.kind === 'electrical_conduit' ? 'LIGHT CONDUIT' : f.kind.replace(/_/g, ' ').toUpperCase().slice(0, 16);
        const nm = base + (G.n > 1 ? ` ×${G.n}` : G.dia.size === 1 ? ` ${[...G.dia][0]}` : ''); const ds = G.ds.slice().sort((a, b) => a - b);
        const depth = f.kind === 'corridor' ? 'cover nominal' : !ds.length ? 'depth not published' : ds.length > 1 && fmt(ds[0], 1) !== fmt(ds[ds.length - 1], 1) ? `${fmt(ds[0], 1)}–${fmt(ds[ds.length - 1], 1)} m` : `${fmt(ds[0], 1)} m`; const suffix = f.kind === 'corridor' || !ds.length ? '' : gr === 'record' ? '' : gr === 'derived' ? ', derived' : ', nominal';
        const SHORT = { 'GAS CORRIDOR': 'GAS CORR.', 'HYDRO CORRIDOR': 'HYDRO CORR.', 'TELECOM CORRIDOR': 'TELECOM', 'ABANDONED WATER': 'ABANDONED', 'LIGHT CONDUIT': 'LIGHT COND.' }; const nmS = (SHORT[base] || base) + (G.n > 1 ? ` ×${G.n}` : '');
        if (inBand(v)) mainRows.push([v, nmS, `${depth}${suffix}`, 'main']);   /* in the boulevard, where it takes the band's width: a row in the west column */
        else roadLabs.push({ f, v, x1: G.x1, txt: `${nm}, ${depth}${suffix}` }); }   /* under the road or the far side: named on its line at the east end, over asphalt only */
      roadLabs.sort((a, b) => P(0, a.v).y - P(0, b.v).y); let ly2 = -1e9;
      for (const r of roadLabs) { const y0 = P(0, r.v).y - 3; const y = Math.max(y0, ly2 + 11); if (y < yTop + 10 || y > yBot - 4) continue; ly2 = y; let x = Math.min(viewX - 10, r.x1 - 8); if (x < wx0 + 120) continue;
        let yL = y; { const tw = r.txt.length * 6.2; const clear = (xe, yy) => !ctDiscs.some(([cx, cy, cr]) => cx + cr > xe - tw - 4 && cx - cr < xe + 4 && Math.abs(cy - yy) < cr + 7); let xe = x, n = 0; while (!clear(xe, y) && n < 14 && xe - tw > wx0 + 130) { xe -= 48; n++; } if (clear(xe, y)) x = xe; else if (clear(x, y0 - 13) && y0 - 13 > yTop + 10) yL = y0 - 13; else if (clear(x, y0 + 16) && y0 + 16 < yBot - 4) yL = y0 + 16; }   /* step west until no disc lies under the label (the walk of 2026-10-13: "SEWER ×2" over the discs) */
        if (yL - y0 > 3) gM.appendChild(el('path', { class: 'mlead', d: `M${(x + 4).toFixed(1)} ${(y0 + 3).toFixed(1)}V${(yL - 2).toFixed(1)}h-3`, opacity: (1 - k23).toFixed(2) }));
        gM.appendChild(el('text', { class: 'mlab ' + GR(r.f), x, y: yL, 'text-anchor': 'end', opacity: (1 - k23).toFixed(2) }, r.txt)); } }
    g.appendChild(gM); }
  g.appendChild(gs);
  if (k23 < 0.5 && ppm >= 5) { const ga = el('g', { class: 'addr', opacity: (1 - k23).toFixed(2) }); for (const [u, v, num] of C.addresses || []) { if (!num) continue; const q = P(u, v); if (q.x < wx0 + 8 || q.x > viewX - 8 || q.y < yTop + 8 || q.y > yBot - 4) continue; ga.appendChild(el('text', { x: q.x, y: q.y + 3.5, 'text-anchor': 'middle' }, num)); } g.appendChild(ga); }   /* the City's address points: the civic number on each house */
  { const fn = app.foundNote; const m = fn && fn.q ? String(fn.q).toUpperCase().match(/^(\d+[A-Z]?)\s+(.+)$/) : null; const hit = m && C.addresses ? C.addresses.find((a) => a[2] === m[1] && (a[3] || '').toUpperCase() === m[2]) : null;
    if (hit && k23 < 0.5) { const house = (S.buildings || []).concat(C.buildings || []).find((b) => inPoly(b.ring_uv, hit[0], hit[1])); const q = P(hit[0], hit[1]); const gh = el('g', { class: 'mine', opacity: (1 - k23).toFixed(2) });
      if (house) { const hp = house.ring_uv.map(([u, v]) => P(u, v)); gh.appendChild(poly(hp, { class: 'house mine' })); const yl = Math.min(...hp.map((z) => z.y)) - 8; if (yl > yTop + 12 && q.x > wx0 + 60 && q.x < viewX - 60) gh.appendChild(el('text', { class: 'minel', x: q.x, y: yl, 'text-anchor': 'middle' }, `YOUR ADDRESS · ${hit[2]}`)); }
      else gh.appendChild(el('circle', { class: 'minedot', cx: q.x, cy: q.y, r: 6 }));
      g.appendChild(gh); } }   /* the address the user typed: its house outlined and named, so the tree in front of it is theirs */
  for (const cs of st.cross_streets || []) { if (!cs || !cs.name) continue; const u = cs.u != null ? cs.u : null; if (u == null) continue; const q = P(u, farCurb + ((curb != null ? curb : cl) - farCurb) * 0.22); if (q.x < wx0 + 12 || q.x > viewX - 12 || q.y < yTop || q.y > yBot) continue; g.appendChild(el('text', { class: 'xst', x: q.x, y: q.y, 'text-anchor': 'middle', transform: `rotate(-90 ${q.x} ${q.y})` }, cs.name)); }
  if (app.pulse) { const q = P(app.pulse.u, app.pulse.v); const c = el('circle', { class: 'pulse', cx: q.x, cy: q.y, r: 8 }); if (!REDUCED) { c.appendChild(el('animate', { attributeName: 'r', from: 8, to: 70, dur: '.5s', fill: 'freeze' })); c.appendChild(el('animate', { attributeName: 'opacity', from: .9, to: 0, dur: '.5s', fill: 'freeze' })); } g.appendChild(c); setTimeout(() => { app.pulse = null; }, 600); }
  // the chunk: full strength inside, the surround faded, the outline in the ring's green
  const cU = [[sl.u0, sl.v0], [sl.u1, sl.v0], [sl.u1, sl.v1], [sl.u0, sl.v1]].map(([u, v]) => P(u, v));
  g.appendChild(el('path', { class: 'fade', d: `M0 0H${sc.W}V${sc.H}H0Z M` + cU.map((q) => `${q.x} ${q.y}`).join('L') + 'Z', 'fill-rule': 'evenodd', opacity: 1 - smooth((t - 0.78) / 0.2) }));   // the chunk reads during the dive only; on the sheet (02–04) the plan is one even drawing, no wash with a hard edge
  // the sheet: everything beside the drawing waits until the camera has arrived
  const gSheet = el('g', { class: 'sheet', opacity: smooth((t - 1.25) / 0.12) });   /* the sheet's furniture waits for the turn: the drawing turns, then it is annotated */ gAll.appendChild(gSheet);
  const replace = t >= 3, review = false;   // 04 the scenario builder: the same section, now with its handles and choosers
  const pendTree = app.pending && app.pending.site_id ? S.trees.find((x) => x.site_id === app.pending.site_id) : null; const shown = (!replace && pendTree) || sel;   /* the section is always the chosen tree's (the clicked tree's at once, while its run is on); a hover never changes it */
  // the plan panel's title, scale bar and north
  const gP = el('g', { opacity: ((1 - toolK) * (1 - k23)).toFixed(3) }); gSheet.appendChild(gP);   /* the plan's sheet furniture goes with the plan; the strip at 03 keeps only its title and the trees */
  { const gT = el('g', { opacity: (1 - toolK).toFixed(3) }); gSheet.appendChild(gT); const t04 = toolK > 0.5; const selT = S.trees.find((x) => x.selected); const cellT = selT && selT.cell && selT.cell.u_from != null ? selT.cell.u_to - selT.cell.u_from : null; gT.appendChild(el('text', { class: 'ptitle', x: wx0, y: yTop - 26 }, t04 ? 'THE BLOCK FACE' : 'PLAN'));
    gT.appendChild(el('text', { class: 'psub', x: wx0 + (t04 ? 140 : 52), y: yTop - 26 }, `${S.title.hblock}, ${S.title.side.toUpperCase()}`));
    gT.appendChild(el('text', { class: 'psub', x: wx0, y: yTop - 9 }, t04 ? `this tree's cell ${cellT != null ? fmt(cellT, 1) + ' m' : ''} · click a tree to switch` : k23 < 0.5 ? `${S.trees.length} trees; click one and its card is on the right` : `the whole block face, ${S.trees.length} trees; click one to switch`)); }   /* 04: the ribbon's job here is the cell and the switch */
  { const m5 = 5 * ppm; const bx = viewX - 2 * m5 - 64, by = yBot + (panOn ? 62 : 22);   /* the scale bar under the plan, at its right, whatever the scale; north beside it */ gP.appendChild(el('rect', { class: 'bar', x: bx, y: by, width: m5, height: 4 })); gP.appendChild(el('rect', { class: 'bar alt', x: bx + m5, y: by, width: m5, height: 4 }));
    [[0, '0'], [m5, '5'], [2 * m5, '10 m']].forEach(([dx, t2]) => gP.appendChild(el('text', { class: 'ps', x: bx + dx, y: by - 5, 'text-anchor': dx ? 'middle' : 'start' }, t2)));
    const nv = sc.northUV || { x: S.frame.along_unit_xy[1], y: S.frame.property_unit_xy[1] }; const axN = sc.axis(0, 0, 0, nv.x, nv.y, 0); const ang = Math.atan2(axN.d.x, -axN.d.y) * 180 / Math.PI; const degT = Math.round(Math.abs(ang)); if (degT > 15) gP.appendChild(el('text', { class: 'ps', x: viewX - 4, y: by + 17, 'text-anchor': 'end' }, `the map turned ${degT}°, north is ${degT > 135 ? 'down the page' : ang > 0 ? 'to the right' : 'to the left'}`));   /* the direction the visitor came from: the map was north-up, the plan is street-up */ const gn = el('g', { class: 'key', transform: `translate(${viewX - 14} ${by - 2}) rotate(${ang})` }); gn.appendChild(el('path', { class: 'north', d: 'M0 -14L4.5 5L0 1.5L-4.5 5Z' })); gn.appendChild(el('text', { x: 0, y: -18, 'text-anchor': 'middle' }, 'N')); gP.appendChild(gn); }
  // zone labels on the west paper, level leaders to the drawing's edge (the plan explains the street; the numbers are the file's)
  { const laneV = (() => { const ls = (C.lanes || []).filter((ln) => ln.length > 1 && Math.abs(ln[0][1] - ln[ln.length - 1][1]) < 4 && ln[0][1] > pl + 10 && Math.max(ln[0][0], ln[ln.length - 1][0]) > blk.u_from && Math.min(ln[0][0], ln[ln.length - 1][0]) < blk.u_to); return ls.length ? ls.reduce((a, ln) => a + (ln[0][1] + ln[ln.length - 1][1]) / 2, 0) / ls.length : null; })();   /* a lane running behind this block */
    const rows = (md ? [laneV != null && [laneV, 'LANE', null], [pl, 'PROPERTY LINE', null], [(md.ocN + md.cfN) / 2, 'ROAD', `${fmt(md.ocN - md.cfN, 1)} m to the outer curb${md.ocKnown[0] ? '' : ', assumed'}`], [md.cfN, 'CURB', `${fmt(md.h, 1)} m from the median\'s centre`], [md.c + 0.001, 'MEDIAN', `${fmt(md.h, 1)} × 2 m`], bd && [(bd.v_from + bd.v_to) / 2 - 0.001, 'THE BAND', `${fmt(bd.v_to - bd.v_from, 2)} × ${fmt(bd.depth_m, 2)} m`], [md.cfF, 'CURB', `${fmt(md.h, 1)} m from the median\'s centre`], [(md.ocF + md.cfF) / 2, 'ROAD', `${fmt(md.cfF - md.ocF, 1)} m to the outer curb${md.ocKnown[1] ? '' : ', assumed'}`]]
      : [laneV != null && [laneV, 'LANE', null], [pl, 'PROPERTY LINE', null], st.sidewalk_v && st.sidewalk_v[0] != null && [(st.sidewalk_v[0] + st.sidewalk_v[1]) / 2, 'SIDEWALK', `${fmt(st.widths_m.sidewalk_clear, 2)} m`], bd && [(bd.v_from + bd.v_to) / 2, 'THE BAND', `${fmt(bd.v_to - bd.v_from, 2)} × ${fmt(bd.depth_m, 2)} m`], curb != null && [curb, 'CURB', `${fmt(curb - cl, 1)} m from ℄`], [curb != null ? (curb + farCurb) / 2 : cl, 'ROAD', curb != null ? `${fmt(curb - farCurb, 1)} m curb to curb` : null], curb != null && [farCurb, 'FAR CURB', 'assumed, mirrored about ℄']]).filter(Boolean).concat(k23 < 0.5 ? mainRows : []).sort((a, b) => b[0] - a[0]);   /* top to bottom: the street's parts and, in grey, the City's mains under them */
    const xr = wx0 - 28, xc = wx0 - 14; const laid = []; let ly = -1e9, prevSub = false;   /* labels end at one edge; a bent leader runs from the text to the dot on the plan's edge, so a label pushed down still points at its line */
    for (const [v, name, sub, cls] of rows) { const yd = P(0, v).y; if (yd < yTop - 60 || yd > yBot + 60) continue; const y = Math.max(yd, ly + (prevSub ? 31 : 21)); ly = y; prevSub = !!sub; laid.push({ yd, y, name, sub, cls }); }
    for (let i = laid.length - 1, lim = yBot - 4; i >= 0; i--) { const r = laid[i]; const bot = r.y + (r.sub ? 15 : 6); if (bot > lim) r.y -= bot - lim; lim = r.y - 15; }   /* the foot: rows that would fall off the sheet are pushed up, never dropped */
    for (const r of laid) { if (r.y < yTop + 10) continue; const gl = el('g', { class: 'zl' + (r.cls ? ' ' + r.cls : '') }); gl.appendChild(el('path', { class: 'lead', d: `M${xr + 6} ${r.y}H${xc}V${r.yd}H${wx0 - 3}` })); gl.appendChild(el('circle', { cx: wx0 - 3, cy: r.yd, r: 2.2 })); gl.appendChild(el('text', { x: xr, y: r.y + (r.sub ? -3 : 3), 'text-anchor': 'end' }, r.name)); if (r.sub) gl.appendChild(el('text', { class: 'sub', x: xr, y: r.y + 11, 'text-anchor': 'end' }, r.sub)); gP.appendChild(gl); } }
  // each tree's cell, a level dimension string on the back boulevard: the length of band the rule reads for that tree — shown for the tree in hand only
  const vS0 = st.back_boulevard_v && st.back_boulevard_v[0] != null ? (st.back_boulevard_v[0] + st.back_boulevard_v[1]) / 2 : md ? md.cfN + 1.3 : null;   /* a median: the string sits on the near carriageway, just off the curb */
  if (vS0 != null && bd) {
    const vS = vS0; const gsd = el('g', { class: 'dim spacing' });
    gsd.setAttribute('opacity', (1 - k23).toFixed(3));   /* the cell lengths belong to the plan at 02, not to the strip */
    const row = S.trees.filter((tr) => tr.cell && tr.cell.u_from != null).sort((a, b) => a.u - b.u);
    for (const tr of row) { const gRow = el('g', { class: 'cellrow' + (isP(tr) || app.hotTree === tr.site_id ? ' on' : '') });
      for (const u of [tr.cell.u_from, tr.cell.u_to]) { const a = P(u, bd.v_to), b = P(u, vS); gRow.appendChild(el('line', { class: 'ext', x1: a.x, y1: a.y, x2: b.x, y2: b.y - 6 })); gRow.appendChild(el('line', { class: 'tick', x1: b.x - 4, y1: b.y + 4, x2: b.x + 4, y2: b.y - 4 })); }
      const a = P(tr.cell.u_from, vS), b = P(tr.cell.u_to, vS); gRow.appendChild(el('line', { class: 'chain', x1: a.x, y1: a.y, x2: b.x, y2: b.y })); gRow.appendChild(el('text', { x: (a.x + b.x) / 2, y: a.y - 6, 'text-anchor': 'middle' }, `${fmt(tr.cell.u_to - tr.cell.u_from, 2)} m`));
      gsd.appendChild(gRow); const h = hotEls.get(tr.site_id); if (h) h.row = gRow; }
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
    if (Math.abs(app.cutU || 0) >= 0.05) gs2.appendChild(el('text', { class: 'ps', x: a.x + 12, y: a.y - 12 }, `${app.cutU > 0 ? '+' : '−'}${fmt(Math.abs(app.cutU), 1)} m`)); else if (t < 3) gs2.appendChild(el('text', { class: 'ps cuthint' + (app.hotCut ? ' on' : ''), x: a.x + 12, y: a.y - 12 }, 'drag A–A along the street; the cut picks the tree'));
    gs2.addEventListener('pointerenter', () => { app.hotCut = true; const h = gs2.querySelector('.cuthint'); if (h) h.classList.add('on'); }); gs2.addEventListener('pointerleave', () => { app.hotCut = false; const h = gs2.querySelector('.cuthint'); if (h) h.classList.remove('on'); });   /* the cut's hint shows while the hand is on it */
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
    gN.appendChild(el('text', { class: 'h', x: nx0, y: yTop + 13 }, `The block face, ${S.trees.length} trees; click one`));
    gN.appendChild(el('line', { class: 'face', x1: nx0, y1: ny + 6, x2: nx1, y2: ny + 6 }));
    gN.appendChild(el('rect', { class: 'win', x: Math.max(nx0 - 2, uToX(uL)), y: ny - 1, width: Math.max(6, Math.min(nx1 + 2, uToX(uR)) - Math.max(nx0 - 2, uToX(uL))), height: 14, rx: 2 }));
    { const xa = uToX(shown.u + (app.cutU || 0)); gN.appendChild(el('line', { class: 'cut', x1: xa, y1: ny - 4, x2: xa, y2: ny + 16 })); }
    for (const q of S.trees) { const c = el('circle', { class: 'dot' + (q.selected ? ' sel' : '') + (q.site_id === app.hotTree ? ' hot' : ''), cx: uToX(q.u), cy: ny + 6, r: q.selected ? 5 : 3.2 }); c.appendChild(el('title', {}, `${(q.species_ref && q.species_ref.common) || q.genus}, ${fmt(q.height_m)} m`)); gN.appendChild(c); const h = hotEls.get(q.site_id); if (h) h.dot = c; }
    gN.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); if (app.busy) return; const r0 = $('overlay').getBoundingClientRect(); const x = e.clientX - r0.left; const hit = S.trees.slice().sort((a2, b2) => Math.abs(uToX(a2.u) - x) - Math.abs(uToX(b2.u) - x))[0];
      if (hit && Math.abs(uToX(hit.u) - x) <= 7) { if (!hit.selected) { app.pan = 0; app.pulse = { u: hit.u, v: hit.v }; draw(); evaluate({ site_id: hit.site_id }); } return; }   /* a dot: that tree */
      const pf = sc.planFrame(); const half = planWAt(app.t) / 2 / pf.ppm; const cB = (sc.slab.u0 + sc.slab.u1) / 2; const lo2 = blk2.u_from + half - 8 - cB, hi2 = blk2.u_to - half + 8 - cB; const clampP = (pp) => (lo2 > hi2 ? 0 : Math.max(lo2, Math.min(hi2, pp)));
      const setTo = (cx) => { app.pan = clampP(xToU(cx) - cB); sc._pf = null; sc.setStop(app.t); requestDraw(); }; setTo(x);   /* elsewhere: the window goes there and follows the hand */
      const mv = (ev) => setTo(ev.clientX - r0.left); const up2 = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up2); draw(); }; window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up2); });
    gAll.appendChild(gN); }
  if (t < 2) { const yk = sc.H - 22; let kx = wx0; gP.appendChild(el('text', { class: 'ps', x: kx, y: yk }, 'The disc, the largest tree the band carries here')); kx += 296;   /* the key to the discs, then to the City's records at grade: one row */
    for (const [k2, w2] of [['Large', 'Large'], ['Medium', 'Medium'], ['Small', 'Small'], ['none', 'none'], ['review', 'manual review'], ['unknown', 'no record']]) { if (k2 === 'review' && !S.trees.some((x) => x.share_status === 'REVIEW_REQUIRED')) continue; if (k2 === 'unknown' && !S.trees.some((x) => clsOf(x) === 'unknown')) continue; gP.appendChild(el('circle', { cx: kx + 5, cy: yk - 4, r: 5, fill: FACE_COL[k2], stroke: 'rgba(30,45,35,.5)', 'stroke-width': .8 })); gP.appendChild(el('text', { class: 'ps', x: kx + 15, y: yk }, w2)); kx += 15 + w2.length * 6.6 + 18; }
    if (seenKinds.size) { const KEY = { pole: 'lighting pole', cb: 'catch basin, approx.', mh: 'manhole', valve: 'water valve', hyd: 'hydrant' }; kx += 20; gP.appendChild(el('text', { class: 'ps', x: kx, y: yk }, 'At grade, City records')); kx += 150; for (const k of seenKinds) { gP.appendChild(symbol(k, kx + 6, yk - 4)); gP.appendChild(el('text', { class: 'ps', x: kx + 18, y: yk }, KEY[k])); kx += 24 + KEY[k].length * 6.6 + 24; } } }
  // the section panel
  const secOn = secOnAt(t);   /* the section: beside the plan from a click or from 03; alone on the sheet at 04 */
  const wx03 = SHEET.rail + SHEET.west; const x03 = wx03, W03 = sc.W - 10 - SHEET.eastRec - x03, y03 = SHEET.head + STRIP_H + 26, H03 = sc.H - y03 - 22; const b4 = box04(sc); const x04 = b4.x, W04 = b4.W, y04 = b4.y, H04 = b4.H;   /* 03: under the strip, the record column kept clear · 04: between the inputs and the outputs */
  const kq = toolK < 0.5 ? 0 : 1;   /* the section is built for 03 or for 04, never for a frame in between: a rebuild of both cuts on every glide frame was the lag at 04; the layer crossfades instead */
  /* 02: the section is a small drawing in the column under the chosen tree's card; SEE ITS GROUND grows it into the sheet (03), the plan shrinking into the strip at the same time */
  const x02 = x03 + W03 * 0.06, W02 = W03 * 0.88, y02 = y03 + 56, H02 = H03 * 0.88;   /* where the section rises from as 03 opens (it is not on the 02 sheet: 02 is the plan and the card) */
  const kq23 = 1; const mini = false;
  const x0s = kq ? x04 : lerp(x02, x03, kq23); const Ws = kq ? W04 : lerp(W02, W03, kq23); const y0s = kq ? y04 : lerp(y02, y03, kq23); const Hs = kq ? H04 : lerp(H02, H03, kq23);   /* the built geometry: 02's stamp, 03's sheet or 04's instrument (A–A above, B–B below) */
  const box = toolK > 0 ? { x: lerp(x03, x04, toolK), y: lerp(y03, y04, toolK), W: lerp(W03, W04, toolK), H: lerp(H03, H04, toolK) } : { x: lerp(x02, x03, k23), y: lerp(y02, y03, k23), W: lerp(W02, W03, k23), H: lerp(H02, H03, k23) };   /* where the section is seen this frame: the built drawing is carried there by a transform, so 02 → 03 → 04 is one continuous move */
  sectionLayer(sc, S, t, shown, replace || kq === 1, review, x0s, y0s, Ws, Hs, kq, op * (1 - 0.25 * Math.sin(Math.PI * toolK)), secOn, box, mini);   /* built once for the workbench (handles included) when the layout flips, not again at the stage line */
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
  void quick;   /* the hatches are gone: the colour alone carries the rule's answer (one legend); the share of Table 9-3 species is in the hover tip */
  { const kBnd = Math.max(0.4, ka) * (1 - smooth((900 - hw) / 320)); if (kBnd > 0.02) { const gb2 = el('g', { opacity: kBnd.toFixed(2) }); for (const a of sc.areaInfo) { const pts = a.ring.map(([u, v]) => sc.project(u, v, 0)); gb2.appendChild(poly(pts, { class: 'abound' })); } g.appendChild(gb2); } }   /* the local-area boundaries: the city is read by them; they thin at the area level and are gone at the block level, where one would cross the block as a heavy line */
  if (ka > 0) { const gl = el('g', { class: 'anames', opacity: ka });   /* the names: rows share a baseline, but a name never leaves its own area — inside the area first, on the row's line second */
    const CW = 7.6, LH = 12; const items = sc.areaInfo.map((a) => { const p = sc.project(a.u, a.v, 0); const ring = a.ring.map(([u, v]) => sc.project(u, v, 0)); return { a, p, ring, txt: a.name.toUpperCase() }; }).sort((q, r) => q.p.y - r.p.y);
    const spanAt = (ring, y, nearX) => { const xs = []; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const A = ring[i], B = ring[j]; if ((A.y > y) !== (B.y > y)) xs.push(A.x + (y - A.y) * (B.x - A.x) / (B.y - A.y)); } xs.sort((q, r) => q - r); let best = null; for (let k = 0; k + 1 < xs.length; k += 2) { const iv = [xs[k], xs[k + 1]]; if (!best || (nearX >= iv[0] && nearX <= iv[1]) || Math.abs((iv[0] + iv[1]) / 2 - nearX) < Math.abs((best[0] + best[1]) / 2 - nearX)) { if (!best || !(nearX >= best[0] && nearX <= best[1])) best = iv; } } return best; };   /* the area's width along a horizontal line: the piece under (or nearest) its centre */
    const setLines = (it, fold) => { const t = it.txt; const h = t.indexOf('-'), sp = t.lastIndexOf(' '); it.lines = fold && t.length > 10 ? (h > 0 ? [t.slice(0, h + 1), t.slice(h + 1)] : sp > 0 ? [t.slice(0, sp), t.slice(sp + 1)] : [t]) : [t]; it.w = Math.max(...it.lines.map((l) => l.length)) * CW + 6; };
    const fit = (it, y) => { const iv = spanAt(it.ring, y, it.p.x); if (!iv) return false; it.y = y; it.lo = iv[0] + 4 + it.w / 2; it.hi = iv[1] - 4 - it.w / 2; if (it.lo > it.hi) { const m = (iv[0] + iv[1]) / 2; it.lo = it.hi = m; } it.x = Math.max(it.lo, Math.min(it.hi, it.p.x)); return true; };
    const bandH = Math.max(40, sc.H * 0.075); const rows = []; for (const it of items) { const row = rows.length ? rows[rows.length - 1] : null; if (row && Math.abs(it.p.y - row.y0) < bandH) { row.items.push(it); row.y0 = row.items.reduce((acc, q) => acc + q.p.y, 0) / row.items.length; } else rows.push({ y0: it.p.y, items: [it] }); }
    for (const row of rows) { const y = Math.round(row.y0); row.items.sort((q, r) => q.p.x - r.p.x);
      for (const it of row.items) { setLines(it, false); if (!fit(it, y)) { fit(it, it.p.y) || (it.x = it.p.x, it.y = it.p.y, it.lo = it.hi = it.p.x); } if (it.hi - it.lo < 0.5 && it.w > 60) { setLines(it, true); fit(it, it.y); } }   /* on the row's line where the area allows it; a name wider than its area folds */
      for (let pass = 0; pass < 3; pass++) for (let k = 0; k + 1 < row.items.length; k++) { const L = row.items[k], R = row.items[k + 1]; if (L.y !== R.y) continue; const over = (L.x + L.w / 2 + 10) - (R.x - R.w / 2); if (over <= 0) continue;
        if (pass === 0) { if (L.lines.length === 1) { setLines(L, true); fit(L, L.y); } if (R.lines.length === 1) { setLines(R, true); fit(R, R.y); } continue; }   /* first: fold both, they get narrower */
        const giveL = L.x - L.lo, giveR = R.hi - R.x; const need = over; const dl = Math.min(giveL, need * (giveL / Math.max(1e-6, giveL + giveR))), dr = Math.min(giveR, need - dl); L.x -= dl; R.x += dr;   /* then: each gives what room its area has */
        if ((L.x + L.w / 2 + 10) - (R.x - R.w / 2) > 0) { const M = giveL < giveR ? L : R; M.y += LH * (M.lines.length === 1 ? 1 : 1.2); fit(M, M.y) || (M.y -= LH); } }   /* last: the one with less room steps down a line, still inside its area */
      for (const it of row.items) it.lines.forEach((l, k) => gl.appendChild(el('text', { x: it.x, y: it.y + 4 + k * LH, 'text-anchor': 'middle' }, l))); }
    g.appendChild(gl); }
  svg.appendChild(g);
}
function legend(svg, right, bottom, op, level, focus) {
  $('rail').classList.toggle('onmap', level !== 'city'); void right; void focus;   /* the rail: a solid paper margin with a crisp edge while the map runs under it */
  const g = el('g', { class: 'legend' + (level === 'city' ? '' : ' solid'), opacity: op }); const x0 = level === 'city' ? 22 : SHEET.rail + 24;
  const sw = (x, y, k) => g.appendChild(el('rect', { x, y: y - 9, width: 14, height: 10, fill: FACE_COL[k] || 'none', stroke: 'rgba(30,45,35,.45)', 'stroke-width': .7 }));
  if (level === 'block') { const S = app.S; const H = 50, y0 = bottom - H; g.appendChild(el('rect', { x: x0 - 14, y: y0 - 6, width: 640, height: H + 16, class: 'paper' }));
    g.appendChild(el('text', { x: x0, y: y0 + 14, class: 't' }, 'Every street tree; click one to open its street plan'));
    let kx = x0; g.appendChild(el('circle', { cx: kx + 6, cy: y0 + 34, r: 3.2, class: 'lg listed' })); g.appendChild(el('text', { x: kx + 16, y: y0 + 38, class: 's' }, 'a Table 9-3 species')); kx += 150;
    g.appendChild(el('circle', { cx: kx + 6, cy: y0 + 34, r: 2.4, class: 'lg other' })); g.appendChild(el('text', { x: kx + 16, y: y0 + 38, class: 's' }, 'another species')); kx += 130;
    g.appendChild(el('circle', { cx: kx + 6, cy: y0 + 34, r: 3, class: 'lg median' })); g.appendChild(el('text', { x: kx + 16, y: y0 + 38, class: 's' }, 'a tree in a median')); kx += 120;
    if (S && app.chosen) { g.appendChild(el('line', { x1: kx, y1: y0 + 34, x2: kx + 16, y2: y0 + 34, class: 'lg face' })); g.appendChild(el('text', { x: kx + 22, y: y0 + 38, class: 's' }, `the chosen street, ${S.title.hblock}`)); }
    svg.appendChild(g); return; }
  const H = 58, y0 = bottom - H, W = 520;   /* the city and the area: one legend, the colour is the rule's answer; the species share is in the hover tip */
  if (level === 'city') g.appendChild(el('rect', { x: x0 - 60, y: y0 - 70, width: W + 140, height: H + 130, class: 'fade' })); else g.appendChild(el('rect', { x: x0 - 14, y: y0 - 6, width: W + 28, height: H + 16, class: 'paper' }));
  g.appendChild(el('text', { x: x0, y: y0 + 14, class: 't' }, "The largest tree the rule allows, on each area's checked streets"));
  let kx = x0; for (const [k, w] of [['Large', 'Large'], ['Medium', 'Medium'], ['Small', 'Small'], ['none', 'nothing fits']]) { sw(kx, y0 + 38, k); g.appendChild(el('text', { x: kx + 19, y: y0 + 38, class: 's' }, w)); kx += 19 + w.length * 6.4 + 16; }
  g.appendChild(el('rect', { x: kx, y: y0 + 29, width: 14, height: 10, fill: 'none', stroke: 'rgba(30,45,35,.45)', 'stroke-width': .7, 'stroke-dasharray': '2 1.5' })); g.appendChild(el('text', { x: kx + 19, y: y0 + 38, class: 's' }, 'not checked yet'));
  g.appendChild(el('text', { x: x0, y: y0 + 57, class: 's grey' }, level === 'city' ? 'hover an area for its share of Table 9-3 species' : "the blocks take their area's colour"));
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
    if (best) { tip.className = 'tip paper on'; tip.innerHTML = `<b>PUBLIC TREE ${best[2]}</b><span class="row"><em>list</em>${best[3] ? 'a Table 9-3 species' : 'not a Table 9-3 species'}</span><span class="go">${best[4] === 1 ? 'a median tree: its band is the median between its curbs · click to open its street plan' : onChecked(best) ? 'click to open its street plan' : 'click to open its street plan; this street is not checked yet, about a minute'}</span>`; tip.style.left = (px + 16) + 'px'; tip.style.top = (py + 16) + 'px'; canvas.style.cursor = 'pointer'; return; } }
  else if (app.hotTreeDot) { app.hotTreeDot = null; requestDraw(); }
  if (app.t < diveT().ts) { const ar = app.t < diveT().ta + 0.06 ? app.scene.pickArea(px, py) : null; if (ar !== app.hotArea) { app.hotArea = ar; draw(); } const f = SHOW_FACES && app.t >= diveT().ta - 0.1 ? app.scene.pickFace(px, py) : null;
    if (!f && ar) { tip.className = 'tip paper on'; const vd = ar.verdict === 'none' ? 'nothing fits' : ar.verdict ? ar.verdict + ' fits' : null; tip.innerHTML = `<b>${ar.name.toUpperCase()}</b><span class="row"><em>trees</em>${(ar.trees || 0).toLocaleString()} public · ${ar.share != null ? Math.round(ar.share * 100) : '?'} % recommended species</span><span class="row"><em>rule</em>${ar.faces ? (vd ? vd + ' on most of ' : 'no clear answer on ') + ar.faces + ' checked streets' : 'no street checked yet'}</span><span class="go">click to fly here</span>`; tip.style.left = (px + 16) + 'px'; tip.style.top = (py + 16) + 'px'; canvas.style.cursor = 'pointer'; return; }
    if (f) { tip.className = 'tip on'; const here = f.site_id === app.S.site_id.split('_')[0]; tip.innerHTML = `<b>${f.hblock}</b> · ${(f.side || '').replace('_', ' ')}<br>${FACE_TXT[f.largest_class_fits] || 'not known'} · ${f.tree_count} trees · band ${fmt(f.band_width_m, 2)} m<br><span style="opacity:.75">${here && app.chosen ? 'chosen · OPEN THE STREET PLAN is on the right' : 'click to choose it'}</span>`; tip.style.left = (px + 14) + 'px'; tip.style.top = (py + 14) + 'px'; tip.classList.add('on'); canvas.style.cursor = here ? 'default' : 'pointer'; return; } tip.className = 'tip'; canvas.style.cursor = 'default'; return; }
  tip.classList.remove('on'); if (app.t < 1) return;
  tip.classList.remove('on');
  canvas.style.cursor = app.t < 3 && app.scene.pickTree(px, py) ? 'pointer' : inReplace() && app.armed ? 'copy' : app.t >= SHEET_ON && app.t < 5 ? 'grab' : 'default';
});
canvas.addEventListener('click', (e) => {
  if (!app.S || app.busy) return; if (app.turned) { app.turned = false; return; }
  if (inReplace() && app.armed) { placeCard(app.armed); return; }
  if (app.t < diveT().ts && app.hotTreeDot) { const q = app.hotTreeDot; app.hotTreeDot = null; $('tip').classList.remove('on'); goTree(q); return; }   /* the block level: a tree dot opens its street plan (02) with that tree selected */
  if (app.t < diveT().ts) { const r0 = canvas.getBoundingClientRect(); const dv = diveT(); const f = SHOW_FACES && app.t >= dv.ta - 0.1 ? app.scene.pickFace(e.clientX - r0.left, e.clientY - r0.top) : null;   /* the city level chooses an area, nothing smaller; a street is chosen from the list */
    if (!f && app.t < dv.ta - 0.1) { const ar = app.scene.pickArea(e.clientX - r0.left, e.clientY - r0.top); if (ar) goArea(ar); return; }
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
// click an area: the camera drops to the AREA level — its checked streets as coloured lines on the map and as cards in the rail; the street is the user's to pick (a street, a tree dot, an address). Nothing is loaded here.
function goArea(ar) {
  app.pulse = { u: ar.u, v: ar.v }; app.area = ar.name; app.hotArea = null; $('tip').classList.remove('on'); app.ctlKey = '';
  status(ar.faces ? '' : 'no checked street in ' + ar.name + ' yet · type an address to check one'); scrollToT(diveT().ta); draw();
}
/* the engine's catch-basin hint for the curb (the City labels them 'location approximate'): the median offset, or null */
function curbHint(S) { const k = S.knobs && S.knobs.curb_offset_from_centreline_m; if (k && k.hint && k.hint.suggested_m != null) return k.hint.suggested_m; if (k && k.hint && k.hint.kind === 'median') return null; /* a median's hint has already weighed its fixtures: no suggestion means the user types the half-width */ const arr = k && k.hint && k.hint.catch_basin_offsets_from_centreline_m; if (!arr || !arr.length) return null; const a = arr.slice().sort((x, y) => x - y); return +(a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2).toFixed(2); }
/* a public tree anywhere, from a dot at the block level: its street loads (or the engine runs for it, about a minute) and the page lands on the street plan (02) with that tree selected */
const onChecked = (q) => { const sc = app.scene; if (!sc || !sc.faceUV) return false; for (const it of sc.faceUV) { const ax = it.a[0], ay = it.a[1], bx = it.b[0], by = it.b[1]; const dx = bx - ax, dy = by - ay; const L2 = dx * dx + dy * dy || 1; const t = Math.max(0, Math.min(1, ((q[0] - ax) * dx + (q[1] - ay) * dy) / L2)); if (Math.hypot(q[0] - (ax + t * dx), q[1] - (ay + t * dy)) < 14) return true; } return false; };   /* a dot within 14 m of a checked face's line: its street opens at once; any other runs the engine first */
function goTree(q) { if (app.busy) return; const asset = q[2]; app.goto = { u: q[0], v: q[1] }; app.chosen = true; app.foundNote = null; app.jump = asset; app.ctlKey = ''; planOnly(); draw(); goTo(String(asset), () => { if (!app.needCurb) status('could not open tree ' + asset); }, STOP_T[1], 650).then(() => { app.goto = null; app.jump = null; app.ctlKey = ''; draw(); }); }   /* a tree is the subject: its plan, fast — the dive to its block while its street loads, then 650 ms into the plan; the rail does not change hands on the way */   /* the busy ring sits on the chosen tree while its street loads or the engine runs */
/* a checked street, from the map or from the rail's list: its scene loads and the camera flies down to the plan (02) */
function goFace(siteId) {
  if (app.busy || !app.S) return; const here = app.S.site_id.split('_')[0]; app.chosen = true; app.foundNote = null; app.resKey = ''; { const f0 = app.city && app.city.faces ? app.city.faces.faces.find((q) => q.site_id === siteId) : null; if (f0 && f0.local_area) app.area = f0.local_area; app.opening = f0 ? { hblock: f0.hblock, side: (f0.side || '').replace('_side', ''), n: f0.tree_count } : null; if (app.opening) question(); }   /* the street's area is the chosen area; its name is on the title and the button at once (the walk of 2026-10-13) */ if (siteId === here) { planOnly(); scrollToT(diveT().tb); draw(); return; }   /* already loaded: the camera drops to its block */
  const it = app.scene.faceUV ? app.scene.faceUV.find((x) => x.f.site_id === siteId) : null; if (it) { app.goto = { u: (it.a[0] + it.b[0]) / 2, v: (it.a[1] + it.b[1]) / 2 }; $('tip').classList.remove('on'); draw(); }
  load(siteId).then((ok) => { app.opening = null; app.goto = null; app.ctlKey = ''; app.resKey = ''; planOnly(); draw(); if (ok) { scrollToT(diveT().tb); return; }
    const f = it ? it.f : (app.city && app.city.faces ? app.city.faces.faces.find((q) => q.site_id === siteId) : null); if (f && f.asset_id) { status(`${f.hblock}: not exported on this server · fetching the street and running the engine, about two minutes …`); goTo(String(f.asset_id), () => status('could not open ' + f.hblock), 1.5); } });   /* a checked street without its scene file here (a fresh clone): run it from the City's data */
}
// the rail: six stages, each a place on the one scroll
$('steps').onclick = (e) => { const li = e.target.closest('li[data-s]'); if (!li) return; goStage(+li.dataset.s); };
$('steps').onkeydown = (e) => { if (e.key !== 'Enter' && e.key !== ' ') return; const li = e.target.closest('li[data-s]'); if (!li) return; e.preventDefault(); goStage(+li.dataset.s); };   /* the stages are reachable by the keyboard: Tab to one, Enter or Space goes there */
/* every way to a stage (the rail, keys 1–6, arrows): 02 is always the whole street as one plan, its section closed */
function goStage(s) { if (s >= 1) app.chosen = true; if (s === 1) { planOnly(); app.scene._pf = null; if (app.S) { app.scene.setStop(app.t); draw(); } } if (s >= 2) runPick(); scrollToT(STOP_T[s]); }

// ---------- the wheel at 01: zoom the map (the city → the area → the block); nowhere else does the wheel move the camera ----------
/* how far in the wheel may go: to the block level once a street of this area is loaded (the dots are that block's), else to the area level — never into a block the user has not chosen */
function wheelMax() { return diveT().tb; }   /* the wheel reaches the block level in any area: the dots there are every public tree, each one a door */
function onWheel(e) { if (app.report || app.busy || !app.S) return;
  if (stage(app.t) === 4 && app.t >= SHEET_ON && !app.tween) { e.preventDefault(); if (Math.abs(e.deltaY) < 4) return; axoWheel(e.deltaY > 0 ? 1 : -1); return; }   /* 05 is a pinned section: a notch is a station; at either end the next notch hands the page on (06) or back (04) */
  if (e.target.closest && e.target.closest('#rail, #result, #tool, #summary, #menu')) return;   /* the panels scroll themselves */
  if (stage(app.t) !== 0 || (app.tTarget != null && app.tTarget >= 1)) return; e.preventDefault(); app.tween = null; { const r = canvas.getBoundingClientRect(); app.wheelPt = { px: e.clientX - r.left, py: e.clientY - r.top }; if (!app.panUV) app.panUV = { u: 0, v: 0 }; } const cur = app.tTarget == null ? app.t : app.tTarget; const d = Math.max(-0.05, Math.min(0.05, e.deltaY * 0.0006));
  app.tTarget = Math.max(0, Math.min(wheelMax(), cur + d)); if (!app.easing) { app.easing = true; requestAnimationFrame(ease); } }
/* the camera glides: each frame t closes a fifth of the gap to the scroll position, so a wheel step becomes a short move, not a jump */
function ease() {
  if (app.tween) { const tw = app.tween; const k = Math.min(1, (performance.now() - tw.t0) / tw.dur); const s = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; app.moving = true; clearTimeout(app.settleT); app.settleT = null; stepTo(lerp(tw.from, tw.to, s)); if (k >= 1) { app.tween = null; app.easing = false; app.settleT = setTimeout(settle, 140); return; } requestAnimationFrame(ease); return; }
  const d = (app.tTarget == null ? app.t : app.tTarget) - app.t; if (Math.abs(d) < 0.0012) { app.easing = false; if (d !== 0) stepTo(app.tTarget); if (app.moving && !app.settleT) app.settleT = setTimeout(settle, 140); return; } app.moving = true; clearTimeout(app.settleT); app.settleT = null; stepTo(app.t + d * 0.28); requestAnimationFrame(ease); }
/* the camera has been still for a moment: the canvas returns to full resolution and the atlas paints its hatch again (one heavy frame, not one per wheel pause) */
function settle() { app.settleT = null; if (app.easing) return; app.moving = false; app.hatchFresh = true; retex(); requestDraw(); }
/* at 01, once the camera is still: the 8.4 km and 2 km textures follow it (painted around the camera when it has moved beyond them) */
function retex() { const sc = app.scene; if (!sc || !sc._repaint || !sc.uvOf || app.t >= 1 || app.swapping) return; const c = sc.centre1; if (!c) return; const hw = sc.halfW1 || 4000; const away = (P) => { if (!P) return 1e9; const [x, y] = sc.uvOf(P.centre[0], P.centre[1]); return Math.hypot(x - c.x, y - c.y); }; if (hw < 4200 && away(sc.midP) > 1800) sc._repaint('mid', c.x, c.y); if (hw < 700 && away(sc.nearP) > 320) sc._repaint('near', c.x, c.y); }   /* app.moving: the atlas paints no hatch while the camera glides */
/* the zoomed plan (02 with a section open, 03) drags along the street: the camera's centre moves, clamped to the block face */
function startPan(e, sc) {
  if (app.drag || !app.S) return; e.preventDefault(); app.pannedOnce = true; const blk = app.S.street.block; const pf = sc.planFrame(); const x0 = e.clientX; const pan0 = app.pan || 0;
  const half = planWAt(app.t) / 2 / pf.ppm; const sl = sc.slab; const cB = (sl.u0 + sl.u1) / 2; const lo = blk.u_from + half - 8 - cB, hi = blk.u_to - half + 8 - cB; const clamp = (p) => (lo > hi ? 0 : Math.max(lo, Math.min(hi, p)));
  const move = (ev) => { app.pan = clamp(pan0 - (ev.clientX - x0) / pf.ppm); sc._pf = null; sc.setStop(app.t); requestDraw(); };
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); app.panning = false; draw(); };
  app.panning = true; window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); draw();
}
/* a click on a tree opens its section beside the plan (02): the plan narrows, the section fades in, no scroll needed */
/* a tree chosen at 01 lands on 02, the whole street as one plan with that tree selected; its section opens when it is clicked at 02 or the scroll reaches 03 */
function planOnly() { app.sectionOpen = false; app.secK = 0; app.secAnim = false; }
/* 02: choosing a tree is a page state (app.pick), not an engine run — the plan rings it and the column shows its card from the face's numbers at once;
   the rule runs for it when its ground is wanted (03: SEE ITS GROUND, key 3, the arrows), so a tree click at 01 lands on the plan in the glide alone */
function pickTree(S) { return app.pick && S ? (S.trees.find((x) => x.site_id === app.pick) || null) : null; }
function runPick() { const S = app.existing || app.S; if (!S || app.busy || !app.pick) return; const sel = S.trees.find((x) => x.selected); if ((!sel || sel.site_id !== app.pick) && S.trees.some((x) => x.site_id === app.pick)) { app.hotTree = null; app.pan = 0; evaluate({ site_id: app.pick }); } else app.pick = null; }
function openSection() { app.sectionOpen = true; if (!app.secAnim) { app.secAnim = true; requestAnimationFrame(secTick); } }
function secTick() { const target = app.sectionOpen ? 1 : 0; const d = target - app.secK; if (Math.abs(d) < 0.01) { app.secK = target; app.secAnim = false; } else app.secK += d * 0.2; app.scene._pf = null; app.scene.setStop(app.t); draw(); if (app.secAnim) requestAnimationFrame(secTick); }
function swapPanels() { const els = ['result', 'tool', 'summary', 'ctl', 'q-mode', 'q-text', 'hint'].map((id) => $(id)); for (const e of els) e.classList.add('swap'); clearTimeout(app.swapT); app.swapT = setTimeout(() => { for (const e of els) e.classList.remove('swap'); }, 40); }   /* the new stage's panels fade and lift into place over the camera's last half second */
function stepTo(t) { const was = stage(app.t); const tWas = app.t; app.t = t; if (was !== stage(t)) { swapPanels(); if (was < 4 && stage(t) === 4 && app.scene) { app.axoTw = null; clearTimeout(app.axoCloseT); app.axoCallout = 0; app.axoPlaying = false; app.axoDone = false; app.axoMaxP = 0; applyAxoP(0); axoAutoPlay(); }   /* 05 is entered with the block closed; on the first visit it opens itself a layer at a time, afterwards the hand opens it */ if (was === 0 && stage(t) === 1) { app.arriveT0 = performance.now(); const r = $('result'); r.classList.add('late'); clearTimeout(app.lateT); app.lateT = setTimeout(() => r.classList.remove('late'), 1800); } } if (was <= 1 && stage(t) === 2) runPick(); if (was >= 2 && stage(t) === 1 && app.sectionOpen) { planOnly(); app.scene._pf = null; }   /* scrolled back up to 02: the plan again, not the section */ if (t >= diveT().ts) { $('tip').classList.remove('on'); app.hotArea = null; } { const lv = app.scene && app.scene.S ? atlasLevel(t) : ''; if (lv !== app.lvlWas) { app.lvlWas = lv; $('tip').classList.remove('on'); app.hotArea = null; app.hotTreeDot = null; canvas.style.cursor = 'default'; } }   /* a level change (city → area → block → street) clears the tip and the hover: nothing of the last level lingers */ if (t < 0.68 || t >= 3) app.hotTree = null; if (app.menuOpen) closeMenu(); if (app.S && !app.swapping) { const wp = app.wheelPt && t < 1 ? app.wheelPt : null; const G = wp ? app.scene.groundAt(wp.px, wp.py) : null; syncScene(); app.scene.setStop(t); if (G) { const g2 = app.scene.groundAt(wp.px, wp.py); if (g2) { app.panUV.u += G.x - g2.x; app.panUV.v += G.y - g2.y; if (t < tWas && t < 0.15) { const k = Math.max(0, t / 0.15); app.panUV.u *= k; app.panUV.v *= k; } app.scene.setStop(t); } } else if (app.panUV && t < 1 && !app.wheelPt && (Math.abs(app.panUV.u) > 0.5 || Math.abs(app.panUV.v) > 0.5)) { app.panUV.u *= 0.86; app.panUV.v *= 0.86; app.scene.setStop(t); } draw(); if (was !== stage(t)) question(); } }   /* a wheel step keeps the ground under the pointer where it was; a click-driven glide lets that offset fade */
window.addEventListener('wheel', onWheel, { passive: false });
window.addEventListener('keydown', (e) => { const tag = (e.target && e.target.tagName) || ''; if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey || app.report) return;
  if (/^[1-6]$/.test(e.key)) { e.preventDefault(); goStage(+e.key - 1); } else if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); goStage(Math.min(5, stage(app.t) + 1)); } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); goStage(Math.max(0, stage(app.t) - 1)); } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && stage(app.t) === 4) { e.preventDefault(); axoWheel(e.key === 'ArrowDown' ? 1 : -1); } });   /* the stages are places: 1–6 or the arrows go there */
window.addEventListener('resize', () => { if (app.S) { app.scene._resize(); app.scene.setStop(app.t); draw(); } });

(async function boot() {
  document.body.classList.add('loading');   /* the sheet stays blank paper until the first street and the city are built; the rail and the top bar carry the wait */
  app.scene = new One(canvas);
  Promise.all([loadTreeArt(), loadGroundArt()]).then(() => { if (app.S && app.scene.needsArtRebuild) { app.scene.needsArtRebuild = false; buildScene(app.S); app.scene.setStop(app.t); } if (app.S) draw(); });   /* a block built before the tree art arrived is rebuilt with it */
  r30().catch(() => null);                                                                              // the land-use rows' widths (R30) for the inputs panel
  await load(app.site); document.body.classList.remove('loading');
  if (STATIC && api.warm) setTimeout(() => { const E = app.existing || app.S; api.warm(E ? { ...knobs(E), candidate: null, scenario: true, scenario_fresh: true, base_engine: E.engine_file } : null); }, 300);   /* a static host: the browser's engine starts, and runs once for this street, while the visitor reads the map */
  if (params.get('scenario')) { try { const S2 = await api.scene(app.site.split('_')[0] + '_scenario'); app.scenario = S2; await loadModels([...new Set(S2.trees.filter((x) => x.species_ref).map((x) => x.species_ref.model).concat(S2.candidate ? [S2.candidate.model] : []))]); if (params.get('scenario') === 'saved') { app.S = S2; saveScenario(); app.S = app.existing; } } catch (e) { /* no scenario side file yet */ } }   // reviewer links and captures: the last scenario side file as the working scenario (&scenario=saved also saves it as A)
  if (params.get('axo') != null) { const v = +params.get('axo') || 0; app.axoDone = v >= 1 || params.get('done') === '1'; app.axoMaxP = 0; applyAxoP(v > 1 ? AXO_P_OF(Math.round(v)) : v); app.axoPlayed = 'param'; if (params.get('callout')) app.axoCallout = +params.get('callout'); }   /* ?axo=0.4: that point of the story · ?axo=N (1–5): the told block opened to station N · &callout=N its callout */   /* ?axo=N lands on 05 at station N (1–4), ?axo=0.5 at that point of the sequence; no auto-play */
  app.tTarget = params.get('t') ? Math.max(0, Math.min(SCROLL, +params.get('t'))) : 0; app.t = app.tTarget; syncScene(); app.scene.setStop(app.t); draw(); question();   /* no glide on arrival; ?t= lands on a stage */
  window.__app = app; window.__draw = draw; window.__evaluate = evaluate; window.__capture = capture; window.__sheetPdf = sheetPdf; window.__resultFor = resultFor; window.__save = saveScenario; window.__scrollToT = scrollToT; window.__setAxoP = setAxoP; window.__reportFor = reportFor;
  if (params.get('capture')) setTimeout(() => capture(params.get('capture')), 3000);
})();
async function capture(name, download = false, opts = {}) {   /* opts.quiet: the PNG is returned, nothing saved or downloaded; opts.first: a page that goes before the sheet in the PDF */
  const sc = app.scene; sc.render(); const W = sc.W, H = sc.H; const out = document.createElement('canvas'); out.width = W; out.height = H; const g = out.getContext('2d');
  if (stage(app.t) === 5 && !app.report) { g.fillStyle = PAPER; g.fillRect(0, 0, W, H); } else g.drawImage(sc.canvas, 0, 0, W, H);   /* 06 has no modelled content: paper, not the renderer's buffer (a forced render there showed the block's stale paper through the cards) */
  const css = Array.from(document.styleSheets).filter((s) => { try { return s.cssRules && /scene\.css|one\.css/.test(s.href || ''); } catch (e) { return false; } }).map((s) => Array.from(s.cssRules).map((r) => r.cssText).join('\n')).join('\n');
  /* both SVG layers: the overlay (plan, labels, captions) and the section layer #osec (SECTION A–A and B–B live there since they were split off the per-frame overlay) */
  for (const id of ['overlay', 'osec']) { const src = $(id); if (id === 'osec' && (!src.children.length || +src.style.opacity === 0)) continue;
    const svg = src.cloneNode(true); svg.setAttribute('xmlns', svgNS); svg.setAttribute('width', W); svg.setAttribute('height', H); svg.style.opacity = '';
    if (id === 'osec') { const d = $('overlay').querySelector('defs').cloneNode(true); svg.insertBefore(d, svg.firstChild); }   /* the patterns and clip paths are declared once, in the overlay's defs */
    const style = document.createElementNS(svgNS, 'style'); style.textContent = css.replace(/#overlay /g, ''); svg.insertBefore(style, svg.firstChild);
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' })); const img = new Image();
    await new Promise((res) => { img.onload = res; img.onerror = res; img.src = url; }); g.globalAlpha = id === 'osec' ? Math.max(0, Math.min(1, +src.style.opacity || 1)) : 1; g.drawImage(img, 0, 0, W, H); g.globalAlpha = 1; URL.revokeObjectURL(url); }
  // the question line, the rail, the result panel and the gate: rasterized as the page shows them (html2canvas, cdnjs); hand-drawn text if it cannot load
  if (await rasterHtml(g)) { const data_url0 = out.toDataURL('image/png'); if (opts.quiet) return data_url0; const r0 = STATIC ? { saved: name + '.png' } : await fetch('/api/capture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, data_url: data_url0 }) }).then((x) => x.json());   /* a static host keeps nothing: the download is the copy */ document.title = 'captured:' + (r0.saved || r0.error); status(download ? 'saved ' + (r0.saved || r0.error) : ''); if (download) { const a = document.createElement('a'); a.href = data_url0; a.download = name + '.png'; a.click(); await sheetPdf(name, data_url0, W, H, opts.first); } return data_url0; }
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
  const data_url = out.toDataURL('image/png'); if (opts.quiet) return data_url;
  const r = await fetch('/api/capture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, data_url }) }).then((x) => x.json());
  document.title = 'captured:' + (r.saved || r.error); status(download ? 'saved ' + (r.saved || r.error) : '');
  if (download) { const a = document.createElement('a'); a.href = data_url; a.download = name + '.png'; a.click(); await sheetPdf(name, data_url, W, H, opts.first); }
  return data_url;
}
async function rasterHtml(g) {
  try {
    if (!window.html2canvas) await new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); });
    for (const id of ['q', 'rail', 'result', 'tool', 'summary']) { const e = $(id); if (!e || (id !== 'q' && id !== 'rail' && !e.classList.contains('on'))) continue; const r = e.getBoundingClientRect(); const c = await window.html2canvas(e, { backgroundColor: null, scale: 1, logging: false, ignoreElements: (x) => (x.tagName === 'INPUT' && x.type === 'range') || (x.tagName !== 'DETAILS' && x.tagName !== 'SUMMARY' && !!x.closest('details:not([open])') && !x.closest('summary')) });   /* a range input is rasterised as its value ("0.9" under DEPTH in the walk's capture): left out of the raster */ /* closed details stay closed in the raster */ g.drawImage(c, r.left, r.top); }
    return true;
  } catch (e) { console.warn('html2canvas', e); return false; }
}
// 3 deliver · the information PDF: page 1 the sheet as captured; page 2 the question and verdict, the two tables, what the rule read, the numbered captions, the grades of what is drawn
async function sheetPdf(name, png, W, H, first = null) {
  if (!window.jspdf) { status('pdf library not loaded'); return; } const { jsPDF } = window.jspdf; const S = app.S; const tr = S.trees.find((x) => x.selected); if (!tr) return;
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [W, H], hotfixes: ['px_scaling'] }); if (first) { pdf.addImage(first, 'PNG', 0, 0, W, H); pdf.addPage([W, H], 'landscape'); }   /* page 1 the comparison, when the report is asked for at 06 (the walk of 2026-10-13) */ pdf.addImage(png, 'PNG', 0, 0, W, H);
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
