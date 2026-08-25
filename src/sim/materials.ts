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

/** spark pulse length on wire = refractory period in frames */
export const SPARK_LIFE = 8;

export function isFluid(cat: number): boolean {
  return cat === Cat.LIQUID || cat === Cat.GAS;
}

/** Animated color pick for a cell (worker-side rasterizer). */
export function colorAt(mat: number, x: number, y: number, frame: number, meta: number): number {
  const m = MATS[mat];
  let v = ((x * 73856093) ^ (y * 19349663)) >>> 0;
  switch (mat) {
    case Mat.FIRE:
      v = (v + frame * 7 + meta * 5) & 3;
      break;
    case Mat.LAVA:
      v = (v + (frame >> 2)) & 3;
      break;
    case Mat.ACID:
      v = (v + (frame >> 3)) & 3;
      break;
    case Mat.EMBER:
      v = ((frame + meta * 3) >> 2) & 3;
      break;
    case Mat.WIRE:
      // energized wire glows hot yellow/white, idle wire is copper
      if (meta > 0) return (frame >> 1) & 1 ? 0xffb0f8ff : 0xff3cd2ff; // #fff8b0 / #ffd23c in ABGR
      v %= 4;
      break;
    case Mat.TORCH:
      v = (v + (frame >> 1)) & 3;
      break;
    case Mat.VOID:
      v = (v + (frame >> 2)) & 3;
      break;
    default:
      v %= 4;
  }
  return m.ramp[v];
}
