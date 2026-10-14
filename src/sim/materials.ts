export const Mat = {
  EMPTY: 0,
  WALL: 1,
  SAND: 2,
  WATER: 3,
  OIL: 4,
  FIRE: 5,
  SMOKE: 6,
  STEAM: 7,
  LAVA: 8,
  STONE: 9,
  ICE: 10,
  WOOD: 11,
  PLANT: 12,
  SEED: 13,
  ACID: 14,
  GUNPOWDER: 15,
  FUSE: 16,
  GLASS: 17,
  EMBER: 18,
  WIRE: 19,
  TORCH: 20,
  CLONE: 21,
  VOID: 22,
  SNOW: 23,
  SALT: 24,
  TNT: 25,
  ASH: 26,
  FLORA: 27,
} as const;

export type MatId = (typeof Mat)[keyof typeof Mat];
export const NMATS = Object.keys(Mat).length;

export const Cat = {
  EMPTY: 0,
  POWDER: 1,
  LIQUID: 2,
  GAS: 3,
  SOLID: 4,
} as const;

export interface MatDef {
  id: number;
  name: string;
  cat: number;
  dens: number;
  disp: number;
  flam: number;
  acidChance: number;
  ramp: [number, number, number, number];
  life: [number, number] | null;
  placeable: boolean;
}

function u32(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (((255 << 24) | (b << 16) | (g << 8) | r) >>> 0);
}

function def(
  id: number,
  name: string,
  cat: number,
  dens: number,
  rampHex: [string, string, string, string],
  opts: Partial<MatDef> = {},
): MatDef {
  return {
    id,
    name,
    cat,
    dens,
    disp: 0,
    flam: 0,
    acidChance: 0.08,
    ramp: [u32(rampHex[0]), u32(rampHex[1]), u32(rampHex[2]), u32(rampHex[3])],
    life: null,
    placeable: true,
    ...opts,
  };
}

export const MATS: MatDef[] = [];

MATS[Mat.EMPTY] = def(Mat.EMPTY, 'EMPTY', Cat.EMPTY, 0, ['#0b0b14', '#0b0b14', '#0b0b14', '#0b0b14'], { placeable: false, acidChance: 0 });
MATS[Mat.WALL] = def(Mat.WALL, 'WALL', Cat.SOLID, 100, ['#6b6b7e', '#75758a', '#5d5d70', '#80809a'], { acidChance: 0 });
MATS[Mat.SAND] = def(Mat.SAND, 'SAND', Cat.POWDER, 1.6, ['#e0c068', '#d4a94e', '#c99a3e', '#ecd28c']);
MATS[Mat.WATER] = def(Mat.WATER, 'WATER', Cat.LIQUID, 1.0, ['#3663c8', '#2f57b4', '#4a76dd', '#2c4da0'], { disp: 5, acidChance: 0.005 });
MATS[Mat.OIL] = def(Mat.OIL, 'OIL', Cat.LIQUID, 0.8, ['#7a5c3f', '#6a4e34', '#8a6a4a', '#5c4229'], { disp: 3, flam: 0.35, acidChance: 0.02 });
MATS[Mat.FIRE] = def(Mat.FIRE, 'FIRE', Cat.GAS, 0.4, ['#ff4b1f', '#ff7a1f', '#ffb01f', '#ffe86b'], { life: [12, 42], placeable: true });
MATS[Mat.SMOKE] = def(Mat.SMOKE, 'SMOKE', Cat.GAS, 0.25, ['#4a4a52', '#3c3c44', '#585860', '#30303a'], { life: [60, 160], acidChance: 0 });
MATS[Mat.STEAM] = def(Mat.STEAM, 'STEAM', Cat.GAS, 0.3, ['#aebfd4', '#98abc4', '#c4d2e4', '#8898b4'], { life: [90, 220], acidChance: 0 });
MATS[Mat.LAVA] = def(Mat.LAVA, 'LAVA', Cat.LIQUID, 1.9, ['#e23c1c', '#ff6a1f', '#c82a10', '#ff9526'], { disp: 1, acidChance: 0 });
MATS[Mat.STONE] = def(Mat.STONE, 'STONE', Cat.SOLID, 100, ['#7e7e8c', '#8c8c9a', '#6e6e7c', '#999aa6'], { acidChance: 0.006 });
MATS[Mat.ICE] = def(Mat.ICE, 'ICE', Cat.SOLID, 100, ['#a8d8f0', '#94c8e8', '#bcdff5', '#88bce0'], { acidChance: 0.02 });
MATS[Mat.WOOD] = def(Mat.WOOD, 'WOOD', Cat.SOLID, 100, ['#7a5230', '#8a5e38', '#6a4628', '#96703f'], { flam: 0.06, acidChance: 0.02 });
MATS[Mat.PLANT] = def(Mat.PLANT, 'PLANT', Cat.SOLID, 100, ['#3f9e3f', '#358a35', '#4ab24a', '#2e7a2e'], { flam: 0.16, acidChance: 0.05 });
MATS[Mat.SEED] = def(Mat.SEED, 'SEED', Cat.POWDER, 1.2, ['#a4b264', '#94a256', '#b4c274', '#849148'], { flam: 0.2 });
MATS[Mat.ACID] = def(Mat.ACID, 'ACID', Cat.LIQUID, 1.05, ['#8ee63f', '#7ad42f', '#a2f455', '#68c222'], { disp: 4, acidChance: 0 });
MATS[Mat.GUNPOWDER] = def(Mat.GUNPOWDER, 'POWDER', Cat.POWDER, 1.5, ['#4a4a55', '#3e3e48', '#585864', '#33333c'], { flam: 1 });
MATS[Mat.FUSE] = def(Mat.FUSE, 'FUSE', Cat.SOLID, 100, ['#c8a07a', '#b8906a', '#d8b08a', '#a87e5a'], { flam: 0, acidChance: 0.04 });
MATS[Mat.GLASS] = def(Mat.GLASS, 'GLASS', Cat.SOLID, 100, ['#b8ccd4', '#a8bcc8', '#c8dce0', '#98acb8'], { acidChance: 0 });
MATS[Mat.EMBER] = def(Mat.EMBER, 'EMBER', Cat.SOLID, 100, ['#c83c1e', '#e85a26', '#a82c14', '#ff7832'], { life: [70, 150], placeable: false });
MATS[Mat.WIRE] = def(Mat.WIRE, 'WIRE', Cat.SOLID, 100, ['#c47a3c', '#b06a30', '#d68a48', '#9c5e2a'], { acidChance: 0.01 });
MATS[Mat.TORCH] = def(Mat.TORCH, 'TORCH', Cat.SOLID, 100, ['#ffcf5a', '#ffb43a', '#ffe38a', '#e89a2c'], { acidChance: 0 });
MATS[Mat.CLONE] = def(Mat.CLONE, 'CLONE', Cat.SOLID, 100, ['#3fd1b4', '#2eb8a0', '#5ae0c8', '#249a86'], { acidChance: 0 });
MATS[Mat.VOID] = def(Mat.VOID, 'VOID', Cat.SOLID, 100, ['#3a2450', '#2c1a40', '#4a3060', '#221230'], { acidChance: 0 });
MATS[Mat.SNOW] = def(Mat.SNOW, 'SNOW', Cat.POWDER, 0.7, ['#eef4fa', '#dce8f4', '#f8fbff', '#c8d8ea'], { acidChance: 0.01 });
MATS[Mat.SALT] = def(Mat.SALT, 'SALT', Cat.POWDER, 1.3, ['#e8e4da', '#d8d4c8', '#f4f0e6', '#c8c4b8'], { acidChance: 0.01 });
MATS[Mat.TNT] = def(Mat.TNT, 'TNT', Cat.SOLID, 100, ['#c8281e', '#b02018', '#e03828', '#981810'], { acidChance: 0.02 });
// lighter than snow, so it is the most wind-mobile thing that still falls
MATS[Mat.ASH] = def(Mat.ASH, 'ASH', Cat.POWDER, 0.5, ['#5c5764', '#4c4754', '#6c6774', '#3f3b48'], { acidChance: 0.03 });
// stems, leaves and flowers that plants push up into the air. Its own
// material so GARDENER's PLANT count (and every plant rule) is untouched;
// which part a cell is lives in meta (see Flora below). The ramp is the
// stem's, which is what the 3D view and anything ramp-based will show.
MATS[Mat.FLORA] = def(Mat.FLORA, 'FLORA', Cat.SOLID, 100, ['#3c8a37', '#337a30', '#46993f', '#2c6c2a'], { flam: 0.16, acidChance: 0.05, placeable: false });

/**
 * FLORA meta: a static part (1..7) or a growing bud (0x80 | height left).
 * Petals carry their hue as an offset from PETAL, so a whole flower is one
 * colour without any per-flower bookkeeping.
 */
export const Flora = {
  STEM: 1,
  LEAF: 2,
  CENTER: 3,
  PETAL: 4, // 4..7 = four petal hues
  BUD: 0x80,
} as const;

const hex = (s: string) => u32(s);
/** ABGR colours per FLORA part; index by meta for static parts */
const FLORA_COLS: number[][] = [
  [],
  [hex('#3c8a37'), hex('#337a30'), hex('#46993f'), hex('#2c6c2a')], // stem
  [hex('#6cc24a'), hex('#5bb03e'), hex('#80d35a'), hex('#4f9d36')], // leaf
  [hex('#ffd54a'), hex('#f2b632'), hex('#ffe27a'), hex('#e8a628')], // centre
  [hex('#f47fb0'), hex('#e86a9f'), hex('#ff97c1'), hex('#f47fb0')], // pink
  [hex('#f6f0e4'), hex('#e9e1d2'), hex('#fffaf0'), hex('#f6f0e4')], // white
  [hex('#a989e8'), hex('#9473d9'), hex('#bea2f2'), hex('#a989e8')], // violet
  [hex('#ea564c'), hex('#d8463d'), hex('#f56e63'), hex('#ea564c')], // red
];
const BUD_COL = hex('#8fdc6a');

/**
 * How hard the wind field pushes each material, 0 (immovable) to 1.
 *
 * Gases go where they are told. Powders drift in proportion to how light they
 * are, so ash streams and sand skitters. Liquids get pushed too - they used to
 * be pinned at zero to protect the water-scored challenges, but a wind brush
 * that does nothing to the two things players paint most (sand and water)
 * reads as broken, which is exactly how it read. The challenge budgets are the
 * thing to re-tune, not the tool.
 */
export const WIND_SUSC = new Float32Array(NMATS);
for (let m = 0; m < NMATS; m++) {
  const d = MATS[m];
  if (!d) continue;
  if (d.cat === Cat.GAS) WIND_SUSC[m] = 1;
  else if (d.cat === Cat.POWDER) WIND_SUSC[m] = Math.min(1, 0.5 / d.dens);
  else if (d.cat === Cat.LIQUID) WIND_SUSC[m] = 0.35;
  else WIND_SUSC[m] = 0;
}

/** spark pulse length on wire = refractory period in frames */
export const SPARK_LIFE = 8;

export function isFluid(cat: number): boolean {
  return cat === Cat.LIQUID || cat === Cat.GAS;
}

/**
 * Which of a material's four ramp colours a cell shows this frame.
 *
 * Split out of `colorAt` so the 3D voxel view can animate its instance
 * colours from exactly the same rule the 2D rasterizer uses, without
 * unpacking and re-linearising a packed ABGR word per cell.
 */
/**
 * A well-mixed per-cell hash. The old `(x*73856093 ^ y*19349663) & 3` used
 * only the low two bits, and an odd multiplier leaves those as a plain
 * function of x and y - every static material was drawn as a regular
 * checker lattice, not noise.
 */
export function cellHash(x: number, y: number): number {
  let h = (Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

/** Calm liquid surface: mostly the base tone, some darker, rare glints. */
function liquidIndex(h: number): number {
  const b = h & 255;
  return b < 150 ? 0 : b < 228 ? 1 : b < 248 ? 3 : 2;
}

export function rampIndexAt(mat: number, x: number, y: number, frame: number, meta: number): number {
  const v = cellHash(x, y);
  switch (mat) {
    case Mat.FIRE:
      return (v + frame * 7 + meta * 5) & 3;
    case Mat.LAVA:
      return (v + (frame >> 2)) & 3;
    case Mat.ACID:
      return (v + (frame >> 3)) & 3;
    case Mat.WATER:
    case Mat.OIL:
      return liquidIndex(v);
    case Mat.EMBER:
      return ((frame + meta * 3) >> 2) & 3;
    case Mat.TORCH:
      return (v + (frame >> 1)) & 3;
    case Mat.VOID:
      return (v + (frame >> 2)) & 3;
    case Mat.SNOW:
      return (v + ((x + y) & 1)) & 3; // static sparkle per grain
    case Mat.TNT:
      return ((x * 7 + y * 13) & 8) ? 0 : v % 4; // striped charge look
    default:
      return v % 4;
  }
}

/**
 * Materials whose colour belongs to the grain rather than the position.
 *
 * Powders are the case that matters: they move as discrete grains, and a
 * position-keyed colour made a falling stream boil. Liquids keep the
 * position rule - water flowing through a still sparkle reads as water.
 * Solids never move, so for them the two rules are the same picture.
 */
export const GRAINY = new Uint8Array(NMATS);
for (let m = 0; m < NMATS; m++) if (MATS[m]?.cat === Cat.POWDER) GRAINY[m] = 1;

/** True when a cell's colour comes from its state, not its ramp. */
export function offRamp(mat: number, meta: number): boolean {
  return mat === Mat.FLORA || (meta > 0 && (mat === Mat.WIRE || mat === Mat.TNT));
}

/** Animated color pick for a cell, without surface lighting. */
export function colorAt(mat: number, x: number, y: number, frame: number, meta: number): number {
  // energized wire glows hot yellow/white and leaves the ramp entirely
  if (mat === Mat.WIRE && meta > 0)
    return (frame >> 1) & 1 ? 0xffb0f8ff : 0xff3cd2ff; // #fff8b0 / #ffd23c in ABGR
  // lit TNT flashes white, twice as fast in its last third - the warning
  // has to be readable from across the screen, so it beats the stripe
  if (mat === Mat.TNT && meta > 0)
    return (frame >> (meta < 24 ? 1 : 2)) & 1 ? 0xfff0f8ff : MATS[mat].ramp[2];
  if (mat === Mat.FLORA) {
    if (meta & Flora.BUD) return BUD_COL;
    const cols = FLORA_COLS[meta] ?? FLORA_COLS[Flora.STEM];
    return cols[cellHash(x, y) & 3];
  }
  return MATS[mat].ramp[rampIndexAt(mat, x, y, frame, meta)];
}

/**
 * Surface lighting - one fixed light, up and to the left.
 *
 * Pixel-art shading rather than physical shading: a lit edge also shifts warm
 * and a shadowed edge shifts cool, which is what keeps it from reading as
 * plain brightness noise. Gases are never lit (they are the light), and VOID
 * is a hole, so a bevel would make it look like a lid.
 */
export const Lit = {
  NONE: 0,
  /** shades the top face where it meets open air or gas */
  TOP: 1,
  /** TOP plus left/right/under bevel - only for things that never move */
  BEVEL: 2,
  /** bright waterline and a softer second row */
  SURFACE: 3,
} as const;

export const LIT = new Uint8Array(NMATS);
/** 1 where the material counts as open air for lighting: empty or gas */
export const OPEN = new Uint8Array(NMATS);
for (let m = 0; m < NMATS; m++) {
  const d = MATS[m];
  if (!d) continue;
  if (d.cat === Cat.EMPTY || d.cat === Cat.GAS) OPEN[m] = 1;
  if (d.cat === Cat.POWDER) LIT[m] = Lit.TOP;
  else if (d.cat === Cat.LIQUID) LIT[m] = Lit.SURFACE;
  else if (d.cat === Cat.SOLID) LIT[m] = Lit.BEVEL;
}
LIT[Mat.VOID] = Lit.NONE;

/** Lighten toward warm white. `k` in 0..1 is how far; ABGR in and out. */
export function lighten(c: number, k: number): number {
  const r = c & 255, g = (c >>> 8) & 255, b = (c >>> 16) & 255;
  const nr = r + (((255 - r) * k * 1.1) | 0);
  const ng = g + (((255 - g) * k) | 0);
  const nb = b + (((255 - b) * k * 0.75) | 0);
  return ((255 << 24) | (nb << 16) | (ng << 8) | nr) >>> 0;
}

/** Darken toward cool blue. Blue loses least, so shadows read violet. */
export function darken(c: number, k: number): number {
  const r = c & 255, g = (c >>> 8) & 255, b = (c >>> 16) & 255;
  const nr = (r * (1 - k)) | 0;
  const ng = (g * (1 - k * 0.9)) | 0;
  const nb = (b * (1 - k * 0.6)) | 0;
  return ((255 << 24) | (nb << 16) | (ng << 8) | nr) >>> 0;
}

/**
 * Which lit version of a colour a cell shows. Index into SHADED's last axis.
 * The strengths live here, once, so the table and the rare off-ramp path
 * (energized wire) cannot drift apart.
 */
export const Shade = {
  BASE: 0,
  /** a powder's grains already vary by a full ramp step, so its rim needs a
   *  stronger lift than a flat solid's to read as an edge, not a grain */
  POWDER_TOP: 1,
  SOLID_TOP: 2,
  UNDER: 3,
  LEFT: 4,
  RIGHT: 5,
  WATERLINE: 6,
  SECOND_ROW: 7,
} as const;

export function applyShade(c: number, v: number): number {
  switch (v) {
    case Shade.POWDER_TOP: return lighten(c, 0.4);
    case Shade.SOLID_TOP: return lighten(c, 0.24);
    case Shade.UNDER: return darken(c, 0.32);
    case Shade.LEFT: return lighten(c, 0.1);
    case Shade.RIGHT: return darken(c, 0.16);
    case Shade.WATERLINE: return lighten(c, 0.42);
    case Shade.SECOND_ROW: return lighten(c, 0.14);
    default: return c;
  }
}

/**
 * Every ramp colour of every material in all eight lit versions, built once.
 * Index `((mat << 2 | rampIndex) << 3) | shade`, so a lit cell costs one
 * array read, like an unlit one. Measured bundled under node, a worst-case
 * full-screen repaint went 1.2 ms -> ~2.2 ms with lighting on; normal frames
 * repaint only dirty chunks. (Do not benchmark under vite-node: it turns
 * every imported binding into a getter and inflated this to 4x.)
 */
export const SHADED = new Uint32Array(NMATS * 4 * 8);

/**
 * Alpha byte that marks a pixel as liquid surface-or-body for the GL
 * composite (depth, caustics, surface glints). Every other pixel is 255.
 * 250/255 is invisible to the 2D fallback, which just draws it.
 */
export const LIQUID_ALPHA = 250;

for (let m = 0; m < NMATS; m++) {
  if (!MATS[m]) continue;
  // lava is a light source, not a pool: it keeps its own look
  const tag = MATS[m].cat === Cat.LIQUID && m !== Mat.LAVA;
  for (let r = 0; r < 4; r++)
    for (let v = 0; v < 8; v++) {
      const c = applyShade(MATS[m].ramp[r], v);
      SHADED[(((m << 2) | r) << 3) | v] = tag ? ((c & 0x00ffffff) | (LIQUID_ALPHA << 24)) >>> 0 : c;
    }
}
