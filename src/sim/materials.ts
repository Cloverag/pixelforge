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
export function rampIndexAt(mat: number, x: number, y: number, frame: number, meta: number): number {
  const v = ((x * 73856093) ^ (y * 19349663)) >>> 0;
  switch (mat) {
    case Mat.FIRE:
      return (v + frame * 7 + meta * 5) & 3;
    case Mat.LAVA:
      return (v + (frame >> 2)) & 3;
    case Mat.ACID:
      return (v + (frame >> 3)) & 3;
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

/** Animated color pick for a cell (worker-side rasterizer). */
export function colorAt(mat: number, x: number, y: number, frame: number, meta: number): number {
  // energized wire glows hot yellow/white and leaves the ramp entirely
  if (mat === Mat.WIRE && meta > 0)
    return (frame >> 1) & 1 ? 0xffb0f8ff : 0xff3cd2ff; // #fff8b0 / #ffd23c in ABGR
  return MATS[mat].ramp[rampIndexAt(mat, x, y, frame, meta)];
}
