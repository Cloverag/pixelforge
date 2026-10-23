import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { FLAMES, MATS, Mat, NMATS } from '../src/sim/materials';
import { CHEM, COMPILED, KEEP, RULES, RX } from '../src/sim/reactions';
import { materialSections } from '../src/ui/hud';

/**
 * The CHEM LAB's reaction table. Every rule must actually fire when its
 * pair touches (and its condition holds), the conditional ones must not
 * fire without their condition, and a world full of reactions must still
 * be deterministic - it runs in lockstep in a room.
 */

const X0 = 100, Y0 = 100, S = 40;

/** A walled box, its inside a checkerboard of a and b so every a touches a b. */
function bench(seed: number, a: number, b: number, opts: { heat?: boolean; with?: number } = {}): World {
  const w = new World(seed);
  const g = w.grid;
  const put = (x: number, y: number, m: number) => {
    const life = MATS[m].life;
    g.setXY(x, y, m, life ? life[1] : 0);
  };
  for (let i = 0; i < S; i++) {
    put(X0 + i, Y0, Mat.WALL);
    put(X0 + i, Y0 + S - 1, Mat.WALL);
    put(X0, Y0 + i, Mat.WALL);
    put(X0 + S - 1, Y0 + i, Mat.WALL);
  }
  for (let y = Y0 + 1; y < Y0 + S - 1; y++)
    for (let x = X0 + 1; x < X0 + S - 1; x++) {
      if (opts.heat && y === Y0 + S - 2) put(x, y, Mat.TORCH);
      else if (opts.with !== undefined && (x + y) % 5 === 0) put(x, y, opts.with);
      else put(x, y, (x + y) & 1 ? a : b);
    }
  return w;
}

function run(w: World, n: number): void {
  for (let i = 0; i < n; i++) w.step();
}

/** The V2 elements: appended after the flames, so outside the H..NEON_GLOW range. */
const V2 = [Mat.HE, Mat.B, Mat.F, Mat.SI, Mat.BR, Mat.AG, Mat.SN, Mat.CS, Mat.AU, Mat.HG];

const needsOf = (ri: number) => {
  const n = RULES[ri].needs;
  return { heat: n === 'heat', with: typeof n === 'number' ? n : undefined };
};

describe('chem lab reactions', { timeout: 120_000 }, () => {
  it('every rule fires when its pair touches', () => {
    const silent: string[] = [];
    RULES.forEach((rule, ri) => {
      const w = bench(11 + ri, rule.a, rule.b, needsOf(ri));
      run(w, 600);
      if (w.rxFired[ri] === 0) silent.push(`${MATS[rule.a].name} + ${MATS[rule.b].name}`);
    });
    expect(silent).toEqual([]);
  });

  it('a rule that needs heat or a helper does not fire without it', () => {
    const fired: string[] = [];
    RULES.forEach((rule, ri) => {
      if (rule.needs === undefined) return;
      const w = bench(11 + ri, rule.a, rule.b);
      run(w, 600);
      if (w.rxFired[ri] > 0) fired.push(`${MATS[rule.a].name} + ${MATS[rule.b].name}`);
    });
    expect(fired).toEqual([]);
  });

  it('an element alone in a box reacts with nothing', () => {
    // none of the V2 elements react with the box: only phosphorus does, with the air
    const elements = [...Array.from({ length: Mat.I - Mat.H + 1 }, (_, i) => Mat.H + i), ...V2];
    for (const m of elements) {
      if (m === Mat.P) continue; // phosphorus reacts with the air itself
      const w = bench(5, m, Mat.EMPTY);
      run(w, 300);
      expect([MATS[m].name, w.rxFired.reduce((s, n) => s + n, 0)]).toEqual([MATS[m].name, 0]);
    }
  });

  it('a rule turns its pair into its products', () => {
    // sodium in water: hydrogen and lye appear, sodium is used up
    const w = bench(3, Mat.NA, Mat.WATER);
    const na0 = w.grid.counts[Mat.NA];
    run(w, 600);
    expect(w.grid.counts[Mat.NA]).toBeLessThan(na0);
    expect(w.grid.counts[Mat.LYE]).toBeGreaterThan(0);
    // thermite: aluminium and rust with heat make molten iron
    const t = bench(3, Mat.AL, Mat.RUST, { heat: true });
    run(t, 600);
    expect(t.grid.counts[Mat.LAVA]).toBeGreaterThan(0);
  });

  it('silicon burns into glass only with oxygen and heat', () => {
    // the generic test only visits rules that declare a condition, so it cannot
    // notice a rule that has lost one: pin this one by its outcome
    const rule = RULES.findIndex((q) => q.a === Mat.SI && q.b === Mat.O);
    const cold = bench(3, Mat.SI, Mat.O);
    run(cold, 600);
    expect([cold.rxFired[rule], cold.grid.counts[Mat.GLASS]]).toEqual([0, 0]);
    const hot = bench(3, Mat.SI, Mat.O, { heat: true });
    const si0 = hot.grid.counts[Mat.SI];
    run(hot, 600);
    expect(hot.grid.counts[Mat.GLASS]).toBeGreaterThan(0);
    expect(hot.grid.counts[Mat.SI]).toBeLessThan(si0);
  });

  it('mercury turns sulfur into cinnabar', () => {
    const w = bench(4, Mat.HG, Mat.S);
    const s0 = w.grid.counts[Mat.S];
    run(w, 600);
    expect(w.grid.counts[Mat.SULFIDE]).toBeGreaterThan(0);
    expect(w.grid.counts[Mat.S]).toBeLessThan(s0);
  });

  it('a flame test keeps the metal and colours the fire', () => {
    const w = bench(9, Mat.CU, Mat.FIRE);
    const cu0 = w.grid.counts[Mat.CU];
    let green = 0;
    for (let i = 0; i < 60; i++) {
      w.step();
      green = Math.max(green, w.grid.counts[Mat.FLAME_GREEN]);
    }
    expect(green).toBeGreaterThan(0);
    expect(w.grid.counts[Mat.CU]).toBe(cu0);
  });

  it('boron and caesium flame tests keep the metal and tint the fire', () => {
    for (const [m, flame] of [[Mat.B, Mat.FLAME_GREEN], [Mat.CS, Mat.FLAME_BLUE]] as const) {
      const w = bench(9, m, Mat.FIRE);
      const n0 = w.grid.counts[m];
      let tint = 0;
      for (let i = 0; i < 60; i++) {
        w.step();
        tint = Math.max(tint, w.grid.counts[flame]);
      }
      expect([MATS[m].name, tint > 0]).toEqual([MATS[m].name, true]);
      expect([MATS[m].name, w.grid.counts[m]]).toEqual([MATS[m].name, n0]);
    }
  });

  it('caesium in water explodes, where lithium only fizzes', () => {
    const run = (m: number) => {
      const w = bench(6, m, Mat.WATER);
      let booms = 0;
      for (let i = 0; i < 300; i++) {
        w.step();
        const e = w.takeEvents();
        for (let k = 2; k < e.booms.length; k += 3) if (e.booms[k] === 4) booms++;
      }
      return { w, booms };
    };
    const cs = run(Mat.CS);
    expect(cs.booms).toBeGreaterThan(0);
    expect(cs.w.grid.counts[Mat.H]).toBeGreaterThan(0);
    expect(cs.w.grid.counts[Mat.LYE]).toBeGreaterThan(0);
    expect(run(Mat.LI).booms).toBe(0);
  });

  it('two chem worlds fed the same start stay identical', () => {
    const mk = () => {
      const w = bench(21, Mat.H, Mat.O, { heat: true });
      // and a sodium-in-water corner, for the fizz and the flames
      for (let y = 20; y < 40; y++) for (let x = 20; x < 40; x++) w.grid.setXY(x, y, (x + y) & 1 ? Mat.NA : Mat.WATER);
      return w;
    };
    const a = mk(), b = mk();
    const ha: number[] = [], hb: number[] = [];
    for (let f = 0; f < 600; f++) {
      a.step();
      b.step();
      if (f % 50 === 49) {
        ha.push(a.hash());
        hb.push(b.hash());
      }
    }
    expect(hb).toEqual(ha);
    expect(a.rxFired.reduce((s, n) => s + n, 0)).toBeGreaterThan(0);
  });

  it('a world does not depend on how often its events are read', () => {
    // the worker takes events once per message, and a guest catching up
    // steps many frames per message: a bang capped on the event count must
    // not change anything the simulation keeps (the wind)
    const a = bench(31, Mat.H, Mat.O, { heat: true });
    const b = bench(31, Mat.H, Mat.O, { heat: true });
    for (let f = 0; f < 300; f++) {
      a.step();
      a.takeEvents();
      b.step();
    }
    expect(b.hash()).toBe(a.hash());
  });

  it('compiles: side A is chem, products are real materials, and FIRE rules cover every flame', () => {
    for (const c of COMPILED) {
      for (const out of [c.outA, c.outB]) if (out !== KEEP) expect(MATS[out]).toBeDefined();
    }
    for (let a = 0; a < NMATS; a++)
      for (let b = 0; b < NMATS; b++) if (RX[a * NMATS + b] >= 0) expect(CHEM[a]).toBe(1);
    // copper's flame test works in a coloured flame too, as the same rule
    const cuFire = COMPILED[RX[Mat.CU * NMATS + Mat.FIRE]];
    const cuYellow = COMPILED[RX[Mat.CU * NMATS + Mat.FLAME_YELLOW]];
    expect(cuYellow?.rule).toBe(cuFire.rule);
  });

  it('marks the V2 elements as chem and keeps the flames out of it', () => {
    for (const m of V2) expect([MATS[m].name, CHEM[m]]).toEqual([MATS[m].name, 1]);
    // flames run fire(), not the reaction table
    for (const m of FLAMES) expect([MATS[m].name, CHEM[m]]).toEqual([MATS[m].name, 0]);
    // appended, never renumbered: the ids a room snapshot already holds
    expect([Mat.FLAME_WHITE, Mat.HE, Mat.HG]).toEqual([65, 66, 75]);
    expect(NMATS).toBe(76);
  });

  it('keeps the chem materials out of the sandbox rail', () => {
    const ids = materialSections(null).flatMap((s) => ('swatches' in s ? s.swatches.map((w) => Number(w.id)) : []));
    expect(ids.filter((m) => m >= 0 && CHEM[m])).toEqual([]);
    expect(ids).toContain(Mat.SAND);
  });
});
