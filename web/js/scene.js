// One three.js scene from scene_<site>.json; views of it: plan (01, 02), long cut (03, 04), the slab (05).
// Paper white, ink linework with a weight hierarchy, one accent. Black is ground not credited or not known.
// The page computes nothing but geometry for previews: every number drawn here is read from the file.
import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';

export const COL = { ink: 0x000000, grey: 0x808080, greyLight: 0xbebebe, accent: 0x557f52, accentTint: 0xc9d9c6, accentDark: 0x46693f,
              paper: 0xf7f4ec, sheet: 0xfcfbf7, red: 0xb0413e, white: 0xffffff, poche: 0x0a0a0a };
const W = { heavy: 2.4, medium: 1.5, thin: 0.8, hair: 0.6 };
const UNKNOWN_SHEET_DEPTH = 3.0;   // vertical question band for facilities without any depth (m)
const HALF_H = 8.0;                // the section frame: grade line at mid-height, +8 m sky, -8 m ground (true scale, no exaggeration)
const MIN_PIPE_R = 0.12;           // a 200 mm main still reads as a pipe in section
export const MODELS = new Map();   // species meshes from web/models/<id>.json (normalized to height 1; built once per species in Rhino)
export async function loadModels(ids) {
  await Promise.all(ids.filter((id) => id && !MODELS.has(id)).map(async (id) => {
    try { const r = await fetch(id); MODELS.set(id, r.ok ? await r.json() : null); } catch (e) { MODELS.set(id, null); }
  }));
}
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
function rng(seed) { let s = (seed >>> 0) || 7; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

export class Scene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: false, alpha: false });   /* capture() renders right before it reads the canvas, so the buffer need not be preserved: the swap is cheaper every frame */
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(COL.paper, 1);
    this.renderer.localClippingEnabled = true;
    this.scene = new THREE.Scene();
    this.camTop = new THREE.OrthographicCamera(-1, 1, 1, -1, -500, 500);
    this.camElev = new THREE.OrthographicCamera(-1, 1, 1, -1, -500, 500);
    this.camMix = new THREE.OrthographicCamera(-1, 1, 1, -1, -500, 500);
    this.camAxo = new THREE.OrthographicCamera(-1, 1, 1, -1, -900, 900);
    this.fatMats = [];
    this.pose = 0;            // 0..1 chapter 01, 1..2 chapter 02, 2..3 chapter 03, 3..4 chapter 04, 4..5 chapter 05 (the slab)
    this.needShape = 'box';
    this.panU = 0;            // the moving cut: how far the section window has been dragged along the street (m)
    this.azimuth = -0.62;     // slab view: camera azimuth (rad), dragged in 05
    this.elevation = 0.62;    // slab view: camera elevation (rad)
    this.pick = { trees: [], facilities: [] };
    this.ray = new THREE.Raycaster();
    this.ray.params.Line = { threshold: 0.6 };
    this._resize();
    window.addEventListener('resize', () => { this._resize(); this.render(); });
  }

  // ---------- helpers -------------------------------------------------------------------------
  /* resolution switch (unused on the glide: re-allocating the buffer stalls the GPU for ~1 s on this machine) */
  setQuality(low) { const pr = low ? 1 : Math.min(window.devicePixelRatio || 1, 2); if (pr === this._pr) return false; this._pr = pr; this.renderer.setPixelRatio(pr); this.renderer.setSize(this.W, this.H, false); return true; }
  _resize() {
    const r = this.canvas.getBoundingClientRect();
    this.W = Math.max(2, r.width); this.H = Math.max(2, r.height);
    this.renderer.setSize(this.W, this.H, false);
    for (const m of this.fatMats) m.resolution.set(this.W, this.H);
  }
  fat(color, width, opts = {}) {
    const m = new LineMaterial({ color, linewidth: width, worldUnits: false, dashed: !!opts.dashed, dashSize: opts.dash || 0.8, gapSize: opts.gap || 0.5,
                                 transparent: true, opacity: opts.opacity == null ? 1 : opts.opacity, depthTest: opts.depthTest !== false });
    m.resolution.set(this.W, this.H); this.fatMats.push(m); return m;
  }
  segs(pairs, mat) {           // pairs: flat [x,y,z, x,y,z, ...] as segment endpoints
    if (!pairs.length) return new THREE.Group();
    const g = new LineSegmentsGeometry(); g.setPositions(pairs);
    const l = new LineSegments2(g, mat); l.computeLineDistances(); return l;
  }
  polyline(pts, mat) {          // pts: [[x,y,z],...]
    const flat = [];
    for (let i = 0; i + 1 < pts.length; i++) flat.push(...pts[i], ...pts[i + 1]);
    return this.segs(flat, mat);
  }
  mesh(geo, color, opts = {}) {
    const m = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: opts.opacity != null, opacity: opts.opacity == null ? 1 : opts.opacity,
                                            map: opts.map || null, depthWrite: opts.depthWrite !== false, polygonOffset: true, polygonOffsetFactor: opts.po || 0, polygonOffsetUnits: 1 });
    return new THREE.Mesh(geo, m);
  }
  rect(u0, u1, v0, v1, z, color, opts = {}) {
    const m = this.mesh(new THREE.PlaneGeometry(u1 - u0, v1 - v0), color, opts); m.position.set((u0 + u1) / 2, (v0 + v1) / 2, z); return m;
  }
  vrect(u0, u1, v, z0, z1, color, opts = {}) {   // vertical rectangle in the plane y = v (facing ±y)
    const m = this.mesh(new THREE.PlaneGeometry(u1 - u0, z1 - z0), color, opts); m.rotation.x = Math.PI / 2; m.position.set((u0 + u1) / 2, v, (z0 + z1) / 2); return m;
  }
  urect(u, v0, v1, z0, z1, color, opts = {}) {   // vertical rectangle in the plane x = u (facing ±x)
    const m = this.mesh(new THREE.PlaneGeometry(v1 - v0, z1 - z0), color, opts); m.rotation.set(Math.PI / 2, Math.PI / 2, 0); m.position.set(u, (v0 + v1) / 2, (z0 + z1) / 2); return m;
  }
  disc(cx, cy, cz, r, plane, color, opts = {}) {   // filled circle in a plane: 'y' (normal ±y) or 'x' (normal ±x)
    const m = this.mesh(new THREE.CircleGeometry(r, 24), color, opts);
    if (plane === 'y') m.rotation.x = Math.PI / 2; else m.rotation.set(Math.PI / 2, Math.PI / 2, 0);
    m.position.set(cx, cy, cz); return m;
  }
  ring(cx, cy, cz, r, plane, mat, n = 28) {
    const c = []; for (let i = 0; i < n; i++) { const a0 = i / n * 6.283, a1 = (i + 1) / n * 6.283;
      if (plane === 'y') c.push(cx + Math.cos(a0) * r, cy, cz + Math.sin(a0) * r, cx + Math.cos(a1) * r, cy, cz + Math.sin(a1) * r);
      else if (plane === 'x') c.push(cx, cy + Math.cos(a0) * r, cz + Math.sin(a0) * r, cx, cy + Math.cos(a1) * r, cz + Math.sin(a1) * r);
      else c.push(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, cz, cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, cz); }
    return this.segs(c, mat);
  }
  stipple(step, r, alpha) {
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128); g.fillStyle = `rgba(23,21,15,${alpha})`;
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let y = 3; y < 128; y += step) for (let x = 3; x < 128; x += step) { const jx = (rnd() - .5) * step * .6, jy = (rnd() - .5) * step * .6; g.beginPath(); g.arc(x + jx, y + jy, r, 0, 6.283); g.fill(); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
  }
  hatch(u0, u1, v, z0, z1, gap, angle, mat) {  // hatch lines on the vertical plane y = v
    const flat = []; const H = z1 - z0; const L = u1 - u0; const k = Math.tan(angle);
    for (let c = -H * Math.abs(k) - gap; c <= L + H * Math.abs(k); c += gap) {
      const at = (z) => u0 + c + k * (z - z0); const cand = [[at(z0), z0], [at(z1), z1]];
      if (k !== 0) { cand.push([u0, z0 + (-c) / k]); cand.push([u1, z0 + (u1 - u0 - c) / k]); }
      const pts = cand.filter(([u, z]) => u >= u0 - 1e-6 && u <= u1 + 1e-6 && z >= z0 - 1e-6 && z <= z1 + 1e-6).sort((a, b) => a[0] - b[0]);
      if (pts.length >= 2) { const a = pts[0], b = pts[pts.length - 1]; if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.01) flat.push(a[0], v, a[1], b[0], v, b[1]); }
    }
    return this.segs(flat, mat);
  }
  hatchX(u, v0, v1, z0, z1, gap, angle, mat) {  // hatch lines on the vertical plane x = u
    const flat = []; const H = z1 - z0; const L = v1 - v0; const k = Math.tan(angle);
    for (let c = -H * Math.abs(k) - gap; c <= L + H * Math.abs(k); c += gap) {
      const at = (z) => v0 + c + k * (z - z0); const cand = [[at(z0), z0], [at(z1), z1]];
      if (k !== 0) { cand.push([v0, z0 + (-c) / k]); cand.push([v1, z0 + (v1 - v0 - c) / k]); }
      const pts = cand.filter(([v, z]) => v >= v0 - 1e-6 && v <= v1 + 1e-6 && z >= z0 - 1e-6 && z <= z1 + 1e-6).sort((a, b) => a[0] - b[0]);
      if (pts.length >= 2) { const a = pts[0], b = pts[pts.length - 1]; if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.01) flat.push(u, a[0], a[1], u, b[0], b[1]); }
    }
    return this.segs(flat, mat);
  }
  hatchTop(u0, u1, v0, v1, z, gap, angle, mat) {   // hatch on the horizontal plane
    const flat = []; const Hh = v1 - v0; const L = u1 - u0; const k = Math.tan(angle);
    for (let c = -Hh * Math.abs(k) - gap; c <= L + Hh * Math.abs(k); c += gap) {
      const at = (vv) => u0 + c + k * (vv - v0); const cand = [[at(v0), v0], [at(v1), v1]];
      if (k !== 0) { cand.push([u0, v0 - c / k]); cand.push([u1, v0 + (u1 - u0 - c) / k]); }
      const pts = cand.filter(([u, vv]) => u >= u0 - 1e-6 && u <= u1 + 1e-6 && vv >= v0 - 1e-6 && vv <= v1 + 1e-6).sort((a, b) => a[0] - b[0]);
      if (pts.length >= 2) { const a = pts[0], b = pts[pts.length - 1]; if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.01) flat.push(a[0], a[1], z, b[0], b[1], z); }
    }
    return this.segs(flat, mat);
  }
  boxLines(u0, u1, v0, v1, z0, z1, mat) {
    const c = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]; const flat = [];
    for (let i = 0; i < 4; i++) { const a = c[i], b = c[(i + 1) % 4]; flat.push(a[0], a[1], z0, b[0], b[1], z0, a[0], a[1], z1, b[0], b[1], z1, a[0], a[1], z0, a[0], a[1], z1); }
    return this.segs(flat, mat);
  }
  disposeAll() {
    this.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.dispose && !this.fatMats.includes(o.material)) o.material.dispose(); });
    this.scene.clear(); this.pick = { trees: [], facilities: [] };
  }

  // ---------- one tree from a library model (normalized, height 1) or the fallback icosahedron -------------
  treeModel(u, v, h, ratio, model, edgeMat, trunkMat, tag) {
    const g = new THREE.Group();
    const white = new THREE.MeshBasicMaterial({ color: COL.white, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    let crownGeo, trunkH, trunkR, radius;
    if (model && model.crown) {
      const mr = (model.crown_ratio_of_height && model.crown_ratio_of_height.value) || ratio; const sxy = h * (ratio / mr);
      const vs = model.crown.vertices, fs = model.crown.faces; const pos = new Float32Array(fs.length * 9); let k = 0;
      for (const f of fs) for (const i of f) { pos[k++] = vs[i][0] * sxy; pos[k++] = vs[i][1] * sxy; pos[k++] = vs[i][2] * h; }
      crownGeo = new THREE.BufferGeometry(); crownGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); crownGeo.computeVertexNormals();
      trunkH = model.trunk.top * h; trunkR = Math.max(0.06, model.trunk.radius * h); radius = ratio * h / 2;
    } else {
      radius = Math.max(0.6, h * ratio / 2); trunkH = Math.max(1.2, h - radius * 1.6); trunkR = 0.14;
      crownGeo = new THREE.IcosahedronGeometry(radius, 1).translate(0, 0, trunkH + radius * 0.7);
    }
    const crown = new THREE.Mesh(crownGeo, white); crown.position.set(u, v, 0);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(trunkR * 0.85, trunkR, trunkH, 8), white); trunk.rotation.x = Math.PI / 2; trunk.position.set(u, v, trunkH / 2);
    const ce = new THREE.EdgesGeometry(crownGeo, 10); const cl = this.segs(Array.from(ce.attributes.position.array), edgeMat); cl.position.copy(crown.position);
    const te = new THREE.EdgesGeometry(trunk.geometry, 30); const tl = this.segs(Array.from(te.attributes.position.array), trunkMat); tl.rotation.copy(trunk.rotation); tl.position.copy(trunk.position);
    for (const o of [trunk, crown, cl, tl]) { o.userData.tree = tag; g.add(o); }
    g.userData.crown = crown; g.userData.trunk = trunk; g.userData.radius = radius; g.userData.trunkR = trunkR; return g;
  }

  // ---------- roots: a NOMINAL line drawing that fills the credited soil and stops at the black / a clearance ----
  // returns { ink: flat segments, cut: flat short ticks }, 3-D, in the engine frame
  rootLines(u, v, r0, roots, strips, seed) {
    // After the Wurzelatlas plates (Kutschera & Lichtenegger): a whole system drawn in section, a few heavy primaries
    // (a tap, oblique heart roots or a surface plate by habit), many medium laterals, a fringe of fine roots; every
    // line lives only in the soil the rule credits and is cut (red tick) where the black, a clearance or the neighbour begins.
    const vol = roots.volume || []; if (!vol.length) return { ink: [], heavy: [], medium: [], thin: [], cut: [] };
    const zmin = Math.min(...vol.map((q) => q.z0)) * (roots.depth_ratio || 0.8);
    const inside = (p) => p[2] <= 0 && p[2] >= zmin && vol.some((q) => p[0] >= q.u0 && p[0] <= q.u1 && p[1] >= q.v0 && p[1] <= q.v1 && p[2] >= q.z0)
      && !strips.some((s) => s.u0 != null && p[0] >= s.u0 && p[0] <= s.u1 && p[1] >= s.v0 && p[1] <= s.v1);
    const R = rng(seed); const out = { heavy: [], medium: [], thin: [], cut: [] }; const form = roots.form || 'heart';
    const shallow = Math.min(1, Math.abs(zmin) / 1.5);   /* a 0.9 m band: the primaries run shallower and longer than in deep ground */
    const dip0 = (form === 'tap' ? 0.45 : form === 'flat' ? 0.06 : 0.28) * (0.4 + 0.6 * shallow);      // primaries' downward slope by habit, eased in shallow soil
    const grow = (p, dir, len, gen, weight) => {
      let cur = p;
      for (let i = 0; i < len; i++) {
        const buf = gen === 0 ? (i < len * 0.3 ? out.heavy : i < len * 0.65 ? out.medium : out.thin) : gen === 1 ? (i < len * 0.5 ? out.medium : out.thin) : out.thin;   /* a root tapers: heavy at the trunk, a hair at its tip */
        const step = (gen === 0 ? 0.45 : gen === 1 ? 0.32 : 0.22) * (0.8 + R() * 0.5);
        const wob = gen === 0 ? 0.22 : 0.45;
        const d = [dir[0] + (R() - .5) * wob, dir[1] + (R() - .5) * wob, dir[2] + (R() - .5) * 0.22 * (0.5 + 0.5 * shallow) - (form === 'flat' && gen === 0 ? 0.02 : 0)];
        const n = Math.hypot(d[0], d[1], d[2]) || 1; dir = [d[0] / n, d[1] / n, d[2] / n];
        const nxt = [cur[0] + dir[0] * step, cur[1] + dir[1] * step, cur[2] + dir[2] * step];
        if (nxt[2] < zmin + 0.04 && inside([nxt[0], nxt[1], zmin + 0.05])) { nxt[2] = zmin + 0.05; dir = [dir[0], dir[1], Math.abs(dir[2]) * 0.3]; }   /* the floor of the credited soil: a root turns along it, it is not a cut */
        if (!inside(nxt)) {                                   // bisect to the boundary, draw the piece, mark the cut, stop
          let a = cur, b = nxt; for (let k = 0; k < 6; k++) { const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]; if (inside(m)) a = m; else b = m; }
          if (Math.hypot(a[0] - cur[0], a[1] - cur[1], a[2] - cur[2]) > 0.05) buf.push(...cur, ...a);
          const t = gen === 0 ? 0.1 : 0.06; out.cut.push(a[0] - dir[1] * t, a[1] + dir[0] * t, a[2], a[0] + dir[1] * t, a[1] - dir[0] * t, a[2]);
          return;
        }
        buf.push(...cur, ...nxt); cur = nxt;
        if (gen === 0 && R() < 0.3) {                          // laterals off a primary: medium, many
          const a = Math.atan2(dir[1], dir[0]) + (R() < .5 ? 1 : -1) * (0.5 + R() * 0.9);
          grow(cur, [Math.cos(a) * 0.9, Math.sin(a) * 0.9, -0.05 - R() * 0.25], 6 + Math.floor(R() * 6), 1, 'medium');
        } else if (gen === 1 && R() < 0.5) {                   // fine roots off a lateral: thin, short
          const a = Math.atan2(dir[1], dir[0]) + (R() < .5 ? 1 : -1) * (0.6 + R() * 1.0);
          grow(cur, [Math.cos(a) * 0.8, Math.sin(a) * 0.8, (R() - 0.5) * 0.5], 3 + Math.floor(R() * 4), 2, 'thin');
        } else if (gen === 2 && R() < 0.25) { const a = Math.atan2(dir[1], dir[0]) + (R() - .5) * 2.2; grow(cur, [Math.cos(a), Math.sin(a), (R() - 0.5) * 0.4], 2 + Math.floor(R() * 2), 2, 'thin'); }   /* root hairs */
        if (form === 'flat' && gen === 0 && R() < 0.25) grow(cur, [(R() - .5) * 0.3, (R() - .5) * 0.3, -1], 2 + Math.floor(R() * 3), 1, 'medium');   // sinkers off a surface plate
      }
    };
    const n = 10 + Math.floor(R() * 4);
    for (let i = 0; i < n; i++) {
      const a = i / n * 6.283 + R() * 0.5; let start = [u + Math.cos(a) * r0, v + Math.sin(a) * r0, -0.06];
      if (!inside(start)) { start = [u + Math.cos(a) * 0.05, v + Math.sin(a) * 0.05, -0.06]; if (!inside(start)) continue; }
      grow(start, [Math.cos(a), Math.sin(a), -dip0], 16 + Math.floor(R() * 10), 0, 'heavy');
    }
    if (form === 'tap' && inside([u, v, -0.1])) grow([u, v, -0.05], [0, 0, -1], 8 + Math.floor(R() * 4), 0, 'heavy');
    if (form === 'heart') for (let i = 0; i < 3; i++) { const a = R() * 6.283; if (inside([u, v, -0.1])) grow([u + Math.cos(a) * 0.1, v + Math.sin(a) * 0.1, -0.05], [Math.cos(a) * 0.5, Math.sin(a) * 0.5, -0.85], 6 + Math.floor(R() * 4), 0, 'heavy'); }
    out.ink = out.heavy.concat(out.medium, out.thin);
    return out;
  }
  // the same root drawing flattened onto the cut face (a section drawing of the roots in the band)
  onFace(flat, v) { const out = []; for (let i = 0; i < flat.length; i += 3) out.push(flat[i], v, flat[i + 2]); return out; }

  // ---------- build ---------------------------------------------------------------------------
  build(S) {
    this.disposeAll();
    this.S = S;
    const ex = S.extent; const st = S.street; const B = S.band; const bd = B.design;
    const cl = st.centreline_v; const pl = st.property_line_v; const cutV = S.cut.long_v;
    const DEPTH = (S.cut && S.cut.depth_m) || 8;
    this.DEPTH = DEPTH;
    const uc = (S.street.block.u_from + S.street.block.u_to) / 2;
    this.center = { u: uc, v: (cl + pl) / 2 };
    this.cutV = cutV;
    const gGround = new THREE.Group(), gAbove = new THREE.Group(), gBelow = new THREE.Group(), gCut = new THREE.Group(), gSel = new THREE.Group(), gSlab = new THREE.Group(), gRoots = new THREE.Group();
    this.g = { ground: gGround, above: gAbove, below: gBelow, cut: gCut, sel: gSel, slab: gSlab, roots: gRoots };   /* roots are their own group: they live in the credited soil and lift with it in the exploded view */
    const inkHeavy = this.fat(COL.ink, W.heavy), inkMed = this.fat(COL.ink, W.medium), inkThin = this.fat(COL.ink, W.thin), inkHair = this.fat(COL.greyLight, W.hair);
    const inkDash = this.fat(COL.ink, W.medium, { dashed: true, dash: 1.2, gap: 0.8 }), inkDashThin = this.fat(COL.ink, W.thin, { dashed: true, dash: 0.5, gap: 0.35 });
    const accHeavy = this.fat(COL.accent, W.heavy), accThin = this.fat(COL.accent, W.thin), accDash = this.fat(COL.accent, W.medium, { dashed: true, dash: 0.8, gap: 0.5 });
    const accDashHeavy = this.fat(COL.accentDark, W.heavy, { dashed: true, dash: 0.7, gap: 0.4 });
    const accHatch = this.fat(COL.accent, W.thin), greyDash = this.fat(COL.grey, W.thin, { dashed: true, dash: 0.6, gap: 0.4 }), greyThin = this.fat(COL.grey, W.thin);
    const whiteThin = this.fat(COL.white, W.medium), whiteDash = this.fat(COL.white, W.medium, { dashed: true, dash: 0.7, gap: 0.45 }), whiteHair = this.fat(COL.white, W.thin);
    const redHatch = this.fat(COL.red, W.thin), redDash = this.fat(COL.red, W.medium, { dashed: true, dash: 0.6, gap: 0.4 }), redThin = this.fat(COL.red, W.medium);
    const greyMed = this.fat(COL.grey, W.medium), greyHeavy = this.fat(COL.grey, W.heavy), ghostMat = this.fat(COL.greyLight, W.medium);
    const rootSet = (c, op) => ({ heavy: this.fat(c, W.medium * 1.15, { opacity: op }), medium: this.fat(c, W.thin * 1.1, { opacity: op }), thin: this.fat(c, W.hair * 0.9, { opacity: op * 0.85 }) });   /* roots: a tone and a taper, never a black cable */
    const rootInk = rootSet(0x3b4a3f, 0.8), rootAcc = rootSet(COL.accentDark, 0.82), rootGrey = rootSet(COL.grey, 0.5); const rootCut = this.fat(COL.red, W.thin, { opacity: 0.65 }); this.rootCut = rootCut;
    this.rootSets = { ink: rootInk, acc: rootAcc, grey: rootGrey };
    this.mats = { inkHeavy, inkMed, inkThin, inkHair, inkDash, inkDashThin, accHeavy, accThin, accDash, accDashHeavy, accHatch, greyDash, greyThin, whiteThin, whiteDash, whiteHair, redHatch, redDash, redThin };

    // ---- ground surfaces (paper; road stippled) ----
    const roadTex = this.stipple(9, 1.0, 0.35); roadTex.repeat.set((ex.u_to - ex.u_from) / 6, 12 / 6);
    const curbV = st.curb_face_v != null ? st.curb_face_v : cl + 6;
    gGround.add(this.rect(ex.u_from, ex.u_to, ex.v_from, curbV, -0.02, COL.white, { map: roadTex, po: 2 }));
    { const blvd = this.rect(ex.u_from, ex.u_to, curbV, pl, -0.02, COL.sheet, { po: 2 }); blvd.userData.blvd = true; gGround.add(blvd); }   /* blvd: the boulevard's surface turns to glass in the exploded axonometric, so the roots under the planter's lid read */
    gGround.add(this.rect(ex.u_from, ex.u_to, pl, ex.v_to, -0.02, COL.paper, { po: 2 }));
    this.groundMeshes = gGround.children.slice();
    if (st.sidewalk_v && st.sidewalk_v[0] != null) {
      const swTex = this.stipple(12, 0.7, 0.18); swTex.repeat.set((ex.u_to - ex.u_from) / 8, 1);
      gGround.add(this.rect(S.street.block.u_from, S.street.block.u_to, st.sidewalk_v[0], st.sidewalk_v[1], -0.015, COL.white, { map: swTex, po: 1 }));
      this.groundMeshes.push(gGround.children[gGround.children.length - 1]);
    }
    const strips = B.strips || [], zstrips = B.zone_strips || [];
    if (bd) {
      for (const sg of B.segments || []) { const m = this.rect(sg.u_from, sg.u_to, bd.v_from, bd.v_to, -0.01, COL.accentTint, { po: 0 }); m.userData.bandTop = true; gGround.add(m); }   /* bandTop: turns to glass in the exploded axonometric so the roots read */
      { const stripGrey = this.fat(COL.grey, W.thin, { opacity: 0.45 }), stripRed = this.fat(COL.red, W.thin, { opacity: 0.6 }); for (const s of strips) gGround.add(this.hatchTop(s.u0, s.u1, s.v0, s.v1, 0.0, 0.5, -Math.PI / 4, s.type === 'crossing' ? stripRed : stripGrey)); }   /* the clearance strips on the lid, lighter than the roots they sit over */
      gGround.add(this.polyline([[bd.u_from, bd.v_from, 0.01], [bd.u_to, bd.v_from, 0.01]], accHeavy));
      gGround.add(this.polyline([[bd.u_from, bd.v_to, 0.01], [bd.u_to, bd.v_to, 0.01]], accHeavy));
      gGround.add(this.polyline([[bd.u_from, bd.v_from, 0.01], [bd.u_from, bd.v_to, 0.01], [bd.u_to, bd.v_to, 0.01], [bd.u_to, bd.v_from, 0.01]], accThin));
    }
    if (B.existing && B.existing.v_from != null) {
      const e = B.existing; const solid = (e.grade || '').startsWith('evidenced');
      gGround.add(this.hatchTop(e.u_from, e.u_to, e.v_from, e.v_to, 0.012, 0.6, Math.PI / 4, accHatch));
      gGround.add(this.polyline([[e.u_from, e.v_from, 0.012], [e.u_to, e.v_from, 0.012]], solid ? accThin : accDash));
      gGround.add(this.polyline([[e.u_from, e.v_to, 0.012], [e.u_to, e.v_to, 0.012]], solid ? accThin : accDash));
    }
    for (const z of B.zones || []) {
      const mat = z.status === 'KNOWN' ? accHatch : z.status === 'NOT_CONNECTED' ? redHatch : greyThin;
      gGround.add(this.hatchTop(z.u_from, z.u_to, z.v_from, z.v_to, 0.013, 0.7, Math.PI / 4, mat));
      gGround.add(this.polyline([[z.u_from, z.v_from, 0.013], [z.u_to, z.v_from, 0.013], [z.u_to, z.v_to, 0.013], [z.u_from, z.v_to, 0.013], [z.u_from, z.v_from, 0.013]], z.status === 'KNOWN' ? accDash : z.status === 'NOT_CONNECTED' ? redDash : greyDash));
      for (const s of zstrips) if (s.v0 < z.v_to && s.v1 > z.v_from) gGround.add(this.hatchTop(s.u0, s.u1, Math.max(s.v0, z.v_from), Math.min(s.v1, z.v_to), 0.014, 0.5, -Math.PI / 4, redHatch));
    }
    gGround.add(this.polyline([[ex.u_from, cl, 0.02], [ex.u_to, cl, 0.02]], inkDash));
    if (st.curb_face_v != null) gGround.add(this.polyline([[ex.u_from, st.curb_face_v, 0.02], [ex.u_to, st.curb_face_v, 0.02]], inkHeavy));
    gGround.add(this.polyline([[S.street.block.u_from, pl, 0.02], [S.street.block.u_to, pl, 0.02]], inkMed));
    if (st.sidewalk_v && st.sidewalk_v[0] != null) for (const vv of st.sidewalk_v) gGround.add(this.polyline([[S.street.block.u_from, vv, 0.02], [S.street.block.u_to, vv, 0.02]], inkThin));
    if (S.street.block.outline_uv) gGround.add(this.polyline(S.street.block.outline_uv.map(([u, v]) => [u, v, 0.02]).concat([[...S.street.block.outline_uv[0], 0.02]]), inkThin));
    for (const r of S.parcels || []) gGround.add(this.polyline(r.map(([u, v]) => [u, v, 0.015]), inkHair));
    for (const cs of st.cross_streets || []) if (cs.u != null) gGround.add(this.polyline([[cs.u, ex.v_from, 0.02], [cs.u, ex.v_to, 0.02]], inkDash));

    // ---- buildings: white blocks with ink edges (nominal 8 m) ----
    for (const b of S.buildings || []) {
      const shape = new THREE.Shape(b.ring_uv.map(([u, v]) => new THREE.Vector2(u, v)));
      const geo = new THREE.ExtrudeGeometry(shape, { depth: b.height_m, bevelEnabled: false });
      gAbove.add(this.mesh(geo, COL.white, { po: 1 }));
      const eg = new THREE.EdgesGeometry(geo, 20); gAbove.add(this.segs(Array.from(eg.attributes.position.array), inkMed));
    }

    // ---- trees: species models at City height; roots in the credited soil ----
    this.treeMeshes = []; this.rootFace = [];
    const cand = S.candidate; const allStrips = strips.concat(zstrips);
    for (const t of S.trees) {
      const h = t.height_m || 4; const sr = t.species_ref; const model = sr ? MODELS.get(sr.model) : null;
      const ratio = (t.crown_diameter_m && h) ? t.crown_diameter_m / h : 0.6;
      const ghost = !!(cand && t.selected);
      const listed = sr && sr.listed;
      const edge = ghost ? ghostMat : listed ? (t.selected ? inkHeavy : inkMed) : (t.selected ? greyHeavy : greyMed);
      const g = this.treeModel(t.u, t.v, h, ratio, model, edge, ghost ? ghostMat : inkThin, t);
      gAbove.add(g); this.treeMeshes.push(g.userData.crown, g.userData.trunk);
      const r = g.userData.radius;
      const circ = []; for (let i = 0; i < 32; i++) { const a0 = i / 32 * 6.283, a1 = (i + 1) / 32 * 6.283; circ.push(t.u + Math.cos(a0) * r, t.v + Math.sin(a0) * r, 0.03, t.u + Math.cos(a1) * r, t.v + Math.sin(a1) * r, 0.03); }
      gGround.add(this.segs(circ, ghost ? ghostMat : inkThin));
      if (t.cell && t.cell.u_from != null && bd) gGround.add(this.segs([t.cell.u_from, bd.v_from - 0.3, 0.03, t.cell.u_from, bd.v_from, 0.03, t.cell.u_to, bd.v_from - 0.3, 0.03, t.cell.u_to, bd.v_from, 0.03], inkThin));
      if (t.selected) { const ring = []; for (let i = 0; i < 40; i++) { const a0 = i / 40 * 6.283, a1 = (i + 1) / 40 * 6.283; ring.push(t.u + Math.cos(a0) * 1.1, t.v + Math.sin(a0) * 1.1, 0.04, t.u + Math.cos(a1) * 1.1, t.v + Math.sin(a1) * 1.1, 0.04); } gSel.add(this.segs(ring, accHeavy)); }
      if (t.roots && !ghost) {
        const rl = this.rootLines(t.u, t.v, g.userData.trunkR * 1.2, t.roots, allStrips, 1000 + (+t.tree_id || 1));
        const set = listed || t.selected ? rootInk : rootGrey; const key = listed || t.selected ? 'ink' : 'grey';
        for (const w of ['heavy', 'medium', 'thin']) gRoots.add(this.segs(rl[w], set[w]));
        gRoots.add(this.segs(rl.cut, rootCut));
        this.rootFace.push({ rl, key });
      }
      // By-law 9958 protection barrier (R32, reference): a dashed rectangle at grade, 6 × Ø along the curb, 0.6 m off the curb, 0.3 m off the sidewalk; a fence, not a root extent
      if (t.protection && t.protection.radius_m && st.curb_face_v != null) {
        const r = t.protection.radius_m; const v0 = st.curb_face_v + (t.protection.offsets_m ? t.protection.offsets_m.from_curb : 0.6);
        const v1 = (st.sidewalk_v && st.sidewalk_v[0] != null ? st.sidewalk_v[0] : pl) - (t.protection.offsets_m ? t.protection.offsets_m.from_sidewalk_edge : 0.3);
        if (v1 > v0 + 0.2) {
          const pm = t.selected ? inkDash : inkDashThin; const z = 0.032;
          gGround.add(this.polyline([[t.u - r, v0, z], [t.u + r, v0, z], [t.u + r, v1, z], [t.u - r, v1, z], [t.u - r, v0, z]], pm));
          for (const [uu, vv] of [[t.u - r, v0], [t.u + r, v0], [t.u + r, v1], [t.u - r, v1]]) gAbove.add(this.segs([uu, vv, 0, uu, vv, 1.2], pm));
          t._protRect = { u0: t.u - r, u1: t.u + r, v0, v1 };
        }
      }
    }
    this.candGroup = null;
    if (cand) {
      const g = this.treeModel(cand.u, cand.v, cand.drawn_height_m || 6, cand.crown_ratio_of_height || 0.6, MODELS.get(cand.model), accHeavy, accThin, null);
      gAbove.add(g); this.candGroup = g;
      const r = g.userData.radius; const circ = []; for (let i = 0; i < 32; i++) { const a0 = i / 32 * 6.283, a1 = (i + 1) / 32 * 6.283; circ.push(cand.u + Math.cos(a0) * r, cand.v + Math.sin(a0) * r, 0.035, cand.u + Math.cos(a1) * r, cand.v + Math.sin(a1) * r, 0.035); }
      gGround.add(this.segs(circ, accThin));
      if (cand.roots) { const rl = this.rootLines(cand.u, cand.v, g.userData.trunkR * 1.2, cand.roots, allStrips, 77); for (const w of ['heavy', 'medium', 'thin']) gRoots.add(this.segs(rl[w], rootAcc[w])); gRoots.add(this.segs(rl.cut, rootCut)); this.rootFace.push({ rl, key: 'acc' }); }
    }

    // ---- facilities below grade (3-D tubes by grade; the plan and the slab see these) ----
    this.facMeshes = [];
    for (const f of S.facilities) {
      const pts = f.path_uv; if (!pts || !pts.length) continue;
      const rad = Math.max(MIN_PIPE_R, (f.diameter_mm || 0) / 2000);
      const group = new THREE.Group(); group.userData.facility = f;
      if (f.kind === 'corridor') {                              // a private utility of undetermined position: a dashed frame across the boulevard at Table 7-1 cover
        const [v0, v1] = f.corridor_v; const z0 = -f.depth_top_m, z1 = -(f.depth_bottom_m || f.depth_top_m + 0.15); const u0 = pts[0][0], u1 = pts[pts.length - 1][0];
        for (const z of [z0, z1]) group.add(this.polyline([[u0, v0, z], [u1, v0, z], [u1, v1, z], [u0, v1, z], [u0, v0, z]], greyDash));
        for (let uu = u0; uu <= u1 + 0.01; uu += Math.max(4, (u1 - u0) / 12)) group.add(this.segs([uu, v0, z0, uu, v1, z0], greyDash));
        gBelow.add(group); this.facMeshes.push(group); continue;
      }
      if (f.grade === 'unknown') {
        if (pts.length === 1) {
          const [u, v] = pts[0]; group.add(this.segs([u, v, 0, u, v, -1.6], greyDash)); group.add(this.ring(u, v, 0.03, 0.35, 'z', f.kind === 'transit' ? inkDash : inkThin, 12));
          if (f.kind === 'street_lighting_pole') { const pole = new THREE.Group(); pole.add(this.segs([u, v, 0, u, v, 7.2, u, v, 7.2, u + 0.9, v, 7.5], inkMed)); const head = this.mesh(new THREE.BoxGeometry(0.5, 0.25, 0.2), COL.white); head.position.set(u + 1.1, v, 7.5); pole.add(head); const he = new THREE.EdgesGeometry(head.geometry); const hl = this.segs(Array.from(he.attributes.position.array), inkThin); hl.position.copy(head.position); pole.add(hl); pole.userData.standard = true; gAbove.add(pole); }   /* the City's pole record: a lamp standard above grade (height nominal) */
        } else {
          for (let i = 0; i + 1 < pts.length; i++) {
            const [u0, v0] = pts[i], [u1, v1] = pts[i + 1]; const L = Math.hypot(u1 - u0, v1 - v0); if (L < 0.05) continue;
            const m = this.mesh(new THREE.PlaneGeometry(L, UNKNOWN_SHEET_DEPTH), COL.greyLight, { opacity: 0.25, depthWrite: false });
            m.position.set((u0 + u1) / 2, (v0 + v1) / 2, -UNKNOWN_SHEET_DEPTH / 2); m.rotation.set(0, 0, 0); m.rotateZ(Math.atan2(v1 - v0, u1 - u0)); m.rotateX(Math.PI / 2);
            group.add(m);
            group.add(this.segs([u0, v0, 0, u1, v1, 0, u0, v0, -UNKNOWN_SHEET_DEPTH, u1, v1, -UNKNOWN_SHEET_DEPTH, u0, v0, 0, u0, v0, -UNKNOWN_SHEET_DEPTH, u1, v1, 0, u1, v1, -UNKNOWN_SHEET_DEPTH], f.kind === 'transit' ? inkDash : greyDash));
          }
        }
      } else {
        const zc = -((f.depth_top_m || 0) + rad);
        if (pts.length === 1) {
          const [u, v] = pts[0]; const hh = Math.max(0.8, f.depth_top_m || 1.2);
          const cyl = this.mesh(new THREE.CylinderGeometry(0.5, 0.5, hh, 12), COL.white); cyl.rotation.x = Math.PI / 2; cyl.position.set(u, v, -hh / 2); group.add(cyl);
          const eg = new THREE.EdgesGeometry(cyl.geometry, 30); const el = this.segs(Array.from(eg.attributes.position.array), inkThin); el.rotation.copy(cyl.rotation); el.position.copy(cyl.position); group.add(el);
        } else {
          const path = new THREE.CurvePath();
          for (let i = 0; i + 1 < pts.length; i++) path.add(new THREE.LineCurve3(new THREE.Vector3(pts[i][0], pts[i][1], zc), new THREE.Vector3(pts[i + 1][0], pts[i + 1][1], zc)));
          { this._pipeTex = this._pipeTex || this.stipple(6, 0.6, 0.30); const tube = this.mesh(new THREE.TubeGeometry(path, Math.max(2, pts.length * 2), rad, 14, false), COL.white, { map: this._pipeTex }); tube.material.map.repeat.set(4, 1); group.add(tube); }   /* a faint stipple: the cylinder reads as a solid on paper */
          const axis = pts.map(([u, v]) => [u, v, zc]);
          const edgeMat = f.grade === 'record' ? (rad >= 0.25 ? inkHeavy : inkMed) : f.grade === 'derived' ? inkMed : this.fat(COL.ink, W.medium, { dashed: true, dash: 0.9, gap: 0.6 });
          group.add(this.polyline(axis.map(([u, v, z]) => [u, v, z + rad]), edgeMat));
          group.add(this.polyline(axis.map(([u, v, z]) => [u, v, z - rad]), edgeMat));
          if (f.grade === 'nominal') group.add(this.polyline(axis, greyDash));
        }
      }
      gBelow.add(group); this.facMeshes.push(group);
    }

    // ---- need volume in 3-D (box or cube), 01–03 ----
    this.needGroup = new THREE.Group();
    if (S.need) {
      const n = S.need;
      if (n.box) { const b = n.box; this.needBox = this.boxLines(b.u0, b.u1, b.v0, b.v1, -b.depth_m, 0, accDash); this.needGroup.add(this.needBox); }
      if (n.cube) { const c = n.cube; const s = c.side_m; this.needCube = this.boxLines(c.u - s / 2, c.u + s / 2, c.v - s / 2, c.v + s / 2, -s, 0, greyDash); this.needCube.visible = false; this.needGroup.add(this.needCube); }
      gBelow.add(this.needGroup);
    }

    // ---- the long cut face at v = cutV (03, 04): black body to -DEPTH, band carved, facilities to diameter, roots ----
    const cutU0 = ex.u_from, cutU1 = ex.u_to;
    gCut.add(this.vrect(cutU0, cutU1, cutV - 0.03, -DEPTH, 0, COL.poche, { po: 0 }));
    if (bd) {
      for (const sg of B.segments || []) gCut.add(this.vrect(sg.u_from, sg.u_to, cutV - 0.02, -bd.depth_m, 0, COL.accentTint, { po: -1 }));
      for (const s of strips) if (s.type === 'crossing') gCut.add(this.hatch(s.u0, s.u1, cutV - 0.018, -bd.depth_m, 0, 0.35, -Math.PI / 4, whiteHair));
      gCut.add(this.segs([bd.u_from, cutV - 0.016, -bd.depth_m, bd.u_to, cutV - 0.016, -bd.depth_m], accHeavy));
      this.bandBottomZ = -bd.depth_m;
    }
    if (B.existing && B.existing.v_from != null) { const e = B.existing; gCut.add(this.hatch(e.u_from, e.u_to, cutV - 0.014, -(e.depth_m || 0.6), 0, 0.45, Math.PI / 4, accHatch)); }
    for (const z of B.zones || []) {
      const mat = z.status === 'KNOWN' ? accDash : z.status === 'NOT_CONNECTED' ? redDash : greyDash; const zd = z.depth_m || (bd && bd.depth_m) || 0.9;
      gCut.add(this.segs([z.u_from, cutV - 0.012, -zd, z.u_to, cutV - 0.012, -zd, z.u_from, cutV - 0.012, -zd, z.u_from, cutV - 0.012, 0, z.u_to, cutV - 0.012, -zd, z.u_to, cutV - 0.012, 0], mat));
    }
    const depthMatCut = this.fat(0x2a2a2a, W.hair);
    for (let z = -1; z > -DEPTH; z -= 1) gCut.add(this.segs([cutU0, cutV - 0.013, z, cutU1, cutV - 0.013, z], depthMatCut));
    this.gOwn = new THREE.Group(); this.gOwnPlan = new THREE.Group();
    const nb = (S.candidate && S.candidate.box) ? S.candidate.box : (S.need && S.need.box);
    for (const t of S.trees) if (t.own_need && !(t.selected && nb)) { this.gOwn.add(this.cutBox(t.own_need, cutV, inkDashThin, false)); this.gOwnPlan.add(this.planBox(t.own_need, inkDashThin, false)); }
    if (nb) { this.gOwn.add(this.cutBox(nb, cutV, accDashHeavy, true)); this.gOwnPlan.add(this.planBox(nb, accDashHeavy, true)); }
    gCut.add(this.gOwn); gGround.add(this.gOwnPlan); this.gOwn.visible = false; this.gOwnPlan.visible = false;
    for (const rf of this.rootFace) { for (const w of ['heavy', 'medium', 'thin']) gCut.add(this.segs(this.onFace(rf.rl[w], cutV - 0.011), this.rootSets[rf.key][w])); gCut.add(this.segs(this.onFace(rf.cut !== undefined ? rf.cut : rf.rl.cut, cutV - 0.011), redThin)); }
    // the protection barriers on the cut: the fence (1.2 m, dashed) at ± the Schedule A distance, above grade
    for (const t of S.trees) if (t._protRect) { const pr = t._protRect; const pm = t.selected ? inkDash : inkDashThin; gCut.add(this.segs([pr.u0, cutV - 0.008, 0, pr.u0, cutV - 0.008, 1.2, pr.u1, cutV - 0.008, 0, pr.u1, cutV - 0.008, 1.2, pr.u0, cutV - 0.008, 1.2, pr.u1, cutV - 0.008, 1.2], pm)); }
    // nominal corridors on the cut face: two dashed lines at Table 7-1 cover across the whole face (position undetermined, depth nominal)
    for (const f of S.corridors || []) { const z0 = -f.depth_top_m, z1 = -(f.depth_bottom_m || f.depth_top_m + 0.15); gCut.add(this.segs([cutU0, cutV - 0.009, z0, cutU1, cutV - 0.009, z0, cutU0, cutV - 0.009, z1, cutU1, cutV - 0.009, z1], whiteDash)); }
    // facilities on the face, to diameter: along the street = white band with edges; crossing or point = white disc; nominal = outline only; unknown = question band
    this.cutItems = []; let n = 0;
    const unkHatch = this.fat(0x555555, W.thin);
    for (const f of S.facilities) {
      const pts = f.path_uv; if (!pts || !pts.length || f.where === 'window') continue;
      const roadSide = pts.filter(([u, v]) => v <= cutV); if (!roadSide.length) continue;
      const us = roadSide.map((p) => p[0]); const u0 = Math.max(cutU0, Math.min(...us)), u1 = Math.min(cutU1, Math.max(...us));
      const rad = Math.max(MIN_PIPE_R, (f.diameter_mm || 0) / 2000);
      const crosses = pts.some(([u, v]) => v > cutV) && pts.some(([u, v]) => v <= cutV);
      n += 1; const item = { n, f, u0, u1, crosses };
      if (f.grade === 'unknown') {
        const uu0 = pts.length === 1 ? pts[0][0] - 0.3 : u0, uu1 = pts.length === 1 ? pts[0][0] + 0.3 : u1;
        gCut.add(this.hatch(uu0, uu1, cutV - 0.010, -UNKNOWN_SHEET_DEPTH, 0, 0.3, Math.PI / 3, unkHatch));
        gCut.add(this.segs([uu0, cutV - 0.009, 0, uu0, cutV - 0.009, -UNKNOWN_SHEET_DEPTH, uu1, cutV - 0.009, 0, uu1, cutV - 0.009, -UNKNOWN_SHEET_DEPTH, uu0, cutV - 0.009, -UNKNOWN_SHEET_DEPTH, uu1, cutV - 0.009, -UNKNOWN_SHEET_DEPTH], whiteDash));
        item.z = -UNKNOWN_SHEET_DEPTH * 0.5; item.u = (uu0 + uu1) / 2;
      } else {
        const zc = -Math.min(DEPTH - rad, (f.depth_top_m || 0) + rad); item.z = zc; item.clamped = (f.depth_top_m || 0) + rad > DEPTH - rad;
        const outline = f.grade === 'nominal' ? whiteDash : whiteThin;
        if (crosses || pts.length === 1) {
          const uc2 = pts.length === 1 ? pts[0][0] : (u0 + u1) / 2; item.u = uc2; const rr = Math.max(rad, 0.16);
          if (f.grade !== 'nominal') gCut.add(this.disc(uc2, cutV - 0.010, zc, rr, 'y', COL.white));
          gCut.add(this.ring(uc2, cutV - 0.009, zc, rr, 'y', outline));
        } else {
          item.u = u1;                                   // runs along the street behind the cut: projected (outline + sparse hatch), never a solid band
          if (f.grade !== 'nominal') gCut.add(this.hatch(u0, u1, cutV - 0.010, zc - rad, zc + rad, Math.max(0.35, rad * 1.2), Math.PI / 3, whiteHair));
          gCut.add(this.segs([u0, cutV - 0.009, zc + rad, u1, cutV - 0.009, zc + rad, u0, cutV - 0.009, zc - rad, u1, cutV - 0.009, zc - rad], outline));
        }
      }
      this.cutItems.push(item);
    }
    const selU = (S.trees.find((t) => t.selected) || { u: 0 }).u;
    const keep = this.cutItems.filter((it) => it.f.where === 'cell' || it.f.where === 'band' || it.f.grade !== 'unknown')
      .sort((a, b) => (a.f.where === 'cell' || a.f.where === 'band' ? 0 : 1) - (b.f.where === 'cell' || b.f.where === 'band' ? 0 : 1) || Math.abs(a.u - selU) - Math.abs(b.u - selU)).slice(0, 14);
    keep.sort((a, b) => a.u - b.u); keep.forEach((it, i) => { it.n = i + 1; }); this.cutItems = keep;
    gCut.add(this.segs([cutU0, cutV - 0.004, 0, cutU1, cutV - 0.004, 0], inkHeavy));
    gCut.visible = false;

    // ---- the A–A cut of a frozen scenario: a thin outline across the street at its u (02 set it; 03 / 04 drew it; the same plane here) ----
    if (S.cut && S.cut.aa && S.frozen) {
      const ua = S.cut.aa.u_abs != null ? S.cut.aa.u_abs : selU + (S.cut.aa.u || 0); const zTop = 9, zBot = -(S.band.design ? S.band.design.depth_m : 1) - 0.6;
      const pts = [[ua, cl, zBot], [ua, pl + 0.5, zBot], [ua, pl + 0.5, zTop], [ua, cl, zTop], [ua, cl, zBot]].map(([u, v, z]) => new THREE.Vector3(u, v, z));
      const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: 0x46693F, dashSize: 0.4, gapSize: 0.25, transparent: true, opacity: 0.9 }));
      ln.computeLineDistances(); ln.renderOrder = 5; gSlab.add(ln);
    }
    // ---- the slab (05) ----
    this.slab = S.slab || { u0: selU - 16, u1: selU + 16, v0: cl, v1: pl, depth_m: DEPTH };
    this.axo = this.axoBox(S);
    this.buildSlab(S, gSlab, this.axo);
    this.buildBandBox(S, gGround);
    gSlab.visible = false;

    this.scene.add(gGround, gAbove, gBelow, gCut, gSel, gSlab, gRoots);
    this.pick.trees = this.treeMeshes; this.pick.facilities = this.facMeshes;
    this.clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), cutV);   // keeps v <= cutV
    const sl = this.axo;
    this.slabClip = [new THREE.Plane(new THREE.Vector3(1, 0, 0), -sl.u0 + 0.08), new THREE.Plane(new THREE.Vector3(-1, 0, 0), sl.u1 + 0.08),
                     new THREE.Plane(new THREE.Vector3(0, 1, 0), -sl.v0 + 0.08), new THREE.Plane(new THREE.Vector3(0, -1, 0), sl.v1 + 0.08), new THREE.Plane(new THREE.Vector3(0, 0, 1), sl.depth_m + 0.08)];
    /* the trees keep their whole crowns: their own clip set is the block's, widened along the street (local clipping, set by the page at 05) */
    this.treeClip = [new THREE.Plane(new THREE.Vector3(1, 0, 0), -sl.u0 + 7), new THREE.Plane(new THREE.Vector3(-1, 0, 0), sl.u1 + 7), new THREE.Plane(new THREE.Vector3(0, 1, 0), -sl.v0 + 0.08), new THREE.Plane(new THREE.Vector3(0, -1, 0), sl.v1 + 0.08)];
    this.fitCameras();
    this.setPose(this.pose);
  }

  /* the credited soil as the planter the drawing lifts: the band's box (its segments inside the block) with stippled translucent
     faces and accent edges, the KNOWN extension zone beside it as a dashed box, the curb as a kerb block, the sidewalk's joints.
     Everything here lives in the ground group, so it lifts with the surface and the roots in the exploded axonometric. */
  buildBandBox(S, g) {
    const sl = this.axo || this.slab; const B = S.band, bd = B.design; const st = S.street; if (!bd) return;
    const soilTex = this.stipple(7, 0.75, 0.42); soilTex.repeat.set(2, 1);
    const face = (mk) => { const m = mk(); m.material.transparent = true; m.material.opacity = 0.30; m.material.depthWrite = false; m.renderOrder = 3; m.userData.band = true; return m; };
    const edge = this.fat(COL.accentDark, W.medium), dash = this.fat(COL.accentDark, W.thin, { dashed: true, dash: 0.5, gap: 0.3 });
    const D = bd.depth_m; const segs = (B.segments || []).map((q) => [Math.max(q.u_from, sl.u0), Math.min(q.u_to, sl.u1)]).filter(([a, b]) => b - a > 0.3);
    for (const [u0, u1] of segs) {
      const L = u1 - u0; const tL = soilTex.clone(); tL.needsUpdate = true; tL.repeat.set(L / 1.5, D / 1.5); const tW = soilTex.clone(); tW.needsUpdate = true; tW.repeat.set((bd.v_to - bd.v_from) / 1.5, D / 1.5);
      g.add(face(() => this.vrect(u0, u1, bd.v_from, -D, 0, COL.accentTint, { map: tL, po: -1 })));
      g.add(face(() => this.vrect(u0, u1, bd.v_to, -D, 0, COL.accentTint, { map: tL, po: -1 })));
      g.add(face(() => this.urect(u0, bd.v_from, bd.v_to, -D, 0, COL.accentTint, { map: tW, po: -1 })));
      g.add(face(() => this.urect(u1, bd.v_from, bd.v_to, -D, 0, COL.accentTint, { map: tW, po: -1 })));
      g.add(face(() => this.rect(u0, u1, bd.v_from, bd.v_to, -D, COL.accentTint, { po: -1 })));
      g.add(this.boxLines(u0, u1, bd.v_from, bd.v_to, -D, 0, edge));
    }
    for (const z of B.zones || []) { if (z.status !== 'KNOWN') continue; const zd = z.depth_m || D; for (const [u0, u1] of segs) { g.add(face(() => { const m = this.rect(u0, u1, z.v_from, z.v_to, -zd, COL.accentTint, { po: -1 }); m.material.opacity = 0.3; return m; })); g.add(this.boxLines(u0, u1, z.v_from, z.v_to, -zd, 0, dash)); } }
    /* the curb: a kerb block 0.15 m wide, 0.15 m proud of the road, white with ink edges */
    if (st.curb_face_v != null) { const c0 = st.curb_face_v, c1 = st.back_of_curb_v != null ? st.back_of_curb_v : c0 + 0.15; const k = this.fat(COL.ink, W.thin);
      const box = new THREE.Mesh(new THREE.BoxGeometry(sl.u1 - sl.u0, c1 - c0, 0.15), new THREE.MeshBasicMaterial({ color: COL.white })); box.position.set((sl.u0 + sl.u1) / 2, (c0 + c1) / 2, 0.075); box.userData.kerb = true; g.add(box);
      g.add(this.segs([sl.u0, c0, 0.15, sl.u1, c0, 0.15, sl.u0, c1, 0.15, sl.u1, c1, 0.15, sl.u0, c0, 0, sl.u1, c0, 0, sl.u0, c0, 0, sl.u0, c0, 0.15, sl.u1, c0, 0, sl.u1, c0, 0.15, sl.u0, c0, 0.15, sl.u0, c1, 0.15, sl.u1, c0, 0.15, sl.u1, c1, 0.15], k)); }
    /* the sidewalk's joints every 1.5 m, hairlines */
    if (st.sidewalk_v && st.sidewalk_v[0] != null) { const j = []; for (let u = Math.ceil(sl.u0 / 1.5) * 1.5; u < sl.u1; u += 1.5) j.push(u, st.sidewalk_v[0], 0.012, u, st.sidewalk_v[1], 0.012); g.add(this.segs(j, this.fat(COL.greyLight, W.hair))); }
  }
  cutBox(b, cutV, mat, withConflicts) {
    const g = new THREE.Group(); const v = cutV - 0.010; const z0 = -b.depth_m;
    if (withConflicts) g.add(this.vrect(b.u0, b.u1, cutV - 0.0105, z0, 0, COL.accent, { opacity: 0.30, depthWrite: false }));
    g.add(this.segs([b.u0, v, 0, b.u1, v, 0, b.u1, v, 0, b.u1, v, z0, b.u1, v, z0, b.u0, v, z0, b.u0, v, z0, b.u0, v, 0], mat));
    if (withConflicts) {
      for (const c of b.conflicts || []) if (c.type === 'crossing') g.add(this.hatch(c.u0, c.u1, cutV - 0.009, z0, 0, 0.25, -Math.PI / 4, this.mats.redHatch));
      for (const x of b.beyond_cell || []) g.add(this.segs([x.u0, v + 0.001, 0, x.u1, v + 0.001, 0, x.u0, v + 0.001, z0, x.u1, v + 0.001, z0, (x.side === 'west' ? x.u0 : x.u1), v + 0.001, 0, (x.side === 'west' ? x.u0 : x.u1), v + 0.001, z0], this.mats.redDash));
    }
    return g;
  }
  planBox(b, mat, withConflicts) {
    const g = new THREE.Group(); const z = 0.022;
    g.add(this.polyline([[b.u0, b.v0, z], [b.u1, b.v0, z], [b.u1, b.v1, z], [b.u0, b.v1, z], [b.u0, b.v0, z]], mat));
    if (withConflicts) {
      for (const c of b.conflicts || []) g.add(this.hatchTop(c.u0, c.u1, c.v0, c.v1, z, 0.28, -Math.PI / 4, this.mats.redHatch));
      for (const x of b.beyond_cell || []) g.add(this.polyline([[x.u0, b.v0, z + 0.001], [x.u1, b.v0, z + 0.001], [x.u1, b.v1, z + 0.001], [x.u0, b.v1, z + 0.001], [x.u0, b.v0, z + 0.001]], this.mats.redDash));
    }
    return g;
  }

  // the slab's faces: black, slightly translucent so the tubes and roots inside ghost through; ink edges;
  // the transverse section on the two end faces, crossings as discs on the long faces, depth lines every metre
  /* the native ground's faces: a soil section in the landscape convention — a stippled growing medium, a wavy boundary, sparse pebble outlines in the subsoil. A drawing convention for ground the City does not describe, never data. */
  strataTexture(D, lenM, seed = 3) {
    const PX = 72; const Wpx = Math.min(4096, Math.round(lenM * PX)), Hpx = Math.max(64, Math.round(D * PX)); const c = document.createElement('canvas'); c.width = Wpx; c.height = Hpx; const g = c.getContext('2d');
    let sd = seed; const R = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    g.fillStyle = '#F3F0E7'; g.fillRect(0, 0, Wpx, Hpx); const INK = 'rgba(38,56,44,'; g.fillStyle = INK + '.78)'; g.strokeStyle = INK + '.8)';
    const yTop = 1.15 * PX; const n = Math.max(2, Math.round(Wpx / 120)); const b1 = []; for (let i = 0; i <= n; i++) b1.push([Wpx * i / n, yTop + (R() - .5) * 0.36 * PX]);
    const yAt = (x) => { const i = Math.min(n - 1, Math.floor(x / Wpx * n)); const [x0, y0] = b1[i], [x1, y1] = b1[i + 1]; return y0 + (y1 - y0) * ((x - x0) / Math.max(1e-6, x1 - x0)); };
    for (let i = 0; i < Wpx * yTop / 150; i++) { const x = R() * Wpx, y = R() * (yTop + 0.3 * PX); if (y < yAt(x) - 2) { g.beginPath(); g.arc(x, y, 0.5 + R() * 0.9, 0, 6.283); g.fill(); } }
    g.lineWidth = 1.2; g.beginPath(); b1.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
    for (let i = 0; i < Wpx * (Hpx - yTop) / 1100; i++) { const x = R() * Wpx, y = yAt(x) + 4 + R() * (Hpx - yAt(x) - 6); g.beginPath(); g.arc(x, y, 0.5 + R() * 0.7, 0, 6.283); g.fill(); }
    g.lineWidth = 1; const placed = []; for (let i = 0; i < Wpx * (Hpx - yTop) / 2200; i++) { const x = R() * Wpx; const y0 = yAt(x); const y = y0 + 10 + R() * (Hpx - y0 - 20); const r = (2.5 + R() * 6) * (0.6 + 0.8 * (y / Hpx)); if (placed.some(([qx, qy, qr]) => Math.hypot(qx - x, qy - y) < qr + r + 3)) continue; placed.push([x, y, r]); g.beginPath(); g.ellipse(x, y, r, r * (0.6 + R() * 0.3), R() * 3.14, 0, 6.283); g.stroke(); }
    const tex = new THREE.CanvasTexture(c); tex.wrapS = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.repeat.set(lenM * PX / Wpx, 1); tex.anisotropy = 4; return tex;
  }
  axoBox(S) { return this.slab; }   /* the block the axonometric cuts out; the page narrows it to the street's own width */
  buildSlab(S, g, box) {
    const sl = box || this.slab; const B = S.band, bd = B.design; const D = sl.depth_m; const M = this.mats;
    const faceOpts = { opacity: 1, depthWrite: true, po: 0 }; const L = sl.u1 - sl.u0, Wd = sl.v1 - sl.v0;
    const texL = this.strataTexture(D, L, 3), texW = this.strataTexture(D, Wd, 5);
    g.add(this.vrect(sl.u0, sl.u1, sl.v0, -D, 0, COL.white, { ...faceOpts, map: texL }));
    g.add(this.vrect(sl.u0, sl.u1, sl.v1, -D, 0, COL.white, { ...faceOpts, map: texL }));
    g.add(this.urect(sl.u0, sl.v0, sl.v1, -D, 0, COL.white, { ...faceOpts, map: texW }));
    g.add(this.urect(sl.u1, sl.v0, sl.v1, -D, 0, COL.white, { ...faceOpts, map: texW }));
    g.add(this.rect(sl.u0, sl.u1, sl.v0, sl.v1, -D, COL.sheet, faceOpts));
    { const lid = this.rect(sl.u0, sl.u1, sl.v0, sl.v1, -0.012, COL.sheet, { opacity: 0, po: 1 }); lid.material.depthWrite = false; lid.userData.lid = true; lid.renderOrder = 1; g.add(lid); this.slabLid = lid; }   /* the block's lid: paper once the surface has lifted off it */
    g.add(this.boxLines(sl.u0, sl.u1, sl.v0, sl.v1, -D, 0, M.inkMed));
    const depthMat = this.fat(0x9a9a9a, W.hair);   /* the metre lines on the drawn ground */
    for (let z = -1; z > -D; z -= 1) g.add(this.segs([sl.u0, sl.v0, z, sl.u1, sl.v0, z, sl.u0, sl.v1, z, sl.u1, sl.v1, z, sl.u0, sl.v0, z, sl.u0, sl.v1, z, sl.u1, sl.v0, z, sl.u1, sl.v1, z], depthMat));
    const unkHatch = this.fat(0x555555, W.thin);
    for (const [u, sgn] of [[sl.u0 - 0.03, 1], [sl.u1 + 0.03, -1]]) {
      const uEnd = sgn === 1 ? sl.u0 : sl.u1;
      if (bd) {
        const inSeg = (B.segments || []).some((s) => uEnd >= s.u_from - 0.01 && uEnd <= s.u_to + 0.01);
        const tagB = (o) => { o.userData.bandCut = true; g.add(o); };
        if (inSeg) tagB(this.urect(u, bd.v_from, bd.v_to, -bd.depth_m, 0, COL.accentTint, { po: -1 }));
        tagB(this.segs([u, bd.v_from, -bd.depth_m, u, bd.v_to, -bd.depth_m, u, bd.v_from, 0, u, bd.v_from, -bd.depth_m, u, bd.v_to, 0, u, bd.v_to, -bd.depth_m], M.accHeavy));
        for (const s of B.strips || []) if (s.type === 'partial' && s.u0 <= uEnd && s.u1 >= uEnd) tagB(this.hatchX(u - sgn * 0.001, Math.max(s.v0, bd.v_from), Math.min(s.v1, bd.v_to), -bd.depth_m, 0, 0.3, -Math.PI / 4, M.whiteHair));
      }
      if (B.existing && B.existing.v_from != null) { const e = B.existing; g.add(this.hatchX(u - sgn * 0.002, e.v_from, e.v_to, -(e.depth_m || 0.6), 0, 0.4, Math.PI / 4, M.accHatch)); }
      for (const z of B.zones || []) { const zd = z.depth_m || (bd && bd.depth_m) || 0.9; const mat = z.status === 'KNOWN' ? M.accDash : z.status === 'NOT_CONNECTED' ? M.redDash : M.greyDash;
        const zl = this.segs([u, z.v_from, -zd, u, z.v_to, -zd, u, z.v_from, 0, u, z.v_from, -zd, u, z.v_to, 0, u, z.v_to, -zd], mat); zl.userData.bandCut = true; g.add(zl); }
      for (const f of S.corridors || []) { const [v0, v1] = f.corridor_v; const z0 = -f.depth_top_m, z1 = -(f.depth_bottom_m || f.depth_top_m + 0.15); g.add(this.segs([u, v0, z0, u, v1, z0, u, v0, z1, u, v1, z1], M.whiteDash)); }
      for (const f of S.facilities) {
        const pts = f.path_uv; if (!pts || pts.length < 2 || f.kind === 'corridor') continue;
        for (let i = 0; i + 1 < pts.length; i++) {
          const a = pts[i], b = pts[i + 1]; if ((a[0] - uEnd) * (b[0] - uEnd) > 0 || Math.abs(b[0] - a[0]) < 1e-6) continue;
          const t = (uEnd - a[0]) / (b[0] - a[0]); const v = a[1] + t * (b[1] - a[1]); if (v < sl.v0 || v > sl.v1) continue;
          const rad = Math.max(MIN_PIPE_R, (f.diameter_mm || 0) / 2000);
          if (f.grade === 'unknown') { g.add(this.segs([u, v - 0.3, 0, u, v - 0.3, -UNKNOWN_SHEET_DEPTH, u, v + 0.3, 0, u, v + 0.3, -UNKNOWN_SHEET_DEPTH], M.whiteDash)); g.add(this.hatchX(u - sgn * 0.001, v - 0.3, v + 0.3, -UNKNOWN_SHEET_DEPTH, 0, 0.25, Math.PI / 3, unkHatch)); }
          else { const zc = -Math.min(D - rad, (f.depth_top_m || 0) + rad); const rr = Math.max(rad, 0.16);
            if (f.grade !== 'nominal') g.add(this.disc(u, v, zc, rr, 'x', COL.white)); g.add(this.ring(u - sgn * 0.001, v, zc, rr, 'x', f.grade === 'nominal' ? M.whiteDash : M.whiteThin)); }
          break;
        }
      }
    }
    for (const [v, sgn] of [[sl.v0 - 0.03, 1], [sl.v1 + 0.03, -1]]) {
      const vEnd = sgn === 1 ? sl.v0 : sl.v1;
      for (const f of S.facilities) {
        const pts = f.path_uv; if (!pts || pts.length < 2 || f.kind === 'corridor') continue;
        for (let i = 0; i + 1 < pts.length; i++) {
          const a = pts[i], b = pts[i + 1]; if ((a[1] - vEnd) * (b[1] - vEnd) > 0 || Math.abs(b[1] - a[1]) < 1e-6) continue;
          const t = (vEnd - a[1]) / (b[1] - a[1]); const u = a[0] + t * (b[0] - a[0]); if (u < sl.u0 || u > sl.u1) continue;
          const rad = Math.max(MIN_PIPE_R, (f.diameter_mm || 0) / 2000);
          if (f.grade === 'unknown') g.add(this.segs([u - 0.3, v, 0, u - 0.3, v, -UNKNOWN_SHEET_DEPTH, u + 0.3, v, 0, u + 0.3, v, -UNKNOWN_SHEET_DEPTH], M.whiteDash));
          else { const zc = -Math.min(D - rad, (f.depth_top_m || 0) + rad); const rr = Math.max(rad, 0.16); if (f.grade !== 'nominal') g.add(this.disc(u, v, zc, rr, 'y', COL.white)); g.add(this.ring(u, v - sgn * 0.001, zc, rr, 'y', f.grade === 'nominal' ? M.whiteDash : M.whiteThin)); }
          break;
        }
      }
    }
    // the X-ray: what the City publishes inside the block, drawn over the black as ghost lines (never as fills)
    const ghostMesh = new THREE.MeshBasicMaterial({ color: COL.white, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    const ghostEdge = this.fat(COL.white, W.heavy, { depthTest: false, opacity: 1 });
    const ghostDash = this.fat(COL.white, W.medium, { dashed: true, dash: 0.7, gap: 0.5, depthTest: false });
    const ghostRoot = this.fat(COL.white, W.medium, { depthTest: false });
    const ghostRootAcc = this.fat(COL.accentTint, W.heavy, { depthTest: false });
    const ghostCut = this.fat(COL.red, W.medium, { depthTest: false });
    for (const f of S.facilities) {
      const pts = f.path_uv; if (!pts || pts.length < 2 || f.grade === 'unknown' || f.kind === 'corridor') continue;
      if (!pts.some(([u, v]) => u >= sl.u0 - 1 && u <= sl.u1 + 1 && v >= sl.v0 - 1 && v <= sl.v1 + 1)) continue;
      const rad = Math.max(MIN_PIPE_R, (f.diameter_mm || 0) / 2000); const zc = -((f.depth_top_m || 0) + rad);
      const path = new THREE.CurvePath();
      for (let i = 0; i + 1 < pts.length; i++) path.add(new THREE.LineCurve3(new THREE.Vector3(pts[i][0], pts[i][1], zc), new THREE.Vector3(pts[i + 1][0], pts[i + 1][1], zc)));
      const tube = new THREE.Mesh(new THREE.TubeGeometry(path, Math.max(2, pts.length * 2), rad, 10, false), ghostMesh); tube.renderOrder = 5; g.add(tube);
      const axis = pts.map(([u, v]) => [u, v, zc]); const em = f.grade === 'nominal' ? ghostDash : ghostEdge;
      const top = this.polyline(axis.map(([u, v, z]) => [u, v, z + rad]), em), bot = this.polyline(axis.map(([u, v, z]) => [u, v, z - rad]), em); top.renderOrder = 6; bot.renderOrder = 6; g.add(top, bot);
    }
    const ghostRootThin = this.fat(COL.white, W.thin, { depthTest: false });
    for (const rf of this.rootFace) { for (const w of ['heavy', 'medium', 'thin']) { const a = this.segs(rf.rl[w], rf.key === 'acc' ? ghostRootAcc : w === 'thin' ? ghostRootThin : ghostRoot); a.renderOrder = 7; g.add(a); } const c = this.segs(rf.rl.cut, ghostCut); c.renderOrder = 7; g.add(c); }
    for (const f of S.corridors || []) { const [v0, v1] = f.corridor_v; const z0 = -f.depth_top_m; const cd = this.fat(COL.white, W.thin, { dashed: true, dash: 0.5, gap: 0.35, depthTest: false }); const fr = this.segs([sl.u0, v0, z0, sl.u1, v0, z0, sl.u0, v1, z0, sl.u1, v1, z0, sl.u0, v0, z0, sl.u0, v1, z0, sl.u1, v0, z0, sl.u1, v1, z0], cd); fr.renderOrder = 6; g.add(fr); }
    const nb2 = (S.candidate && S.candidate.box) ? S.candidate.box : (S.need && S.need.box);
    if (nb2) { const b = this.boxLines(nb2.u0, nb2.u1, nb2.v0, nb2.v1, -nb2.depth_m, 0, this.fat(COL.accentTint, W.heavy, { dashed: true, dash: 0.7, gap: 0.4, depthTest: false })); b.renderOrder = 8; g.add(b); }
  }

  // ---------- cameras and poses -------------------------------------------------------------------
  fitCameras() {
    const ex = this.S.extent; const aspect = this.W / this.H;
    const halfWu = (ex.u_to - ex.u_from) / 2 * 1.02;
    this.halfW = halfWu; this.halfH = halfWu / aspect;
    for (const cam of [this.camTop, this.camElev, this.camMix]) { cam.left = -this.halfW; cam.right = this.halfW; cam.top = this.halfH; cam.bottom = -this.halfH; cam.updateProjectionMatrix(); }
    const bd = this.S.band.design; const vc = bd ? (bd.v_from + bd.v_to) / 2 : this.center.v;
    this.topTarget = new THREE.Vector3(this.center.u, vc, 0);
    this.camTop.position.set(this.center.u, vc, 300); this.camTop.up.set(0, 1, 0); this.camTop.lookAt(this.topTarget);
    const sel = this.S.trees.find((t) => t.selected) || { u: this.center.u };
    this.selU = sel.u;
    this._applySection();
    this._applyAxo();
  }
  _applySection() {                       // the section window: the selected tree (+ pan), grade line at mid-height, ±HALF_H m, true scale
    const blk = this.S.street.block;
    this.elevU = Math.min(Math.max(this.selU + this.panU, blk.u_from - 4), blk.u_to + 4);
    this.elevTarget = new THREE.Vector3(this.elevU, this.cutV, 0);
    this.camElev.position.set(this.elevU, this.cutV + 300, 0); this.camElev.up.set(0, 0, 1); this.camElev.lookAt(this.elevTarget);
    const hTop = Math.round(this.H * 0.30), hB = this.H - hTop; this.elevHalfW = HALF_H * (this.W / hB);
    this.topHalfW = this.elevHalfW; this.topU = this.elevU;
  }
  _elevFrustum(hPx) {                     // true scale, mirrored in x (camera on the property side, east stays right)
    const ce = this.camElev; const asp = this.W / hPx; ce.top = HALF_H; ce.bottom = -HALF_H; ce.left = -HALF_H * asp; ce.right = HALF_H * asp;
    this.elevHalfW = HALF_H * asp;
    ce.updateProjectionMatrix(); ce.projectionMatrix.premultiply(new THREE.Matrix4().makeScale(-1, 1, 1)); ce.projectionMatrixInverse.copy(ce.projectionMatrix).invert();
  }
  _topStrip(hTop, on) {                   // the plan strip above the section: the same window, the same x scale
    const cam = this.camTop; const aspect = this.W / hTop;
    if (on) { cam.left = -this.topHalfW; cam.right = this.topHalfW; cam.top = this.topHalfW / aspect; cam.bottom = -cam.top; cam.position.x = this.topU; }
    else { cam.left = -this.halfW; cam.right = this.halfW; cam.top = this.halfH; cam.bottom = -this.halfH; cam.position.x = this.center.u; }
    cam.updateProjectionMatrix();
  }
  _applyAxo() {                           // the slab view (05): parallel projection from the road side, above
    const sl = this.axo || this.slab; if (!sl) return;
    const c = new THREE.Vector3((sl.u0 + sl.u1) / 2, (sl.v0 + sl.v1) / 2, -sl.depth_m * 0.35);
    const az = this.azimuth, el = this.elevation;
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), -Math.cos(az) * Math.cos(el), Math.sin(el));
    this.camAxo.position.copy(c).add(dir.multiplyScalar(400)); this.camAxo.up.set(0, 0, 1); this.camAxo.lookAt(c);
    const L = (sl.u1 - sl.u0), Wd = (sl.v1 - sl.v0); const half = Math.max(L, Wd) * 0.62 + 6; const asp = this.W / this.H;
    this.camAxo.left = -half; this.camAxo.right = half; this.camAxo.top = half / asp; this.camAxo.bottom = -half / asp; this.camAxo.updateProjectionMatrix();
  }
  setNeedShape(s) { this.needShape = s; if (this.needBox) this.needBox.visible = s === 'box'; if (this.needCube) this.needCube.visible = s === 'cube'; this.render(); }
  pan(du) { this.panU += du; this._applySection(); this.render(); }
  orbit(daz, del) { this.azimuth += daz; this.elevation = Math.max(0.15, Math.min(1.35, this.elevation + del)); this._applyAxo(); this.render(); }
  // t: 0..1 (01), 1..2 (02), 2..3 (03), 3..4 (04), 4..5 (05 slab)
  setPose(t) {
    this.pose = t;
    const glass = smooth((t - 1) / 0.4);                 // the ground disappears entering 02: only its edges stay
    for (const m of this.groundMeshes) { m.material.transparent = true; m.material.opacity = lerp(1, 0.0, glass); m.material.depthWrite = glass < 0.5; }
    this.g.below.visible = t >= 1;
    const toCut = smooth((t - 2) / 0.6);
    const cutOn = t >= 2.35 && t < 4;
    this.g.cut.visible = cutOn;
    this.g.slab.visible = t >= 4;
    if (this.gOwn) { this.gOwn.visible = t >= 3 && t < 4; this.gOwnPlan.visible = t >= 3; }
    if (this.needGroup) this.needGroup.visible = t < 3 || t >= 4;
    if (t >= 4) {
      for (const m of this.groundMeshes) { m.material.opacity = 1; m.material.depthWrite = true; }
      this.renderer.clippingPlanes = this.slabClip; this.activeCam = this.camAxo; this.split = false;
    } else {
      this.renderer.clippingPlanes = cutOn ? [this.clipPlane] : [];
      if (t < 2) { this.activeCam = this.camTop; this.split = false; }
      else if (toCut < 1) {
        const p = new THREE.Vector3().lerpVectors(this.camTop.position, this.camElev.position, toCut);
        const tg = new THREE.Vector3().lerpVectors(this.topTarget, this.elevTarget, toCut);
        const up = new THREE.Vector3().lerpVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), toCut).normalize();
        this.camMix.position.copy(p); this.camMix.up.copy(up); this.camMix.lookAt(tg); this.activeCam = this.camMix; this.split = false;
      } else { this.activeCam = this.camElev; this.split = true; }
    }
    this.render();
  }
  render() {
    const r = this.renderer; r.setScissorTest(false); r.setViewport(0, 0, this.W, this.H); r.clear();
    if (!this.S) return;
    if (this.split) {
      const hTop = Math.round(this.H * 0.30);
      const cam = this.camTop; this._topStrip(hTop, true);
      r.setScissorTest(true);
      r.setViewport(0, this.H - hTop, this.W, hTop); r.setScissor(0, this.H - hTop, this.W, hTop);
      const clip = r.clippingPlanes; r.clippingPlanes = []; const cutVis = this.g.cut.visible; this.g.cut.visible = false;
      r.render(this.scene, cam);
      r.clippingPlanes = clip; this.g.cut.visible = cutVis;
      const hB = this.H - hTop; this._elevFrustum(hB);
      r.setViewport(0, 0, this.W, hB); r.setScissor(0, 0, this.W, hB);
      r.render(this.scene, this.camElev);
      r.setScissorTest(false);
      this._topStrip(hTop, false);
    } else {
      r.render(this.scene, this.activeCam);
    }
  }

  // ---------- projection for the SVG overlay --------------------------------------------------------
  project(u, v, z, view = 'active') {
    const p = new THREE.Vector3(u, v, z);
    if (this.split && view === 'top') {
      const hTop = Math.round(this.H * 0.30); this._topStrip(hTop, true); p.project(this.camTop); this._topStrip(hTop, false);
      return { x: (p.x + 1) / 2 * this.W, y: (1 - p.y) / 2 * hTop };
    }
    if (this.split && view === 'elev') {
      const hTop = Math.round(this.H * 0.30); const hB = this.H - hTop; this._elevFrustum(hB); p.project(this.camElev);
      return { x: (p.x + 1) / 2 * this.W, y: hTop + (1 - p.y) / 2 * hB };
    }
    p.project(this.activeCam);
    return { x: (p.x + 1) / 2 * this.W, y: (1 - p.y) / 2 * this.H };
  }
  unprojectTopV(py) { const hTop = this.split ? Math.round(this.H * 0.30) : this.H; const aspect = this.W / hTop; const halfH = (this.split ? this.topHalfW : this.halfW) / aspect; return this.topTarget.y + (1 - 2 * py / hTop) * halfH; }
  unprojectTopU(px) { return (this.split ? this.topU : this.center.u) + (2 * px / this.W - 1) * (this.split ? this.topHalfW : this.halfW); }
  unprojectElevZ(py) { const hTop = Math.round(this.H * 0.30); const hB = this.H - hTop; return this.elevTarget.z + (1 - 2 * (py - hTop) / hB) * HALF_H; }
  unprojectElevU(px) { return this.elevU + (2 * px / this.W - 1) * this.elevHalfW; }
  unprojectU(px) { return this.center.u + (2 * px / this.W - 1) * this.halfW; }
  groundPoint(px, py) {                    // a point on the ground plane under the cursor, in whichever view is active (for the borehole)
    if (this.split) { const hTop = Math.round(this.H * 0.30); if (py <= hTop) return { u: this.unprojectTopU(px), v: this.unprojectTopV(py) }; return { u: this.unprojectElevU(px), v: this.cutV - 0.5, section: true }; }
    if (this.pose < 2) return { u: this.unprojectU(px), v: this.unprojectTopV(py) };
    const n = this._ndc(px, py, 'active'); this.ray.setFromCamera(new THREE.Vector2(n.x, n.y), n.cam);
    const hit = new THREE.Vector3(); if (this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), hit)) return { u: hit.x, v: hit.y };
    return null;
  }

  // ---------- picking ------------------------------------------------------------------------------
  _ndc(px, py, view) {
    if (this.split && view === 'top') { const hTop = Math.round(this.H * 0.30); this._topStrip(hTop, true); return { x: px / this.W * 2 - 1, y: 1 - py / hTop * 2, cam: this.camTop, ok: py <= hTop, restore: () => this._topStrip(hTop, false) }; }
    if (this.split && view === 'elev') { const hTop = Math.round(this.H * 0.30); const hB = this.H - hTop; return { x: px / this.W * 2 - 1, y: 1 - (py - hTop) / hB * 2, cam: this.camElev, ok: py > hTop }; }
    return { x: px / this.W * 2 - 1, y: 1 - py / this.H * 2, cam: this.activeCam, ok: true };
  }
  pickTree(px, py) {
    const n = this._ndc(px, py, this.split ? 'top' : 'active'); if (!n.ok) { if (n.restore) n.restore(); return null; }
    this.ray.setFromCamera(new THREE.Vector2(n.x, n.y), n.cam);
    const hit = this.ray.intersectObjects(this.pick.trees, false)[0]; if (n.restore) n.restore();
    return hit ? hit.object.userData.tree : null;
  }
  pickFacility(px, py) {
    const n = this._ndc(px, py, this.split ? 'top' : 'active'); if (!n.ok) { if (n.restore) n.restore(); return null; }
    this.ray.setFromCamera(new THREE.Vector2(n.x, n.y), n.cam);
    const hits = this.ray.intersectObjects(this.pick.facilities, true); if (n.restore) n.restore();
    for (const h of hits) { let o = h.object; while (o && !o.userData.facility) o = o.parent; if (o) return o.userData.facility; }
    return null;
  }
  snapshot() { this.render(); return this.canvas.toDataURL('image/png'); }
}
