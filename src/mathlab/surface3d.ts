import * as THREE from 'three';
import type { Surface, V3 } from './surface';

/**
 * MATH LAB's surfaces drawn by WebGL. The 2D version painted quads back to
 * front by their middle's depth, which put the rose's petals through each
 * other where they overlap; a depth buffer gets every pixel right. Normals
 * are smooth across the grid instead of one flat shade a quad, and a frame is
 * one draw instead of thousands of sorted canvas paths.
 *
 * Rendered off screen and copied onto the picture's 2D canvas, so the ASCII
 * filter and the title screen's preview take it as they took the old one.
 * Loaded on demand (surface.ts imports it the first time a graph is drawn),
 * like every three.js view: the entry chunk never carries three.
 */

/** what a SurfaceRun hands over to be drawn: its grid, fitted into a unit box */
export interface SurfaceFrame {
  readonly s: Surface;
  readonly nu: number;
  readonly nv: number;
  readonly pts: V3[];
  readonly origin: V3;
  readonly zMin: number;
  readonly zMax: number;
}

/**
 * The grid's indices, a row of quads at a time, so a draw range of the first
 * `rows` rows is the surface built that far: two triangles a quad, and the
 * mesh lines - the first row's edge, then each row's uprights and top edge.
 */
export function gridIndex(nu: number, nv: number): { tri: number[]; seg: number[]; triCount: (rows: number) => number; segCount: (rows: number) => number } {
  const tri: number[] = [];
  const seg: number[] = [];
  for (let i = 0; i < nu - 1; i++) seg.push(i, i + 1);
  for (let j = 0; j < nv - 1; j++) {
    for (let i = 0; i < nu - 1; i++) {
      const a = j * nu + i;
      tri.push(a, a + 1, a + nu + 1, a, a + nu + 1, a + nu);
    }
    for (let i = 0; i < nu; i++) seg.push(j * nu + i, (j + 1) * nu + i);
    for (let i = 0; i < nu - 1; i++) seg.push((j + 1) * nu + i, (j + 1) * nu + i + 1);
  }
  return {
    tri,
    seg,
    triCount: (rows) => rows * (nu - 1) * 6,
    segCount: (rows) => (rows > 0 ? 2 * (nu - 1) + rows * 2 * (2 * nu - 1) : 0),
  };
}

/**
 * Colours go through as written, no sRGB conversion either way: the 2D
 * version multiplied its shade straight into the sRGB numbers, and lighting
 * them in linear light instead turned the rose from pink to crimson.
 */
const RAW = THREE.LinearSRGBColorSpace;

/** the 2D version's camera: this far back, and the picture's middle 54% of the way down */
const D = 3.2;
const AXES: [V3, string, string][] = [
  [[0.75, 0, 0], 'x', '#ff8a80'],
  [[0, 0.75, 0], 'y', '#9fe8a0'],
  [[0, 0, 0.6], 'z', '#9fd0ff'],
];

/** One renderer for every graph: the lab's and the title screen's preview never draw at once. */
class SurfaceView {
  readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(50, 1, 0.1, 20);
  // the maths is z up and three is y up; pitch tips it towards the camera, yaw turns it about its own z
  private pitch = new THREE.Group();
  private yaw = new THREE.Group();
  private surface = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      // pushed back a touch, so the mesh lines on it are not lost in it
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
  );
  private lines = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: new THREE.Color().setHex(0xffebdc, RAW), transparent: true, opacity: 0.3 }),
  );
  // over everything, as the 2D version drew them last
  private axes = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false }),
  );
  private shown: SurfaceFrame | null = null;
  private index = gridIndex(2, 2);
  private v = new THREE.Vector3();
  private size = new THREE.Vector2();

  constructor() {
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = RAW;
    this.scene.background = new THREE.Color().setHex(0x05050d, RAW);
    const zUp = new THREE.Group();
    zUp.rotation.x = -Math.PI / 2;
    this.scene.add(this.pitch);
    this.pitch.add(zUp);
    zUp.add(this.yaw);
    this.axes.renderOrder = 1;
    this.yaw.add(this.surface, this.lines, this.axes);
    // the 2D shade, 0.35 + 0.65 |n.L| (three's lights divide by pi). |n.L| is a
    // light from L and another from -L: whichever faces a side lights it
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.35 * Math.PI));
    for (const k of [1, -1]) {
      const sun = new THREE.DirectionalLight(0xffffff, 0.65 * Math.PI);
      // in the surface's own frame, as before: the light turns with it
      sun.position.set(0.35 * k, -0.45 * k, 0.82 * k);
      this.yaw.add(sun, sun.target);
    }
  }

  private build(f: SurfaceFrame): void {
    const { nu, nv, pts } = f;
    const pos = new Float32Array(nu * nv * 3);
    const col = new Float32Array(nu * nv * 3);
    const c = new THREE.Color();
    const zr = f.zMax - f.zMin || 1;
    pts.forEach(([x, y, z], k) => {
      pos.set([x, y, z], k * 3);
      const [r, g, b] = f.s.colour((k % nu) / (nu - 1), Math.floor(k / nu) / (nv - 1), (z - f.zMin) / zr);
      c.setRGB(r, g, b, RAW);
      col.set([c.r, c.g, c.b], k * 3);
    });
    const position = new THREE.BufferAttribute(pos, 3);
    this.index = gridIndex(nu, nv);

    this.surface.geometry.dispose();
    this.surface.geometry = new THREE.BufferGeometry();
    this.surface.geometry.setAttribute('position', position);
    this.surface.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.surface.geometry.setIndex(this.index.tri);
    this.surface.geometry.computeVertexNormals();

    this.lines.geometry.dispose();
    this.lines.geometry = new THREE.BufferGeometry();
    this.lines.geometry.setAttribute('position', position);
    this.lines.geometry.setIndex(this.index.seg);

    const o = f.origin;
    const ap: number[] = [];
    const ac: number[] = [];
    if (f.s.axes)
      for (const [d, , hex] of AXES) {
        c.setStyle(hex, RAW);
        ap.push(...o, o[0] + d[0], o[1] + d[1], o[2] + d[2]);
        ac.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
    this.axes.geometry.dispose();
    this.axes.geometry = new THREE.BufferGeometry();
    this.axes.geometry.setAttribute('position', new THREE.Float32BufferAttribute(ap, 3));
    this.axes.geometry.setAttribute('color', new THREE.Float32BufferAttribute(ac, 3));
    this.shown = f;
  }

  draw(g: CanvasRenderingContext2D, w: number, h: number, aw: number, f: SurfaceFrame, built: number, yaw: number, pitch: number): void {
    if (this.shown !== f) this.build(f);
    const rows = Math.ceil((f.nv - 1) * built);
    this.surface.geometry.setDrawRange(0, this.index.triCount(rows));
    this.lines.geometry.setDrawRange(0, this.index.segCount(rows));
    this.yaw.rotation.z = yaw;
    this.pitch.rotation.x = -pitch;

    // the 2D camera: S pixels a unit at the middle's depth, centred in the left aw pixels
    const S = Math.min(aw, h) * 0.62;
    const size = this.renderer.getSize(this.size);
    if (size.x !== w || size.y !== h) this.renderer.setSize(w, h, false);
    this.camera.position.set(0, 0, D);
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(h / (2 * S * D)));
    this.camera.aspect = w / h;
    this.camera.setViewOffset(w, h, (w - aw) / 2, -0.04 * h, w, h);
    this.renderer.render(this.scene, this.camera);
    g.drawImage(this.renderer.domElement, 0, 0);

    if (!f.s.axes) return;
    g.font = `${Math.round(S / 18)}px 'IBM Plex Mono', monospace`;
    const o = f.origin;
    for (const [d, label, hex] of AXES) {
      const p = this.yaw.localToWorld(this.v.set(o[0] + d[0], o[1] + d[1], o[2] + d[2])).project(this.camera);
      g.fillStyle = hex;
      g.fillText(label, ((p.x + 1) / 2) * w + 4, ((1 - p.y) / 2) * h - 4);
    }
  }
}

let view: SurfaceView | null = null;
let failed = false;

/** Draws one surface onto g; false when this browser has no WebGL to draw it with. */
export function drawSurface(g: CanvasRenderingContext2D, w: number, h: number, aw: number, f: SurfaceFrame, built: number, yaw: number, pitch: number): boolean {
  if (failed) return false;
  try {
    view ??= new SurfaceView();
  } catch {
    failed = true;
    return false;
  }
  view.draw(g, w, h, aw, f, built, yaw, pitch);
  return true;
}
