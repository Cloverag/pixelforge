import { rng } from './flowers';

/**
 * BLOOM: one flower's whole life in dots. It sprouts from the soil, its stem
 * curves up, two leaves unfurl, three rings of petals open in 3D, a glow and
 * a ring of sparks gather round it - then it wilts: the petals fade to dusk
 * colours, the head bows, petals drop away - and it starts again.
 *
 * Pointillism: every part is a cloud of dots made once (seeded), each with
 * its place on the part (along, across) and its colour from fresh to wilted.
 * Each frame the life-cycle state puts the dots where the part is now.
 */

const CYCLE = 18;
const LEVELS = 8; // colour steps from fresh to wilted

const ss = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/** Where the life cycle is at time t (seconds): each 0..1. */
export function bloomState(t: number): { stem: number; leaf: number; bloom: number; glow: number; wilt: number; fade: number } {
  const c = ((t % CYCLE) + CYCLE) % CYCLE;
  const wilt = ss(12, 15.5, c);
  return {
    stem: ss(0.3, 4, c),
    leaf: ss(2.2, 5.2, c),
    bloom: ss(4.5, 8.5, c),
    glow: ss(6, 9, c) * (1 - wilt),
    wilt,
    fade: ss(16.6, 18, c),
  };
}

type RGB = [number, number, number];

/** One part's dots: where on the part (a along, b across), size, colours by wilt level. */
interface Dots {
  a: Float32Array;
  b: Float32Array;
  r: Float32Array;
  col: string[][];
}

interface Petal {
  dots: Dots;
  layer: number;
  phi: number;
}

export interface BloomScene {
  soil: Dots;
  stem: Dots;
  leaves: Dots[];
  petals: Petal[];
  stamens: Dots;
  falling: { phi: number; at: number; drift: number; col: string }[];
}

const mix = (p: RGB, q: RGB, k: number): RGB => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k];
const css = (c: RGB) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;

function dots(n: number, rand: () => number, place: (i: number) => [number, number, number], live: (a: number, b: number) => RGB, wilted: (a: number, b: number) => RGB): Dots {
  const d: Dots = { a: new Float32Array(n), b: new Float32Array(n), r: new Float32Array(n), col: [] };
  for (let i = 0; i < n; i++) {
    const [a, b, r] = place(i);
    d.a[i] = a;
    d.b[i] = b;
    d.r[i] = r;
    const jit = 0.85 + rand() * 0.3;
    const L = live(a, b).map((v) => v * jit) as RGB;
    const W = wilted(a, b);
    d.col.push(Array.from({ length: LEVELS }, (_, k) => css(mix(L, W, k / (LEVELS - 1)))));
  }
  return d;
}

const SOIL: RGB[] = [[34, 25, 20], [50, 36, 28], [68, 50, 37], [88, 65, 47], [108, 82, 60]];
const PETAL_IN: RGB = [120, 30, 150];
const PETAL_MID: RGB = [190, 90, 235];
const PETAL_RIM: RGB = [240, 205, 255];
const DUSK: RGB = [120, 76, 92];

export function buildBloom(seed: number): BloomScene {
  const rand = rng(seed);
  const pick = (pal: RGB[]) => pal[Math.floor(rand() * pal.length)];
  const soil = dots(
    1600,
    rand,
    () => {
      const a = (rand() + rand() + rand()) / 1.5 - 1; // -1..1, bunched in the middle
      return [a, rand(), 1 + rand() * 1.6];
    },
    () => pick(SOIL),
    () => pick(SOIL),
  );
  const stem = dots(
    900,
    rand,
    () => [rand(), rand() * 2 - 1, 0.8 + rand() * 0.8],
    (a) => mix([40, 120, 100], [110, 70, 190], a),
    () => [110, 82, 60],
  );
  const leaves = [0, 1].map(() =>
    dots(
      650,
      rand,
      () => [Math.sqrt(rand()), rand() * 2 - 1, 0.8 + rand() * 0.9],
      (a, b) => (Math.abs(b) < 0.08 ? [200, 235, 225] : mix([50, 140, 125], [140, 95, 205], a)),
      () => [128, 98, 70],
    ),
  );
  const petals: Petal[] = [];
  const LAYERS = [5, 6, 7];
  LAYERS.forEach((n, layer) => {
    for (let k = 0; k < n; k++) {
      const phi = (k / n) * Math.PI * 2 + layer * 0.45 + rand() * 0.1;
      petals.push({
        layer,
        phi,
        dots: dots(
          520 - layer * 80,
          rand,
          () => [Math.pow(rand(), 0.8), rand() * 2 - 1, 0.9 + rand() * 1.1],
          (a, b) => {
            const base = a < 0.35 ? mix(PETAL_IN, PETAL_MID, a / 0.35) : mix(PETAL_MID, PETAL_RIM, (a - 0.35) / 0.65);
            return Math.abs(b) > 0.8 ? mix(base, PETAL_RIM, 0.5) : base;
          },
          () => mix(DUSK, [100, 70, 52], rand()),
        ),
      });
    }
  });
  const stamens = dots(
    260,
    rand,
    () => [rand(), Math.floor(rand() * 9), 0.9 + rand() * 0.8],
    (a) => (a > 0.85 ? [255, 214, 110] : [255, 230, 245]),
    () => [140, 112, 84],
  );
  const falling = Array.from({ length: 26 }, () => ({ phi: rand() * Math.PI * 2, at: rand(), drift: rand() * 2 - 1, col: css(mix(PETAL_MID, DUSK, 0.3 + rand() * 0.5)) }));
  return { soil, stem, leaves, petals, stamens, falling };
}

function bez(p: number[][], s: number): [number, number] {
  const u = 1 - s;
  const x = u * u * u * p[0][0] + 3 * u * u * s * p[1][0] + 3 * u * s * s * p[2][0] + s * s * s * p[3][0];
  const y = u * u * u * p[0][1] + 3 * u * u * s * p[1][1] + 3 * u * s * s * p[2][1] + s * s * s * p[3][1];
  return [x, y];
}

/** Paint the flower at time t (seconds) on g, w x h. */
export function drawBloom(g: CanvasRenderingContext2D, sc: BloomScene, w: number, h: number, t: number): void {
  const st = bloomState(t);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  g.fillStyle = '#03030b';
  g.fillRect(0, 0, w, h);
  const px = h / 700; // one dot unit
  const cx = w / 2;
  const y0 = h * 0.9;
  const lvl = (x: number) => Math.min(LEVELS - 1, Math.max(0, Math.round(x * (LEVELS - 1))));
  const dot = (d: Dots, i: number, x: number, y: number, wl: number) => {
    const r = d.r[i] * px * 2;
    g.fillStyle = d.col[i][lvl(wl)];
    g.fillRect(x - r / 2, y - r / 2, r, r);
  };
  g.globalAlpha = 1 - st.fade;

  // soil, a little stirred while the shoot breaks through
  const stir = Math.sin(Math.PI * Math.min(1, st.stem * 2)) * 4 * px;
  for (let i = 0; i < sc.soil.a.length; i++) {
    const a = sc.soil.a[i];
    const mound = (1 - a * a) * 0.035 * h;
    dot(sc.soil, i, cx + a * 0.32 * w, y0 - mound * sc.soil.b[i] + sc.soil.b[i] * 0.05 * h - (Math.abs(a) < 0.15 ? stir : 0), 0);
  }

  // the stem: a curve that grows, sways, and bows as the flower wilts
  const L = 0.52 * h * st.stem;
  const sway = 0.012 * h * Math.sin(t * 0.9) * st.stem * (1 - 0.6 * st.wilt);
  const P = [
    [cx, y0],
    [cx - 0.06 * L, y0 - 0.33 * L],
    [cx + 0.05 * L + 0.25 * L * st.wilt + sway * 0.5, y0 - L * (0.74 + 0.2 * st.wilt)],
    [cx + sway + 0.32 * L * st.wilt, y0 - L * (1 - 0.18 * st.wilt)],
  ];
  if (L > 1) {
    for (let i = 0; i < sc.stem.a.length; i++) {
      const s = sc.stem.a[i];
      const [x, y] = bez(P, s);
      const wdt = 0.009 * h * (1 - 0.35 * s);
      dot(sc.stem, i, x + sc.stem.b[i] * wdt, y, st.wilt);
    }
  }

  // leaves unfurl from along the stem out to the sides, and droop when it wilts
  sc.leaves.forEach((lf, k) => {
    if (st.leaf <= 0) return;
    const side = k ? 1 : -1;
    const [bx, by] = bez(P, k ? 0.42 : 0.28);
    const ang = -Math.PI / 2 + side * (0.15 + 0.85 * st.leaf + 0.5 * st.wilt);
    const len = 0.17 * h * st.leaf * (1 - 0.2 * st.wilt);
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    for (let i = 0; i < lf.a.length; i++) {
      const a = lf.a[i];
      const half = 0.3 * len * Math.pow(Math.sin(Math.PI * a), 0.8);
      const curl = 0.12 * len * a * a * side;
      const x = bx + dx * a * len - dy * lf.b[i] * half + curl * -dy;
      const y = by + dy * a * len + dx * lf.b[i] * half + curl * dx + st.wilt * a * a * 0.08 * h;
      dot(lf, i, x, y, st.wilt);
    }
  });

  if (st.stem < 0.6) return;
  const [hx, hy] = bez(P, 1);
  const grow = ss(0.6, 1, st.stem);
  // the glow behind the head
  if (st.glow > 0) {
    const R = 0.36 * h;
    const gr = g.createRadialGradient(hx, hy, 0, hx, hy, R);
    gr.addColorStop(0, `rgba(200,120,255,${0.35 * st.glow})`);
    gr.addColorStop(1, 'rgba(200,120,255,0)');
    g.fillStyle = gr;
    g.fillRect(hx - R, hy - R, R * 2, R * 2);
  }

  // the petals in 3D: an opening angle from the vertical, seen a little from above
  const pitch = 0.45;
  const bow = 0.9 * st.wilt; // the head tips over to the side
  const proj = (x: number, y: number, z: number): [number, number, number] => {
    // tip around the view axis by `bow`, then tilt toward the viewer
    const x1 = x * Math.cos(bow) + y * Math.sin(bow);
    const y1 = -x * Math.sin(bow) + y * Math.cos(bow);
    const ys = y1 * Math.cos(pitch) - z * Math.sin(pitch);
    const zs = y1 * Math.sin(pitch) + z * Math.cos(pitch);
    return [hx + x1, hy - ys, zs];
  };
  const order = sc.petals
    .map((p) => {
      const open = [1.35, 1.0, 0.6][p.layer];
      const tau = 0.12 + open * st.bloom + 0.6 * st.wilt;
      const Lp = 0.19 * h * grow * [1, 0.8, 0.6][p.layer] * (1 - 0.15 * st.wilt);
      const tip = proj(Math.cos(p.phi) * Math.sin(tau) * Lp, Math.cos(tau) * Lp, Math.sin(p.phi) * Math.sin(tau) * Lp);
      return { p, tau, Lp, z: tip[2] };
    })
    .sort((m, n) => n.z - m.z);
  for (const { p, tau, Lp } of order) {
    const d = p.dots;
    const ex = -Math.sin(p.phi);
    const ez = Math.cos(p.phi);
    const shed = st.wilt > 0.5 && p.layer === 0 ? ss(0.5, 1, st.wilt) : 0;
    for (let i = 0; i < d.a.length; i++) {
      const a = d.a[i];
      const half = 0.42 * Lp * Math.sin(Math.PI * Math.pow(a, 0.75)) * (1 - 0.2 * a);
      const cup = -0.12 * Lp * d.b[i] * d.b[i] * Math.sin(Math.PI * a);
      const r = a * Lp;
      const x = Math.cos(p.phi) * Math.sin(tau) * r + ex * d.b[i] * half;
      const y = Math.cos(tau) * r + cup + (st.wilt > 0 ? -st.wilt * a * a * 0.25 * Lp : 0);
      const z = Math.sin(p.phi) * Math.sin(tau) * r + ez * d.b[i] * half;
      const [sx, sy] = proj(x, y, z);
      if (shed > 0 && ((i * 7919) % 100) / 100 < shed * 0.6) continue; // dropping away
      dot(d, i, sx, sy, Math.min(1, st.wilt * (0.9 + 0.5 * a)));
    }
  }

  // stamens: filaments out of the heart, gold tips that pulse
  const pulse = 1 + 0.15 * Math.sin(t * 3);
  for (let i = 0; i < sc.stamens.a.length; i++) {
    const a = sc.stamens.a[i];
    const k = sc.stamens.b[i];
    const ang = (k / 9) * Math.PI * 2;
    const sl = 0.1 * h * st.bloom * grow * (a > 0.85 ? pulse : 1);
    const [sx, sy] = proj(Math.cos(ang) * 0.35 * sl * a, sl * a, Math.sin(ang) * 0.35 * sl * a);
    dot(sc.stamens, i, sx, sy, st.wilt);
  }

  // a ring of sparks circling the bloom
  if (st.glow > 0) {
    g.fillStyle = `rgba(235,215,255,${0.8 * st.glow})`;
    for (let i = 0; i < 90; i++) {
      const a = (i / 90) * Math.PI * 2 + t * 0.4;
      const [sx, sy] = proj(Math.cos(a) * 0.27 * h, 0.012 * h * Math.sin(a * 3 + t), Math.sin(a) * 0.27 * h);
      const r = (1 + (i % 3)) * px;
      g.fillRect(sx - r / 2, sy - r / 2, r, r);
    }
  }

  // petals falling away as it wilts
  if (st.wilt > 0.3) {
    for (const f of sc.falling) {
      const age = (st.wilt - 0.3 - f.at * 0.5) * 6;
      if (age <= 0) continue;
      const x = hx + Math.cos(f.phi) * 0.1 * h + f.drift * age * 0.05 * h + Math.sin(age * 2 + f.phi) * 0.02 * h;
      const y = hy + age * age * 0.03 * h + age * 0.03 * h;
      if (y > y0) continue;
      g.fillStyle = f.col;
      g.fillRect(x - 2 * px, y - 1.5 * px, 4 * px, 3 * px);
    }
  }
  g.globalAlpha = 1;
}
