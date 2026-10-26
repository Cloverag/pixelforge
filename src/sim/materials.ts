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
  MUD: 28,
  TURBINE: 29,
  ANT: 30,
  BIRD: 31,
  // ---- CHEM LAB: elements (see sim/reactions.ts) ----
  H: 32,
  O: 33,
  N: 34,
  CL: 35,
  NE: 36,
  LI: 37,
  NA: 38,
  K: 39,
  MG: 40,
  AL: 41,
  CA: 42,
  FE: 43,
  CU: 44,
  ZN: 45,
  SR: 46,
  BA: 47,
  C: 48,
  P: 49,
  S: 50,
  I: 51,
  // ---- CHEM LAB: what reactions make ----
  LYE: 52,
  RUST: 53,
  OXIDE: 54,
  SULFIDE: 55,
  IODINE_GAS: 56,
  NEON_GLOW: 57,
  // flame-test colours: fire that a metal has tinted
  FLAME_YELLOW: 58,
  FLAME_LILAC: 59,
  FLAME_CRIMSON: 60,
  FLAME_GREEN: 61,
  FLAME_APPLE: 62,
  FLAME_ORANGE: 63,
  FLAME_BLUE: 64,
  FLAME_WHITE: 65,
  // ---- CHEM LAB V2: ten more elements, appended - ids travel in room
  // snapshots, so nothing above is ever renumbered ----
  HE: 66,
  B: 67,
  F: 68,
  SI: 69,
  BR: 70,
  AG: 71,
  SN: 72,
  CS: 73,
  AU: 74,
  HG: 75,
  // ---- NUCLEAR: fissile metals and the neutrons that split them ----
  U: 76,
  PU: 77,
  NEUTRON: 78,
  // ---- CHEM LAB: compounds for the bench's demonstrations ----
  PEROXIDE: 79,
  IODIDE: 80,
  FOAM: 81,
  TOLLENS: 82,
  GLUCOSE: 83,
  SILVER_SOL: 84,
  MIRROR: 85,
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
MATS[Mat.WALL] = def(Mat.WALL, 'WALL', Cat.SOLID, 100, ['#6b6b7e', '#75758a', '#47475a', '#80809a'], { acidChance: 0 });
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

// sand that has met water: heavy, sticky, holds a tunnel roof
MATS[Mat.MUD] = def(Mat.MUD, 'MUD', Cat.POWDER, 1.8, ['#6b4a2e', '#5e3f27', '#7a5636', '#523621'], { acidChance: 0.03 });
// spins in wind or under falling water; a spinning turbine sparks wire
MATS[Mat.TURBINE] = def(Mat.TURBINE, 'TURBINE', Cat.SOLID, 100, ['#8fa3b3', '#7d909f', '#a9bccb', '#6a7b88'], { acidChance: 0.01 });
// creatures: SOLID so nothing else displaces them - they move themselves.
// dens < water so an ant that falls in floats.
MATS[Mat.ANT] = def(Mat.ANT, 'ANT', Cat.SOLID, 0.9, ['#d0482f', '#b83c27', '#e0583b', '#a8341f'], { flam: 0.4, acidChance: 0.3 });
MATS[Mat.BIRD] = def(Mat.BIRD, 'BIRD', Cat.SOLID, 0.5, ['#f4f3ee', '#d6dade', '#ffffff', '#b4bac2'], { flam: 0.5, acidChance: 0.3 });

// ---- CHEM LAB ----
// Elements and their products live only in the CHEM LAB (placeable: false
// keeps them out of the sandbox rail). Densities are on the game's scale -
// water 1, sand 1.6 - and keep the real order where it shows: sodium,
// potassium and lithium float on water, the heavy metals sink. Metals resist
// ACID's generic eating (acidChance 0): their reaction with acid is a rule
// that makes hydrogen, not a cell quietly vanishing.
const chem = (id: number, name: string, cat: number, dens: number, ramp: [string, string, string, string], opts: Partial<MatDef> = {}) =>
  (MATS[id] = def(id, name, cat, dens, ramp, { placeable: false, ...opts }));
chem(Mat.H, 'HYDROGEN', Cat.GAS, 0.09, ['#d9f2ff', '#c4e6fa', '#eaf8ff', '#b4dcf5'], { flam: 0.9, acidChance: 0 });
chem(Mat.O, 'OXYGEN', Cat.GAS, 0.4, ['#8fb8ff', '#7aa6f2', '#a6c8ff', '#6894e0'], { acidChance: 0 });
chem(Mat.N, 'NITROGEN', Cat.GAS, 0.35, ['#9a9ab8', '#8a8aa8', '#acacc8', '#7c7c9a'], { acidChance: 0 });
chem(Mat.CL, 'CHLORINE', Cat.GAS, 0.8, ['#c8e64a', '#b4d43a', '#d8f064', '#a2c22c'], { acidChance: 0 });
chem(Mat.NE, 'NEON', Cat.GAS, 0.2, ['#8a6a72', '#7a5c64', '#9a7880', '#6c5058'], { acidChance: 0 });
chem(Mat.LI, 'LITHIUM', Cat.POWDER, 0.53, ['#c8c8d0', '#b8b8c2', '#d8d8e0', '#a8a8b4'], { acidChance: 0 });
chem(Mat.NA, 'SODIUM', Cat.POWDER, 0.97, ['#d2d6dc', '#c0c4cc', '#e2e6ea', '#b0b4bc'], { acidChance: 0 });
chem(Mat.K, 'POTASSIUM', Cat.POWDER, 0.86, ['#c4c8d8', '#b2b6c8', '#d4d8e6', '#a2a6b8'], { acidChance: 0 });
chem(Mat.MG, 'MAGNESIUM', Cat.POWDER, 1.74, ['#e6e8ee', '#d4d6de', '#f4f6fa', '#c2c4ce'], { flam: 0.1, acidChance: 0 });
chem(Mat.AL, 'ALUMINIUM', Cat.POWDER, 2.7, ['#b8c0cc', '#a6aebc', '#cad2dc', '#949cac'], { acidChance: 0 });
chem(Mat.CA, 'CALCIUM', Cat.POWDER, 1.55, ['#e4e0d4', '#d2cec2', '#f0ece2', '#c0bcb0'], { acidChance: 0 });
chem(Mat.FE, 'IRON', Cat.POWDER, 7.87, ['#6c6e76', '#5c5e66', '#7c7e86', '#4e5058'], { acidChance: 0 });
chem(Mat.CU, 'COPPER', Cat.POWDER, 8.96, ['#d0804a', '#bc6e3a', '#e2945c', '#a65e2e'], { acidChance: 0 });
chem(Mat.ZN, 'ZINC', Cat.POWDER, 7.14, ['#a4acb8', '#949ca8', '#b4bcc8', '#848c98'], { acidChance: 0 });
chem(Mat.SR, 'STRONTIUM', Cat.POWDER, 2.64, ['#e2dcc0', '#d0caae', '#eee8d0', '#beb89c'], { acidChance: 0 });
chem(Mat.BA, 'BARIUM', Cat.POWDER, 3.5, ['#c6ccbe', '#b4baac', '#d6dcd0', '#a2a89a'], { acidChance: 0 });
chem(Mat.C, 'CARBON', Cat.POWDER, 2.0, ['#2c2a2e', '#242226', '#38363a', '#1c1a1e'], { flam: 0.04, acidChance: 0 });
chem(Mat.P, 'PHOSPHORUS', Cat.POWDER, 1.82, ['#f2ecc4', '#e4dcac', '#faf4d6', '#d4cc98'], { flam: 0.5, acidChance: 0.05 });
chem(Mat.S, 'SULFUR', Cat.POWDER, 2.07, ['#f0dc3c', '#e0ca28', '#f8e85a', '#cfb81c'], { acidChance: 0 });
chem(Mat.I, 'IODINE', Cat.POWDER, 4.93, ['#4a3a5e', '#3c2e4e', '#5a4a70', '#30243e'], { acidChance: 0 });
chem(Mat.LYE, 'LYE', Cat.LIQUID, 1.1, ['#cfd8e4', '#bcc8d6', '#dde6ee', '#aab8c8'], { disp: 4, acidChance: 0 });
chem(Mat.RUST, 'RUST', Cat.POWDER, 5.2, ['#a4482a', '#8e3c22', '#b85634', '#7a321c'], { acidChance: 0.02 });
chem(Mat.OXIDE, 'OXIDE', Cat.POWDER, 3.0, ['#f2f2ee', '#e2e2de', '#fafaf8', '#d2d2cc'], { acidChance: 0.01 });
chem(Mat.SULFIDE, 'SULFIDE', Cat.POWDER, 4.8, ['#4c4640', '#3e3934', '#5a544c', '#322d28'], { acidChance: 0.02 });
chem(Mat.IODINE_GAS, 'IODINE GAS', Cat.GAS, 0.5, ['#a04ae0', '#8c3ccc', '#b45cf0', '#7a30b8'], { life: [80, 200], acidChance: 0 });
chem(Mat.NEON_GLOW, 'NEON GLOW', Cat.GAS, 0.2, ['#ff4a2a', '#ff6a3a', '#ff8a4a', '#ff3a1a'], { life: [20, 50], acidChance: 0 });
// flames burn like FIRE (same life) and only their colour differs
const flame = (id: number, name: string, ramp: [string, string, string, string]) =>
  chem(id, name, Cat.GAS, MATS[Mat.FIRE].dens, ramp, { life: [12, 42], acidChance: 0 });
flame(Mat.FLAME_YELLOW, 'YELLOW FLAME', ['#ffc81a', '#ffdc3a', '#ffe866', '#ffb000']);
flame(Mat.FLAME_LILAC, 'LILAC FLAME', ['#b67cff', '#c896ff', '#dab4ff', '#9c5cf0']);
flame(Mat.FLAME_CRIMSON, 'CRIMSON FLAME', ['#ff1e46', '#ff3c5e', '#ff6a82', '#e00a32']);
flame(Mat.FLAME_GREEN, 'GREEN FLAME', ['#1ee6a0', '#3cf4b4', '#7affd0', '#0ac888']);
flame(Mat.FLAME_APPLE, 'APPLE FLAME', ['#a8f03a', '#bcfa5a', '#d4ff8a', '#8cd822']);
flame(Mat.FLAME_ORANGE, 'ORANGE FLAME', ['#ff6a14', '#ff8434', '#ffa25c', '#e85200']);
flame(Mat.FLAME_BLUE, 'BLUE FLAME', ['#3a6cff', '#5a88ff', '#8aacff', '#2050e8']);
flame(Mat.FLAME_WHITE, 'WHITE FLAME', ['#ffffff', '#f4f6ff', '#fffef0', '#e6ecff']);
// V2 elements. Helium is the lightest thing in the lab, gold and mercury the
// heaviest; bromine and mercury are the two liquid elements (a runny bromine,
// a thick mercury). Gold, silver and the rest resist ACID's generic eating
// like every other metal: acid reacts with them by rule, or not at all.
chem(Mat.HE, 'HELIUM', Cat.GAS, 0.05, ['#fbe9f0', '#f4dbe6', '#fff4f8', '#eacfdc'], { acidChance: 0 });
chem(Mat.B, 'BORON', Cat.POWDER, 2.34, ['#3a2c24', '#2e231c', '#4a382d', '#231a14'], { acidChance: 0 });
chem(Mat.F, 'FLUORINE', Cat.GAS, 0.9, ['#f2ee9a', '#e6e284', '#faf6b4', '#d6d270'], { acidChance: 0 });
chem(Mat.SI, 'SILICON', Cat.POWDER, 2.33, ['#7a8aa0', '#6a7a90', '#8e9eb4', '#5a6a80'], { acidChance: 0 });
chem(Mat.BR, 'BROMINE', Cat.LIQUID, 3.1, ['#7a2a1a', '#6a2214', '#8c3622', '#581a0e'], { disp: 3, acidChance: 0 });
chem(Mat.AG, 'SILVER', Cat.POWDER, 10.5, ['#e8eaee', '#d6d8de', '#f8fafc', '#c4c6ce'], { acidChance: 0 });
chem(Mat.SN, 'TIN', Cat.POWDER, 7.3, ['#9a9ca0', '#8a8c90', '#aaacb0', '#7a7c82'], { acidChance: 0 });
chem(Mat.CS, 'CAESIUM', Cat.POWDER, 1.93, ['#e8d49a', '#dcc684', '#f4e4b2', '#ccb870'], { acidChance: 0 });
chem(Mat.AU, 'GOLD', Cat.POWDER, 19.3, ['#f0c030', '#e0ae20', '#ffd54a', '#c89a14'], { acidChance: 0 });
chem(Mat.HG, 'MERCURY', Cat.LIQUID, 13.5, ['#d8dce4', '#c6cad4', '#eceff4', '#b2b8c4'], { disp: 2, acidChance: 0 });

// Nuclear. Uranium and plutonium are dense solid metal that glows (the game's
// licence: the real metals do not); a neutron that reaches one splits it into
// heat and two (plutonium: three) more neutrons - a chain reaction if there is
// enough metal close together for the neutrons to find. Boron soaks them up.
chem(Mat.U, 'URANIUM', Cat.SOLID, 19.1, ['#4a6a3a', '#3e5c30', '#5a7c46', '#334e28'], { acidChance: 0 });
chem(Mat.PU, 'PLUTONIUM', Cat.SOLID, 19.8, ['#7a6a5a', '#6c5c4c', '#8a7a68', '#5e4e40'], { acidChance: 0 });
chem(Mat.NEUTRON, 'NEUTRON', Cat.GAS, 0.0001, ['#e6fbff', '#c8f4ff', '#ffffff', '#a8ecff'], { acidChance: 0 });

// Two classroom demonstrations. ELEPHANT TOOTHPASTE: iodide splits strong
// hydrogen peroxide into water and oxygen, and the oxygen whips soapy water
// into foam - yellow from a trace of iodine. FOAM's meta is the gas still to
// come out of it (world.ts foam()); its life is the gas a fresh cell starts
// with. SILVER MIRROR: sugar turns Tollens' reagent (silver in ammonia) dark
// as silver forms, and the silver plates onto the glass it touches.
chem(Mat.PEROXIDE, 'PEROXIDE', Cat.LIQUID, 1.45, ['#d4ecf6', '#c2e0ee', '#e2f4fa', '#b0d4e6'], { disp: 4, acidChance: 0 });
chem(Mat.IODIDE, 'IODIDE', Cat.POWDER, 3.1, ['#f2efe2', '#e2ddca', '#faf8ee', '#d4cdb4'], { acidChance: 0 });
chem(Mat.FOAM, 'FOAM', Cat.POWDER, 0.3, ['#f6e3a0', '#eed283', '#fcf0c6', '#e4c36c'], { life: [4, 7], acidChance: 0.02 });
chem(Mat.TOLLENS, 'TOLLENS', Cat.LIQUID, 1.05, ['#dfe4ea', '#d0d6de', '#eceff3', '#c2c9d2'], { disp: 4, acidChance: 0 });
chem(Mat.GLUCOSE, 'GLUCOSE', Cat.POWDER, 1.54, ['#fbfaf4', '#eeece2', '#ffffff', '#e0ddd0'], { flam: 0.05, acidChance: 0.02 });
chem(Mat.SILVER_SOL, 'SILVERING', Cat.LIQUID, 1.08, ['#7a7066', '#6a6058', '#8a8076', '#5c534b'], { disp: 4, acidChance: 0 });
chem(Mat.MIRROR, 'MIRROR', Cat.SOLID, 100, ['#8d96a2', '#6c7480', '#e6ebf0', '#59606b'], { acidChance: 0 });

/** The coloured flames: each burns exactly like FIRE. */
export const FLAMES = new Set<number>([
  Mat.FLAME_YELLOW, Mat.FLAME_LILAC, Mat.FLAME_CRIMSON, Mat.FLAME_GREEN,
  Mat.FLAME_APPLE, Mat.FLAME_ORANGE, Mat.FLAME_BLUE, Mat.FLAME_WHITE,
]);

/** Materials that live: grouped together in the palette, drawn unlit. */
export const LIFE_MATS = new Set<number>([Mat.SEED, Mat.PLANT, Mat.ANT, Mat.BIRD]);

/**
 * FLORA meta: a static part (1..7, or a petal 8..23) or a growing bud
 * (0x80 | height left). A petal's meta encodes its hue and tone, so a
 * whole flower is one colour (with lighter tips) without any per-flower
 * bookkeeping.
 */
export const Flora = {
  STEM: 1,
  LEAF: 2,
  CENTER: 3,
  CENTER_DARK: 4,
  LEAF_DARK: 5,
  PETAL: 8, // 8 + hue * 2 + tone
  HUES: 8,
  BUD: 0x80,
} as const;

/** meta for a petal of hue h (0..HUES-1); tone 1 is the lighter tip */
export function petal(h: number, tone: 0 | 1): number {
  return Flora.PETAL + h * 2 + tone;
}

const hex = (s: string) => u32(s);
/** four close variations of a colour, so a petal reads as one hue with grain */
function ramp4(base: string, d = 0.1): number[] {
  const c = hex(base);
  return [c, darken(c, d), lighten(c, d), c];
}
/** pink, white, violet, red, yellow, orange, sky, magenta */
const PETAL_BASE = ['#f27aae', '#f5efe2', '#a685ea', '#e8473c', '#ffd23f', '#ff8a2b', '#6cc4f2', '#d94fc0'];
/** ABGR colours per FLORA part; index by meta for static parts */
const FLORA_COLS: number[][] = [];
FLORA_COLS[Flora.STEM] = [hex('#3c8a37'), hex('#337a30'), hex('#46993f'), hex('#2c6c2a')];
FLORA_COLS[Flora.LEAF] = [hex('#6cc24a'), hex('#5bb03e'), hex('#80d35a'), hex('#62b843')];
FLORA_COLS[Flora.LEAF_DARK] = [hex('#3f8e34'), hex('#367e2d'), hex('#4a9b3c'), hex('#3a8530')];
FLORA_COLS[Flora.CENTER] = [hex('#ffd54a'), hex('#f2b632'), hex('#ffe27a'), hex('#e8a628')];
FLORA_COLS[Flora.CENTER_DARK] = [hex('#6b3e1e'), hex('#5a3218'), hex('#7d4a24'), hex('#4f2b14')];
PETAL_BASE.forEach((b, h) => {
  FLORA_COLS[petal(h, 0)] = ramp4(b, 0.08);
  FLORA_COLS[petal(h, 1)] = ramp4(b, 0.08).map((c) => lighten(c, 0.38));
});
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
// mud is too heavy and sticky to blow around
WIND_SUSC[Mat.MUD] = 0;

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

/**
 * Textures for things that never move, drawn from position. Each returns a
 * ramp index; by convention ramp[2] is the material's darkest tone (mortar,
 * seams, cracks) and ramp[3] or ramp[2] its lightest where noted.
 */
function brick(x: number, y: number): number {
  const course = y >> 2;
  const sx = x + (course & 1) * 4; // half-brick offset on alternate courses
  if ((y & 3) === 3 || (sx & 7) === 7) return 2; // mortar
  const face = cellHash(sx >> 3, course) % 3; // each brick its own shade
  const speck = (cellHash(x, y) & 15) === 0;
  return speck ? 3 : face === 0 ? 0 : face === 1 ? 1 : 3;
}

function woodGrain(x: number, y: number): number {
  const board = y >> 2;
  if ((y & 3) === 3) return 2; // seam between boards
  const h = cellHash(board, 7);
  if ((cellHash(x >> 1, board) & 127) === 0) return 2; // a knot
  const streak = (x + (h & 31) + (y & 3) * 3) % 9;
  if (streak < 2) return 0; // grain line
  return (h & 1) === 0 ? 1 : 3; // alternate boards light and lighter
}

function cobble(x: number, y: number): number {
  const row = y >> 2;
  const sx = x + (row & 1) * 2;
  const bx = sx >> 2;
  const vEdge = (sx & 3) === 3 && (cellHash(bx, row) & 3) !== 0; // some stones merge
  const hEdge = (y & 3) === 3 && (cellHash(bx, row + 99) & 3) !== 0;
  if (vEdge || hEdge) return 2;
  const face = cellHash(bx, row) % 3;
  return face === 0 ? 0 : face === 1 ? 1 : 3;
}

function glassShine(x: number, y: number): number {
  const d = (x + y) % 23;
  if (d === 0 || d === 1 || d === 4) return 2; // two diagonal glints
  return (cellHash(x, y) & 31) === 0 ? 1 : 0;
}

function iceCracks(x: number, y: number): number {
  // ice's light tone is ramp[2]: bright fracture lines on a calm body
  if ((x * 2 - y + 400) % 29 === 0 || (x + y * 3) % 41 === 0) return 2;
  return (cellHash(x, y) & 31) === 0 ? 1 : 0;
}

export function rampIndexAt(mat: number, x: number, y: number, frame: number, meta: number): number {
  const v = cellHash(x, y);
  switch (mat) {
    case Mat.WALL:
      return brick(x, y);
    case Mat.WOOD:
      return woodGrain(x, y);
    case Mat.STONE:
      return cobble(x, y);
    case Mat.GLASS:
      return glassShine(x, y);
    case Mat.ICE:
      return iceCracks(x, y);
    case Mat.FIRE:
    case Mat.FLAME_YELLOW:
    case Mat.FLAME_LILAC:
    case Mat.FLAME_CRIMSON:
    case Mat.FLAME_GREEN:
    case Mat.FLAME_APPLE:
    case Mat.FLAME_ORANGE:
    case Mat.FLAME_BLUE:
    case Mat.FLAME_WHITE:
    case Mat.NEON_GLOW:
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
    case Mat.TURBINE:
      // spinning: the light band sweeps round; still: plain metal
      return meta > 0 ? (((x + y + (frame >> 1)) & 3) === 0 ? 2 : v & 1) : v & 1 ? 0 : 3;
    case Mat.BIRD:
      // wing beat: alternates light and shadow, out of step bird to bird
      return ((frame >> 2) + x) & 1 ? 2 : 1;
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
// creatures are single cells: a bevel would just darken them into the dark
LIT[Mat.ANT] = Lit.NONE;
LIT[Mat.BIRD] = Lit.NONE;

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
 * A frame pixel's alpha byte says which material the cell is: alpha = the
 * material id for every cell drawn from it, and 255 for everything that is
 * not a cell (the background, wind specks, flying debris, the playground's
 * particles; 253 is the playground's wall tag). The GL composite reads it
 * with texelFetch to shade, light and shadow each cell by what it is; the 2D
 * fallback forces alpha back to 255 before drawing. Ids stay below 128
 * (NMATS), so they never collide with 253 or 255.
 */
export function withMat(c: number, m: number): number {
  return ((c & 0x00ffffff) | (m << 24)) >>> 0;
}

for (let m = 0; m < NMATS; m++) {
  if (!MATS[m]) continue;
  for (let r = 0; r < 4; r++)
    for (let v = 0; v < 8; v++) SHADED[(((m << 2) | r) << 3) | v] = withMat(applyShade(MATS[m].ramp[r], v), m);
}
