/**
 * The ASCII garden's flowers as data: what kind, where the bloom is, where
 * its stem starts, its colours, size and turn. Pure and seeded, so a bouquet
 * is the same every time for the same seed, and tests can walk it.
 *
 * Coordinates are the world's 640 x 360, +y down (like the sim).
 */

export type FlowerKind = 'lily' | 'tulip' | 'daisy' | 'rose' | 'sunflower';
export const FLOWER_KINDS: readonly FlowerKind[] = ['lily', 'tulip', 'daisy', 'rose', 'sunflower'];

export interface Flower {
  kind: FlowerKind;
  /** the bloom's centre */
  x: number;
  y: number;
  /** where the stem starts (the ground, or the bouquet's tie) */
  sx: number;
  sy: number;
  /** bloom radius */
  r: number;
  /** turn of the bloom, radians */
  rot: number;
  /** petal colour (base) and its lighter tip, '#rrggbb' */
  petal: string;
  tip: string;
  /** when it was planted, seconds: it opens over the first second */
  born: number;
  /** its own sway phase */
  phase: number;
}

/** Petal colours by kind: [base, tip]. Lilies come in the bouquet's colours. */
const COLORS: Record<FlowerKind, [string, string][]> = {
  lily: [
    ['#d61f2c', '#ff6a5a'],
    ['#e8417e', '#ffb0d0'],
    ['#f2c230', '#fff1a0'],
    ['#efe6dc', '#ffffff'],
    ['#f08a3c', '#ffd2a0'],
    ['#b8326e', '#f7a1c8'],
  ],
  tulip: [
    ['#e02a3a', '#ff8a80'],
    ['#f2a33c', '#ffe08a'],
    ['#b04ad8', '#e6b3ff'],
  ],
  daisy: [['#f4f2ea', '#ffffff']],
  rose: [
    ['#b0122a', '#ff4a5a'],
    ['#e86a9a', '#ffc0d8'],
  ],
  sunflower: [['#f2b81c', '#ffe066']],
};

/** A small seeded random source (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GROUND = 352;

/** One flower planted at (x, y): its stem grows from the ground straight below. */
export function plantAt(kind: FlowerKind, x: number, y: number, size: number, now: number, seed: number): Flower {
  const rand = rng(seed);
  const pal = COLORS[kind][Math.floor(rand() * COLORS[kind].length)];
  const by = Math.min(y, GROUND - 24);
  return {
    kind,
    x,
    y: by,
    sx: x + (rand() - 0.5) * 30,
    sy: GROUND,
    r: size,
    rot: rand() * Math.PI * 2,
    petal: pal[0],
    tip: pal[1],
    born: now,
    phase: rand() * Math.PI * 2,
  };
}

/**
 * A bouquet: blooms in a dome above a tie, every stem gathered to it, the
 * big lilies in front - the shape of a florist's bouquet. Back to front, so
 * drawing them in order layers them right.
 */
export function bouquet(seed: number, now: number, cx = 320, top = 14): Flower[] {
  const rand = rng(seed);
  const tieX = cx;
  const tieY = 330;
  const n = 11;
  const out: Flower[] = [];
  for (let i = 0; i < n; i++) {
    // a dome: wide in the middle, narrow at the top
    const a = Math.PI * (0.12 + 0.76 * rand());
    const d = 0.35 + 0.65 * Math.sqrt(rand());
    const x = cx - Math.cos(a) * 185 * d;
    const y = top + 50 + (1 - Math.sin(a)) * 70 + (1 - d) * 60 + rand() * 60;
    const kind: FlowerKind = rand() < 0.72 ? 'lily' : FLOWER_KINDS[1 + Math.floor(rand() * 4)];
    const pal = COLORS[kind][Math.floor(rand() * COLORS[kind].length)];
    out.push({
      kind,
      x,
      y,
      sx: tieX + (rand() - 0.5) * 16,
      sy: tieY,
      r: kind === 'lily' ? 52 + rand() * 20 : 32 + rand() * 12,
      rot: rand() * Math.PI * 2,
      petal: pal[0],
      tip: pal[1],
      // they open one after another, from the back
      born: now + i * 0.12,
      phase: rand() * Math.PI * 2,
    });
  }
  // further back (higher up, smaller) first
  out.sort((p, q) => p.y + p.r * 0.5 - (q.y + q.r * 0.5));
  return out;
}

/** 0 to 1 over the first second after planting, eased: how open a bloom is. */
export function openness(f: Flower, now: number): number {
  const t = Math.min(1, Math.max(0, now - f.born));
  return 1 - (1 - t) * (1 - t) * (1 - t);
}

/**
 * A garden as a link code (base64url): a version byte, then 12 bytes a
 * flower - kind and colour, bloom x y, stem x y, size, turn, sway phase.
 * Positions are whole cells, turns 1/256ths: invisible at this size.
 */
const CODE_VERSION = 1;
const BYTES = 12;
const TURN = Math.PI * 2;

export function encodeGarden(flowers: Flower[]): string {
  const b = new Uint8Array(1 + flowers.length * BYTES);
  const v = new DataView(b.buffer);
  b[0] = CODE_VERSION;
  flowers.forEach((f, i) => {
    const o = 1 + i * BYTES;
    const pal = Math.max(0, COLORS[f.kind].findIndex(([p]) => p === f.petal));
    b[o] = FLOWER_KINDS.indexOf(f.kind) * 16 + pal;
    v.setInt16(o + 1, Math.round(f.x));
    v.setInt16(o + 3, Math.round(f.y));
    v.setInt16(o + 5, Math.round(f.sx));
    v.setInt16(o + 7, Math.round(f.sy));
    b[o + 9] = Math.max(1, Math.min(255, Math.round(f.r)));
    b[o + 10] = Math.round((((f.rot % TURN) + TURN) % TURN / TURN) * 256) & 255;
    b[o + 11] = Math.round((((f.phase % TURN) + TURN) % TURN / TURN) * 256) & 255;
  });
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The flowers back, opening one after another from `now`; null for a code that is not a garden. */
export function decodeGarden(code: string, now: number): Flower[] | null {
  let s: string;
  try {
    s = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    return null;
  }
  const b = Uint8Array.from(s, (c) => c.charCodeAt(0));
  if (b[0] !== CODE_VERSION || (b.length - 1) % BYTES !== 0) return null;
  const v = new DataView(b.buffer);
  const out: Flower[] = [];
  for (let o = 1; o < b.length; o += BYTES) {
    const kind = FLOWER_KINDS[b[o] >> 4];
    const pal = kind && COLORS[kind][b[o] & 15];
    if (!pal) return null;
    out.push({
      kind,
      x: v.getInt16(o + 1),
      y: v.getInt16(o + 3),
      sx: v.getInt16(o + 5),
      sy: v.getInt16(o + 7),
      r: b[o + 9],
      rot: (b[o + 10] / 256) * TURN,
      petal: pal[0],
      tip: pal[1],
      born: now + out.length * 0.12,
      phase: (b[o + 11] / 256) * TURN,
    });
  }
  return out;
}
