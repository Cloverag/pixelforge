import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { Mat } from '../src/sim/materials';
import { CHEM_SCENES } from '../src/sim/chemscenes';

/**
 * The CHEM LAB's ready-made experiments must do what their buttons say,
 * and arrive as a room input: only in the chem lab, the same for everyone.
 */

function scene(id: string, seed = 5): World {
  const w = new World(seed);
  w.applyInput({ k: 'mode', m: 'chem' });
  w.applyInput({ k: 'chemScene', id });
  return w;
}

/** Step, remembering the most of each material seen at any one frame. */
function watch(w: World, frames: number, mats: number[]): Map<number, number> {
  const peak = new Map(mats.map((m) => [m, 0]));
  for (let f = 0; f < frames; f++) {
    w.step();
    for (const m of mats) peak.set(m, Math.max(peak.get(m)!, w.grid.counts[m]));
  }
  return peak;
}

describe('chem lab experiments', { timeout: 120_000 }, () => {
  it('ALKALI BATH: all three metals fizz into hydrogen and lye', () => {
    const w = scene('alkali');
    const before = [Mat.LI, Mat.NA, Mat.K].map((m) => w.grid.counts[m]);
    const peak = watch(w, 600, [Mat.H, Mat.LYE]);
    expect(peak.get(Mat.H)).toBeGreaterThan(0);
    expect(peak.get(Mat.LYE)).toBeGreaterThan(0);
    [Mat.LI, Mat.NA, Mat.K].forEach((m, k) => expect(w.grid.counts[m]).toBeLessThan(before[k]));
  });

  it('THERMITE: the magnesium fuse burns into the crucible and makes molten iron', () => {
    const w = scene('thermite');
    const peak = watch(w, 600, [Mat.FLAME_WHITE, Mat.LAVA]);
    expect(peak.get(Mat.FLAME_WHITE)).toBeGreaterThan(0);
    expect(peak.get(Mat.LAVA)).toBeGreaterThan(0);
  });

  it('FLAME TESTS: every metal colours a flame', () => {
    const flames = [Mat.FLAME_CRIMSON, Mat.FLAME_YELLOW, Mat.FLAME_LILAC, Mat.FLAME_ORANGE, Mat.FLAME_APPLE, Mat.FLAME_GREEN];
    const w = scene('flames');
    const peak = watch(w, 600, flames);
    expect(flames.filter((m) => peak.get(m) === 0)).toEqual([]);
    // and the colours are what you see: tinted flame outnumbers plain fire
    // (a bed of burning wood made the same tints but drowned them in orange)
    let tinted = 0, plain = 0;
    for (let f = 0; f < 120; f++) {
      w.step();
      tinted += flames.reduce((s, m) => s + w.grid.counts[m], 0);
      plain += w.grid.counts[Mat.FIRE] + w.grid.counts[Mat.EMBER];
    }
    expect(tinted).toBeGreaterThan(plain * 3);
  });

  it('builds the same bench for everyone, and only in the chem lab', () => {
    for (const s of CHEM_SCENES) {
      // different seeds: a scene that rolled the world's RNG would differ
      const a = scene(s.id, 1), b = scene(s.id, 999);
      expect(a.grid.cells.every((c, i) => c === b.grid.cells[i] && a.grid.meta[i] === b.grid.meta[i])).toBe(true);
      expect(a.grid.counts[Mat.EMPTY]).toBeLessThan(a.grid.cells.length);
    }
    const sand = new World(5);
    sand.applyInput({ k: 'chemScene', id: 'alkali' });
    expect(sand.grid.counts[Mat.EMPTY]).toBe(sand.grid.cells.length);
  });
});
