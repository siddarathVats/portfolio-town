import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { C } from "./style";
import { PROP_CELLS, PROP } from "./propCells";
import { PLANET_RADIUS, distanceToRoute, rng } from "@/lib/world";

/**
 * The world's props, built in code from simple solids and merged into big vertex-coloured meshes.
 * Each prop is drawn in its own frame: metres, +y up, +z toward the road (its front), x across.
 */

// ---------- shared solids (non-indexed, so every face keeps its own flat normal) ----------
const flat = (g: THREE.BufferGeometry) => {
  const n = g.index ? g.toNonIndexed() : g;
  n.computeVertexNormals();
  return n;
};
const BOX = flat(new THREE.BoxGeometry(1, 1, 1));
const CYL = flat(new THREE.CylinderGeometry(0.5, 0.5, 1, 8));
const CYL12 = flat(new THREE.CylinderGeometry(0.5, 0.5, 1, 12));
const CONE = flat(new THREE.ConeGeometry(0.5, 1, 7));
// Foliage keeps smooth (sphere) normals, so canopies shade as soft round masses, not facets.
const BLOB = new THREE.IcosahedronGeometry(0.5, 2);
// Lighter versions for small or far masses, where the extra roundness can't be seen (level of detail).
const BLOB_MID = new THREE.IcosahedronGeometry(0.5, 1);
const BLOB_LOW = new THREE.IcosahedronGeometry(0.5, 0);
const CLUMP = new THREE.IcosahedronGeometry(0.5, 1);
/** A leaf: a thin round disc, scaled into an oval (flat slabs of box read as blocks). */
const DISC = flat(new THREE.CylinderGeometry(0.5, 0.5, 1, 10));
const ROCK = flat(new THREE.DodecahedronGeometry(0.5, 0));
/** Trunks and boughs: a cylinder narrowing to 0.6 of its width at the top. */
const TAPER = flat(new THREE.CylinderGeometry(0.3, 0.5, 1, 7));
/** Wheel: a ring of radius 1 in the xy plane (tube 0.12, scaled in z for thickness). */
// Geo.add reads triangles straight from the position list, so every solid must be non-indexed.
const TORUS = new THREE.TorusGeometry(1, 0.12, 6, 24).toNonIndexed();
/** A thin tyre: ring radius 1, tube 0.05 (for bicycles). */
const TYRE = new THREE.TorusGeometry(1, 0.05, 5, 28).toNonIndexed();
/** Gable roof: a triangular prism 1 wide (x), 1 tall, 1 deep (z), ridge along z. */
const PRISM = (() => {
  const s = new THREE.Shape();
  s.moveTo(-0.5, 0);
  s.lineTo(0.5, 0);
  s.lineTo(0, 1);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  return flat(g);
})();

const _m = new THREE.Matrix4();
const _n = new THREE.Matrix3();
const _v = new THREE.Vector3();
const _c = new THREE.Color();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _ext = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const _Y = new THREE.Vector3(0, 1, 0);
const _w = new THREE.Vector3();

/** A solid's distinct corners (position + normal) and the triangles over them, worked out once. */
type Shared = { p: Float32Array; n: Float32Array; idx: Uint32Array };
const shared = new WeakMap<THREE.BufferGeometry, Shared>();
function sharedOf(g: THREE.BufferGeometry): Shared {
  let s = shared.get(g);
  if (!s) {
    const src = new THREE.BufferGeometry();
    src.setAttribute("position", g.getAttribute("position"));
    src.setAttribute("normal", g.getAttribute("normal"));
    const m = mergeVertices(src, 1e-4);
    s = { p: m.getAttribute("position").array as Float32Array, n: m.getAttribute("normal").array as Float32Array, idx: Uint32Array.from(m.index!.array) };
    shared.set(g, s);
  }
  return s;
}

/**
 * Collects coloured solids into one indexed geometry: corners shared by several triangles (same
 * place, same normal) are stored and shaded once, which cuts the GPU's vertex work by a third on
 * boxes and several times over on the round foliage.
 */
export class Geo {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  /** Triangles of the large shapes only (walls, roofs, poles, canopies): the level of detail used to
   * cast shadows and to draw the street from far off, without pots, frames, bars and wires. */
  bigIdx: number[] = [];
  center = new THREE.Vector3();
  private count = 0;

  /** ao: the prop's ground point and up; corners near the ground get darker (baked occlusion). */
  add(g: THREE.BufferGeometry, m: THREE.Matrix4, color: THREE.ColorRepresentation, ao?: { o: THREE.Vector3; up: THREE.Vector3 }) {
    if (g.index) throw new Error("Geo.add needs non-indexed geometry");
    const sh = sharedOf(g);
    // How big this solid is: its longest and second-longest sides after scaling.
    const a = _ext[0].setFromMatrixColumn(m, 0).lengthSq();
    const b = _ext[1].setFromMatrixColumn(m, 1).lengthSq();
    const c = _ext[2].setFromMatrixColumn(m, 2).lengthSq();
    const big = Math.max(a, b, c) >= 0.49 && a + b + c - Math.max(a, b, c) - Math.min(a, b, c) >= 0.0144;
    _n.getNormalMatrix(m);
    _c.set(color);
    const base = this.count;
    const verts = sh.p.length / 3;
    for (let i = 0; i < verts; i++) {
      _v.fromArray(sh.p, i * 3).applyMatrix4(m);
      this.pos.push(_v.x, _v.y, _v.z);
      this.center.add(_v);
      let k = 1;
      if (ao) {
        const h = _v.sub(ao.o).dot(ao.up);
        const t = Math.min(1, Math.max(0, h / 1.2));
        k = 0.76 + 0.24 * t * t * (3 - 2 * t);
      }
      _v.fromArray(sh.n, i * 3).applyMatrix3(_n).normalize();
      this.nor.push(_v.x, _v.y, _v.z);
      this.col.push(_c.r * k, _c.g * k, _c.b * (k * 0.96 + 0.04));
    }
    for (let i = 0; i < sh.idx.length; i++) this.idx.push(base + sh.idx[i]);
    if (big) for (let i = 0; i < sh.idx.length; i++) this.bigIdx.push(base + sh.idx[i]);
    this.count += verts;
  }

  // Decals: flat quads cut from the 4×4 painted decal sheet, drawn over walls and road.
  dpos: number[] = [];
  dnor: number[] = [];
  duv: number[] = [];

  /** Add a decal quad (corners in world space, counter-clockwise from bottom-left) using sheet cell 0..15. */
  addDecal(c: THREE.Vector3[], n: THREE.Vector3, cell: number) {
    const u0 = (cell % 4) / 4 + 0.01;
    const v1 = 1 - Math.floor(cell / 4) / 4 - 0.01;
    const u1 = u0 + 0.23;
    const v0 = v1 - 0.23;
    const uv = [u0, v0, u1, v0, u1, v1, u0, v1];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      this.dpos.push(c[i].x, c[i].y, c[i].z);
      this.dnor.push(n.x, n.y, n.z);
      this.duv.push(uv[i * 2], uv[i * 2 + 1]);
    }
  }

  // Painted sheets: quads showing one cell of a painted atlas (windows, signs), one mesh per sheet.
  sheets: Record<string, { pos: number[]; nor: number[]; uv: number[] }> = {};

  /** Add a quad (corners counter-clockwise from bottom-left) showing cell `cell` of a cols × rows sheet. */
  addSheet(name: string, c: THREE.Vector3[], n: THREE.Vector3, cell: number, cols = 4, rows = 4) {
    const t = (this.sheets[name] ??= { pos: [], nor: [], uv: [] });
    const u0 = (cell % cols) / cols + 0.004;
    const v1 = 1 - Math.floor(cell / cols) / rows - 0.004;
    const u1 = u0 + 1 / cols - 0.008;
    const v0 = v1 - 1 / rows + 0.008;
    const uv = [u0, v0, u1, v0, u1, v1, u0, v1];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      t.pos.push(c[i].x, c[i].y, c[i].z);
      t.nor.push(n.x, n.y, n.z);
      t.uv.push(uv[i * 2], uv[i * 2 + 1]);
    }
  }
  addPane(c: THREE.Vector3[], n: THREE.Vector3, cell: number) {
    this.addSheet("windows", c, n, cell);
  }

  buildSheet(name: string) {
    const t = this.sheets[name];
    if (!t) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(t.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(t.nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(t.uv, 2));
    g.computeBoundingSphere();
    return g;
  }

  buildDecals() {
    if (!this.dpos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.dpos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.dnor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.duv, 2));
    g.computeBoundingSphere();
    return g;
  }

  // Leaf clumps: painted cards that turn to face the camera (foliage.ts). Per clump: its centre, the
  // normal it takes its light from, its tint, the leafy mass it belongs to, (size, turn, sheet cell,
  // height up its tree) and its tree's sway phase.
  private lv: number[][] = [[], [], [], [], [], []];
  addLeaf(c: THREE.Vector3, n: THREE.Vector3, col: THREE.Color, lobe: THREE.Vector3, size: number, turn: number, cell: number, h: number, phase: number) {
    const [lc, ln, lcol, llobe, lleaf, lph] = this.lv;
    lc.push(c.x, c.y, c.z);
    ln.push(n.x, n.y, n.z);
    lcol.push(col.r, col.g, col.b);
    llobe.push(lobe.x, lobe.y, lobe.z);
    lleaf.push(size, turn, cell, h);
    lph.push(phase);
  }
  /** One card shape, drawn once per clump. */
  buildLeaves() {
    const [lc, ln, lcol, llobe, lleaf, lph] = this.lv;
    if (!lc.length) return null;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const at = (a: number[], k: number) => new THREE.InstancedBufferAttribute(new Float32Array(a), k);
    const centres = at(lc, 3);
    g.setAttribute("iCentre", centres);
    g.setAttribute("normal", at(ln, 3));
    g.setAttribute("color", at(lcol, 3));
    g.setAttribute("iLobe", at(llobe, 3));
    g.setAttribute("iLeaf", at(lleaf, 4));
    g.setAttribute("iPhase", at(lph, 1));
    g.instanceCount = lc.length / 3;
    // Bounds from the clumps' centres, padded for the cards themselves and their sway.
    const sphere = new THREE.Box3().setFromBufferAttribute(centres).getBoundingSphere(new THREE.Sphere());
    let far = 0;
    for (let i = 0; i < centres.count; i++) far = Math.max(far, _v.fromBufferAttribute(centres, i).distanceTo(sphere.center));
    sphere.radius = far + 1.5;
    g.boundingSphere = sphere;
    // (what the culling samples, in place of the card's corners)
    g.userData.points = centres;
    return g;
  }

  // Drawn props: painted cut-outs (art/pack-props.py: potted plants, bins, a post box) standing on
  // the ground and turned about their own up to face the camera (style.ts propMaterial). Per prop:
  // its foot, its up, its size (width, height) and where its drawing is on the sheet (u0, v0, u1, v1).
  private pv: number[][] = [[], [], [], []];
  addProp(foot: THREE.Vector3, up: THREE.Vector3, h: number, cell: number) {
    const [pf, pu, ps, puv] = this.pv;
    const c = PROP_CELLS[cell % PROP_CELLS.length];
    pf.push(foot.x, foot.y, foot.z);
    pu.push(up.x, up.y, up.z);
    ps.push(h * c[4], h);
    puv.push(c[0], c[1], c[2], c[3]);
  }
  buildProps() {
    const [pf, pu, ps, puv] = this.pv;
    if (!pf.length) return null;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const at = (a: number[], k: number) => new THREE.InstancedBufferAttribute(new Float32Array(a), k);
    const feet = at(pf, 3);
    g.setAttribute("iFoot", feet);
    g.setAttribute("iUp", at(pu, 3));
    g.setAttribute("iSize", at(ps, 2));
    g.setAttribute("iUv", at(puv, 4));
    g.instanceCount = pf.length / 3;
    const sphere = new THREE.Box3().setFromBufferAttribute(feet).getBoundingSphere(new THREE.Sphere());
    let far = 0;
    for (let i = 0; i < feet.count; i++) far = Math.max(far, _v.fromBufferAttribute(feet, i).distanceTo(sphere.center));
    sphere.radius = far + 1.5;
    g.boundingSphere = sphere;
    g.userData.points = feet;
    return g;
  }

  // Flower heads: drawn cards that turn to face the camera (foliage.ts), on the tips of their stems.
  // Per head: its centre, petal colour, centre colour and the centre's radius, and (size, petals,
  // petal shape, turn).
  private fv: number[][] = [[], [], [], [], []];
  addFlower(c: THREE.Vector3, up: THREE.Vector3, petal: THREE.Color, eye: THREE.Color, eyeR: number, size: number, petals: number, shape: number, turn: number) {
    const [fc, fn, fcol, feye, fl] = this.fv;
    fc.push(c.x, c.y, c.z);
    fn.push(up.x, up.y, up.z);
    fcol.push(petal.r, petal.g, petal.b);
    feye.push(eye.r, eye.g, eye.b, eyeR);
    fl.push(size, petals, shape, turn);
  }
  buildFlowers() {
    const [fc, fn, fcol, feye, fl] = this.fv;
    if (!fc.length) return null;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const at = (a: number[], k: number) => new THREE.InstancedBufferAttribute(new Float32Array(a), k);
    const centres = at(fc, 3);
    g.setAttribute("iCentre", centres);
    g.setAttribute("normal", at(fn, 3));
    g.setAttribute("color", at(fcol, 3));
    g.setAttribute("iEye", at(feye, 4));
    g.setAttribute("iFlower", at(fl, 4));
    g.instanceCount = fc.length / 3;
    const sphere = new THREE.Box3().setFromBufferAttribute(centres).getBoundingSphere(new THREE.Sphere());
    let far = 0;
    for (let i = 0; i < centres.count; i++) far = Math.max(far, _v.fromBufferAttribute(centres, i).distanceTo(sphere.center));
    sphere.radius = far + 0.5;
    g.boundingSphere = sphere;
    g.userData.points = centres;
    return g;
  }

  // Dressed stone (the bridge): its own mesh, the joints between stones drawn on (stoneMaterial).
  private sv = { pos: [] as number[], nor: [] as number[], st: [] as number[], idx: [] as number[] };
  addStone(pos: number[], nor: number[], st: number[], idx: number[]) {
    const base = this.sv.pos.length / 3;
    for (let i = 0; i < pos.length; i++) {
      this.sv.pos.push(pos[i]);
      this.sv.nor.push(nor[i]);
      this.sv.st.push(st[i]);
    }
    for (const i of idx) this.sv.idx.push(base + i);
  }
  buildStone() {
    if (!this.sv.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.sv.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.sv.nor, 3));
    g.setAttribute("stone", new THREE.Float32BufferAttribute(this.sv.st, 3));
    g.setIndex(this.sv.idx);
    g.computeBoundingSphere();
    return g;
  }

  // Grass blades: thin triangles, sway 0 at the root and 1 at the tip.
  private bv: number[][] = [[], [], [], []];
  addBlade(a: THREE.Vector3, b: THREE.Vector3, tip: THREE.Vector3, n: THREE.Vector3, root: THREE.Color, top: THREE.Color) {
    const [pos, nor, col, sway] = this.bv;
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, tip.x, tip.y, tip.z);
    for (let i = 0; i < 3; i++) nor.push(n.x, n.y, n.z);
    col.push(root.r, root.g, root.b, root.r, root.g, root.b, top.r, top.g, top.b);
    sway.push(0, 0, 1);
  }
  buildBlades() {
    const [pos, nor, col, sway] = this.bv;
    if (!pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute("sway", new THREE.Float32BufferAttribute(sway, 1));
    g.computeBoundingSphere();
    return g;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    // The large-shapes version shares this one's vertex data (uploaded once), with its own index.
    const lod = new THREE.BufferGeometry();
    for (const name of ["position", "normal", "color"]) lod.setAttribute(name, g.getAttribute(name));
    lod.setIndex(this.bigIdx.length ? this.bigIdx : [0, 0, 0]);
    g.computeBoundingSphere();
    lod.boundingSphere = g.boundingSphere!.clone();
    g.userData.lod = lod;
    return g;
  }

  get empty() {
    return this.count === 0;
  }
}

/** A prop's frame, plus helpers that place solids in it. */
export class Kit {
  private ao: { o: THREE.Vector3; up: THREE.Vector3 };
  /**
   * How dressed a building is: 0 a quiet facade (windows, door, the roof line, a drain pipe), 1 the
   * usual fittings (meters, lamps, AC units, balconies, signs), 2 a landmark's full dressing.
   */
  detail = 1;
  /** Clear ground beside the side walls (-x, +x), in metres: what may stick out there (a stair, an AC unit). */
  sideRoom: [number, number] = [0.3, 0.3];
  /** How far the building's cornice or eaves reach out past its walls (m), once it is built. */
  reach = 0.25;
  /** Doors, windows and shop fronts on the front wall (x from, to, y from, to): painted wear keeps off them. */
  openings: [number, number, number, number][] = [];
  /** Whether a patch of the front wall (centre x, y, size w, h) would cover a door or window. */
  overOpening(x: number, y: number, w: number, h: number) {
    return this.openings.some(([x0, x1, y0, y1]) => x + w / 2 > x0 && x - w / 2 < x1 && y + h / 2 > y0 && y - h / 2 < y1);
  }
  constructor(
    public g: Geo,
    public frame: THREE.Matrix4,
  ) {
    const o = new THREE.Vector3().setFromMatrixPosition(frame);
    this.ao = { o, up: o.clone().normalize() };
  }
  private put(geo: THREE.BufferGeometry, x: number, y: number, z: number, w: number, h: number, d: number, color: THREE.ColorRepresentation, rx = 0, ry = 0, rz = 0) {
    _q.setFromEuler(_e.set(rx, ry, rz));
    _m.compose(_p.set(x, y, z), _q, _s.set(w, h, d));
    this.g.add(geo, _m.premultiply(this.frame), color, this.ao);
  }
  /** A decal on a wall facing +z (dir -1: the back wall), centred at (x, y), size w × h. */
  decal(x: number, y: number, z: number, w: number, h: number, cell: number, dir = 1) {
    const zz = z + 0.015 * dir;
    const pts = [
      [x - (w / 2) * dir, y - h / 2],
      [x + (w / 2) * dir, y - h / 2],
      [x + (w / 2) * dir, y + h / 2],
      [x - (w / 2) * dir, y + h / 2],
    ].map(([px, py]) => new THREE.Vector3(px, py, zz).applyMatrix4(this.frame));
    this.g.addDecal(pts, new THREE.Vector3(0, 0, dir).transformDirection(this.frame), cell);
  }
  /** A cell of a painted sheet on a wall facing +z (dir -1: the back wall), centred at (x, y, z). */
  sheetZ(name: string, cell: number, cols: number, rows: number, x: number, y: number, z: number, w: number, h: number, dir = 1) {
    const pts = [
      [x - (w / 2) * dir, y - h / 2],
      [x + (w / 2) * dir, y - h / 2],
      [x + (w / 2) * dir, y + h / 2],
      [x - (w / 2) * dir, y + h / 2],
    ].map(([px, py]) => new THREE.Vector3(px, py, z).applyMatrix4(this.frame));
    this.g.addSheet(name, pts, new THREE.Vector3(0, 0, dir).transformDirection(this.frame), cell, cols, rows);
  }
  /** A cell of a painted sheet on a side wall facing +x (sx 1) or -x (sx -1), centred at (x, y, z). */
  sheetX(name: string, cell: number, cols: number, rows: number, x: number, y: number, z: number, w: number, h: number, sx: number) {
    const pts = [
      [z + (w / 2) * sx, y - h / 2],
      [z - (w / 2) * sx, y - h / 2],
      [z - (w / 2) * sx, y + h / 2],
      [z + (w / 2) * sx, y + h / 2],
    ].map(([pz, py]) => new THREE.Vector3(x, py, pz).applyMatrix4(this.frame));
    this.g.addSheet(name, pts, new THREE.Vector3(sx, 0, 0).transformDirection(this.frame), cell, cols, rows);
  }
  /** A drawn prop (PROP_CELLS: which drawing) standing at (x, y, z), h metres tall. */
  sprite(x: number, y: number, z: number, h: number, cell: number) {
    const foot = new THREE.Vector3(x, y, z).applyMatrix4(this.frame);
    const up = new THREE.Vector3(0, 1, 0).transformDirection(this.frame);
    this.g.addProp(foot, up, h, cell);
  }
  /** A cell picked from where the thing stands, so the world's random sequence (and layout) is untouched. */
  spotCell(x: number, y: number, z: number, n: number) {
    _v.set(x, y, z).applyMatrix4(this.frame);
    return Math.floor(Math.abs(Math.sin(_v.x * 12.9898 + _v.y * 78.233 + _v.z * 37.719) * 43758.5453)) % n;
  }
  /** A painted window pane on a wall facing +z (dir -1: the back wall), centred at (x, y, z). */
  pane(x: number, y: number, z: number, w: number, h: number, dir = 1) {
    const pts = [
      [x - (w / 2) * dir, y - h / 2],
      [x + (w / 2) * dir, y - h / 2],
      [x + (w / 2) * dir, y + h / 2],
      [x - (w / 2) * dir, y + h / 2],
    ].map(([px, py]) => new THREE.Vector3(px, py, z).applyMatrix4(this.frame));
    // Which window drawing: from where it is, so the world's random sequence (and layout) is untouched.
    const c = pts[0];
    const cell = Math.floor(Math.abs(Math.sin(c.x * 12.9898 + c.y * 78.233 + c.z * 37.719) * 43758.5453)) % 16;
    this.g.addPane(pts, new THREE.Vector3(0, 0, dir).transformDirection(this.frame), cell);
  }
  /** A painted window pane on a side wall facing +x (sx 1) or -x (sx -1), centred at (x, y, z). */
  paneX(x: number, y: number, z: number, w: number, h: number, sx: number) {
    const pts = [
      [z + (w / 2) * sx, y - h / 2],
      [z - (w / 2) * sx, y - h / 2],
      [z - (w / 2) * sx, y + h / 2],
      [z + (w / 2) * sx, y + h / 2],
    ].map(([pz, py]) => new THREE.Vector3(x, py, pz).applyMatrix4(this.frame));
    const c = pts[0];
    const cell = Math.floor(Math.abs(Math.sin(c.x * 12.9898 + c.y * 78.233 + c.z * 37.719) * 43758.5453)) % 16;
    this.g.addPane(pts, new THREE.Vector3(sx, 0, 0).transformDirection(this.frame), cell);
  }
  /** A decal lying on the ground at (x, z), size s, turned by rot. */
  decalFlat(x: number, z: number, s: number, cell: number, rot = 0) {
    const c = Math.cos(rot) * (s / 2);
    const n = Math.sin(rot) * (s / 2);
    const pts = [
      [-c + n, n + c],
      [c + n, -n + c],
      [c - n, -n - c],
      [-c - n, n - c],
    ].map(([dx, dz]) => new THREE.Vector3(x + dx, 0.05, z + dz).applyMatrix4(this.frame));
    this.g.addDecal(pts, new THREE.Vector3(0, 1, 0).transformDirection(this.frame), cell);
  }
  /** A thin bicycle tyre of radius r in the xy plane. */
  tyre(x: number, y: number, z: number, r: number, color: THREE.ColorRepresentation) {
    this.put(TYRE, x, y, z, r, r, r, color);
  }
  torus(x: number, y: number, z: number, r: number, tube: number, color: THREE.ColorRepresentation, ry = 0) {
    this.put(TORUS, x, y, z, r, r, tube / 0.12, color, 0, ry);
  }
  /** Box standing on y (its bottom at y). */
  box(x: number, y: number, z: number, w: number, h: number, d: number, color: THREE.ColorRepresentation, ry = 0) {
    // (sizes taken as positive: a box given a negative depth, as for the back wall, came out mirrored,
    // inside out, its face against the wall the one that showed, flickering with the wall)
    this.put(BOX, x, y + h / 2, z, Math.abs(w), h, Math.abs(d), color, 0, ry);
  }
  /** Box centred at y, tilted. */
  tilted(x: number, y: number, z: number, w: number, h: number, d: number, color: THREE.ColorRepresentation, rx = 0, ry = 0, rz = 0) {
    this.put(BOX, x, y, z, w, h, d, color, rx, ry, rz);
  }
  cyl(x: number, y: number, z: number, r: number, h: number, color: THREE.ColorRepresentation, smooth = false) {
    this.put(smooth ? CYL12 : CYL, x, y + h / 2, z, r * 2, h, r * 2, color);
  }
  cone(x: number, y: number, z: number, r: number, h: number, color: THREE.ColorRepresentation) {
    this.put(CONE, x, y + h / 2, z, r * 2, h, r * 2, color);
  }
  /** Metres from the prop to the lane, worked out once (for level of detail). */
  get fromLane() {
    return (this._fromLane ??= distanceToRoute(this.ao.o));
  }
  private _fromLane?: number;
  blob(x: number, y: number, z: number, r: number, color: THREE.ColorRepresentation, sy = 1) {
    // Full roundness only where it shows: big masses near the street.
    const geo = r < 0.1 ? BLOB_LOW : r < 0.2 || this.fromLane > 7 ? BLOB_MID : BLOB;
    this.put(geo, x, y, z, r * 2, r * 2 * sy, r * 2, color);
  }
  /** A small faceted leaf clump, turned at random: many of these read as brushwork. */
  /** A flat leaf, w across and d long (h thick), turned like `tilted`. */
  leaf(x: number, y: number, z: number, w: number, h: number, d: number, color: THREE.ColorRepresentation, rx = 0, ry = 0, rz = 0) {
    this.put(DISC, x, y, z, w, h, d, color, rx, ry, rz);
  }
  clump(x: number, y: number, z: number, r: number, color: THREE.ColorRepresentation, ry: number, rx: number) {
    this.put(CLUMP, x, y, z, r * 2, r * 1.5, r * 2, color, rx, ry);
  }
  rock(x: number, y: number, z: number, r: number, color: THREE.ColorRepresentation, ry = 0) {
    this.put(ROCK, x, y, z, r * 2, r * 1.3, r * 2, color, 0, ry);
  }
  /** A random sequence of this prop's own, from where it stands: drawing from it leaves the world's
   *  sequence, and so the layout of everything placed after, as it was. */
  own(): R {
    _w.setFromMatrixPosition(this.frame);
    return rng(Math.floor(Math.abs(Math.sin(_w.x * 12.9898 + _w.y * 78.233 + _w.z * 37.719) * 43758.5453) * 1e4) + 1);
  }
  /** A trunk or bough from one point to another, r its radius at the foot. */
  limb(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r: number, color: THREE.ColorRepresentation) {
    const d = _w.set(x1 - x0, y1 - y0, z1 - z0);
    const len = d.length();
    _q.setFromUnitVectors(_Y, d.divideScalar(len));
    _m.compose(_p.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), _q, _s.set(r * 2, len, r * 2));
    this.g.add(TAPER, _m.premultiply(this.frame), color, this.ao);
  }
  /**
   * A leafy mass round (x, y, z): drawn clumps spread over a ball of radius `rad` (squashed in height
   * by `squash`), each lit by the ball's normal where it sits, leaning out from the trunk, so the
   * mass shades as one rounded shape. `top` is the tree's height (the higher a clump, the more it
   * sways); `cell` picks the clump drawing (0, 1 broad leaves, 2 needles, 3 small leaves).
   */
  lobe(x: number, y: number, z: number, rad: number, color: THREE.Color, q: R, o: { cell: number; top: number; phase: number; squash?: number }) {
    // Far from the lane, fewer and bigger clumps: the outline still reads, at half the cards.
    const far = this.fromLane > 13;
    const n = Math.round(Math.min(34, Math.max(12, 10 + 28 * rad)) * (far ? 0.45 : 1));
    const sq = o.squash ?? 1;
    const centre = new THREE.Vector3(x, y, z).applyMatrix4(this.frame);
    const lean = Math.hypot(x, z) > 0.05 ? 0.3 / Math.hypot(x, z) : 0;
    const spin = q() * 6.28;
    const out = 0.62 * rad;
    for (let i = 0; i < n; i++) {
      // Even spread over the ball (a Fibonacci spiral).
      const dy = 1 - (2 * (i + 0.5)) / n;
      const rr = Math.sqrt(1 - dy * dy);
      const th = i * 2.39996 + spin;
      const dx = Math.cos(th) * rr;
      const dz = Math.sin(th) * rr;
      const c = new THREE.Vector3(x + dx * out, y + dy * out * sq, z + dz * out).applyMatrix4(this.frame);
      const nrm = _w.set(dx + x * lean, dy / Math.max(0.6, sq) + 0.15, dz + z * lean).normalize().transformDirection(this.frame);
      // Underneath a shade darker, and every clump a touch different.
      _c.copy(color).multiplyScalar((0.86 + 0.14 * (dy * 0.5 + 0.5)) * (0.95 + 0.1 * q()));
      const h = Math.min(1, Math.max(0, (y + dy * out * sq) / o.top));
      this.g.addLeaf(c, nrm, _c, centre, rad * 1.7 * (0.9 + 0.25 * q()) * (far ? 1.25 : 1), q() * 6.28, o.cell, h, o.phase);
    }
  }
  /** A tuft of grass blades at (x, z), each fanning out from the middle, h tall; or with `fern`,
   *  broader fronds arching out low and wide. */
  blades(x: number, z: number, n: number, h: number, q: R, fern = false) {
    const up = _Y.clone().transformDirection(this.frame);
    const root = new THREE.Color();
    const top = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const a = q() * 6.28;
      const lean = fern ? 0.9 + q() * 0.5 : 0.2 + q() * 0.45;
      const hh = h * (0.65 + 0.6 * q());
      const w = fern ? 0.07 + q() * 0.04 : 0.026 + q() * 0.022;
      const bx = x + Math.cos(a) * 0.025;
      const bz = z + Math.sin(a) * 0.025;
      const px = (-Math.sin(a) * w) / 2;
      const pz = (Math.cos(a) * w) / 2;
      const p0 = new THREE.Vector3(bx + px, -0.03, bz + pz).applyMatrix4(this.frame);
      const p1 = new THREE.Vector3(bx - px, -0.03, bz - pz).applyMatrix4(this.frame);
      const tip = new THREE.Vector3(bx + Math.cos(a) * lean * hh, hh, bz + Math.sin(a) * lean * hh).applyMatrix4(this.frame);
      root.set(fern ? C.fern[0] : C.blade[0]).multiplyScalar(0.9 + 0.15 * q());
      top.set(fern ? C.fern[1] : C.blade[1]).lerp(root, q() * 0.4);
      this.g.addBlade(p0, p1, tip, up, root, top);
    }
  }
  /**
   * A flower at (x, z): a stem leaning up to its head h high, the head a drawn card (see foliage.ts):
   * `petals` petals of `shape` (above 1 thin, below 1 broad and round), a centre of `eye` colour.
   */
  flower(x: number, z: number, h: number, size: number, petal: THREE.Color, eye: THREE.Color, eyeR: number, petals: number, shape: number, q: R) {
    const up = _Y.clone().transformDirection(this.frame);
    const a = q() * 6.28;
    const lean = 0.02 + q() * 0.05;
    const tip = new THREE.Vector3(x + Math.cos(a) * lean, h, z + Math.sin(a) * lean).applyMatrix4(this.frame);
    const w = 0.009 + q() * 0.005;
    const p0 = new THREE.Vector3(x + w, -0.03, z).applyMatrix4(this.frame);
    const p1 = new THREE.Vector3(x - w, -0.03, z).applyMatrix4(this.frame);
    this.g.addBlade(p0, p1, tip, up, _c.set(C.stem[0]), new THREE.Color(C.stem[1]));
    // (the stem's tip and the head sway as one: both take the wind at the tip's own place)
    this.g.addFlower(tip, up, petal, eye, eyeR, size, petals, shape, q() * 6.28);
  }
  prism(x: number, y: number, z: number, w: number, h: number, d: number, color: THREE.ColorRepresentation, ry = 0) {
    this.put(PRISM, x, y, z, w, h, d, color, 0, ry);
  }
}

type R = () => number;
const pick = <T,>(r: R, a: readonly T[]) => a[Math.floor(r() * a.length)];
/**
 * Something that used to be built here and is now drawn (a prop sprite): it is still "built" into a
 * scrap pile that is thrown away, so it takes the world's random draws just as it did and everything
 * placed after it stays where it was.
 */
const scrap = new Geo();
function unbuilt(k: Kit, build: (k: Kit) => void) {
  build(new Kit(scrap, k.frame));
  scrap.pos.length = scrap.nor.length = scrap.col.length = scrap.idx.length = scrap.bigIdx.length = 0;
}
export const FLOOR = 1.45;
/** How far a building's footing reaches below its floor: enough for the steepest hillside plot. */
const FOUNDATION = 1.5;

/** A drain pipe down a wall from h to the ground, with a kink near the top. */
function pipe(k: Kit, x: number, z: number, h: number, out = 0.08) {
  k.cyl(x, 0, z + out, 0.045, h - 0.35, C.metal, true);
  k.tilted(x, h - 0.2, z + out / 2, 0.08, 0.32, 0.08, C.metal, 0.5);
  for (let y = 0.6; y < h - 0.4; y += 1.2) k.box(x, y, z + out / 2, 0.12, 0.05, out, C.metalDark);
}
/** One window on a wall facing +z: frame, glass split by a mullion, sometimes bars or a sill garden. */
function windowAt(k: Kit, x: number, y: number, z: number, r: R, wide: number, dir = 1) {
  if (dir > 0 && z > 0) k.openings.push([x - wide / 2 - 0.14, x + wide / 2 + 0.14, y - 0.15, y + 0.8]);
  const frame = r() < 0.7 ? C.frame : C.metal;
  // Back rows, seen only from across the valley, get the window but not its small dressing.
  const far = k.fromLane > 9;
  // Rain streaks below the sill: two faint darker drips on the wall (fewer on a quiet facade).
  if (!far && r() < (k.detail ? 0.55 : 0.25))
    for (const sx of [-0.22, 0.18]) {
      const len = 0.25 + r() * 0.45;
      const thick = 0.05 + r() * 0.06;
      // (not down across a door or a window below: a streak's face lies in the plane of a door's dark
      // reveal, and where one ran into a doorway the two flickered through each other)
      if (dir > 0 && z > 0 && k.overOpening(x + sx * wide, y - 0.44 - len / 2, thick, len)) continue;
      k.box(x + sx * wide, y - 0.44 - len, z + 0.004 * dir, thick, len, 0.008, "#b9bfb7");
    }
  k.box(x, y - 0.06, z, wide + 0.12, 0.76, 0.06 * dir, frame);
  k.box(x, y, z + 0.035 * dir, wide, 0.62, 0.04, r() < 0.1 ? C.windowLit : C.window);
  // The glass shows a painted window (curtains, blinds, a lamp-lit room...) instead of flat teal.
  // (a centimetre in front of the glass: 3 mm was within the depth buffer's grain across the valley,
  // and the painted window flickered with the plain glass behind it)
  k.pane(x, y + 0.31, z + 0.065 * dir, wide, 0.62, dir);
  if (far || !k.detail) return;
  const u = r();
  if (u < (k.detail > 1 ? 0.22 : 0.12)) {
    // Security bars.
    for (let i = 0; i < 4; i++) k.box(x - wide / 2 + (wide * (i + 0.5)) / 4, y - 0.04, z + 0.1 * dir, 0.025, 0.7, 0.025, C.metalDark);
    k.box(x, y + 0.02, z + 0.1 * dir, wide + 0.08, 0.03, 0.06, C.metalDark);
  } else if (u < (k.detail > 1 ? 0.32 : 0.16)) {
    // A little sill garden.
    k.box(x, y - 0.12, z + 0.12 * dir, wide, 0.12, 0.2, "#efefe8");
    for (let i = 0; i < 3; i++) {
      const px = x - wide / 3 + (i * wide) / 3;
      pick(r, C.leaf);
      r();
      k.sprite(px, y - 0.02, z + 0.12 * dir, 0.34, PROP.plants[k.spotCell(px, y, z, PROP.plants.length)]);
    }
  }
}
/** Balcony slab with a railing (and sometimes laundry or plants) in front of a window. */
function balcony(k: Kit, x: number, y: number, z: number, w: number, r: R) {
  // First-floor balconies stay shallow (the low camera passes under them); higher ones reach out.
  const deep = y > FLOOR + 0.1 ? 0.8 : 0.42;
  k.box(x, y - 0.12, z + deep / 2, w + 0.1, 0.12, deep, C.concrete[1]);
  const rail = r() < 0.5 ? C.metal : C.frame;
  k.box(x, y + 0.55, z + deep - 0.11, w, 0.05, 0.05, rail);
  const bars = Math.max(2, Math.round(w / 0.36));
  for (let i = 0; i <= bars; i++) k.box(x - w / 2 + (w * i) / bars, y, z + deep - 0.11, 0.03, 0.55, 0.03, rail);
  if (r() < 0.4) {
    // Laundry on a pole.
    k.box(x, y + 1.0, z + deep * 0.7, w - 0.1, 0.03, 0.03, C.metal);
    for (let i = 0; i < 3; i++) k.box(x - w / 3 + (i * w) / 3, y + 0.62, z + deep * 0.7, 0.26, 0.36, 0.02, pick(r, ["#f4f2ea", "#d9a441", "#7aa7c7", "#e6a7a0"]));
  } else if (r() < 0.5) {
    for (let i = 0; i < 2; i++) {
      const px = x - w / 4 + i * (w / 2);
      unbuilt(k, (q) => pottedGreens(q, r, px, y + 0.28, z + deep * 0.55, 0.2));
      k.sprite(px, y, z + deep * 0.55, 0.5, PROP.plants[k.spotCell(px, y, z, PROP.plants.length)]);
    }
  }
}
/** Rows of windows over floors [from, floors) of a wall facing +z. */
function windows(k: Kit, w: number, z: number, floors: number, from: number, r: R, dir = 1, balconies = false) {
  // Each building gets its own rhythm: two or three windows, unevenly spaced, sometimes paired.
  const n = Math.max(1, Math.min(3, Math.floor((w - 0.4) / 1.15)));
  const xs = Array.from({ length: n }, (_, i) => -w / 2 + (w / n) * (i + 0.5) + (r() - 0.5) * 0.35);
  // A quiet facade keeps its balconies to one column, stacked, instead of scattered over the wall.
  const column = xs[Math.floor(r() * xs.length)];
  for (let f = from; f < floors; f++) {
    for (const x of xs) {
      // A deep recess behind some windows, a darker shape that reads as depth.
      if (r() < 0.3) k.box(x, f * FLOOR + 0.12, z + 0.01 * dir, 0.95, 0.9, 0.02, "#8f9893");
      const y = f * FLOOR + 0.5;
      windowAt(k, x, y, z, r, 0.56 + r() * 0.12, dir);
      const balconyHere = k.detail ? r() < (k.detail > 1 ? 0.4 : 0.3) : x === column && r() < 0.35;
      if (balconies && dir > 0 && f > 0 && balconyHere) balcony(k, x, f * FLOOR, z, Math.min(w / n - 0.1, 1.1), r);
      // (no boxes bolted to the walls, AC units and the like: they read as floating blocks; (the draw that once placed it is still taken, so nothing placed after it moves))
      else if (k.detail) r();
    }
  }
}
/** A doorway: concrete surround, a little canopy, a step. */
function door(k: Kit, x: number, z: number, r: R) {
  // A recessed doorway: jambs and a lintel standing proud, the door set back in a dark reveal.
  const jamb = C.concrete[2];
  k.openings.push([x - 0.6, x + 0.6, 0, 1.6]);
  // (each layer stands a little proud of the one behind: set flush, the reveal's face lay in the
  // wall's and the door's in the grime band's, and the two flickered through each other)
  k.box(x, 0, z - 0.012, 0.86, 1.3, 0.04, "#334043");
  for (const sx of [-1, 1]) k.box(x + sx * 0.47, 0, z + 0.05, 0.12, 1.4, 0.22, jamb);
  k.box(x, 1.3, z + 0.05, 1.06, 0.14, 0.22, jamb);
  k.box(x, 0, z + 0.015, 0.7, 1.18, 0.05, pick(r, [C.door, "#7a6a58", "#5f7f86", "#c46b5b", "#3f7fa0", "#d4a24a"]));
  k.box(x + 0.24, 0.56, z + 0.05, 0.05, 0.05, 0.03, C.yellow);
  // Canopy and step.
  k.box(x, 1.5, z + 0.24, 1.2, 0.08, 0.48, C.concrete[1]);
  k.box(x, 0, z + 0.25, 1.0, 0.1, 0.45, C.concrete[0]);
  if (!k.detail) return;
  // (No meter, mailbox or intercom boxes beside it: they read as floating blocks. The draw that
  // coloured the mailbox is still taken, so nothing placed after moves.)
  r();
}
/** A vertical blade sign of abstract glyph blocks, sticking out from a wall at x, below its roof line `top`. */
function bladeSign(k: Kit, x: number, y: number, z: number, r: R, top: number) {
  const c = pick(r, C.sign);
  const h = Math.min(1 + r() * 0.8, top - y - 0.2);
  k.box(x, y, z + 0.3, 0.1, h, 0.42, c);
  // Both faces painted: one of the eight drawn blade signs (see art/signs-atlas-codex.png).
  const cell = k.spotCell(x, y, z, 8);
  k.sheetX("signs", cell, 8, 2, x + 0.052, y + h / 2, z + 0.3, 0.42, h, 1);
  k.sheetX("signs", cell, 8, 2, x - 0.052, y + h / 2, z + 0.3, 0.42, h, -1);
  k.box(x, y + h - 0.02, z + 0.1, 0.06, 0.06, 0.24, C.metalDark);
}
/** Rooftop: a parapet, and on some roofs a water tank on legs or a stair hut, an antenna, a dish. */
function rooftop(k: Kit, w: number, d: number, h: number, r: R) {
  const band = C.concrete[3];
  const ph = 0.15 + r() * 0.5;
  k.box(0, h, d / 2 - 0.05, w, ph, 0.1, band);
  k.box(0, h, -d / 2 + 0.05, w, ph, 0.1, band);
  k.box(w / 2 - 0.05, h, 0, 0.1, ph, d, band);
  k.box(-w / 2 + 0.05, h, 0, 0.1, ph, d, band);
  // A quiet roof has one thing on it at most, a tank or a stair hut, and most have nothing.
  const u = r() / (k.detail ? 1 : 0.35);
  if (u < 0.4) {
    for (const [x, z] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) k.box(w / 4 + x, h, -d / 6 + z, 0.06, 0.5, 0.06, C.metalDark);
    k.cyl(w / 4, h + 0.5, -d / 6, 0.38, 0.7, "#eae7dc", true);
  } else if (u < 0.7) {
    k.box(-w / 4, h, -d / 6, 1.1, 1.0, 1.0, C.concrete[1]);
    k.box(-w / 4, h, -d / 6 + 0.51, 0.55, 0.85, 0.03, C.door);
  }
  if (!k.detail) return;
  if (r() < (k.detail > 1 ? 0.5 : 0.3)) {
    k.cyl(w / 3, h, d / 4, 0.025, 1.4, C.metalDark);
    k.box(w / 3, h + 1.2, d / 4, 0.6, 0.03, 0.03, C.metalDark);
  }
  if (r() < (k.detail > 1 ? 0.35 : 0.15)) k.tilted(-w / 3, h + 0.5, d / 4, 0.45, 0.45, 0.05, "#eeeee6", -0.5, 0.6);
}
/** External stair up the side of a block (+x side, reaching 0.85 m out), with a railing. */
function sideStair(k: Kit, w: number, d: number, floors: number) {
  for (let f = 0; f < Math.min(floors - 1, 3); f++) {
    const y = f * FLOOR;
    k.tilted(w / 2 + 0.45, y + FLOOR / 2, 0, 0.8, 0.08, d * 0.95, C.concrete[2], Math.atan2(FLOOR, d * 0.9) * (f % 2 ? -1 : 1));
    k.box(w / 2 + 0.45, y + FLOOR - 0.1, (f % 2 ? 1 : -1) * (d / 2 - 0.35), 0.8, 0.1, 0.7, C.concrete[2]);
    k.box(w / 2 + 0.84, y + FLOOR, 0, 0.04, 0.6, d, C.metal);
  }
}

/** Gooseneck wall lamp. */
function wallLamp(k: Kit, x: number, y: number, z: number) {
  k.box(x, y, z + 0.03, 0.08, 0.14, 0.06, C.metalDark);
  k.tilted(x, y + 0.12, z + 0.2, 0.04, 0.04, 0.36, C.metalDark, 0.35);
  k.cone(x, y + 0.02, z + 0.38, 0.14, 0.12, "#7f8c86");
}
/**
 * Finishes the faces of a box building (w × h × d, centred, front at +z): corner trim, a base plinth
 * and cornice and small side windows on every building, so none looks unfinished; meters, vents,
 * lamps, cable runs, AC units and posters only by its detail, so most facades stay quiet and the
 * dressed ones stand out.
 */
function fixtures(k: Kit, r: R, w: number, d: number, h: number, wall: THREE.ColorRepresentation) {
  const trim = new THREE.Color(wall).multiplyScalar(0.88);
  const plinth = new THREE.Color(wall).multiplyScalar(0.78);
  for (const [x, z] of [[-w / 2, d / 2], [w / 2, d / 2], [-w / 2, -d / 2], [w / 2, -d / 2]]) k.box(x, 0, z, 0.14, h, 0.14, trim);
  // The plinth runs on down as a foundation, so on a slope the downhill side stands on concrete
  // instead of floating over the grass (where the ground is flat it is simply buried).
  k.box(0, -FOUNDATION, 0, w + 0.05, 0.32 + FOUNDATION, d + 0.05, plinth);
  // Grime where the wall meets the ground and under the first floor line.
  k.box(0, 0.32, 0, w + 0.03, 0.18, d + 0.03, new THREE.Color(wall).multiplyScalar(0.9));
  // (its top a centimetre over the roof's, not level with it: from above the two flickered)
  k.box(0, h - 0.13, 0, w + 0.5, 0.14, d + 0.5, trim);
  const dressed = k.detail > 0;
  // Front: a lamp, a cable run along the first floor line. (No meter or vent boxes: they read as
  // floating blocks; the draws that placed them are still taken, so nothing after them moves.)
  if (dressed) {
    // (over the door canopy: only where the wall rises above it)
    if (h > 2.6 && r() < (k.detail > 1 ? 0.7 : 0.5)) wallLamp(k, w / 2 - 0.45, 2.15, d / 2);
    if (k.detail > 1 && r() < 0.5) k.box(0, FLOOR - 0.25, d / 2 + 0.05, w - 0.3, 0.03, 0.03, C.metalDark);
    r();
  }
  // Sides: a small window per floor (where an AC unit or a vent once went, nothing), a cable drop on
  // a dressed building; a drain pipe down one side, or both.
  for (const sx of [-1, 1]) {
    const x = (sx * w) / 2;
    const room = k.sideRoom[sx < 0 ? 0 : 1];
    for (let y = 0.6; y < h - 0.6; y += FLOOR) {
      const z = (r() - 0.5) * (d - 1.2);
      if (r() < (dressed ? 0.6 : 0.5)) {
        k.box(x + sx * 0.03, y, z, 0.06, 0.62, 0.62, C.frame);
        k.box(x + sx * 0.06, y + 0.06, z, 0.04, 0.5, 0.5, C.window);
        k.paneX(x + sx * 0.09, y + 0.31, z, 0.5, 0.5, sx);
      } else if (dressed && room > 0.5) r();
    }
    if (dressed || sx > 0) k.cyl(x + sx * 0.08, 0, d / 2 - 0.35, 0.04, h - 0.2, C.metal, true);
    if (dressed && r() < 0.35) k.box(x + sx * 0.05, 0.4, -d / 4, 0.035, h - 0.6, 0.035, C.metalDark);
  }
  // Painted wear from the decal sheet: drips under the roof line, grime low down, a crack, and on a
  // dressed building now and then a poster or a notice by the door.
  const WALL_WEAR = [0, 1, 6, 7];
  const wear = dressed ? 1 + Math.floor(r() * 2) : r() < 0.6 ? 1 : 0;
  // (none over a door, a window or a shop front: they'd paint across it)
  const onWall = (x: number, y: number, dw: number, dh: number, cell: number) => {
    if (!k.overOpening(x, y, dw, dh)) k.decal(x, y, d / 2 + 0.02, dw, dh, cell);
  };
  for (let i = 0; i < wear; i++) {
    const cell = WALL_WEAR[Math.floor(r() * WALL_WEAR.length)];
    const high = cell === 0;
    const x = (r() - 0.5) * (w - 0.8);
    const y = high ? h - 0.7 - r() * 0.5 : Math.min(0.5 + r() * 1.2, h - 0.55);
    onWall(x, y, 0.9, high ? 1.1 : 0.8, cell);
  }
  if (dressed && r() < 0.6) {
    const x = -w / 2 + 1.35 + (r() < 0.5 ? 0.55 : -0.5);
    onWall(x, 1.3, 0.42, 0.55, r() < 0.5 ? 8 : 9);
  }
  if (dressed && r() < 0.4) onWall(w / 2 - 0.9, 0.9, 0.32, 0.32, 10);
  for (const sx of [-1, 1]) if (r() < (dressed ? 0.35 : 0.15)) {
    // Side walls face ±x: rotate the decal by building a temporary frame-aligned quad.
    const y = 0.6 + r() * (h - 1.2);
    const z = (r() - 0.5) * (d - 0.8);
    const cell = WALL_WEAR[Math.floor(r() * WALL_WEAR.length)];
    const pts = [
      [sx * (w / 2 + 0.03), y - 0.45, z - 0.45 * sx],
      [sx * (w / 2 + 0.03), y - 0.45, z + 0.45 * sx],
      [sx * (w / 2 + 0.03), y + 0.45, z + 0.45 * sx],
      [sx * (w / 2 + 0.03), y + 0.45, z - 0.45 * sx],
    ].map(([px, py, pz]) => new THREE.Vector3(px, py, pz).applyMatrix4(k.frame));
    k.g.addDecal(pts, new THREE.Vector3(sx, 0, 0).transformDirection(k.frame), cell);
  }
}

/** Concrete apartment block: floor bands, varied windows, a drain pipe; dressed ones add balconies,
 *  AC units, a blade sign, panel seams and, where there is room beside it, an outside stair. */
export function block(k: Kit, r: R, w = 3.4, d = 3, floors = 3) {
  const wall = pick(r, C.concrete);
  const band = new THREE.Color(wall).multiplyScalar(0.92);
  const h = floors * FLOOR;
  const setback = floors > 2 && r() < 0.35;
  const hb = setback ? h - FLOOR : h;
  k.box(0, 0, 0, w, hb, d, wall);
  if (setback) k.box(-0.3, hb, -0.3, w - 0.6, FLOOR, d - 0.6, new THREE.Color(wall).multiplyScalar(0.97));
  if (r() < 0.5) for (let f = 1; f <= floors - (setback ? 1 : 0); f++) k.box(0, f * FLOOR - 0.08, 0, w + 0.12, 0.12, d + 0.12, band);
  // (the door's place kept clear before the windows go up: see windowAt's rain streaks)
  k.openings.push([-w / 2 + 0.1, -w / 2 + 1.3, 0, 1.6]);
  windows(k, w, d / 2, setback ? floors - 1 : floors, 1, r, 1, true);
  windows(k, w, -d / 2, setback ? floors - 1 : floors, 0, r, -1);
  // Concrete panel seams down the walls.
  const seam = new THREE.Color(wall).multiplyScalar(0.86);
  if (k.detail && r() < 0.35) for (let x = -w / 2 + 1.15; x < w / 2 - 0.3; x += 1.15) k.box(x, 0.5, d / 2 + 0.014, 0.025, hb - 0.65, 0.02, seam);
  door(k, -w / 2 + 0.7, d / 2, r);
  // Ground floor front: a shutter or a small window.
  if (r() < 0.5) {
    k.openings.push([0.55 - Math.min(1.5, w - 1.9) / 2 - 0.05, 0.55 + Math.min(1.5, w - 1.9) / 2 + 0.05, 0, 1.25]);
    // (in front of the plinth, not flush with it)
    k.box(0.55, 0.05, d / 2 + 0.01, Math.min(1.5, w - 1.9), 1.1, 0.05, "#c9cdc8");
    for (let y = 0.15; y < 1.1; y += 0.12) k.box(0.55, y, d / 2 + 0.045, Math.min(1.5, w - 1.9), 0.02, 0.02, "#aab1ae");
  } else windowAt(k, 0.6, 0.55, d / 2, r, 0.9);
  pipe(k, w / 2 - 0.12, d / 2, hb);
  if (k.detail && r() < 0.5) pipe(k, -w / 2 + 0.12, -d / 2, hb, -0.08);
  // (Where AC units hung on the back wall, nothing: (the draw that once placed it is still taken, so nothing placed after it moves).)
  const ac = [0.5 / floors, 0.4, 0.6][Math.min(k.detail, 2)];
  for (let f = 0, n = 0; f < floors; f++) if (r() < ac && (k.detail || !n++)) r();
  if (k.detail && r() < 0.45) bladeSign(k, w / 2 - 0.05, FLOOR + 0.3, d / 2 - 0.1, r, hb);
  if (k.detail && k.sideRoom[1] > 0.95 && r() < 0.5) sideStair(k, w, d, floors);
  fixtures(k, r, w, d, hb, wall);
  rooftop(k, setback ? w - 0.6 : w, setback ? d - 0.6 : d, h, r);
}

/** Small house: one or two storeys, a gabled roof with eaves (its ridge along the street, or its
 *  gable end turned to it), door canopy, windows, a pipe; dressed ones a balcony and an AC unit. */
export function house(k: Kit, r: R, w = 3, d = 2.6) {
  const wall = pick(r, C.concrete);
  const roof = pick(r, C.roof);
  const floors = r() < 0.45 ? 2 : 1;
  const h = floors * FLOOR + 0.25;
  k.box(0, 0, 0, w, h, d, wall);
  k.box(0, 0, 0, w + 0.06, 0.35, d + 0.06, new THREE.Color(wall).multiplyScalar(0.85));
  // The eaves reach 0.4 m out, less over a narrow gap beside the house (half of it, the neighbour's
  // eaves or cornice take the other half), so they never touch. (The prism's triangle spans its x
  // and its ridge runs along z, before it is turned.)
  const ow = w + 2 * Math.min(0.4, Math.max(0.1, Math.min(...k.sideRoom) / 2 - 0.12));
  if (r() < 0.4) k.prism(0, h, 0, ow, 1.15, d + 0.8, roof);
  else k.prism(0, h, 0, d + 0.8, 1.0, ow, roof, Math.PI / 2);
  k.box(0, h - 0.08, 0, ow, 0.1, d + 0.8, new THREE.Color(roof).multiplyScalar(0.8));
  door(k, w / 2 - 0.75, d / 2, r);
  for (let f = 0; f < floors; f++) windowAt(k, -w / 4, f * FLOOR + 0.5, d / 2, r, 0.6);
  if (floors === 2 && r() < (k.detail ? 0.5 : 0.2)) balcony(k, -w / 4, FLOOR, d / 2, 1.1, r);
  pipe(k, -w / 2 + 0.1, d / 2, h);
  if (k.detail) r();
  if (r() < 0.45) k.box(w / 4, h + 0.2, -d / 5, 0.3, 0.9, 0.3, C.metalDark);
  fixtures(k, r, w, d, h, wall);
  k.reach = Math.max(0.25, (ow - w) / 2);
}

/** Corner shop: shop front, awning, signboard, shutter, a blade sign; crates of goods at a stop's shop. */
export function shop(k: Kit, r: R, w = 3, d = 2.8, accent?: string) {
  const wall = pick(r, C.concrete);
  const aw = accent ?? pick(r, C.awning);
  const floors = 2 + (r() < 0.3 ? 1 : 0);
  const h = floors * FLOOR;
  k.box(0, 0, 0, w, h, d, wall);
  if (r() < 0.5) for (let f = 1; f <= floors; f++) k.box(0, f * FLOOR - 0.08, 0, w + 0.12, 0.12, d + 0.12, new THREE.Color(wall).multiplyScalar(0.92));
  // Shop front: glass in a dark frame, a half-raised shutter, the door.
  k.openings.push([-w / 2, w / 2, 0, 2.3]);
  k.box(0.25, 0.08, d / 2, w - 1.3, 1.1, 0.06, "#3e5a5f");
  k.box(0.25, 0.15, d / 2 + 0.03, w - 1.45, 0.95, 0.03, C.windowLit);
  k.pane(0.25, 0.625, d / 2 + 0.055, w - 1.45, 0.95);
  // (the shutter a little wider than the frame: as wide, their ends lay in one plane where the
  // shutter comes down over the frame's top, and flickered there)
  k.box(0.25, 1.05, d / 2 + 0.05, w - 1.28, 0.22, 0.05, "#c9cdc8");
  k.box(-w / 2 + 0.45, 0, d / 2, 0.62, 1.2, 0.08, C.door);
  // Kept above head height and shallow: the lane is narrow and the camera rides low.
  k.tilted(0, 2.05, d / 2 + 0.24, w - 0.1, 0.05, 0.5, aw, 0.3);
  k.box(0, 1.94, d / 2 + 0.48, w - 0.1, 0.1, 0.03, new THREE.Color(aw).multiplyScalar(0.85));
  // Signboard: abstract glyph blocks on a panel.
  k.box(0, 1.62, d / 2 + 0.06, w - 0.4, 0.5, 0.1, aw);
  for (let i = 0; i < 3; i++) k.box(-0.6 + i * 0.6, 1.72, d / 2 + 0.12, 0.36, 0.28, 0.03, C.frame);
  windows(k, w, d / 2, floors, 1, r, 1, true);
  windows(k, w, -d / 2, floors, 0, r, -1);
  pipe(k, w / 2 - 0.12, d / 2, h);
  if (k.detail || r() < 0.5) bladeSign(k, w / 2 + 0.05, 1.9, d / 2 - 0.5, r, h);
  // (No crates of fruit out front: they read as blocks. The draws that placed them are still taken,
  // so nothing placed after moves.)
  if (k.detail > 1 && r() < 0.7) r();
  fixtures(k, r, w, d, h, wall);
  rooftop(k, w, d, h, r);
}

/** Office tower: glass bands, a rooftop sign. */
export function tower(k: Kit, r: R, w = 3, d = 3, floors = 6, accent?: string) {
  const wall = pick(r, C.concrete);
  const h = floors * FLOOR;
  k.box(0, 0, 0, w, h, d, wall);
  for (let f = 1; f < floors; f++) {
    k.box(0, f * FLOOR + 0.25, d / 2, w - 0.3, 0.75, 0.06, C.window);
    k.box(0, f * FLOOR + 0.25, -d / 2, w - 0.3, 0.75, 0.06, C.window);
    k.box(w / 2, f * FLOOR + 0.25, 0, 0.06, 0.75, d - 0.3, C.window);
    k.box(-w / 2, f * FLOOR + 0.25, 0, 0.06, 0.75, d - 0.3, C.window);
    // Each glass band reads as a row of separate painted windows.
    const y = f * FLOOR + 0.625;
    const nx = Math.max(1, Math.round((w - 0.3) / 1.1));
    const nz = Math.max(1, Math.round((d - 0.3) / 1.1));
    for (let i = 0; i < nx; i++) {
      const x = -(w - 0.3) / 2 + ((w - 0.3) * (i + 0.5)) / nx;
      k.pane(x, y, d / 2 + 0.04, (w - 0.3) / nx - 0.04, 0.75);
      k.pane(x, y, -d / 2 - 0.04, (w - 0.3) / nx - 0.04, 0.75, -1);
    }
    for (let i = 0; i < nz; i++) {
      const z = -(d - 0.3) / 2 + ((d - 0.3) * (i + 0.5)) / nz;
      k.paneX(w / 2 + 0.04, y, z, (d - 0.3) / nz - 0.04, 0.75, 1);
      k.paneX(-w / 2 - 0.04, y, z, (d - 0.3) / nz - 0.04, 0.75, -1);
    }
  }
  k.box(0, 0, d / 2, 1.4, 1.2, 0.08, C.window);
  k.box(0, h, 0, w * 0.6, 0.9, 0.12, accent ?? pick(r, C.sign));
  k.box(0, h, 0, w * 0.7, 0.2, d * 0.7, C.metal);
}

/** Post office: the save point. Red trim, a big letter sign and a post box out front. */
export function postOffice(k: Kit, r: R) {
  shop(k, r, 3.6, 3, C.red);
  // A big letter on the roof edge: white envelope, red flap.
  k.box(0, 2 * FLOOR + 0.1, 0.9, 1.4, 0.95, 0.12, C.frame);
  k.tilted(-0.34, 2 * FLOOR + 0.8, 0.98, 0.82, 0.08, 0.04, C.red, 0, 0, -0.55);
  k.tilted(0.34, 2 * FLOOR + 0.8, 0.98, 0.82, 0.08, 0.04, C.red, 0, 0, 0.55);
  postBox(k, 1.5, 1.9);
}

/** A red pillar post box (drawn). */
export function postBox(k: Kit, x: number, z: number) {
  k.sprite(x, 0, z, 1.15, PROP.postBox);
}

/** Utility pole with a crossbar, insulators and a striped sleeve; returns the wire point (local). */
export function pole(k: Kit) {
  k.cyl(0, 0, 0, 0.09, 5.4, C.metal);
  k.cyl(0, 0.6, 0, 0.11, 0.9, C.yellow);
  k.cyl(0, 1.05, 0, 0.115, 0.12, C.black);
  k.box(0, 4.8, 0, 1.3, 0.08, 0.08, C.metalDark);
  for (const x of [-0.5, 0, 0.5]) k.cyl(x, 4.86, 0, 0.04, 0.12, C.frame);
  k.cyl(0.18, 3.7, 0, 0.17, 0.5, C.metalDark, true);
  return new THREE.Vector3(0, 4.95, 0);
}

/** Street sign: a post with an arrow board. */
/** A painted road sign face (roadsigns.webp: 0 bus stop, 1 warning, 2 no entry, 3 direction board),
 *  s metres square, centred at (x, y) just in front of z, on a thin grey plate. */
function signFace(k: Kit, cell: number, x: number, y: number, z: number, s: number) {
  k.sheetZ("roadsigns", cell, 4, 1, x, y, z + 0.013, s, s);
}
/** Direction board for the walkers on a post. */
export function signpost(k: Kit, r: R) {
  k.cyl(0, 0, 0, 0.04, 2.1, C.metal);
  pick(r, [0, 1, 2]);
  k.box(0.32, 1.56, -0.01, 0.74, 0.37, 0.02, "#8f9a9c");
  signFace(k, 3, 0.32, 1.745, 0, 0.78);
}
/** Round bus stop sign, with a timetable plate on the post. */
export function busSign(k: Kit) {
  k.cyl(0, 0, 0, 0.04, 2.3, C.metal);
  k.leaf(0, 2.3, -0.01, 0.56, 0.02, 0.56, "#8f9a9c", Math.PI / 2);
  signFace(k, 0, 0, 2.3, 0, 0.6);
  k.box(0, 1.2, 0.04, 0.22, 0.5, 0.06, C.frame);
}
/** A drinks vending machine: its front and sides painted (vending.webp), a darker top and plinth. */
export function vending(k: Kit, r: R) {
  const red = pick(r, [true, false, true]);
  for (let i = 0; i < 3; i++) pick(r, C.sign);
  const body = red ? "#b8574d" : "#dedbd0";
  k.box(0, 0, 0, 0.9, 1.75, 0.65, body);
  k.box(0, 1.75, 0, 0.92, 0.04, 0.67, C.metalDark);
  k.box(0, 0, 0, 0.92, 0.05, 0.67, C.metalDark);
  k.sheetZ("vending", red ? 0 : 1, 3, 1, 0, 0.9, 0.326, 0.9, 1.7);
  if (red) for (const sx of [-1, 1]) k.sheetX("vending", 2, 3, 1, sx * 0.451, 0.9, 0, 0.65, 1.7, sx);
}
/** A roadside utility cabinet: plinth, two doors with handles, louvres, a warning label, a pipe. */
export function utilityBox(k: Kit) {
  const body = "#a9bdb6";
  const dark = "#8aa09a";
  k.box(0, 0, 0, 0.98, 0.14, 0.56, C.concrete[1]);
  k.box(0, 0.14, 0, 0.9, 1.0, 0.48, body);
  k.box(0, 1.14, 0, 0.96, 0.05, 0.54, dark);
  k.box(0, 0.17, 0.245, 0.012, 0.94, 0.01, "#6f817c");
  for (const x of [-0.06, 0.06]) k.box(x, 0.66, 0.25, 0.025, 0.12, 0.03, "#5f6e6a");
  for (let i = 0; i < 4; i++) k.box(0.25, 0.9 + i * 0.045, 0.248, 0.26, 0.012, 0.01, dark);
  k.tilted(-0.24, 0.92, 0.25, 0.12, 0.12, 0.01, C.yellow, 0, 0, Math.PI / 4);
  k.box(-0.24, 0.9, 0.256, 0.02, 0.06, 0.005, C.black);
  k.cyl(0.38, 0, -0.18, 0.04, 0.16, C.metalDark);
}
export function bollard(k: Kit) {
  k.cyl(0, 0, 0, 0.09, 0.85, C.black, true);
  k.cyl(0, 0.5, 0, 0.095, 0.12, C.yellow, true);
  k.cyl(0, 0.7, 0, 0.095, 0.08, C.yellow, true);
}
/** A park bench: wooden slats with gaps between, on two cast-iron ends (legs, arm, back support). */
export function bench(k: Kit) {
  const slat = ["#b07e54", "#a7774f", "#9c6f49"];
  for (let i = 0; i < 4; i++) k.box(0, 0.42, 0.15 - i * 0.1, 1.42, 0.035, 0.075, slat[i % 3]);
  for (let i = 0; i < 3; i++) k.tilted(0, 0.56 + i * 0.12, -0.2 - i * 0.025, 1.42, 0.075, 0.03, slat[(i + 1) % 3], -0.2);
  for (const x of [-0.62, 0.62]) {
    k.tilted(x, 0.21, 0.12, 0.045, 0.44, 0.05, C.metalDark, 0.18);
    k.tilted(x, 0.21, -0.12, 0.045, 0.44, 0.05, C.metalDark, -0.18);
    k.box(x, 0.4, 0, 0.05, 0.04, 0.4, C.metalDark);
    k.tilted(x, 0.64, -0.24, 0.045, 0.46, 0.045, C.metalDark, -0.2);
    k.box(x, 0.6, 0.02, 0.05, 0.035, 0.36, C.metalDark);
    k.box(x, 0.44, 0.17, 0.045, 0.17, 0.04, C.metalDark);
  }
}
/** Low retaining wall along x, length l. */
export function wall(k: Kit, l: number, h = 0.8) {
  k.box(0, 0, 0, l, h, 0.35, C.concrete[1]);
  k.box(0, h, 0, l + 0.04, 0.08, 0.42, C.concrete[0]);
}
export function fence(k: Kit, l: number) {
  const posts = Math.max(2, Math.round(l / 0.9) + 1);
  for (let i = 0; i < posts; i++) k.box(-l / 2 + (l * i) / (posts - 1), 0, 0, 0.08, 0.9, 0.08, C.woodDark);
  k.box(0, 0.55, 0, l, 0.08, 0.05, C.wood);
  k.box(0, 0.25, 0, l, 0.08, 0.05, C.wood);
}
export function guardrail(k: Kit, l: number) {
  const posts = Math.max(2, Math.round(l / 1.2) + 1);
  for (let i = 0; i < posts; i++) k.box(-l / 2 + (l * i) / (posts - 1), 0, 0, 0.1, 0.65, 0.1, C.metal);
  k.box(0, 0.45, 0.06, l, 0.22, 0.05, C.frame);
}

/** Broadleaf tree: a leaning trunk with a branch, and a soft canopy of a few round masses, darker
 *  underneath and lighter on top, like washes of paint. */
/**
 * A broadleaf tree: a trunk with a slight kink, forking into boughs under a canopy of four to six
 * leafy masses, a crown and a ring round it. (The world's random draws are taken as the old ball
 * canopy took them, so everything placed after a tree stays where it was; the tree's own shape comes
 * from its own sequence.)
 */
export function tree(k: Kit, r: R, s = 1) {
  const h = (1.9 + r() * 0.9) * s;
  const base = new THREE.Color(pick(r, C.leaf));
  const R0 = (1 + r() * 0.4) * s;
  const n = 7 + Math.floor(r() * 4);
  for (let i = 0; i < n * 4; i++) r();
  const q = k.own();
  const lx = (q() - 0.5) * 0.3 * s;
  const lz = (q() - 0.5) * 0.3 * s;
  k.limb(0, -0.15, 0, lx * 0.4, h * 0.55, lz * 0.4, 0.13 * s, C.trunk);
  k.limb(lx * 0.4, h * 0.55 - 0.05, lz * 0.4, lx, h + R0 * 0.2, lz, 0.085 * s, C.trunk);
  const top = h + R0 * 1.4;
  const phase = q() * 6.28;
  const cy = h + R0 * 0.45;
  const masses: [number, number, number, number][] = [[lx, cy + R0 * 0.4, lz, R0 * 0.62]];
  const m = 3 + Math.floor(q() * 3);
  const a0 = q() * 6.28;
  for (let i = 0; i < m; i++) {
    const a = a0 + (i / m) * 6.28 + (q() - 0.5) * 0.8;
    const out = R0 * (0.5 + q() * 0.2);
    masses.push([lx + Math.cos(a) * out, cy + (q() - 0.45) * R0 * 0.5, lz + Math.sin(a) * out, R0 * (0.44 + q() * 0.16)]);
  }
  // Boughs from the fork out into the side masses (the ones that show below the canopy).
  for (let i = 1; i < masses.length; i++) {
    if (q() < 0.3) continue;
    const [x, y, z] = masses[i];
    const f = 0.6 + q() * 0.15;
    k.limb(lx * f, h * f, lz * f, lx + (x - lx) * 0.75, y - R0 * 0.1, lz + (z - lz) * 0.75, 0.05 * s, C.trunk);
  }
  const under = base.clone().multiplyScalar(0.9);
  for (const [x, y, z, rad] of masses) k.lobe(x, y, z, rad, y < cy ? under : base, q, { cell: q() < 0.5 ? 0 : 1, top, phase });
}

/** A tall, slender tree: a long pale trunk with thin branches up its length, each ending in a tuft. */
function slender(k: Kit, q: R, s: number, leaf: THREE.Color) {
  const h = (3.4 + q() * 1.6) * s;
  const lx = (q() - 0.5) * 0.35 * s;
  const lz = (q() - 0.5) * 0.35 * s;
  k.limb(0, -0.15, 0, lx, h, lz, 0.085 * s, C.bark);
  const top = h + 0.7 * s;
  const phase = q() * 6.28;
  k.lobe(lx, h + 0.12 * s, lz, 0.5 * s, leaf, q, { cell: 1, top, phase });
  const n = 3 + Math.floor(q() * 3);
  const a0 = q() * 6.28;
  for (let i = 0; i < n; i++) {
    const t = 0.42 + (i / n) * 0.42 + q() * 0.06;
    const a = a0 + i * 2.4 + (q() - 0.5) * 0.6;
    const len = (0.5 + q() * 0.45) * s * (1.15 - t * 0.5);
    const x0 = lx * t;
    const y0 = h * t;
    const z0 = lz * t;
    const x1 = x0 + Math.cos(a) * len;
    const y1 = y0 + len * (0.55 + q() * 0.45);
    const z1 = z0 + Math.sin(a) * len;
    k.limb(x0, y0, z0, x1, y1, z1, 0.032 * s, C.bark);
    k.lobe(x1, y1 + 0.08 * s, z1, (0.3 + q() * 0.16) * s, i % 2 ? leaf.clone().multiplyScalar(0.93) : leaf, q, { cell: q() < 0.5 ? 0 : 1, top, phase });
  }
}

/** A fir: a straight trunk under tiers of drooping needle sprays, narrowing to a point. */
function fir(k: Kit, q: R, s: number, needles: THREE.Color) {
  const h = (2.5 + q() * 1.3) * s;
  k.limb(0, -0.15, 0, 0, h * 0.92, 0, 0.11 * s, C.trunk);
  const top = h + 0.3 * s;
  const phase = q() * 6.28;
  const tiers = 5;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    k.lobe(0, h * (0.28 + 0.64 * t), 0, (0.92 - 0.6 * t) * s, needles.clone().multiplyScalar(0.9 + 0.14 * t), q, { cell: 2, top, phase, squash: 0.42 });
  }
  k.lobe(0, h, 0, 0.24 * s, needles.clone().multiplyScalar(1.05), q, { cell: 2, top, phase, squash: 1.5 });
}

/** In the woods: a tall slender tree or a fir. */
export function pine(k: Kit, r: R, s = 1) {
  const c = pick(r, C.pine);
  const q = k.own();
  if (q() < 0.55) slender(k, q, s, new THREE.Color(pick(q, C.leaf)).lerp(new THREE.Color("#b9d98a"), 0.18));
  else fir(k, q, s, new THREE.Color(c));
}
/** A shrub: two or three low leafy masses of small leaves. */
export function bush(k: Kit, r: R, s = 1) {
  const base = new THREE.Color(pick(r, C.leaf));
  const n = 5 + Math.floor(r() * 4);
  for (let i = 0; i < n * 6; i++) r();
  const q = k.own();
  const phase = q() * 6.28;
  const m = 2 + Math.floor(q() * 2);
  for (let i = 0; i < m; i++) {
    const a = q() * 6.28;
    const out = (0.08 + q() * 0.2) * s;
    const rad = (0.3 + q() * 0.14) * s;
    k.lobe(Math.cos(a) * out, rad * 0.75, Math.sin(a) * out, rad, i ? base.clone().multiplyScalar(0.92) : base, q, { cell: 3, top: 2.2 * s, phase, squash: 0.85 });
  }
}
/** Leafy top for a pot: a few tilted clumps and a couple of spiky leaves. */
function pottedGreens(k: Kit, r: R, x: number, y: number, z: number, size: number) {
  const g = new THREE.Color(pick(r, C.leaf));
  const dark = g.clone().multiplyScalar(0.8);
  const kind = r();
  if (kind < 0.18) {
    // Spiky: a fan of long thin blades.
    for (let j = 0; j < 7; j++) {
      const a = (j / 7) * Math.PI * 2 + r();
      const lean = 0.35 + r() * 0.35;
      k.tilted(x + Math.cos(a) * size * 0.25, y + size * 0.55, z + Math.sin(a) * size * 0.25, 0.035, size * (1.1 + r() * 0.5), 0.012, j % 2 ? dark : g, Math.sin(a) * lean, 0, -Math.cos(a) * lean);
    }
  } else if (kind < 0.42) {
    // A round-leaved shrub: overlapping flat leaf discs.
    for (let j = 0; j < 7; j++) {
      const a = r() * Math.PI * 2;
      const out = size * (0.1 + r() * 0.3);
      k.leaf(x + Math.cos(a) * out, y + size * (0.3 + r() * 0.6), z + Math.sin(a) * out, size * 0.42, 0.015, size * 0.42, j % 2 ? dark : g, (r() - 0.5) * 0.8, a, (r() - 0.5) * 0.8);
    }
  } else if (kind < 0.7) {
    // Tall and leafy: a stem with a few big flat leaves.
    k.cyl(x, y, z, 0.015, size * 1.6, C.trunk);
    for (let j = 0; j < 5; j++) {
      const a = r() * Math.PI * 2;
      const yy = y + size * (0.5 + j * 0.25);
      k.leaf(x + Math.cos(a) * size * 0.25, yy, z + Math.sin(a) * size * 0.25, size * 0.5, 0.012, size * 0.24, j % 2 ? dark : g, 0.3, a, 0.2);
    }
  } else {
    // Trailing: low clumps spilling over the pot's edge.
    for (let j = 0; j < 5; j++) {
      const a = r() * Math.PI * 2;
      const out = size * (0.3 + r() * 0.35);
      k.clump(x + Math.cos(a) * out, y - r() * size * 0.5, z + Math.sin(a) * out, size * (0.3 + r() * 0.2), j % 2 ? dark : g, r() * 6, (r() - 0.5) * 0.8);
    }
  }
}
/** The wild flowers, each drawn in the colours it was planted as: petals, centre (and its size), petal
 *  count and shape, head size. */
const BLOOMS: Record<string, { eye: string; eyeR: number; petals: number; shape: number; size: number }> = {
  // buttercups: five broad, round petals
  [C.flower[0]]: { eye: "#c98a2e", eyeR: 0.3, petals: 5, shape: 0.55, size: 0.055 },
  // poppies: four wide petals round a dark heart
  [C.flower[1]]: { eye: "#3b2d2a", eyeR: 0.24, petals: 4, shape: 0.35, size: 0.075 },
  // daisies: a ring of thin white petals
  [C.flower[2]]: { eye: "#e9b63c", eyeR: 0.3, petals: 13, shape: 2.4, size: 0.06 },
  // bellflowers: five pointed lilac petals
  [C.flower[3]]: { eye: "#f4ecd8", eyeR: 0.17, petals: 5, shape: 1.3, size: 0.055 },
  // marigolds: a full orange ruff
  [C.flower[4]]: { eye: "#c0611f", eyeR: 0.32, petals: 11, shape: 1.6, size: 0.06 },
  // cosmos: eight soft pink petals
  [C.flower[5]]: { eye: "#e5be4f", eyeR: 0.22, petals: 8, shape: 0.9, size: 0.07 },
  // cornflowers: a ragged blue ring
  [C.flower[6]]: { eye: "#3a4f9a", eyeR: 0.22, petals: 9, shape: 1.8, size: 0.055 },
  // campions: five notched magenta petals
  [C.flower[7]]: { eye: "#f3d36a", eyeR: 0.2, petals: 5, shape: 0.7, size: 0.06 },
};
/** A patch of wild flowers: a few on long stems, a bud or two lower down, leaves at their feet. (The
 *  world's draws are taken as the old ones were, so nothing placed after moves.) */
export function flowers(k: Kit, r: R) {
  const c = pick(r, C.flower);
  const kind = BLOOMS[c];
  const q = k.own();
  const petal = new THREE.Color(c);
  const eye = new THREE.Color(kind.eye);
  for (let i = 0; i < 4; i++) {
    const x = (r() - 0.5) * 0.6;
    const z = (r() - 0.5) * 0.6;
    const h = 0.2 + q() * 0.22;
    k.flower(x, z, h, kind.size * (0.85 + q() * 0.35), petal.clone().multiplyScalar(0.94 + q() * 0.1), eye, kind.eyeR, kind.petals, kind.shape, q);
    if (q() < 0.6) k.blades(x, z, 2 + Math.floor(q() * 2), 0.1 + q() * 0.06, q, true);
  }
  // a bud or two, lower and smaller
  for (let i = 0; i < 2; i++)
    if (q() < 0.6) {
      const x = (q() - 0.5) * 0.5;
      const z = (q() - 0.5) * 0.5;
      k.flower(x, z, 0.1 + q() * 0.1, kind.size * 0.6, petal, eye, kind.eyeR, kind.petals, kind.shape, q);
    }
}
/** The kinds in a picked bouquet (art/bouquet-codex.png): daisies, pink cosmos, buttercups, lilac bells. */
const COSMOS = { petal: "#f1a9bd", eye: "#e5be4f", eyeR: 0.22, petals: 8, shape: 0.9, size: 0.07 };
export const BOUQUET_KINDS = [
  { petal: C.flower[2], ...BLOOMS[C.flower[2]] },
  COSMOS,
  { petal: C.flower[0], ...BLOOMS[C.flower[0]] },
  { petal: C.flower[3], ...BLOOMS[C.flower[3]] },
];
/** One wild flower of a kind (see BOUQUET_KINDS) at (x, z), `h` tall. */
export function wildflower(k: Kit, q: R, kind: number, x: number, z: number, h: number) {
  const b = BOUQUET_KINDS[kind];
  const petal = new THREE.Color(b.petal).multiplyScalar(0.94 + q() * 0.1);
  k.flower(x, z, h, b.size * (0.85 + q() * 0.3), petal, new THREE.Color(b.eye), b.eyeR, b.petals, b.shape, q);
}
/**
 * A bed of wild flowers, an oval `w` long and `d` across: drifts of each kind growing together (as
 * they seed), thick in the middle and thinning to single stems at the edges, leaves at their feet.
 */
export function wildflowerBed(k: Kit, q: R, w: number, d: number) {
  const clumps = Array.from({ length: 7 }, (_, i) => ({ x: (q() - 0.5) * w * 0.8, z: (q() - 0.5) * d * 0.7, kind: i % 4 }));
  for (let i = 0; i < 110; i++) {
    const c = clumps[Math.floor(q() * clumps.length)];
    // (spread round its clump, a few strays further out)
    const spread = q() < 0.85 ? 0.28 : 0.6;
    const x = c.x + (q() + q() - 1) * spread;
    const z = c.z + (q() + q() - 1) * spread * 0.8;
    const e = (x / (w / 2)) ** 2 + (z / (d / 2)) ** 2;
    if (e > 1) continue;
    // taller toward the middle of the bed
    const h = (0.2 + q() * 0.18) * (1.15 - 0.35 * e);
    wildflower(k, q, q() < 0.8 ? c.kind : Math.floor(q() * 4), x, z, h);
    if (q() < 0.45) k.blades(x, z, 2 + Math.floor(q() * 3), 0.1 + q() * 0.08, q, true);
  }
}
/** A fern on the forest floor: a ring of broad fronds arching out from the middle. */
export function fern(k: Kit, r: R, s = 1) {
  k.blades(0, 0, 7 + Math.floor(r() * 4), (0.32 + r() * 0.16) * s, r, true);
}
/** A tuft of grass: three little fans of blades that bend in the wind. */
export function tuft(k: Kit, r: R) {
  const q = k.own();
  for (let i = 0; i < 3; i++) {
    const x = (r() - 0.5) * 0.3;
    const z = (r() - 0.5) * 0.3;
    k.blades(x, z, 4 + Math.floor(q() * 3), 0.22 + r() * 0.15, q);
  }
}
export function boulder(k: Kit, r: R, s = 1) {
  k.rock(0, 0.15 * s, 0, 0.5 * s, C.rock, r() * 6);
}

/** The bridge's frame sits SINK below the ground at its middle. */
export const BRIDGE_SINK = 0.06;
/** The bare ground under the bridge's frame, d metres along it from the middle (the planet curves away). */
export const bridgeGround = (d: number) => BRIDGE_SINK - (d * d) / (2 * PLANET_RADIUS);
/** The stone bridge: metres from its middle to each end along the road, how high its deck rises over
 *  the stream, and the arch under it (half its span, and its height over the water). */
export const BRIDGE_HALF = 4.2;
export const BRIDGE_RISE = 0.9;
export const ARCH_HALF = 1.9;
export const ARCH_RISE = 0.62;
const RISE_FOOT = 0.03;
/** The deck's top above the bare ground, d metres along the road from the bridge's middle: a hump that
 *  leaves the path level at both ends and rises over the stream. */
export const bridgeRise = (d: number) => (Math.abs(d) >= BRIDGE_HALF ? 0 : RISE_FOOT + BRIDGE_RISE * (0.5 + 0.5 * Math.cos((Math.PI * d) / BRIDGE_HALF)));
/** The arch's underside above the bare ground, d metres along from the middle (0 beyond its feet). */
const archRise = (d: number) => (Math.abs(d) >= ARCH_HALF ? 0 : ARCH_RISE * Math.sqrt(1 - (d / ARCH_HALF) ** 2));

/**
 * The bridge's dressed stone, w wide across (x), its length along z: two coursed side walls standing
 * on the arch and on the banks beyond it, the vault under the arch, and the deck. Drawn as its own
 * mesh, with the joints between stones drawn on (stoneMaterial); `stone` carries each point's place
 * on its face (along, up or across) and which face.
 */
function stoneBody(k: Kit, w: number) {
  const pos: number[] = [];
  const nor: number[] = [];
  const st: number[] = [];
  const idx: number[] = [];
  const nm = new THREE.Matrix3().getNormalMatrix(k.frame);
  const pt = new THREE.Vector3();
  const nv = new THREE.Vector3();
  const put = (x: number, y: number, z: number, n: THREE.Vector3, a: number, b: number, face: number) => {
    pt.set(x, y, z).applyMatrix4(k.frame);
    pos.push(pt.x, pt.y, pt.z);
    nv.copy(n).applyMatrix3(nm).normalize();
    nor.push(nv.x, nv.y, nv.z);
    st.push(a, b, face);
    return pos.length / 3 - 1;
  };
  // A triangle wound to face `n` (local), whichever order its corners came in.
  const local: THREE.Vector3[] = [];
  const tri = (i: number, j: number, l: number, n: THREE.Vector3) => {
    const [a, b, c] = [i, j, l].map((q) => local[q]);
    const f = b.clone().sub(a).cross(c.clone().sub(a)).dot(n);
    if (f >= 0) idx.push(i, j, l);
    else idx.push(i, l, j);
  };
  const add = (x: number, y: number, z: number, n: THREE.Vector3, a: number, b: number, face: number) => {
    local.push(new THREE.Vector3(x, y, z));
    return put(x, y, z, n, a, b, face);
  };
  const top = (z: number) => bridgeGround(z) + bridgeRise(z);
  const under = (z: number) => (Math.abs(z) < ARCH_HALF ? bridgeGround(z) + archRise(z) : bridgeGround(z) - 0.12);
  const N = 84;
  const zs: number[] = [];
  for (let i = 0; i <= N; i++) zs.push(-BRIDGE_HALF + (2 * BRIDGE_HALF * i) / N);
  // (the arch's feet exactly, and close in round them, where its curve turns down sharply)
  for (const e of [-1, 1]) for (const f of [1, 0.995, 0.98, 0.95]) zs.push(e * ARCH_HALF * f);
  zs.sort((a, b) => a - b);
  // Side walls.
  for (const sx of [-1, 1]) {
    const n = new THREE.Vector3(sx, 0, 0);
    let last = -1;
    for (const z of zs) {
      const g = bridgeGround(z);
      const a = add((sx * w) / 2, under(z), z, n, z, under(z) - g, 0);
      const b = add((sx * w) / 2, top(z), z, n, z, top(z) - g, 0);
      if (last >= 0) {
        tri(last, last + 1, b, n);
        tri(last, b, a, n);
      }
      last = a;
    }
  }
  // The deck, its normal tipped with the slope.
  {
    let last = -1;
    for (const z of zs) {
      const slope = (top(z + 0.01) - top(z - 0.01)) / 0.02;
      const n = new THREE.Vector3(0, 1, -slope).normalize();
      const a = add(-w / 2, top(z), z, n, z, -w / 2, 2);
      const b = add(w / 2, top(z), z, n, z, w / 2, 2);
      if (last >= 0) {
        tri(last, last + 1, b, n);
        tri(last, b, a, n);
      }
      last = a;
    }
  }
  // The vault: the arch's underside, facing down into the opening.
  {
    let last = -1;
    for (const z of zs.filter((q) => Math.abs(q) <= ARCH_HALF)) {
      const y = under(z) - bridgeGround(z);
      const n = new THREE.Vector3(0, -y / ARCH_RISE ** 2, -z / ARCH_HALF ** 2).normalize();
      const a = add(-w / 2, under(z), z, n, z, -w / 2, 1);
      const b = add(w / 2, under(z), z, n, z, w / 2, 1);
      if (last >= 0) {
        tri(last, last + 1, b, n.clone().set(0, -1, 0));
        tri(last, b, a, n.clone().set(0, -1, 0));
      }
      last = a;
    }
  }
  k.g.addStone(pos, nor, st, idx);
}

/**
 * A humpbacked stone bridge carrying the path over the stream, w wide: coursed stone on an arch,
 * a deck of slabs with kerb stones along its edges, stone pillars at its four corners and wooden
 * post-and-rail parapets between them, and rocks at the arch's feet.
 */
export function bridge(k: Kit, w = 2.4) {
  stoneBody(k, w);
  const top = (z: number) => bridgeGround(z) + bridgeRise(z);
  const end = BRIDGE_HALF - 0.32;
  const stone = "#b3ad9c";
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const z = sz * end;
      k.box((sx * (w / 2 - 0.13)), top(z) - 0.1, z, 0.28, 0.82, 0.28, stone);
      k.box((sx * (w / 2 - 0.13)), top(z) + 0.72, z, 0.34, 0.08, 0.34, "#c3bdac");
    }
  // Wooden posts along each side, and two rails following the hump between them.
  const posts = 8;
  for (const sx of [-1, 1]) {
    const x = sx * (w / 2 - 0.12);
    const zs = Array.from({ length: posts + 1 }, (_, i) => -end + (2 * end * i) / posts);
    zs.forEach((z, i) => {
      if (i > 0 && i < posts) k.box(x, top(z) - 0.05, z, 0.1, 0.86, 0.1, C.woodDark);
      if (i === 0) return;
      const z0 = zs[i - 1];
      for (const [h, t, d] of [
        [0.74, 0.08, 0.09],
        [0.4, 0.06, 0.06],
      ] as const) {
        const y0 = top(z0) + h;
        const y1 = top(z) + h;
        const len = Math.hypot(z - z0, y1 - y0) + 0.04;
        k.tilted(x, (y0 + y1) / 2, (z0 + z) / 2, d, t, len, C.wood, -Math.atan2(y1 - y0, z - z0));
      }
    });
  }
  // Rocks where the arch meets the banks.
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) k.rock(sx * (w / 2 + 0.22), 0.04, sz * (ARCH_HALF + 0.15), 0.32 + 0.05 * sx * sz, "#aaa697", sx + sz * 2);
}

/** Zebra crossing across a road of half-width hw, stripes running along the road (z). */
export function crossing(k: Kit, hw: number) {
  for (let x = -hw + 0.35; x <= hw - 0.3; x += 0.55) k.box(x, 0.045, 0, 0.32, 0.015, 1.4, C.line);
}

/** A sagging wire from a to b (world points), as short straight pieces. */
export function wire(g: Geo, a: THREE.Vector3, b: THREE.Vector3, sag: number, up: THREE.Vector3) {
  const N = 8;
  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const at = (t: number, out: THREE.Vector3) => out.lerpVectors(a, b, t).addScaledVector(up, -sag * 4 * t * (1 - t));
  const q = new THREE.Quaternion();
  const m = new THREE.Matrix4();
  const y = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < N; i++) {
    at(i / N, p0);
    at((i + 1) / N, p1);
    const d = p1.clone().sub(p0);
    const len = d.length();
    q.setFromUnitVectors(y, d.normalize());
    m.compose(p0.clone().add(p1).multiplyScalar(0.5), q, new THREE.Vector3(0.035, len, 0.035));
    g.add(CYL, m, C.black);
  }
}

/** A run of kerb, along z. */
export function kerb(k: Kit, l: number, h = 0.15) {
  k.box(0, 0, 0, 0.2, h, l, C.curb);
}
/** Drain grate and manhole cover, flush with the road. */
export function grate(k: Kit) {
  // Long side along the gutter (z), slots across it.
  k.box(0, 0.04, 0, 0.32, 0.02, 0.75, C.metalDark);
  for (let i = 0; i < 5; i++) k.box(0, 0.052, -0.28 + i * 0.14, 0.24, 0.008, 0.06, "#3a4447");
}
export function manhole(k: Kit) {
  k.cyl(0, 0.03, 0, 0.36, 0.025, C.metalDark, true);
  k.cyl(0, 0.05, 0, 0.26, 0.012, C.metal, true);
}

/** Traffic cone. */
export function cone(k: Kit, x = 0, z = 0) {
  k.box(x, 0, z, 0.36, 0.04, 0.36, "#e0643c");
  k.cone(x, 0.04, z, 0.14, 0.6, "#ea7a4a");
  k.cyl(x, 0.3, z, 0.1, 0.08, C.frame, true);
}
/** Striped roadwork barrier on two A-legs, along x. */
export function barrier(k: Kit, l = 1.4) {
  for (const x of [-l / 2 + 0.1, l / 2 - 0.1]) {
    k.tilted(x, 0.35, 0.12, 0.05, 0.75, 0.05, C.metalDark, 0.3);
    k.tilted(x, 0.35, -0.12, 0.05, 0.75, 0.05, C.metalDark, -0.3);
  }
  for (let i = 0; i < 5; i++) k.box(-l / 2 + (l * (i + 0.5)) / 5, 0.62, 0, l / 5, 0.22, 0.04, i % 2 ? C.frame : "#e0643c");
}
/** A row of round pots with greens: a neighbour's kerbside garden. */
export function planters(k: Kit, r: R) {
  const n = 2 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * 0.5;
    unbuilt(k, (q) => {
      pottedGreens(q, r, x, 0.3, 0, 0.2);
      if (r() < 0.3) pick(r, C.flower);
    });
    k.sprite(x, 0, 0, 0.55, PROP.plants[k.spotCell(x, 0, 0, PROP.plants.length)]);
  }
  if (r() < 0.5) {
    unbuilt(k, (q) => pottedGreens(q, r, 0.9, 0.5, 0, 0.32));
    k.sprite(0.9, 0, 0, 0.75, PROP.plants[k.spotCell(0.9, 0, 0, PROP.plants.length)]);
  }
}
/** A parked bicycle, along x: thin tyres with hubs and spokes, a diamond frame, saddle and bars. */
export function bicycle(k: Kit, r: R) {
  const c = pick(r, ["#a8665d", "#5f7f96", "#3a4c50", "#b8a06a"]);
  const W = 0.31; // wheel radius
  const back = -0.5;
  const front = 0.5;
  for (const x of [back, front]) {
    k.tyre(x, W, 0, W, "#2f3438");
    k.cyl(x, W - 0.03, 0, 0.03, 0.06, C.metal, true);
    for (let i = 0; i < 4; i++) k.tilted(x, W, 0, 0.008, W * 1.9, 0.008, "#9aa3a5", 0, 0, (i / 4) * Math.PI);
  }
  // Frame: chain stay, seat tube, top tube, down tube, fork.
  const bb = [-0.05, 0.3];
  const seat = [-0.18, 0.78];
  const head = [0.38, 0.76];
  const seg = (a: number[], b: number[], t = 0.022) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    k.tilted((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0, Math.hypot(dx, dy), t, t, c, 0, 0, Math.atan2(dy, dx));
  };
  seg([back, W], bb);
  seg([back, W], seat);
  seg(bb, seat);
  seg(seat, head);
  seg(bb, head);
  seg(head, [front, W]);
  k.box(seat[0] - 0.03, seat[1], 0, 0.22, 0.05, 0.09, "#2f3438");
  k.box(head[0] + 0.02, head[1] + 0.12, 0, 0.04, 0.04, 0.46, "#2f3438");
  k.cyl(head[0], head[1], 0, 0.015, 0.14, c);
  if (r() < 0.5) k.box(front + 0.08, 0.66, 0, 0.26, 0.16, 0.28, C.metal);
}
/** A parked scooter, along x. */
export function scooter(k: Kit, r: R) {
  const c = pick(r, ["#f4f2ea", "#7aa7c7", "#e6a7a0", "#d9a441"]);
  for (const x of [-0.5, 0.5]) k.torus(x, 0.2, 0, 0.18, 0.06, "#2f3438");
  k.box(-0.15, 0.2, 0, 0.75, 0.32, 0.36, c);
  k.box(-0.25, 0.52, 0, 0.5, 0.1, 0.3, "#3a3f43");
  k.tilted(0.48, 0.55, 0, 0.12, 0.75, 0.3, c, 0, 0, -0.25);
  k.box(0.6, 0.95, 0, 0.06, 0.05, 0.55, "#3a3f43");
}
/** Convex traffic mirror on an orange pole, for a blind corner. */
export function trafficMirror(k: Kit) {
  k.cyl(0, 0, 0, 0.05, 2.5, "#e0643c");
  k.box(0, 2.35, 0.12, 0.08, 0.08, 0.25, "#e0643c");
  k.cyl(0, 2.15, 0.28, 0.33, 0.05, "#e0643c", true);
  k.cyl(0, 2.16, 0.32, 0.28, 0.03, "#cfe9ec", true);
}
/** Neighbourhood notice board with pinned posters. */
export function noticeBoard(k: Kit, r: R) {
  for (const x of [-0.55, 0.55]) k.box(x, 0, 0, 0.07, 1.7, 0.07, C.woodDark);
  k.box(0, 0.85, 0.04, 1.2, 0.8, 0.05, "#8a6a4f");
  k.box(0, 1.68, 0.1, 1.35, 0.06, 0.22, C.woodDark);
  for (let i = 0; i < 4; i++) k.box(-0.38 + (i % 2) * 0.48 + r() * 0.08, 0.95 + Math.floor(i / 2) * 0.32 + r() * 0.04, 0.075, 0.32, 0.26, 0.01, pick(r, ["#f4f2ea", "#f2c23a", "#e6a7a0", "#9fd0cf"]));
}
/** Concrete steps climbing the hill away from the road (toward -z), with a handrail. */
export function steps(k: Kit, n = 7) {
  for (let i = 0; i < n; i++) k.box(0, 0, -i * 0.32, 1.1, 0.18 * (i + 1), 0.34, C.concrete[i % 2]);
  k.box(0.6, 0, -((n - 1) * 0.32) / 2, 0.1, 0.18 * n + 0.1, n * 0.32, C.concrete[2]);
  k.tilted(0.6, 0.18 * n * 0.5 + 0.9, -((n - 1) * 0.32) / 2, 0.04, 0.04, n * 0.36, C.metal, Math.atan2(0.18, 0.32));
}
/** A darker patch of fresh asphalt for roadwork. */
export function patch(k: Kit, w: number, l: number) {
  k.box(0, 0.04, 0, w, 0.012, l, "#5a6970");
}

/** Paper lantern hanging from a bracket, glowing warm (abstract glyph band). */
export function lantern(k: Kit, x: number, y: number, z: number) {
  k.box(x, y + 0.3, z - 0.15, 0.03, 0.03, 0.3, C.metalDark);
  k.box(x, y + 0.22, z, 0.025, 0.1, 0.025, C.metalDark);
  k.blob(x, y + 0.06, z, 0.12, "#ffd9a0", 1.3);
  k.cyl(x, y - 0.1, z, 0.07, 0.03, "#c4574f", true);
  k.cyl(x, y + 0.2, z, 0.07, 0.03, "#c4574f", true);
  k.box(x, y + 0.03, z + 0.115, 0.05, 0.12, 0.015, "#c4574f");
}
/** Cloth banner hanging down a wall facing +z, with abstract glyph marks. */
export function banner(k: Kit, x: number, y: number, z: number, r: R) {
  const c = pick(r, ["#f4f2ea", "#e6dfcc", "#c4574f", "#2b464b"]);
  k.box(x, y, z + 0.06, 0.55, 1.2, 0.02, c);
  k.box(x, y + 1.2, z + 0.06, 0.65, 0.04, 0.04, C.woodDark);
  // The cloth is one of the eight drawn banners.
  k.sheetZ("signs", 8 + k.spotCell(x, y, z, 8), 8, 2, x, y + 0.6, z + 0.072, 0.55, 1.2);
}
/** White pipe railing along x (pavement edge), length l. */
export function pipeRail(k: Kit, l: number) {
  const posts = Math.max(2, Math.round(l / 1.1) + 1);
  for (let i = 0; i < posts; i++) k.cyl(-l / 2 + (l * i) / (posts - 1), 0, 0, 0.035, 0.85, "#f1f1ec", true);
  k.tilted(0, 0.85, 0, l, 0.06, 0.06, "#f1f1ec");
  k.tilted(0, 0.45, 0, l, 0.05, 0.05, "#f1f1ec");
}
/** A row of potted plants along x, length l: pots of different sizes and greens. */
export function potRow(k: Kit, r: R, l: number) {
  // (spaced a little wider than the draws ask, as the drawn pots are bushier than the old ones were)
  for (let x = -l / 2; x < l / 2; x += 0.3 + r() * 0.25) {
    const big = r() < 0.3;
    const pr = big ? 0.17 : 0.11;
    const z = (r() - 0.5) * 0.15;
    pick(r, C.leaf);
    pick(r, C.leaf);
    if (!(r() < 0.4)) unbuilt(k, (q) => pottedGreens(q, r, x, (big ? 0.3 : 0.2) + pr * 0.6, 0, pr * 1.2));
    k.sprite(x, 0, z, big ? 0.66 : 0.45, PROP.plants[k.spotCell(x, 0, z, PROP.plants.length)]);
  }
}
/** Small kei truck, parked along x. */
export function keiTruck(k: Kit, r: R) {
  const c = pick(r, ["#eeeee8", "#e9e6dc", "#cfd8d6"]);
  for (const [x, z] of [[-0.9, -0.62], [-0.9, 0.62], [0.95, -0.62], [0.95, 0.62]]) k.torus(x, 0.28, z, 0.24, 0.09, "#2f3438");
  k.box(0.15, 0.3, 0, 3.1, 0.25, 1.35, "#3a3f43");
  // Cab.
  k.box(-1.05, 0.5, 0, 0.95, 1.0, 1.35, c);
  k.box(-1.36, 0.95, 0, 0.32, 0.5, 1.25, "#5f8c93");
  k.box(-1.05, 1.0, 0.68, 0.6, 0.42, 0.02, "#5f8c93");
  k.box(-1.05, 1.0, -0.68, 0.6, 0.42, 0.02, "#5f8c93");
  k.box(-1.53, 0.55, 0, 0.06, 0.18, 1.3, C.metalDark);
  // Flatbed with low sides and some cargo.
  k.box(0.65, 0.55, 0, 2.0, 0.08, 1.35, c);
  for (const z of [-0.65, 0.65]) k.box(0.65, 0.63, z, 2.0, 0.32, 0.05, c);
  k.box(1.63, 0.63, 0, 0.05, 0.32, 1.35, c);
  if (r() < 0.7) {
    k.box(0.4, 0.63, 0.1, 0.6, 0.45, 0.6, "#c9a46b");
    k.box(1.0, 0.63, -0.2, 0.5, 0.35, 0.5, "#b8925a");
  }
}
/** Pavement tiles: a grid of slightly different slabs over a strip, along z. */
export function tiles(k: Kit, r: R, w: number, l: number) {
  for (let z = -l / 2; z < l / 2 - 0.01; z += 0.5)
    for (let x = -w / 2; x < w / 2 - 0.01; x += 0.5) k.box(x + 0.25, 0.025, z + 0.25, 0.47, 0.012, 0.47, r() < 0.5 ? "#e4dccb" : "#d9d0bd");
}

/** A white arrow painted on the road, pointing +z. */
export function roadArrow(k: Kit) {
  k.box(0, 0.045, -0.3, 0.14, 0.012, 1.0, C.line);
  k.tilted(-0.16, 0.051, 0.32, 0.12, 0.012, 0.5, C.line, 0, 0.7);
  k.tilted(0.16, 0.051, 0.32, 0.12, 0.012, 0.5, C.line, 0, -0.7);
}
/** Stop line across the lane (half-width hw). */
export function stopLine(k: Kit, hw: number) {
  k.box(0, 0.045, 0, hw * 2 - 0.2, 0.012, 0.25, C.line);
}
/** Triangular warning sign on a post (generic exclamation glyph). */
/** Triangular warning sign on a post. */
export function warningSign(k: Kit) {
  k.cyl(0, 0, 0, 0.04, 2.1, C.metal);
  signFace(k, 1, 0, 2.35, 0.03, 0.66);
}
/** Round no-entry sign on a post. */
export function noEntry(k: Kit) {
  k.cyl(0, 0, 0, 0.04, 2.0, C.metal);
  k.leaf(0, 2.2, 0.02, 0.54, 0.02, 0.54, "#8f9a9c", Math.PI / 2);
  signFace(k, 2, 0, 2.2, 0.03, 0.58);
}

/** Road wear: an irregular darker patch, and sometimes a crack line. */
export function wear(k: Kit, r: R) {
  // Puddles, oil spots, scuffs and cracks from the painted decal sheet.
  const ROAD = [14, 15, 1, 13];
  k.decalFlat(0, 0, 0.7 + r() * 0.8, ROAD[Math.floor(r() * ROAD.length)], r() * 6);
  if (r() < 0.35) k.tilted(0, 0.041, 0, 0.5 + r() * 0.6, 0.008, 0.4 + r() * 0.8, "#64737a", 0, r() * 3);
}

/** A pair of lidded rubbish bins. */
export function bins(k: Kit, r: R) {
  for (const x of [-0.27, 0.27]) {
    const c = pick(r, [0, 1, 0]);
    k.sprite(x, 0, 0, 0.66, PROP.bins[c]);
  }
}

/** Water tower on four legs with a ladder: a landmark that shows over the rooftops. */
export function waterTower(k: Kit) {
  // (the legs reach on into the hillside, so none stands short of the slope)
  for (const [x, z] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) k.box(x, -FOUNDATION, z, 0.16, 7 + FOUNDATION, 0.16, C.metalDark);
  for (const y of [2.3, 4.6]) {
    k.box(0, y, -0.9, 1.9, 0.08, 0.08, C.metal);
    k.box(0, y, 0.9, 1.9, 0.08, 0.08, C.metal);
    k.box(-0.9, y, 0, 0.08, 0.08, 1.9, C.metal);
    k.box(0.9, y, 0, 0.08, 0.08, 1.9, C.metal);
  }
  k.box(0, 7, 0, 2.3, 0.18, 2.3, C.metalDark);
  k.cyl(0, 7.18, 0, 1.25, 2.1, "#b9c8c2", true);
  k.cyl(0, 8.45, 0, 1.3, 0.15, "#8aa09a", true);
  k.cone(0, 8.6, 0, 1.3, 0.6, "#8aa09a");
  k.box(0, 7.9, 1.26, 1.1, 0.5, 0.04, "#e9e6dc");
  for (let y = 0.3; y < 7; y += 0.35) k.box(1.0, y, 1.0, 0.3, 0.03, 0.03, C.metal);
}
/** Abstract stencil lettering painted on the road (made-up glyphs, not words). */
export function roadGlyphs(k: Kit, r: R) {
  for (let i = 0; i < 2; i++) {
    const z = -0.5 + i * 1.0;
    k.box(-0.18, 0.045, z, 0.08, 0.012, 0.7, C.line);
    k.box(0.05, 0.045, z + 0.2 * (r() < 0.5 ? 1 : -1), 0.38, 0.012, 0.08, C.line);
    k.box(0.22, 0.045, z, 0.08, 0.012, 0.5 + r() * 0.2, C.line);
  }
}
