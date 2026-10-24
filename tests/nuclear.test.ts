import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { Mat } from '../src/sim/materials';

/** The chem lab's fission: a chain reaction needs enough metal; boron stops it. */

function scene(id: string): World {
  const w = new World(5);
  w.applyInput({ k: 'mode', m: 'chem' });
  w.applyInput({ k: 'chemScene', id });
  return w;
}

/** Step `frames`, reporting the first frame with a blast (-1: none). */
function run(w: World, frames: number): number {
  let burst = -1;
  for (let f = 0; f < frames; f++) {
    w.events.booms.length = 0;
    w.step();
    if (burst < 0 && w.events.booms.length) burst = f;
  }
  return burst;
}

function count(w: World, m: number, x0: number, y0: number, x1: number, y1: number): number {
  let n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (w.grid.get(x, y) === m) n++;
  return n;
}

function lump(mat: number, size: number): World {
  const w = new World(3);
  w.applyInput({ k: 'mode', m: 'chem' });
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) w.grid.setXY(300 + x, 150 + y, mat);
  return w;
}

describe('nuclear: fission and critical mass', { timeout: 120_000 }, () => {
  it('CRITICAL MASS: the small lump fizzles, the big one runs away and blows apart', () => {
    const w = scene('critical');
    const small0 = count(w, Mat.U, 100, 266, 119, 285);
    const big0 = count(w, Mat.U, 380, 256, 479, 354);
    const burst = run(w, 900);
    expect(count(w, Mat.U, 90, 250, 130, 295)).toBeGreaterThan(small0 * 0.9);
    expect(count(w, Mat.U, 300, 150, 560, 358)).toBeLessThan(big0 * 0.75);
    expect(burst).toBeGreaterThanOrEqual(0);
  });

  it('REACTOR: caged in boron rods it stays calm; without them it runs away', () => {
    const calm = scene('reactor');
    const u0 = calm.grid.counts[Mat.U];
    expect(run(calm, 900)).toBe(-1);
    expect(calm.grid.counts[Mat.U]).toBeGreaterThan(u0 * 0.9);

    // it is the boron that does it: the same cage in stone holds nothing back
    const stone = scene('reactor');
    for (let y = 0; y < 360; y++) for (let x = 0; x < 640; x++) if (stone.grid.get(x, y) === Mat.B) stone.grid.setXY(x, y, Mat.STONE);
    expect(run(stone, 900)).toBeGreaterThanOrEqual(0);

    const bare = scene('reactor');
    for (let y = 0; y < 360; y++) for (let x = 0; x < 640; x++) if (bare.grid.get(x, y) === Mat.B) bare.grid.setXY(x, y, Mat.U);
    const b0 = bare.grid.counts[Mat.U];
    expect(run(bare, 900)).toBeGreaterThanOrEqual(0);
    expect(bare.grid.counts[Mat.U]).toBeLessThan(b0 * 0.7);
  });

  it('plutonium has a smaller critical mass: a lump that fizzles as uranium runs away as plutonium', () => {
    const u = lump(Mat.U, 30);
    const pu = lump(Mat.PU, 30);
    run(u, 3000);
    run(pu, 3000);
    expect(u.grid.counts[Mat.U]).toBeGreaterThan(900 * 0.95);
    expect(pu.grid.counts[Mat.PU]).toBeLessThan(900 * 0.7);
  });
});
