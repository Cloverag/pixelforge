import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { MATS, Mat, NMATS } from '../src/sim/materials';
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
    for (let m: number = Mat.H; m <= Mat.I; m++) {
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

  it('keeps the chem materials out of the sandbox rail', () => {
    const ids = materialSections(null).flatMap((s) => ('swatches' in s ? s.swatches.map((w) => Number(w.id)) : []));
    expect(ids.filter((m) => m >= 0 && CHEM[m])).toEqual([]);
    expect(ids).toContain(Mat.SAND);
  });
});
