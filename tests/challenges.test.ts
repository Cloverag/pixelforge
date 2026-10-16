import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { Mat } from '../src/sim/materials';
import { CHALLENGES } from '../src/sim/challenges';

/** a 4-connected path from a to b: each step moves one cell in x or in y */
function path(x0: number, y0: number, x1: number, y1: number): number[] {
  const pts = [x0, y0];
  let x = x0;
  let y = y0;
  const n = Math.abs(x1 - x0) + Math.abs(y1 - y0);
  for (let k = 0; k < n; k++) {
    const tx = x0 + ((x1 - x0) * (k + 1)) / n;
    const ty = y0 + ((y1 - y0) * (k + 1)) / n;
    if (Math.abs(tx - x) >= Math.abs(ty - y) && x !== x1) x += Math.sign(x1 - x0);
    else if (y !== y1) y += Math.sign(y1 - y0);
    else x += Math.sign(x1 - x0);
    pts.push(x, y);
  }
  return pts;
}

/**
 * Play a challenge to the end with `plan` painting through World.paint - the
 * player's own path, so budgets apply - and return how it ended.
 */
function play(id: string, plan: (w: World, f: number) => void) {
  const def = CHALLENGES.find((c) => c.id === id)!;
  const w = new World(1);
  w.loadChallenge(id);
  const ch = w.challenge!;
  for (let f = 0; f < def.timeLimit && !ch.done; f++) {
    plan(w, ch.frame);
    w.step();
  }
  return ch.result;
}

const idle = () => {};

describe('SPARK THE BEACON', () => {
  it('can be won by bridging the three gaps', () => {
    const r = play('beacon', (w, f) => {
      if (f !== 0) return;
      w.paint(path(90, 296, 150, 271), Mat.WIRE, 1);
      w.paint(path(210, 270, 270, 270), Mat.WIRE, 1);
      w.paint(path(330, 271, 390, 300), Mat.WIRE, 1);
    });
    expect(r?.status).toBe('win');
  });

  it('is not won without the bridges', () => {
    expect(play('beacon', idle)).toBeNull();
  });
});
