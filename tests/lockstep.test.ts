import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { Mat } from '../src/sim/materials';
import type { NetInput, PaintKind } from '../src/sim/protocol';

/**
 * Multiplayer runs the same simulation on every peer and only sends inputs,
 * so it rests on two properties tested here: the sim is deterministic for a
 * seed and an input sequence, and a snapshot captures every bit of state the
 * next frame depends on (a joining player starts from one).
 */

const line = (x0: number, y0: number, x1: number, y1: number): number[] => {
  const pts: number[] = [];
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let k = 0; k <= n; k++) pts.push(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n);
  return pts;
};
const paint = (pts: number[], mat: number, size = 4, kind: PaintKind = 'brush'): NetInput => ({ k: 'paint', pts, mat, size, kind });

/** a busy scripted session touching most of the sim's random paths */
function script(f: number): NetInput[] {
  switch (f) {
    case 0: return [paint(line(40, 330, 600, 330), Mat.STONE, 6), paint(line(300, 250, 300, 330), Mat.STONE, 4)];
    case 10: return [paint(line(80, 120, 200, 120), Mat.SAND, 8)];
    case 30: return [paint(line(350, 100, 500, 100), Mat.WATER, 8)];
    case 60: return [paint(line(120, 300, 220, 300), Mat.WOOD, 6), paint([170, 280], Mat.FIRE, 5)];
    case 90: return [paint(line(420, 300, 460, 300), Mat.TNT, 6), paint([440, 290], Mat.FIRE, 3)];
    case 140: return [paint(line(250, 200, 400, 200), 0, 10, 'wind')];
    case 160: return [paint([520, 80, 540, 80, 560, 80], Mat.BIRD, 2), paint([90, 320, 110, 320], Mat.ANT, 2)];
    case 200: return [paint(line(60, 300, 100, 300), Mat.SEED, 3), paint([480, 60], Mat.LAVA, 6)];
    case 260: return [paint(line(150, 60, 250, 60), Mat.SNOW, 6), paint([200, 250], Mat.ACID, 4)];
    case 400: return [paint(line(40, 200, 200, 200), Mat.OIL, 6), paint([120, 190], Mat.FIRE, 3)];
    default: return [];
  }
}

function run(w: World, from: number, to: number, check: (f: number, h: number) => void) {
  for (let f = from; f < to; f++) {
    for (const inp of script(f)) w.applyInput(inp);
    w.step();
    if (f % 50 === 49) check(f, w.hash());
  }
}

describe('lockstep determinism', { timeout: 120_000 }, () => {
  it('two worlds fed the same inputs stay identical', () => {
    const a = new World(1234);
    const b = new World(1234);
    const ha: number[] = [];
    run(a, 0, 1200, (_f, h) => ha.push(h));
    let k = 0;
    run(b, 0, 1200, (f, h) => expect(h, `diverged by frame ${f}`).toBe(ha[k++]));
    // and the session really was busy: a frozen world would pass trivially
    expect(new Set(ha).size).toBeGreaterThan(20);
  });

  it('a world restored from a snapshot mid-game stays identical to the original', () => {
    const orig = new World(1234);
    run(orig, 0, 600, () => {});
    const snap = orig.snapshot();
    // a joiner: different seed, and it already ran some other session
    const joiner = new World(99);
    run(joiner, 0, 137, () => {});
    joiner.restore(snap);
    expect(joiner.hash()).toBe(orig.hash());
    const ho: number[] = [];
    run(orig, 600, 1200, (_f, h) => ho.push(h));
    let k = 0;
    run(joiner, 600, 1200, (f, h) => expect(h, `joiner diverged by frame ${f}`).toBe(ho[k++]));
  });

  it('the fingerprint notices a single changed cell', () => {
    const a = new World(5);
    run(a, 0, 100, () => {});
    const h = a.hash();
    a.grid.cells[1000] = a.grid.cells[1000] === Mat.SAND ? Mat.EMPTY : Mat.SAND;
    expect(a.hash()).not.toBe(h);
  });
});
