import { rng } from '../garden/flowers';
import { compile } from './expr';

/**
 * MATH LAB's drawings: classic turtle-graphics maths - a parametric heart,
 * a spiral of circles, a sphere of turning ellipses, a recursive tree - as
 * plain data. Each drawing turns its parameters into strokes, and each
 * stroke remembers which line of the drawing's code made it, so the code
 * panel can light that line while it is drawn.
 *
 * Pure and seeded: the same parameters always give the same strokes.
 * Coordinates are a turtle's: (0, 0) in the middle, +y up, about +-350.
 */

export interface Param {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
}

export interface Stroke {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  col: string;
  w: number;
  /** the line of `code` that drew it */
  line: number;
}

export interface Drawing {
  id: string;
  name: string;
  /** what it teaches, one line */
  idea: string;
  params: Param[];
  /** a formula the player types (YOUR CURVE): its label, starting text and ideas to try */
  formula?: { label: string; value: string; examples: string[] };
  /** the program, Python-turtle style, with the current values (and formula) written in */
  code(p: Record<string, number>, formula?: string): string[];
  /** throws, with a message for the player, if the formula cannot be read */
  strokes(p: Record<string, number>, formula?: string): Stroke[];
}

const TAU = Math.PI * 2;
const hsl = (h: number, s: number, l: number) => `hsl(${h.toFixed(0)} ${s.toFixed(0)}% ${l.toFixed(0)}%)`;

/** A circle as a ring of short strokes. */
function circle(out: Stroke[], cx: number, cy: number, r: number, col: string, w: number, line: number): void {
  const n = Math.max(8, Math.min(48, Math.round(r * 1.2)));
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU;
    const b = ((k + 1) / n) * TAU;
    out.push({ x1: cx + r * Math.cos(a), y1: cy + r * Math.sin(a), x2: cx + r * Math.cos(b), y2: cy + r * Math.sin(b), col, w, line });
  }
}

/** The heart curve: x = 16 sin^3 t, y = 13 cos t - 5 cos 2t - 2 cos 3t - cos 4t. */
function heartAt(a: number, s: number): [number, number] {
  const x = 16 * Math.sin(a) ** 3 * s;
  const y = (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) * s;
  return [x, y];
}

const heart: Drawing = {
  id: 'heart',
  name: 'HEART',
  idea: 'A parametric curve: one angle t gives both x and y. Thousands of short strokes, each pointing away from the centre, fill it in.',
  params: [
    { key: 'n', label: 'STROKES', min: 500, max: 8000, step: 500, value: 4000 },
    { key: 'spread', label: 'SPREAD', min: 0, max: 1, step: 0.05, value: 0.5 },
    { key: 'len', label: 'LENGTH', min: 4, max: 30, step: 1, value: 14 },
  ],
  code: (p) => [
    'def heart(t, s):',
    '    x = 16 * sin(t)**3 * s',
    '    y = (13*cos(t) - 5*cos(2*t) - 2*cos(3*t) - cos(4*t)) * s',
    '    return x, y',
    '',
    `for i in range(${p.n}):`,
    '    t = random(0, 2*pi)',
    '    s = random(0.5, 15.5)       # how far out',
    '    x, y = heart(t, s)',
    `    angle = atan2(y, x) + random(-${p.spread}, ${p.spread})`,
    `    length = random(4, ${p.len})`,
    '    pencolor(pink)',
    '    line(x, y, angle, length)',
  ],
  strokes(p) {
    const r = rng(7);
    const out: Stroke[] = [];
    for (let i = 0; i < p.n; i++) {
      const t = r() * TAU;
      // the last fifth are bright strokes on the outline itself
      const edge = i > p.n * 0.8;
      const s = edge ? 16 : 0.5 + r() * 15;
      const [x, y] = heartAt(t, s);
      const ang = Math.atan2(y, x) + (r() * 2 - 1) * p.spread;
      const len = 4 + r() * (p.len - 4);
      out.push({
        x1: x,
        y1: y,
        x2: x + Math.cos(ang) * len,
        y2: y + Math.sin(ang) * len,
        col: hsl(330 + r() * 20, 90, edge ? 82 : 55 + r() * 20),
        w: 0.5 + r() * 0.8,
        line: 12,
      });
    }
    return out;
  },
};

/** Mix two [r, g, b] colours (0-1) by k, as a CSS colour. */
function mixRgb(a: number[], b: number[], k: number): string {
  const c = a.map((v, i) => Math.round((v + (b[i] - v) * k) * 255));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

const butterfly: Drawing = {
  id: 'butterfly',
  name: 'BUTTERFLY',
  idea: "Temple Fay's butterfly curve, in polar form: r = e^cos(t) - 2cos(4t) + sin(t/12)^5. Drawn from the middle out, the colour follows the size.",
  params: [
    { key: 'n', label: 'STROKES', min: 500, max: 9000, step: 500, value: 5500 },
    { key: 'turns', label: 'TURNS', min: 1, max: 12, step: 1, value: 1 },
    { key: 'len', label: 'LENGTH', min: 2, max: 20, step: 1, value: 8 },
  ],
  code: (p) => [
    'def butterfly(t, s):',
    '    r = (exp(cos(t)) - 2*cos(4*t) + sin(t/12)**5) * s',
    '    return r*sin(t), r*cos(t)',
    '',
    `points = [(random(0, ${p.turns} * 2*pi), random(3, 92))`,
    `          for i in range(${p.n})]`,
    'for t, s in sorted(points, key=size):   # small first',
    '    x, y = butterfly(t, s)',
    '    angle = atan2(y, x) + random(-0.18, 0.18)',
    `    length = random(3, ${p.len})`,
    '    pencolor(cyan -> blue -> magenta -> purple by s)',
    '    line(x, y, angle, length)',
  ],
  strokes(p) {
    const r = rng(12);
    const pts: [number, number][] = [];
    for (let i = 0; i < p.n; i++) pts.push([r() * TAU * p.turns, 3 + r() * 89]);
    pts.sort((a, b) => a[1] - b[1]);
    const CYAN = [0.32, 0.95, 1];
    const BLUE = [0.22, 0.42, 1];
    const MAGENTA = [0.88, 0.2, 1];
    const PURPLE = [0.24, 0.025, 0.42];
    return pts.map(([t, s]) => {
      const rr = (Math.exp(Math.cos(t)) - 2 * Math.cos(4 * t) + Math.sin(t / 12) ** 5) * s;
      const x = rr * Math.sin(t);
      const y = rr * Math.cos(t);
      const ang = Math.atan2(y, x) + (r() * 2 - 1) * 0.18;
      const len = 3 + r() * Math.max(0, p.len - 3);
      let col: string;
      if (s < 41) col = mixRgb(CYAN, BLUE, s / 41);
      else if (s < 74) col = mixRgb(BLUE, MAGENTA, (s - 41) / 33);
      else {
        const k = (s - 74) / 18;
        col = mixRgb(MAGENTA, PURPLE, k * k * (3 - 2 * k));
      }
      return { x1: x, y1: y, x2: x + Math.cos(ang) * len, y2: y + Math.sin(ang) * len, col, w: 0.7 + r() * 0.6, line: 11 };
    });
  },
};

const rosette: Drawing = {
  id: 'rosette',
  name: 'ROSETTE',
  idea: 'Polar coordinates: each arm is a spiral, x = r cos(angle), y = r sin(angle). The circles shrink as r grows.',
  params: [
    { key: 'arms', label: 'ARMS', min: 3, max: 24, step: 1, value: 11 },
    { key: 'steps', label: 'STEPS', min: 20, max: 150, step: 5, value: 75 },
    { key: 'twist', label: 'TWIST', min: 0, max: 4, step: 0.1, value: 1.8 },
  ],
  code: (p) => [
    `arms, steps = ${p.arms}, ${p.steps}`,
    'for j in range(steps):',
    '    t = j / steps',
    '    r = 30 + 225 * t**0.9          # spiral out',
    '    radius = 22 * (1 - t)**0.85 + 1.8',
    '    for i in range(arms):',
    '        a0 = 2*pi * i / arms',
    `        angle = a0 + ${p.twist} * t**1.2 - 0.4*sin(pi*t)`,
    '        x, y = r*cos(angle), r*sin(angle)',
    '        circle(x, y, radius)',
  ],
  strokes(p) {
    const out: Stroke[] = [];
    for (let j = 0; j < p.steps; j++) {
      const t = j / p.steps;
      const rr = 30 + 225 * t ** 0.9;
      const cr = 22 * (1 - t) ** 0.85 + 1.8;
      for (let i = 0; i < p.arms; i++) {
        const a = (TAU * i) / p.arms + p.twist * t ** 1.2 - 0.4 * Math.sin(Math.PI * t);
        circle(out, rr * Math.cos(a), rr * Math.sin(a), cr, hsl(200 + t * 120, 30, 88 - t * 20), 0.7, 9);
      }
    }
    return out;
  },
};

const sphere: Drawing = {
  id: 'sphere',
  name: 'SPHERE',
  idea: 'A circle seen at an angle is an ellipse. Turn a ring around the axis and its width is R * cos(angle): enough rings make a globe.',
  params: [
    { key: 'rings', label: 'RINGS', min: 2, max: 36, step: 1, value: 12 },
    { key: 'lat', label: 'LATITUDES', min: 0, max: 12, step: 1, value: 5 },
    { key: 'tilt', label: 'TILT', min: 0, max: 80, step: 5, value: 20 },
  ],
  code: (p) => [
    'R = 180',
    'circle(0, 0, R)                  # the outline',
    `for k in range(${p.rings}):           # meridians`,
    `    turn = pi * k / ${p.rings}`,
    '    ellipse(0, 0, R*cos(turn), R)',
    `for k in range(1, ${p.lat} + 1):      # latitudes`,
    `    h = R * k / (${p.lat} + 1)`,
    `    ellipse(0, h, sqrt(R*R - h*h), ${p.tilt} deg)`,
    '    ellipse(0, -h, ...)          # and below',
  ],
  strokes(p) {
    const out: Stroke[] = [];
    const R = 180;
    const tilt = (p.tilt * Math.PI) / 180;
    // the globe is tilted toward us: y squashed by cos(tilt), latitudes become ellipses
    const ell = (cx: number, cy: number, rx: number, ry: number, col: string, line: number) => {
      const n = 72;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU;
        const b = ((k + 1) / n) * TAU;
        out.push({ x1: cx + rx * Math.cos(a), y1: cy + ry * Math.sin(a), x2: cx + rx * Math.cos(b), y2: cy + ry * Math.sin(b), col, w: 1.2, line });
      }
    };
    ell(0, 0, R, R, '#e9d5ff', 1);
    for (let k = 0; k < p.rings; k++) {
      const turn = (Math.PI * k) / p.rings;
      ell(0, 0, R * Math.cos(turn), R, k % 2 ? '#a855f7' : '#c084fc', 4);
    }
    for (let k = 1; k <= p.lat; k++) {
      const h = (R * k) / (p.lat + 1);
      const w = Math.sqrt(R * R - h * h);
      for (const s of [1, -1]) ell(0, s * h * Math.cos(tilt), w, w * Math.sin(tilt), '#7c3aed', s > 0 ? 7 : 8);
    }
    return out;
  },
};

const tree: Drawing = {
  id: 'tree',
  name: 'TREE',
  idea: 'Recursion: a branch is a line with two smaller branches on its end. The function calls itself until the branches are tiny.',
  params: [
    { key: 'len', label: 'TRUNK', min: 40, max: 130, step: 5, value: 95 },
    { key: 'angle', label: 'ANGLE', min: 5, max: 50, step: 1, value: 20 },
    { key: 'ratio', label: 'RATIO', min: 0.55, max: 0.85, step: 0.01, value: 0.8 },
    { key: 'min', label: 'SMALLEST', min: 4, max: 30, step: 1, value: 10 },
  ],
  code: (p) => [
    'def tree(length):',
    `    if length < ${p.min}:`,
    '        return',
    '    forward(length)',
    '    circle(2)                    # a blossom',
    `    left(${p.angle})`,
    `    tree(length * ${p.ratio})`,
    `    right(${2 * p.angle})`,
    `    tree(length * ${p.ratio})`,
    `    left(${p.angle})`,
    '    backward(length)',
    '',
    `tree(${p.len})`,
  ],
  strokes(p) {
    const out: Stroke[] = [];
    const turn = (p.angle * Math.PI) / 180;
    // ponytail: depth capped at 14 (16k branches) so a tiny SMALLEST cannot hang the page
    const grow = (x: number, y: number, dir: number, len: number, depth: number) => {
      if (len < p.min || depth > 14) return;
      const x2 = x + Math.cos(dir) * len;
      const y2 = y + Math.sin(dir) * len;
      out.push({ x1: x, y1: y, x2, y2, col: hsl(10, 55, 28 + Math.min(depth * 3, 25)), w: Math.max(0.8, len / 14), line: 3 });
      circle(out, x2, y2, 2, '#ffc0d8', 1, 4);
      grow(x2, y2, dir + turn, len * p.ratio, depth + 1);
      grow(x2, y2, dir - turn, len * p.ratio, depth + 1);
    };
    grow(0, -300, Math.PI / 2, p.len, 0);
    return out;
  },
};

/** Phyllotaxis: how a sunflower packs its seeds. Each one turns the golden angle further. */
const sunflower: Drawing = {
  id: 'sunflower',
  name: 'SUNFLOWER',
  idea: 'Each seed turns 137.5 degrees (the golden angle) past the last and sits at r = c * sqrt(n). Nudge the angle to 137 or 140 and the seeds fall into spokes with gaps.',
  params: [
    { key: 'n', label: 'SEEDS', min: 50, max: 2000, step: 50, value: 900 },
    { key: 'angle', label: 'ANGLE', min: 130, max: 145, step: 0.1, value: 137.5 },
    { key: 'size', label: 'SEED SIZE', min: 1, max: 6, step: 0.5, value: 2.5 },
  ],
  code: (p) => [
    `golden = ${p.angle}          # degrees; 137.5 is the golden angle`,
    `for n in range(${p.n}):`,
    '    angle = radians(n * golden)',
    '    r = 6 * sqrt(n)             # equal area for every seed',
    '    x, y = r*cos(angle), r*sin(angle)',
    `    circle(x, y, ${p.size})        # petals round the edge`,
  ],
  strokes(p) {
    const out: Stroke[] = [];
    for (let n = 0; n < p.n; n++) {
      const a = (n * p.angle * Math.PI) / 180;
      const r = 6 * Math.sqrt(n);
      const k = n / p.n;
      // dark seeds in the middle, orange, then a rim of golden petals
      const col = k > 0.86 ? hsl(46, 95, 58) : k > 0.6 ? hsl(28, 80, 40 + 10 * k) : hsl(25, 55, 18 + 18 * k);
      circle(out, r * Math.cos(a), r * Math.sin(a), k > 0.86 ? p.size * 1.6 : p.size, col, 1.2, 5);
    }
    return out;
  },
};

/** The Maurer rose: the rose curve r = sin(n theta), walked in jumps of d degrees. */
const maurer: Drawing = {
  id: 'maurer',
  name: 'MAURER ROSE',
  idea: 'Walk round the rose curve r = sin(n theta) in jumps of d degrees and join the dots with straight lines. Two whole numbers, hundreds of flowers: try n 6, d 71.',
  params: [
    { key: 'n', label: 'PETALS N', min: 1, max: 12, step: 1, value: 6 },
    { key: 'd', label: 'JUMP D', min: 1, max: 179, step: 1, value: 71 },
  ],
  code: (p) => [
    'for k in range(361):',
    `    theta = radians(k * ${p.d})       # jump d degrees`,
    `    r = sin(${p.n} * theta)`,
    '    line_to(r*cos(theta), r*sin(theta))',
    '',
    'for k in range(361):              # the rose itself, on top',
    `    theta = radians(k); r = sin(${p.n} * theta)`,
    '    line_to(r*cos(theta), r*sin(theta))',
  ],
  strokes(p) {
    const out: Stroke[] = [];
    const walk = (step: number, col: (k: number) => string, w: number, line: number) => {
      let px = 0, py = 0;
      for (let k = 0; k <= 360; k++) {
        const th = (k * step * Math.PI) / 180;
        const r = 250 * Math.sin(p.n * th);
        const x = r * Math.cos(th), y = r * Math.sin(th);
        if (k > 0) out.push({ x1: px, y1: py, x2: x, y2: y, col: col(k), w, line });
        px = x;
        py = y;
      }
    };
    walk(p.d, (k) => hsl(190 + (k / 360) * 80, 80, 62), 0.7, 3);
    walk(1, () => '#ff4a6a', 1.6, 7);
    return out;
  },
};

/** The toy: a pen in a wheel rolling inside a ring (a hypotrochoid). */
const spiro: Drawing = {
  id: 'spiro',
  name: 'SPIROGRAPH',
  idea: 'A wheel of radius r rolls inside a ring of radius R; a pen d from its centre draws. The pattern closes after r / gcd(R, r) turns round the ring.',
  params: [
    { key: 'R', label: 'RING R', min: 40, max: 120, step: 1, value: 105 },
    { key: 'r', label: 'WHEEL R', min: 5, max: 100, step: 1, value: 33 },
    { key: 'd', label: 'PEN D', min: 5, max: 120, step: 1, value: 60 },
  ],
  code: (p) => [
    `R, r, d = ${p.R}, ${p.r}, ${p.d}     # ring, wheel, pen`,
    'turns = r / gcd(R, r)            # when it closes',
    'for i in range(turns * 360):',
    '    t = radians(i)',
    '    x = (R - r)*cos(t) + d*cos((R - r)/r * t)',
    '    y = (R - r)*sin(t) - d*sin((R - r)/r * t)',
    '    line_to(x, y)',
  ],
  strokes(p) {
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
    const turns = Math.min(40, p.r / gcd(Math.round(p.R), Math.round(p.r)));
    const n = Math.round(turns * 360);
    const out: Stroke[] = [];
    let px = 0, py = 0;
    for (let i = 0; i <= n; i++) {
      const t = (i * Math.PI) / 180;
      const k = (p.R - p.r) / p.r;
      const x = (p.R - p.r) * Math.cos(t) + p.d * Math.cos(k * t);
      const y = (p.R - p.r) * Math.sin(t) - p.d * Math.sin(k * t);
      if (i > 0) out.push({ x1: px, y1: py, x2: x, y2: y, col: hsl((i / n) * 300 + 180, 85, 65), w: 1, line: 6 });
      px = x;
      py = y;
    }
    return out;
  },
};

/** The player's own polar curve, r = f(t). */
const yours: Drawing = {
  id: 'yours',
  name: 'YOUR CURVE',
  idea: 'Type r as a formula of t and it is drawn: r(t) is how far from the middle at angle t. Try the ideas below, then change a number and see what it does.',
  params: [{ key: 'turns', label: 'TURNS', min: 1, max: 24, step: 1, value: 2 }],
  formula: {
    label: 'r(t) =',
    value: '1 + 2cos(5t)',
    examples: ['cos(4t)', '1 + 2cos(5t)', 'sin(t)^2 + 0.6sin(9t)', 'exp(sin t) - 2cos(4t)', 't / 6', '1 - sin(t)', 'cos(7t / 4)'],
  },
  code: (p, f = '') => [
    'def r(t):',
    `    return ${f}`,
    '',
    `for i in range(${p.turns} * 720):`,
    '    t = radians(i / 2)',
    '    x, y = r(t)*cos(t), r(t)*sin(t)',
    '    line_to(x, y)',
  ],
  strokes(p, f = '') {
    const r = compile(f, ['t']);
    const n = p.turns * 720;
    const out: Stroke[] = [];
    let prev: [number, number] | null = null;
    for (let i = 0; i <= n; i++) {
      const t = (i / 2) * (Math.PI / 180);
      const rt = r({ t });
      const pt: [number, number] | null = Number.isFinite(rt) && Math.abs(rt) < 1e6 ? [rt * Math.cos(t), rt * Math.sin(t)] : null;
      if (prev && pt) out.push({ x1: prev[0], y1: prev[1], x2: pt[0], y2: pt[1], col: hsl(330 + (i / n) * 200, 85, 64), w: 1.2, line: 6 });
      prev = pt;
    }
    return out;
  },
};

export const DRAWINGS: Drawing[] = [heart, butterfly, rosette, sphere, tree];
/** maths that makes flowers */
export const MATH_FLOWERS: Drawing[] = [sunflower, maurer, spiro];
/** the player's own */
export const YOURS: Drawing = yours;

/** A drawing's (or a 3D graph's) parameters at their starting values. */
export function defaults(d: { params: Param[] }): Record<string, number> {
  return Object.fromEntries(d.params.map((q) => [q.key, q.value]));
}
