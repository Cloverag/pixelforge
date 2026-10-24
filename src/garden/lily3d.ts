import { rng } from './flowers';

/**
 * 3D LILY: a bouquet of oriental lilies built from parametric surfaces.
 *
 * Each lily is six tepals (two rings of three). A tepal is a surface over
 * (t along it, w across it): it rises from the throat, then curls back at the
 * tip; it is widest a third of the way out and cupped along a keel. Stems and
 * leaves join them. The scene first draws itself as a wireframe, element by
 * element, then the lit surfaces fade in, and the camera keeps orbiting.
 *
 * Plain 2D canvas: quads are projected, shaded (two-sided, with a little
 * light through the petal from behind), and painted back to front.
 */

type V3 = [number, number, number];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => mul(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));

/** A quad of the scene: four corners, its colour, and when it is built. */
interface Quad {
  p: [V3, V3, V3, V3];
  col: V3;
  /** seconds: its wireframe starts, its surface follows */
  t0: number;
}
interface Line {
  a: V3;
  b: V3;
  col: V3;
  w: number;
  t0: number;
}

/** Petal colours: [throat, body, margin]. Stargazer pink, white, orange, gold. */
const LILY_COLS: [V3, V3, V3][] = [
  [[0.55, 0.05, 0.25], [0.92, 0.25, 0.55], [1, 0.9, 0.95]],
  [[0.75, 0.6, 0.35], [0.97, 0.95, 0.9], [1, 1, 1]],
  [[0.75, 0.25, 0.05], [1, 0.55, 0.2], [1, 0.85, 0.6]],
  [[0.7, 0.5, 0.05], [1, 0.82, 0.2], [1, 0.97, 0.7]],
];

const mix3 = (a: V3, b: V3, k: number): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

/** One tepal's surface point. */
function tepalAt(c: V3, axis: V3, d: V3, e: V3, L: number, wid: number, t: number, w: number): V3 {
  const r = t * L;
  const lift = L * (0.62 * t - 0.6 * t * t); // up, then curled back at the tip
  const half = L * wid * Math.sin(Math.PI * Math.pow(t, 0.75)) * (1 - 0.2 * t);
  const keel = -0.1 * L * w * w * Math.sin(Math.PI * t);
  return add(add(add(c, mul(d, r)), mul(axis, lift + keel)), mul(e, w * half));
}

export interface LilyScene {
  quads: Quad[];
  lines: Line[];
}

/** The bouquet, built once per seed. */
export function buildLilies(seed: number): LilyScene {
  const rand = rng(seed);
  const quads: Quad[] = [];
  const lines: Line[] = [];
  const tie: V3 = [0, -1.7, 0];
  const n = 5;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand() * 0.6;
    const rad = i === 0 ? 0 : 0.85 + rand() * 0.3;
    const head: V3 = [Math.cos(a) * rad, 0.7 + rand() * 0.5 - rad * 0.3, Math.sin(a) * rad];
    if (i === 0) head[1] = 1.15;
    const axis = norm(add(norm(sub(head, tie)), [Math.cos(a) * rad * 0.6, 0.25, Math.sin(a) * rad * 0.6]));
    const u = norm(cross(axis, Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    const v = cross(axis, u);
    const cols = LILY_COLS[Math.floor(rand() * LILY_COLS.length)];
    const L = 0.85 + rand() * 0.25;
    const start = 0.6 + i * 0.7;
    // the stem, from the tie up to the bloom, bowed outward
    const mid = add(mul(add(tie, head), 0.5), [Math.cos(a) * 0.25, 0, Math.sin(a) * 0.25]);
    for (let s = 0; s < 8; s++) {
      const p = bez(tie, mid, head, s / 8);
      const q = bez(tie, mid, head, (s + 1) / 8);
      lines.push({ a: p, b: q, col: [0.25, 0.55, 0.22], w: 0.045, t0: start - 0.5 + s * 0.04 });
    }
    // a leaf on the way up
    const lb = bez(tie, mid, head, 0.35);
    const ld = norm([Math.cos(a + 0.8), 0.6, Math.sin(a + 0.8)]);
    const le = norm(cross(ld, [0, 1, 0]));
    for (let s = 0; s < 6; s++)
      for (const side of [-1, 1]) {
        const at = (k: number, w: number): V3 => add(add(lb, mul(ld, k * 0.7)), add(mul(le, w * 0.09 * Math.sin(Math.PI * k)), [0, -0.12 * k * k, 0]));
        quads.push({ p: [at(s / 6, 0), at((s + 1) / 6, 0), at((s + 1) / 6, side), at(s / 6, side)], col: [0.3, 0.62, 0.24], t0: start - 0.3 });
      }
    // six tepals, the inner ring a little narrower
    for (let k = 0; k < 6; k++) {
      const inner = k % 2 === 1;
      const phi = (k / 6) * Math.PI * 2 + rand() * 0.15;
      const d = add(mul(u, Math.cos(phi)), mul(v, Math.sin(phi)));
      const e = cross(axis, d);
      const len = L * (inner ? 0.92 : 1);
      const wid = inner ? 0.2 : 0.17;
      const T = 9;
      const Wn = 4;
      for (let ti = 0; ti < T; ti++)
        for (let wi = 0; wi < Wn; wi++) {
          const t1 = ti / T;
          const t2 = (ti + 1) / T;
          const w1 = -1 + (2 * wi) / Wn;
          const w2 = -1 + (2 * (wi + 1)) / Wn;
          const P = (t: number, w: number) => tepalAt(head, axis, d, e, len, wid, t, w);
          const tm = (t1 + t2) / 2;
          const wm = Math.abs((w1 + w2) / 2);
          const body = tm < 0.25 ? mix3(cols[0], cols[1], tm / 0.25) : cols[1];
          quads.push({ p: [P(t1, w1), P(t2, w1), P(t2, w2), P(t1, w2)], col: mix3(body, cols[2], Math.pow(wm, 3) * 0.9), t0: start + k * 0.08 });
        }
    }
    // stamens and the pistil
    for (let s = 0; s < 7; s++) {
      const phi = (s / 6) * Math.PI * 2;
      const tip = s === 6 ? add(head, mul(axis, L * 0.7)) : add(add(head, mul(axis, L * 0.5)), mul(add(mul(u, Math.cos(phi)), mul(v, Math.sin(phi))), L * 0.32));
      lines.push({ a: head, b: tip, col: [0.85, 0.9, 0.65], w: 0.012, t0: start + 0.5 });
      lines.push({ a: tip, b: add(tip, mul(axis, 0.05)), col: s === 6 ? [0.6, 0.8, 0.4] : [0.55, 0.2, 0.08], w: 0.05, t0: start + 0.6 });
    }
  }
  return { quads, lines };
}

function bez(a: V3, b: V3, c: V3, t: number): V3 {
  const s = 1 - t;
  return add(add(mul(a, s * s), mul(b, 2 * s * t)), mul(c, t * t));
}

/** toward the light: up, right, and toward the viewer at the start of the orbit */
const LIGHT = norm([0.4, 0.8, -0.6]);
/** a wireframe takes this long to draw, then its surface takes as long to fill in */
const WIRE = 1.0;

/** Draw the scene at time t: camera orbiting, wireframe then surfaces. */
export function drawLilies(g: CanvasRenderingContext2D, s: LilyScene, w: number, h: number, t: number): void {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  const yaw = t * 0.22;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const pitch = -0.18;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const f = h * 1.05;
  const D = 5.2;
  const cam = (p: V3): V3 => {
    const x = p[0] * cy + p[2] * sy;
    const z0 = -p[0] * sy + p[2] * cy;
    const y = p[1] * cp - z0 * sp;
    const z = p[1] * sp + z0 * cp;
    return [x, y, z];
  };
  const proj = (c: V3): [number, number] => [w / 2 + (f * c[0]) / (D + c[2]), h * 0.46 - (f * c[1]) / (D + c[2])];

  type Item = { z: number; draw: () => void };
  const items: Item[] = [];
  for (const q of s.quads) {
    const wire = Math.min(1, Math.max(0, (t - q.t0) / WIRE));
    if (wire <= 0) continue;
    const fill = Math.min(1, Math.max(0, (t - q.t0 - WIRE) / WIRE));
    const c = q.p.map(cam) as [V3, V3, V3, V3];
    const n = norm(cross(sub(c[1], c[0]), sub(c[3], c[0])));
    // two-sided: the side we see, lit from the front; a little light shows through from behind
    const facing = n[2] > 0 ? mul(n, -1) : n;
    const Lc = cam(LIGHT);
    const lit = Math.max(0, dot(facing, Lc));
    const through = Math.max(0, -dot(facing, Lc)) * 0.35;
    const k = 0.32 + 0.75 * lit + through;
    const col = q.col.map((x) => Math.min(255, Math.round(x * k * 255)));
    const pts = c.map(proj);
    const z = (c[0][2] + c[1][2] + c[2][2] + c[3][2]) / 4;
    items.push({
      z,
      draw: () => {
        g.beginPath();
        g.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < 4; i++) g.lineTo(pts[i][0], pts[i][1]);
        g.closePath();
        if (fill > 0) {
          g.globalAlpha = fill;
          g.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
          g.fill();
          // the same colour round the edge hides the seams between quads
          g.strokeStyle = g.fillStyle;
          g.lineWidth = 1;
          g.stroke();
        }
        if (fill < 1) {
          g.globalAlpha = wire * (1 - fill);
          g.strokeStyle = '#9fe8ff';
          g.lineWidth = 0.8;
          g.stroke();
        }
        g.globalAlpha = 1;
      },
    });
  }
  for (const l of s.lines) {
    const k = Math.min(1, Math.max(0, (t - l.t0) / WIRE));
    if (k <= 0) continue;
    const a = cam(l.a);
    const b = cam(add(l.a, mul(sub(l.b, l.a), k)));
    const pa = proj(a);
    const pb = proj(b);
    const col = l.col.map((x) => Math.round(x * 255));
    items.push({
      z: (a[2] + b[2]) / 2,
      draw: () => {
        g.strokeStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
        g.lineWidth = Math.max(1, (f * l.w) / (D + a[2]));
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(pa[0], pa[1]);
        g.lineTo(pb[0], pb[1]);
        g.stroke();
      },
    });
  }
  // far to near
  items.sort((p, q) => q.z - p.z);
  for (const it of items) it.draw();
}

/** When the whole bouquet has finished building, in seconds. */
export function lilyBuildTime(s: LilyScene): number {
  let last = 0;
  for (const q of s.quads) last = Math.max(last, q.t0);
  return last + 2 * WIRE;
}
