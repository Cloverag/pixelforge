import { FLAMES, Mat, MATS, NMATS } from './materials';

/**
 * The CHEM LAB's chemistry, as data: when cell A touches cell B, they may
 * turn into something else. One flat list, read top to bottom - the shape
 * falling-sand games settle on (a pair, two products, a chance per tick),
 * written for this game. Real reactions, simplified to what reads on screen:
 * which pairs react, roughly how fast, and how violently.
 *
 * Everything here runs inside the shared simulation, so it must stay
 * deterministic: chances are rolled on the world's RNG and nothing reads the
 * clock. Every rule has a CHEM material on side A - the engine (World.chem)
 * runs on those cells only, so the older materials need no changes to react.
 */

/** keep this side as it is */
export const KEEP = -1;

export type Fx = 'fizz' | 'boom' | 'flash' | 'ignite';

export interface Rule {
  a: number;
  b: number;
  /** what A and B become (KEEP leaves one alone) */
  outA: number;
  outB: number;
  /** chance per tick while they touch */
  p: number;
  /** only near heat (fire, a flame, lava, embers, a torch) or near this material */
  needs?: 'heat' | number;
  fx?: Fx;
  /** a flame of this colour licks up from the spot */
  spark?: number;
  /** what the rule is, for the periodic table's "reacts with" card */
  note: string;
}

const M = Mat;
const r = (a: number, b: number, outA: number, outB: number, p: number, note: string, more: Partial<Rule> = {}): Rule => ({
  a, b, outA, outB, p, note, ...more,
});

export const RULES: Rule[] = [
  // ---- alkali and alkaline-earth metals in water: hydrogen and lye ----
  r(M.LI, M.WATER, M.H, M.LYE, 0.01, 'fizzes slowly in water', { fx: 'fizz' }),
  r(M.NA, M.WATER, M.H, M.LYE, 0.04, 'fizzes in water, sometimes catches fire', { fx: 'fizz', spark: M.FLAME_YELLOW }),
  r(M.K, M.WATER, M.H, M.LYE, 0.15, 'bursts into lilac flame in water', { fx: 'fizz', spark: M.FLAME_LILAC }),
  r(M.CA, M.WATER, M.H, M.LYE, 0.008, 'bubbles in water', { fx: 'fizz' }),
  r(M.SR, M.WATER, M.H, M.LYE, 0.006, 'bubbles in water', { fx: 'fizz' }),
  r(M.BA, M.WATER, M.H, M.LYE, 0.01, 'bubbles in water', { fx: 'fizz' }),
  // the heaviest alkali metal: a boom, not a fizz
  r(M.CS, M.WATER, M.H, M.LYE, 0.5, 'explodes in water', { fx: 'boom', spark: M.FLAME_BLUE }),
  // ---- metals in acid: hydrogen ----
  r(M.MG, M.ACID, M.H, M.WATER, 0.05, 'dissolves in acid, giving off hydrogen', { fx: 'fizz' }),
  r(M.ZN, M.ACID, M.H, M.WATER, 0.03, 'dissolves in acid, giving off hydrogen', { fx: 'fizz' }),
  r(M.AL, M.ACID, M.H, M.WATER, 0.02, 'dissolves in acid, giving off hydrogen', { fx: 'fizz' }),
  r(M.FE, M.ACID, M.H, M.WATER, 0.01, 'slowly dissolves in acid', { fx: 'fizz' }),
  r(M.CA, M.ACID, M.H, M.WATER, 0.05, 'dissolves in acid, giving off hydrogen', { fx: 'fizz' }),
  r(M.SN, M.ACID, M.H, M.WATER, 0.008, 'slowly dissolves in acid', { fx: 'fizz' }),
  // silver and gold have no acid rule on purpose: nothing in the lab dissolves them
  // ---- acid meets base ----
  r(M.LYE, M.ACID, M.SALT, M.WATER, 0.3, 'neutralises acid into salt water', { fx: 'fizz' }),
  // ---- halogens ----
  r(M.NA, M.CL, M.SALT, M.EMPTY, 0.15, 'burns in chlorine into table salt', { fx: 'flash', spark: M.FLAME_YELLOW }),
  r(M.K, M.CL, M.SALT, M.EMPTY, 0.25, 'burns in chlorine into salt', { fx: 'flash', spark: M.FLAME_LILAC }),
  r(M.H, M.CL, M.ACID, M.EMPTY, 0.5, 'explodes with chlorine near heat, making acid', { needs: 'heat', fx: 'boom' }),
  r(M.CL, M.PLANT, KEEP, M.ASH, 0.05, 'bleaches plants to ash'),
  r(M.CL, M.FLORA, KEEP, M.ASH, 0.05, 'bleaches flowers to ash'),
  r(M.AL, M.I, M.OXIDE, M.IODINE_GAS, 0.1, 'smokes violet with iodine once wet', { needs: M.WATER, fx: 'ignite' }),
  // fluorine needs no heat and no help: the most violent thing in the lab
  r(M.F, M.H, M.ACID, M.EMPTY, 0.6, 'explodes with hydrogen, even cold', { fx: 'boom' }),
  r(M.F, M.WATER, M.O, M.ACID, 0.2, 'splits water into oxygen and acid', { fx: 'fizz' }),
  r(M.F, M.GLASS, M.EMPTY, M.EMPTY, 0.05, 'etches glass away'),
  r(M.F, M.NA, M.SALT, M.EMPTY, 0.3, 'burns sodium into salt', { fx: 'flash', spark: M.FLAME_YELLOW }),
  r(M.F, M.WOOD, M.EMPTY, M.FIRE, 0.2, 'sets wood alight', { fx: 'ignite' }),
  r(M.F, M.PLANT, KEEP, M.ASH, 0.1, 'withers plants to ash'),
  r(M.F, M.FLORA, KEEP, M.ASH, 0.1, 'withers flowers to ash'),
  // bromine, the liquid halogen: slower than chlorine on plants, hard on metals
  r(M.AL, M.BR, M.SALT, M.EMPTY, 0.3, 'aluminium sparks in bromine', { fx: 'flash' }),
  r(M.K, M.BR, M.SALT, M.EMPTY, 0.2, 'burns in bromine into salt', { fx: 'flash', spark: M.FLAME_LILAC }),
  r(M.NA, M.BR, M.SALT, M.EMPTY, 0.05, 'slowly turns to salt in bromine'),
  r(M.BR, M.PLANT, KEEP, M.ASH, 0.03, 'bleaches plants'),
  r(M.BR, M.FLORA, KEEP, M.ASH, 0.03, 'bleaches flowers'),
  // ---- fire and oxygen ----
  r(M.H, M.O, M.STEAM, M.STEAM, 0.7, 'explodes with oxygen near heat, making water', { needs: 'heat', fx: 'boom' }),
  r(M.C, M.O, M.FIRE, M.SMOKE, 0.3, 'burns hot in oxygen', { needs: 'heat', fx: 'ignite' }),
  r(M.P, M.O, M.FIRE, M.SMOKE, 0.05, 'bursts into flame in oxygen', { fx: 'ignite' }),
  r(M.P, M.EMPTY, M.FIRE, KEEP, 0.0015, 'catches fire on its own in open air', { fx: 'ignite' }),
  // the burning metal becomes the flame, so the front carries along a ribbon
  r(M.MG, M.FIRE, M.FLAME_WHITE, KEEP, 0.25, 'burns with a blinding white flash', { fx: 'flash' }),
  r(M.S, M.FIRE, M.FLAME_BLUE, M.FLAME_BLUE, 0.1, 'burns with a blue flame', { fx: 'ignite' }),
  r(M.N, M.FIRE, KEEP, M.EMPTY, 0.6, 'smothers fire'),
  r(M.FE, M.O, M.RUST, M.EMPTY, 0.0008, 'rusts in oxygen'),
  r(M.FE, M.WATER, M.RUST, KEEP, 0.0003, 'rusts in water, slowly'),
  // ---- heat-started reactions between solids ----
  // both products molten (iron and slag): lava is lighter than the powders,
  // so it stays on top and heats the next layer down - a solid oxide crust
  // sank under it and smothered the burn after one layer
  r(M.AL, M.RUST, M.LAVA, M.LAVA, 0.25, 'thermite: with heat, melts rust into molten iron', { needs: 'heat', fx: 'flash' }),
  r(M.FE, M.S, M.SULFIDE, M.EMPTY, 0.2, 'glows into iron sulfide when heated', { needs: 'heat', fx: 'ignite' }),
  r(M.ZN, M.S, M.SULFIDE, M.FLAME_GREEN, 0.4, 'flashes into zinc sulfide when heated', { needs: 'heat', fx: 'flash' }),
  r(M.SI, M.O, M.GLASS, M.EMPTY, 0.2, 'burns into glass', { needs: 'heat' }),
  // slow, cold chemistry: tarnish, and the spill clean-up trick
  r(M.AG, M.S, M.SULFIDE, KEEP, 0.002, 'tarnishes black with sulfur'),
  r(M.HG, M.S, M.SULFIDE, M.EMPTY, 0.02, 'turns sulfur into cinnabar'),
  r(M.AL, M.HG, M.OXIDE, KEEP, 0.02, 'amalgam: aluminium crumbles to white oxide'),
  r(M.I, M.FIRE, M.IODINE_GAS, KEEP, 0.2, 'turns straight to violet vapour in a flame'),
  r(M.I, M.LAVA, M.IODINE_GAS, KEEP, 0.3, 'turns straight to violet vapour on lava'),
  // ---- the bench's demonstrations ----
  // elephant toothpaste: the iodide is a catalyst, it is never used up
  r(M.PEROXIDE, M.IODIDE, M.FOAM, KEEP, 0.6, 'iodide splits it into oxygen: a rush of foam', { fx: 'fizz' }),
  // the iodide dissolves into the mix, so the foam carries it on through the peroxide
  r(M.PEROXIDE, M.FOAM, M.FOAM, KEEP, 0.04, 'the iodide carried in the foam keeps splitting it'),
  r(M.PEROXIDE, M.RUST, M.FOAM, KEEP, 0.02, 'rust splits it slowly into foam', { fx: 'fizz' }),
  // silver mirror: the sugar dissolves, the darkening spreads, silver plates out
  r(M.GLUCOSE, M.TOLLENS, M.SILVER_SOL, M.SILVER_SOL, 0.2, "turns Tollens' reagent dark as silver forms"),
  r(M.SILVER_SOL, M.TOLLENS, KEEP, M.SILVER_SOL, 0.12, 'the darkening spreads through the solution'),
  r(M.SILVER_SOL, M.GLASS, M.WATER, M.MIRROR, 0.08, 'silver plates onto glass: a mirror'),
  r(M.SILVER_SOL, M.MIRROR, M.WATER, KEEP, 0.01, 'more silver plates onto the mirror'),
  r(M.SILVER_SOL, M.WATER, M.WATER, KEEP, 0.04, 'clears as the silver settles out'),
  // ---- light ----
  r(M.NE, M.TORCH, M.NEON_GLOW, KEEP, 0.5, 'glows red-orange beside a torch'),
  r(M.NE, M.NEON_GLOW, M.NEON_GLOW, KEEP, 0.25, 'passes the glow along'),
  // ---- flame tests: the metal stays, the fire takes its colour ----
  r(M.NA, M.FIRE, KEEP, M.FLAME_YELLOW, 0.4, 'flame test: yellow'),
  r(M.K, M.FIRE, KEEP, M.FLAME_LILAC, 0.4, 'flame test: lilac'),
  r(M.LI, M.FIRE, KEEP, M.FLAME_CRIMSON, 0.4, 'flame test: crimson'),
  r(M.SR, M.FIRE, KEEP, M.FLAME_CRIMSON, 0.4, 'flame test: crimson'),
  r(M.CU, M.FIRE, KEEP, M.FLAME_GREEN, 0.4, 'flame test: blue-green'),
  r(M.BA, M.FIRE, KEEP, M.FLAME_APPLE, 0.4, 'flame test: apple green'),
  r(M.CA, M.FIRE, KEEP, M.FLAME_ORANGE, 0.4, 'flame test: orange-red'),
  r(M.B, M.FIRE, KEEP, M.FLAME_GREEN, 0.4, 'flame test: bright green'),
  r(M.CS, M.FIRE, KEEP, M.FLAME_BLUE, 0.4, 'flame test: blue-violet'),
  // ...and over a torch, a steady burner: the grain gives off its own flame
  r(M.NA, M.TORCH, KEEP, KEEP, 0.12, 'over a torch: a yellow flame', { spark: M.FLAME_YELLOW }),
  r(M.K, M.TORCH, KEEP, KEEP, 0.12, 'over a torch: a lilac flame', { spark: M.FLAME_LILAC }),
  r(M.LI, M.TORCH, KEEP, KEEP, 0.12, 'over a torch: a crimson flame', { spark: M.FLAME_CRIMSON }),
  r(M.SR, M.TORCH, KEEP, KEEP, 0.12, 'over a torch: a crimson flame', { spark: M.FLAME_CRIMSON }),
  r(M.CU, M.TORCH, KEEP, KEEP, 0.12, 'over a torch: a blue-green flame', { spark: M.FLAME_GREEN }),
  r(M.BA, M.TORCH, KEEP, KEEP, 0.12, 'over a torch: an apple-green flame', { spark: M.FLAME_APPLE }),
  r(M.CA, M.TORCH, KEEP, KEEP, 0.12, 'over a torch: an orange-red flame', { spark: M.FLAME_ORANGE }),
  r(M.B, M.TORCH, KEEP, KEEP, 0.12, 'over a torch: a bright green flame', { spark: M.FLAME_GREEN }),
  r(M.CS, M.TORCH, KEEP, KEEP, 0.12, 'over a torch: a blue-violet flame', { spark: M.FLAME_BLUE }),
];

/** Materials the engine runs: every element and product. */
export const CHEM = new Uint8Array(NMATS);
for (let m = Mat.H; m <= Mat.NEON_GLOW; m++) CHEM[m] = 1;
// the flames (58-65) sit between the two blocks and stay out: they run fire().
// The V2 elements come after them, so they are marked by name, not by range.
for (const m of [Mat.HE, Mat.B, Mat.F, Mat.SI, Mat.BR, Mat.AG, Mat.SN, Mat.CS, Mat.AU, Mat.HG]) CHEM[m] = 1;
// nuclear: chem lab materials too, though they move by their own code (world.ts fissile/neutron), not the table
for (const m of [Mat.U, Mat.PU, Mat.NEUTRON]) CHEM[m] = 1;
// the demonstrations' compounds; FOAM and MIRROR also run their own code (world.ts foam, mirror)
for (const m of [Mat.PEROXIDE, Mat.IODIDE, Mat.FOAM, Mat.TOLLENS, Mat.GLUCOSE, Mat.SILVER_SOL, Mat.MIRROR]) CHEM[m] = 1;

/** What sets off a 'heat' rule. */
export const HOT = new Uint8Array(NMATS);
for (const m of [Mat.FIRE, Mat.EMBER, Mat.LAVA, Mat.TORCH, ...FLAMES]) HOT[m] = 1;

/** Life gases settle back into: iodine vapour deposits crystals, neon stops glowing. */
export const DECAY = new Int16Array(NMATS).fill(Mat.EMPTY);
DECAY[Mat.IODINE_GAS] = Mat.I;
DECAY[Mat.NEON_GLOW] = Mat.NE;

export interface Compiled {
  /** index into RULES */
  rule: number;
  outA: number;
  outB: number;
  p: number;
  needs: number; // -1 none, -2 heat, else a material
  fx: Fx | null;
  spark: number; // -1 none
}

/**
 * The rules from each side. RX[a * NMATS + b] is an index into COMPILED, or
 * -1. A rule against FIRE also fires against every coloured flame (they
 * burn the same). A rule between two chem materials is entered from both
 * sides, products swapped, so whichever cell ticks can start it.
 */
export const RX = new Int16Array(NMATS * NMATS).fill(-1);
export const COMPILED: Compiled[] = [];

function enter(a: number, b: number, ri: number, swap: boolean): void {
  const rule = RULES[ri];
  const k = a * NMATS + b;
  if (RX[k] >= 0) {
    if (swap) return; // the pair already has its own rule from this side
    throw new Error(`two rules for ${MATS[a].name} + ${MATS[b].name}`);
  }
  RX[k] = COMPILED.length;
  COMPILED.push({
    rule: ri,
    outA: swap ? rule.outB : rule.outA,
    outB: swap ? rule.outA : rule.outB,
    p: rule.p,
    needs: rule.needs === undefined ? -1 : rule.needs === 'heat' ? -2 : rule.needs,
    fx: rule.fx ?? null,
    spark: rule.spark ?? -1,
  });
}

RULES.forEach((rule, ri) => {
  if (!CHEM[rule.a]) throw new Error(`rule side A must be a chem material: ${MATS[rule.a].name}`);
  const bs = rule.b === Mat.FIRE ? [Mat.FIRE, ...FLAMES] : [rule.b];
  for (const b of bs) enter(rule.a, b, ri, false);
});
// second pass, so a pair's own rule always wins over the mirrored one
RULES.forEach((rule, ri) => {
  if (CHEM[rule.b]) enter(rule.b, rule.a, ri, true);
});

/** For the periodic table's card: what this element does, one line per rule. */
export function rulesFor(m: number): Rule[] {
  return RULES.filter((q) => q.a === m || q.b === m);
}
