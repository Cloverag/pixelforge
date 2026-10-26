import type { Param } from './drawings';

/**
 * MATH LAB's 3D graphs: surfaces given as a function of two numbers (u, v)
 * -> (x, y, z), sampled on a grid and drawn as shaded quads, back to front,
 * on a plain 2D canvas - with axes and the mesh's grid lines, building row
 * by row, turning slowly; dragging turns them by hand.
 *
 * The surfaces are pure (params -> grid of points); SurfaceRun draws one.
 */

export type V3 = [number, number, number];

export interface Surface {
  id: string;
  name: string;
  idea: string;
  params: Param[];
  code(p: Record<string, number>): string[];
  /** the maths, typeset (KaTeX), with the current values written in */
  tex(p: Record<string, number>): string;
  /** the code line lit while it builds */
  plotLine: number;
  /** the grid: nu x nv points, row by row along v */
  mesh(p: Record<string, number>): { nu: number; nv: number; pts: V3[] };
  /** colour of a quad from where it is (u, v in 0..1) and its height (0..1) */
  colour(u: number, v: number, h: number): V3;
  /** draw axes through the origin */
  axes: boolean;
}

const TAU = Math.PI * 2;

/** viridis-like: deep blue, teal, green, yellow by height */
function heightColour(h: number): V3 {
  const stops: V3[] = [[0.27, 0.0, 0.33], [0.23, 0.32, 0.55], [0.13, 0.57, 0.55], [0.37, 0.79, 0.38], [0.99, 0.91, 0.14]];
  const x = Math.min(0.999, Math.max(0, h)) * (stops.length - 1);
  const i = Math.floor(x);
  const k = x - i;
  return stops[i].map((c, j) => c + (stops[i + 1][j] - c) * k) as V3;
}

/** a number in front of a bracket: 1 and -1 are not written */
const coef = (k: number) => (k === 1 ? '' : k === -1 ? '-' : `${k}\\,`);

function grid(nu: number, nv: number, at: (u: number, v: number) => V3): { nu: number; nv: number; pts: V3[] } {
  const pts: V3[] = [];
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) pts.push(at(i / (nu - 1), j / (nv - 1)));
  return { nu, nv, pts };
}

/** The famous mathematical rose: petals from a spiral whose opening angle closes as it turns. */
const rose: Surface = {
  id: 'rose',
  name: 'ROSE',
  idea: 'A rose from one formula: a spiral that turns round and round while each turn opens less (phi shrinks), and a mod makes the petals.',
  params: [
    { key: 'petals', label: 'PETALS', min: 1, max: 6, step: 0.1, value: 3.6 },
    { key: 'turns', label: 'TURNS', min: 4, max: 30, step: 1, value: 20 },
    { key: 'open', label: 'OPEN', min: 2, max: 16, step: 0.5, value: 8 },
  ],
  tex: (p) => String.raw`\begin{gathered} \varphi = \frac{\pi}{2}\, e^{-t / (${p.open}\pi)} \\ X = 1 - \frac{1}{2}\left(\frac{5}{4}\left(1 - \frac{(${p.petals}\, t) \bmod 2\pi}{\pi}\right)^2 - \frac{1}{4}\right)^2 \\ r = X \left(x \sin \varphi + y \cos \varphi\right) \\ z = X \left(x \cos \varphi - y \sin \varphi\right) \end{gathered}`,
  code: (p) => [
    'for x in linspace(0, 1, 18):              # across a petal',
    `  for t in linspace(-pi/4, ${p.turns}*pi, 260):  # round and round`,
    `    phi = pi/2 * exp(-t / (${p.open}*pi))`,
    `    X = 1 - 0.5*((5/4)*(1 - ((${p.petals}*t) % (2*pi))/pi)**2 - 1/4)**2`,
    '    y = 1.95653 * x**2 * (1.27689*x - 1)**2 * sin(phi)',
    '    r = X * (x*sin(phi) + y*cos(phi))',
    '    z = X * (x*cos(phi) - y*sin(phi))',
    '    point(r*sin(t), r*cos(t), z)',
    'surface(points)                  # neighbours joined into quads',
  ],
  plotLine: 8,
  mesh: (p) =>
    grid(18, 260, (u, v) => {
      const t = -Math.PI / 4 + v * (p.turns * Math.PI + Math.PI / 4);
      const phi = (Math.PI / 2) * Math.exp(-t / (p.open * Math.PI));
      const m = (((p.petals * t) % TAU) + TAU) % TAU;
      const X = 1 - 0.5 * ((5 / 4) * (1 - m / Math.PI) ** 2 - 1 / 4) ** 2;
      const y = 1.95653 * u * u * (1.27689 * u - 1) ** 2 * Math.sin(phi);
      const r = X * (u * Math.sin(phi) + y * Math.cos(phi));
      const z = X * (u * Math.cos(phi) - y * Math.sin(phi));
      return [r * Math.sin(t), r * Math.cos(t), z];
    }),
  colour: (u) => [1, 0.18 + 0.25 * u * u, 0.32 + 0.1 * u],
  axes: true,
};

const ripple: Surface = {
  id: 'ripple',
  name: 'RIPPLE',
  idea: 'z = sin(r)/r, where r is the distance from the middle: a drop falling in a pond. At r = 0 it is 1, the limit, not 0/0.',
  params: [
    { key: 'freq', label: 'FREQUENCY', min: 0.3, max: 3, step: 0.1, value: 1 },
    { key: 'amp', label: 'HEIGHT', min: 1, max: 8, step: 0.5, value: 4 },
  ],
  tex: (p) => String.raw`z = ${coef(p.amp)} \frac{\sin\left(${coef(p.freq)} r\right)}{${coef(p.freq)} r}, \quad r = \sqrt{x^2 + y^2}`,
  code: (p) => [
    'for x in linspace(-10, 10, 49):     # 49: one point is the middle',
    '  for y in linspace(-10, 10, 49):',
    '    r = sqrt(x*x + y*y)          # distance from the middle',
    `    z = ${p.amp} * sin(${p.freq}*r) / (${p.freq}*r)   # 1 when r is 0`,
    '    point(x, y, z)',
    'surface(points)',
  ],
  plotLine: 5,
  mesh: (p) =>
    grid(49, 49, (u, v) => {
      const x = -10 + 20 * u;
      const y = -10 + 20 * v;
      const k = p.freq * Math.hypot(x, y);
      return [x, y, p.amp * (k < 1e-6 ? 1 : Math.sin(k) / k)];
    }),
  colour: (_u, _v, h) => heightColour(h),
  axes: true,
};

const saddle: Surface = {
  id: 'saddle',
  name: 'SADDLE',
  idea: 'z = k(x^2 - y^2): curving up one way and down the other. The middle is a saddle point - flat, but neither a top nor a bottom.',
  params: [{ key: 'k', label: 'CURVE', min: -2, max: 2, step: 0.1, value: 1 }],
  tex: (p) => String.raw`z = ${coef(p.k)} \left(x^2 - y^2\right)`,
  code: (p) => [
    'for x in linspace(-1, 1, 36):',
    '  for y in linspace(-1, 1, 36):',
    `    z = ${p.k} * (x*x - y*y)`,
    '    point(x, y, z)',
    'surface(points)',
  ],
  plotLine: 4,
  mesh: (p) =>
    grid(36, 36, (u, v) => {
      const x = -1 + 2 * u;
      const y = -1 + 2 * v;
      return [x, y, p.k * (x * x - y * y)];
    }),
  colour: (_u, _v, h) => heightColour(h),
  axes: true,
};

const waves: Surface = {
  id: 'waves',
  name: 'WAVES',
  idea: 'z = sin(a x) cos(b y): two waves multiplied make an egg box. Change a and b and count the bumps.',
  params: [
    { key: 'a', label: 'A (ALONG X)', min: 0.5, max: 4, step: 0.5, value: 1.5 },
    { key: 'b', label: 'B (ALONG Y)', min: 0.5, max: 4, step: 0.5, value: 1 },
  ],
  tex: (p) => String.raw`z = \sin\left(${coef(p.a)} x\right) \cos\left(${coef(p.b)} y\right)`,
  code: (p) => [
    'for x in linspace(-pi, pi, 40):',
    '  for y in linspace(-pi, pi, 40):',
    `    z = sin(${p.a}*x) * cos(${p.b}*y)`,
    '    point(x, y, z)',
    'surface(points)',
  ],
  plotLine: 4,
  mesh: (p) =>
    grid(40, 40, (u, v) => {
      const x = -Math.PI + TAU * u;
      const y = -Math.PI + TAU * v;
      return [x, y, Math.sin(p.a * x) * Math.cos(p.b * y)];
    }),
  colour: (_u, _v, h) => heightColour(h),
  axes: true,
};

export const SURFACES: Surface[] = [rose, ripple, saddle, waves];

/** How long the rows take to appear, seconds. */
const BUILD = 3;

/** One surface on screen: built row by row, turning; `turn` adds a drag. */
export class SurfaceRun {
  private t0 = performance.now();
  private nu: number;
  private nv: number;
  private pts: V3[];
  private yaw = 0.6;
  private pitch = 0.5;
  private done = false;

  constructor(
    private s: Surface,
    p: Record<string, number>,
  ) {
    const m = s.mesh(p);
    this.nu = m.nu;
    this.nv = m.nv;
    // into a unit box round the middle; z keeps its own scale against x and y
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, y, z] of m.pts) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
    const span = Math.max(x1 - x0, y1 - y0, 1e-9);
    const zs = Math.max(z1 - z0, 1e-9);
    // a graph keeps its axes at the origin; z is scaled to about half the width so flat and tall both read
    const zk = Math.min(1 / span, 0.6 / zs);
    this.pts = m.pts.map(([x, y, z]) => [(x - (x0 + x1) / 2) / span, (y - (y0 + y1) / 2) / span, (z - (z0 + z1) / 2) * zk]);
    this.origin = [(0 - (x0 + x1) / 2) / span, (0 - (y0 + y1) / 2) / span, (0 - (z0 + z1) / 2) * zk];
    this.zMin = (z0 - (z0 + z1) / 2) * zk;
    this.zMax = (z1 - (z0 + z1) / 2) * zk;
  }
  private origin: V3;
  private zMin: number;
  private zMax: number;

  finish(): void {
    this.done = true;
  }

  turn(dyaw: number, dpitch: number): void {
    // all the way round, both ways: over the top and from underneath
    this.yaw += dyaw;
    this.pitch += dpitch;
  }

  draw(g: CanvasRenderingContext2D, w: number, h: number, aw: number): number {
    const t = (performance.now() - this.t0) / 1000;
    const built = this.done ? 1 : Math.min(1, t / BUILD);
    this.yaw += 0.004; // a slow turn
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#05050d';
    g.fillRect(0, 0, w, h);
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const S = Math.min(aw, h) * 0.62;
    const D = 3.2;
    const cam = (p: V3): [number, number, number] => {
      const x = p[0] * cy - p[1] * sy;
      const yd = p[0] * sy + p[1] * cy;
      const z = p[2] * cp - yd * sp;
      const depth = yd * cp + p[2] * sp;
      const k = D / (D + depth);
      return [aw / 2 + x * S * k, h * 0.54 - z * S * k, depth];
    };
    const P = this.pts.map(cam);
    const { nu, nv } = this;
    const rows = Math.ceil((nv - 1) * built);
    type Q = { d: number; i: number; j: number };
    const quads: Q[] = [];
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < nu - 1; i++) {
        const a = j * nu + i;
        quads.push({ d: (P[a][2] + P[a + 1][2] + P[a + nu][2] + P[a + nu + 1][2]) / 4, i, j });
      }
    quads.sort((p, q) => q.d - p.d);
    const L: V3 = [0.35, -0.45, 0.82];
    const zr = this.zMax - this.zMin || 1;
    g.lineWidth = Math.max(0.6, S / 700);
    for (const { i, j } of quads) {
      const a = j * nu + i;
      const A = this.pts[a], B = this.pts[a + 1], C = this.pts[a + nu + 1], E = this.pts[a + nu];
      // a normal from the diagonals; two-sided, so its sign does not matter
      const d1 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
      const d2 = [E[0] - B[0], E[1] - B[1], E[2] - B[2]];
      const n = [d1[1] * d2[2] - d1[2] * d2[1], d1[2] * d2[0] - d1[0] * d2[2], d1[0] * d2[1] - d1[1] * d2[0]];
      const nl = Math.hypot(n[0], n[1], n[2]) || 1;
      const lit = 0.35 + 0.65 * Math.abs((n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / nl);
      // how high the quad is, 0 bottom to 1 top, for the colour map
      const hgt = ((A[2] + C[2]) / 2 - this.zMin) / zr;
      const c = this.s.colour(i / (nu - 2), j / (nv - 2), hgt);
      const col = `rgb(${(c[0] * lit * 255) | 0},${(c[1] * lit * 255) | 0},${(c[2] * lit * 255) | 0})`;
      g.beginPath();
      g.moveTo(P[a][0], P[a][1]);
      g.lineTo(P[a + 1][0], P[a + 1][1]);
      g.lineTo(P[a + nu + 1][0], P[a + nu + 1][1]);
      g.lineTo(P[a + nu][0], P[a + nu][1]);
      g.closePath();
      g.fillStyle = col;
      g.fill();
      // the mesh: lighter lines, as in a plotting program
      g.strokeStyle = `rgba(255,235,220,${0.18 + 0.2 * lit})`;
      g.stroke();
    }
    if (this.s.axes) this.drawAxes(g, cam, S);
    return built < 1 ? this.s.plotLine : -1;
  }

  private drawAxes(g: CanvasRenderingContext2D, cam: (p: V3) => [number, number, number], S: number): void {
    const o = this.origin;
    const axes: [V3, string, string][] = [
      [[0.75, 0, 0], 'x', '#ff8a80'],
      [[0, 0.75, 0], 'y', '#9fe8a0'],
      [[0, 0, 0.6], 'z', '#9fd0ff'],
    ];
    g.font = `${Math.round(S / 18)}px 'IBM Plex Mono', monospace`;
    g.lineWidth = Math.max(1, S / 300);
    for (const [d, label, col] of axes) {
      const a = cam(o);
      const b = cam([o[0] + d[0], o[1] + d[1], o[2] + d[2]]);
      g.strokeStyle = col;
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(a[0], a[1]);
      g.lineTo(b[0], b[1]);
      g.stroke();
      g.fillText(label, b[0] + 4, b[1] - 4);
    }
  }
}
