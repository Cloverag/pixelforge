import { SIM_H, SIM_W } from './protocol';
import { hash2d } from '../core/rng';

/**
 * The playground's backdrop, so the world is never a black void: a dim
 * nebula, a starfield in three depths that drifts and twinkles, and now and
 * then a shooting star. The forces bend it, so a black hole reads as a black
 * hole before anything has fallen in: a dark shadow ringed by lensed light.
 * Vortices and black holes stir it round them.
 *
 * Drawing only. It runs in PSys.draw, never in step, so it is not part of the
 * shared simulation and needs none of its determinism; Math.sin is fine here.
 *
 * Cost is the constraint - this runs in the worker's frame. The nebula is not
 * blended in a pass of its own: skyLayer() hands PSys.draw a cached image that
 * trails decay toward instead of flat black, so the loop that already visits
 * every pixel carries it. The cache is rebuilt only where a force is still
 * stirring, through lookup tables rather than per-pixel sqrt and trig. (A
 * straightforward version cost 15 ms a frame with nothing placed and 59 ms
 * with eight forces.)
 */

/** what the sky needs of a force: where it is and what it does */
export interface Bender {
  kind: 'attract' | 'repel' | 'vortex' | 'hole';
  x: number;
  y: number;
}

const BG_R = 0x0b;
const BG_G = 0x0b;
const BG_B = 0x14;
const BG = ((255 << 24) | (BG_B << 16) | (BG_G << 8) | BG_R) >>> 0;

/** the black hole's Einstein radius: lensed light crowds into a ring here */
const EINSTEIN = 22;
/** the black hole's shadow: the sky is dark inside it */
const SHADOW = Math.round(EINSTEIN * 0.72);
/** how far round a force the sky is bent, and where the bend starts to fade */
const WARP_R = 80;
const WARP_FULL = 45;
/** stirring stops winding the nebula after this many frames, so it settles
 *  into spiral arms instead of winding itself into noise */
const STIR_MAX = 900;
const STIR_EVERY = 3;

// ---------------------------------------------------------------- nebula

/** value noise from the hash, smoothly interpolated, at one scale */
function noise(x: number, y: number, cell: number, salt: number): number {
  const gx = Math.floor(x / cell);
  const gy = Math.floor(y / cell);
  const fx = x / cell - gx;
  const fy = y / cell - gy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const v = (i: number, j: number) => (hash2d(gx + i, gy + j + salt * 977) & 0xffff) / 0xffff;
  const a = v(0, 0) + (v(1, 0) - v(0, 0)) * ux;
  const b = v(0, 1) + (v(1, 1) - v(0, 1)) * ux;
  return a + (b - a) * uy;
}

/** the unbent clouds, built once: dim purple and teal where they are dense */
const NEB = new Uint32Array(SIM_W * SIM_H);
for (let y = 0; y < SIM_H; y++) {
  for (let x = 0; x < SIM_W; x++) {
    const d = noise(x, y, 160, 1) * 0.55 + noise(x, y, 80, 2) * 0.3 + noise(x, y, 32, 3) * 0.15;
    const hue = noise(x, y, 213, 4);
    // only the denser parts glow; the rest stays open sky
    const k = Math.max(0, d - 0.36) / 0.64;
    const v = k * k * 72;
    const r = BG_R + v * (0.55 + 0.35 * hue);
    const g = BG_G + v * (0.25 + 0.45 * (1 - hue));
    const b = BG_B + v * 0.95;
    NEB[y * SIM_W + x] = ((255 << 24) | (Math.min(255, b | 0) << 16) | (Math.min(255, g | 0) << 8) | Math.min(255, r | 0)) >>> 0;
  }
}

/** distance from the centre for every offset in a force's square of reach */
const D = WARP_R * 2 + 1;
const RTAB = new Float32Array(D * D);
for (let j = 0; j < D; j++)
  for (let i = 0; i < D; i++) RTAB[j * D + i] = Math.hypot(i - WARP_R, j - WARP_R);

/** the bent sky, rebuilt where forces change it */
const sky = new Uint32Array(SIM_W * SIM_H);
sky.set(NEB);
/** the frame each force was first seen: drawing-side only, never simulated */
const born = new WeakMap<Bender, number>();
/** stirring forces that have had their last redraw */
const settled = new WeakSet<Bender>();
let lastSig = '';

/**
 * Per force, by whole radius 0..WARP_R: the radial scale and rotation that
 * take a displayed pixel back to where its light came from - back through the
 * lens round a black hole, back through the twist round a vortex.
 */
const kTab = new Float32Array(WARP_R + 1);
const cTab = new Float32Array(WARP_R + 1);
const sTab = new Float32Array(WARP_R + 1);

function fillTables(f: Bender, age: number): void {
  const stir = Math.min(STIR_MAX, age);
  for (let r = 0; r <= WARP_R; r++) {
    const rr = Math.max(r, 0.5);
    const w = r < WARP_FULL ? 1 : 1 - (r - WARP_FULL) / (WARP_R - WARP_FULL);
    let k = 1;
    let turn = 0;
    if (f.kind === 'hole') {
      k = (rr - (EINSTEIN * EINSTEIN / rr) * w) / rr;
      turn = -0.006 * stir * Math.exp(-rr / 34) * w;
    } else if (f.kind === 'vortex') {
      turn = -0.012 * stir * Math.exp(-rr / 40) * w;
    } else {
      const s = 0.3 * Math.exp(-rr / 45) * w;
      k = f.kind === 'attract' ? 1 + s : 1 - s;
    }
    kTab[r] = k;
    cTab[r] = Math.cos(turn);
    sTab[r] = Math.sin(turn);
  }
}

/** Redraw the sky inside one force's reach, bending through all of them. */
function rebuildAround(f: Bender, forces: readonly Bender[], frame: number): void {
  const x0 = Math.max(0, Math.floor(f.x) - WARP_R);
  const x1 = Math.min(SIM_W - 1, Math.floor(f.x) + WARP_R);
  const y0 = Math.max(0, Math.floor(f.y) - WARP_R);
  const y1 = Math.min(SIM_H - 1, Math.floor(f.y) + WARP_R);
  // start every pixel in reach at "unbent", then send it back through each
  // force in turn; one force's tables are filled once for the whole region
  const n = (x1 - x0 + 1) * (y1 - y0 + 1);
  const bx = new Float32Array(n);
  const by = new Float32Array(n);
  const dark = new Uint8Array(n);
  const inside = new Uint8Array(n);
  let m = 0;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++, m++) {
      bx[m] = x;
      by[m] = y;
      const dx = x - Math.floor(f.x) + WARP_R;
      const dy = y - Math.floor(f.y) + WARP_R;
      inside[m] = RTAB[dy * D + dx] <= WARP_R ? 1 : 0;
    }
  for (const g of forces) {
    // only forces whose reach overlaps this one's can bend a pixel in it
    if (Math.abs(g.x - f.x) > 2 * WARP_R || Math.abs(g.y - f.y) > 2 * WARP_R) continue;
    fillTables(g, frame - (born.get(g) ?? frame));
    const gx = Math.floor(g.x);
    const gy = Math.floor(g.y);
    for (let i = 0; i < n; i++) {
      if (!inside[i] || dark[i]) continue;
      const ox = Math.round(bx[i]) - gx + WARP_R;
      const oy = Math.round(by[i]) - gy + WARP_R;
      if (ox < 0 || oy < 0 || ox >= D || oy >= D) continue;
      const r = RTAB[oy * D + ox];
      if (r > WARP_R) continue;
      if (g.kind === 'hole' && r < SHADOW) {
        dark[i] = 1;
        continue;
      }
      const ri = r | 0;
      const dx = bx[i] - g.x;
      const dy = by[i] - g.y;
      const k = kTab[ri];
      bx[i] = g.x + (dx * cTab[ri] - dy * sTab[ri]) * k;
      by[i] = g.y + (dx * sTab[ri] + dy * cTab[ri]) * k;
    }
  }
  m = 0;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++, m++) {
      if (!inside[m]) continue;
      let v = BG;
      if (!dark[m]) {
        const sx = Math.round(bx[m]);
        const sy = Math.round(by[m]);
        if (sx >= 0 && sy >= 0 && sx < SIM_W && sy < SIM_H) v = NEB[sy * SIM_W + sx];
      }
      sky[y * SIM_W + x] = v;
    }
}

/**
 * The sky for this frame, for trails to decay toward. Rebuilt in full when
 * the set of forces changes; while a vortex or black hole is still stirring,
 * only its own reach is redrawn.
 */
export function skyLayer(frame: number, forces: readonly Bender[]): Uint32Array {
  for (const f of forces) if (!born.has(f)) born.set(f, frame);
  let sig = '';
  for (const f of forces) sig += `${f.kind}${f.x | 0},${f.y | 0};`;
  if (sig !== lastSig) {
    lastSig = sig;
    sky.set(NEB);
    for (const f of forces) rebuildAround(f, forces, frame);
    return sky;
  }
  // the stir turns about a hundredth of a radian a frame, so each stirring
  // force is redrawn every STIR_EVERY frames, staggered, and nobody can tell
  for (let i = 0; i < forces.length; i++) {
    const f = forces[i];
    if (f.kind !== 'vortex' && f.kind !== 'hole') continue;
    const age = frame - (born.get(f) ?? frame);
    if (age <= STIR_MAX) {
      if ((frame + i) % STIR_EVERY === 0) rebuildAround(f, forces, frame);
    } else if (!settled.has(f)) {
      // one last redraw at the fully wound state: frames run undrawn while
      // the tab is hidden, and the arms would otherwise freeze half-wound
      settled.add(f);
      rebuildAround(f, forces, frame);
    }
  }
  return sky;
}

// ---------------------------------------------------------------- stars

const N = 1200;
/** drift in cells per frame for the far, middle and near layers */
const DRIFT = [0.012, 0.03, 0.065];
/** brightness above the background for each layer (0-255) */
const GLOW: [number, number][] = [[26, 58], [52, 105], [100, 170]];

const starX = new Float32Array(N);
const starY = new Float32Array(N);
const depth = new Uint8Array(N);
const lum = new Float32Array(N);
const phase = new Float32Array(N);
const rate = new Float32Array(N);
/** per-star tint: most near white, a few warm or cool */
const tintR = new Float32Array(N);
const tintG = new Float32Array(N);
const tintB = new Float32Array(N);

{
  // fixed layout: the same sky for every player and every visit
  const u = (i: number, salt: number) => (hash2d(i * 7 + salt, salt * 131 + 17) & 0xffff) / 0x10000;
  for (let i = 0; i < N; i++) {
    starX[i] = u(i, 1) * SIM_W;
    starY[i] = u(i, 2) * SIM_H;
    // more far stars than near ones, like a real sky
    const l = u(i, 3);
    depth[i] = l < 0.6 ? 0 : l < 0.9 ? 1 : 2;
    const [lo, hi] = GLOW[depth[i]];
    lum[i] = lo + (hi - lo) * u(i, 4) ** 2;
    phase[i] = u(i, 5) * Math.PI * 2;
    rate[i] = 0.02 + u(i, 6) * 0.06;
    const t = u(i, 7);
    if (t < 0.12) [tintR[i], tintG[i], tintB[i]] = [1, 0.82, 0.62]; // warm
    else if (t < 0.24) [tintR[i], tintG[i], tintB[i]] = [0.7, 0.82, 1]; // cool
    else [tintR[i], tintG[i], tintB[i]] = [0.94, 0.94, 1];
  }
}

/** Lighten: keep the brighter of what is there and the star, per channel. */
function plot(pix: Uint32Array, x: number, y: number, r: number, g: number, b: number): void {
  if (x < 0 || y < 0 || x >= SIM_W || y >= SIM_H) return;
  const i = y * SIM_W + x;
  const c = pix[i];
  const cr = Math.max(c & 255, r);
  const cg = Math.max((c >>> 8) & 255, g);
  const cb = Math.max((c >>> 16) & 255, b);
  pix[i] = ((255 << 24) | (cb << 16) | (cg << 8) | cr) >>> 0;
}

/**
 * Where a star appears with the forces in play, and how much brighter: the
 * forward version of the nebula's bend - pushed out to the lensed ring round
 * a black hole (the outer image of a point lens), drawn in, pushed off, and
 * turned round vortices and black holes, faster close in.
 */
const out = new Float32Array(3);
function bend(x: number, y: number, frame: number, forces: readonly Bender[]): void {
  let gain = 1;
  for (const f of forces) {
    const dx = x - f.x;
    const dy = y - f.y;
    const r = Math.sqrt(dx * dx + dy * dy);
    if (r < 0.01) continue;
    const age = frame - (born.get(f) ?? frame);
    let r2 = r;
    let turn = 0;
    if (f.kind === 'hole') {
      r2 = (r + Math.sqrt(r * r + 4 * EINSTEIN * EINSTEIN)) / 2;
      gain *= Math.min(2.6, r2 / r);
      turn = 0.006 * age * Math.exp(-r / 34);
    } else if (f.kind === 'attract') {
      r2 = r * (1 - 0.3 * Math.exp(-r / 45));
    } else if (f.kind === 'repel') {
      r2 = r * (1 + 0.3 * Math.exp(-r / 45));
    } else {
      turn = 0.012 * age * Math.exp(-r / 40);
    }
    const k = r2 / r;
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    x = f.x + (dx * c - dy * s) * k;
    y = f.y + (dx * s + dy * c) * k;
  }
  out[0] = x;
  out[1] = y;
  out[2] = gain;
}

export function drawStars(pix: Uint32Array, frame: number, forces: readonly Bender[]): void {
  for (const f of forces) if (!born.has(f)) born.set(f, frame);
  for (let i = 0; i < N; i++) {
    let x = starX[i] - frame * DRIFT[depth[i]];
    x -= Math.floor(x / SIM_W) * SIM_W; // wrap round, left to right
    bend(x, starY[i], frame, forces);
    const tw = 0.72 + 0.28 * Math.sin(frame * rate[i] + phase[i]);
    const v = Math.min(200, lum[i] * tw * out[2]);
    plot(
      pix,
      out[0] | 0,
      out[1] | 0,
      Math.min(255, BG_R + v * tintR[i]) | 0,
      Math.min(255, BG_G + v * tintG[i]) | 0,
      Math.min(255, BG_B + v * tintB[i]) | 0,
    );
  }
  shootingStar(pix, frame);
}

/** one every ~8 s on average: a hashed coin per 4 s window decides */
const WINDOW = 240;
const STREAK = 34;

function shootingStar(pix: Uint32Array, frame: number): void {
  const w = Math.floor(frame / WINDOW);
  const h = hash2d(w, 911);
  if ((h & 1) === 0) return;
  const t = frame - w * WINDOW - ((h >>> 1) % (WINDOW - STREAK));
  if (t < 0 || t >= STREAK) return;
  // enters along the top half, falls down and to the left
  const x0 = SIM_W * 0.35 + (((h >>> 8) % 1000) / 1000) * SIM_W * 0.6;
  const y0 = (((h >>> 18) % 1000) / 1000) * SIM_H * 0.4;
  const hx = x0 - t * 5.2;
  const hy = y0 + t * 2.1;
  const fade = t < 6 ? t / 6 : 1 - (t - 6) / (STREAK - 6);
  for (let j = 0; j < 14; j++) {
    const v = 230 * fade * (1 - j / 14);
    plot(pix, (hx + j * 2.6) | 0, (hy - j * 1.05) | 0, (BG_R + v) | 0, (BG_G + v * 0.96) | 0, (BG_B + v * 0.9) | 0);
  }
}
