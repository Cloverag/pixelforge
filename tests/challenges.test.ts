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
  // one past the limit: the time limit itself is part of how a level ends
  for (let f = 0; f <= def.timeLimit && !ch.done; f++) {
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
    expect(play('beacon', idle)?.status).toBe('lose'); // out of time
  });
});

describe('torch lights a fuse', () => {
  it('a fuse touching a torch catches and burns down', () => {
    const w = new World(41);
    for (let x = 90; x < 160; x++) w.grid.setXY(x, 201, Mat.WALL);
    w.grid.setXY(99, 200, Mat.TORCH);
    for (let x = 100; x < 130; x++) w.grid.setXY(x, 200, Mat.FUSE);
    for (let f = 0; f < 400; f++) w.step();
    expect(w.grid.counts[Mat.FUSE]).toBe(0);
  });

});

describe('FIRE WATCH', () => {
  const splash = (at: number) => (w: World, f: number) => {
    if (f === at) w.paint([540, 322], Mat.WATER, 24);
  };

  it('is lost if nobody fights the fire', () => {
    expect(play('firefighter', idle)?.status).toBe('lose');
  });

  it('is won with three stars by flooding the hedge early', () => {
    const r = play('firefighter', splash(0));
    expect(r?.status).toBe('win');
    expect(r?.stars).toBe(3);
  });

  it('is lost when the water comes too late', () => {
    expect(play('firefighter', splash(330))?.status).toBe('lose');
  });
});

describe('time limits', () => {
  it('an idle challenge is lost exactly when its time runs out, not a frame before', () => {
    for (const id of ['beacon', 'gardener']) {
      const def = CHALLENGES.find((c) => c.id === id)!;
      const w = new World(1);
      w.loadChallenge(id);
      const ch = w.challenge!;
      while (ch.frame < def.timeLimit - 1) w.step();
      expect(ch.done, id).toBe(false);
      w.step();
      expect(ch.result, id).toMatchObject({ status: 'lose', reason: def.loseReason, timeFrames: def.timeLimit });
    }
  });
});

describe('the eraser in a challenge', () => {
  it('cannot remove the level, only what the player could place', () => {
    const w = new World(1);
    w.loadChallenge('icebreaker');
    const ice0 = w.grid.counts[Mat.ICE];
    // brush and bucket over the glacier: nothing goes
    for (let y = 130; y < 340; y += 6) w.paint([320, y], -1, 12);
    w.paint([320, 200], -1, 4, 'flood');
    expect(w.grid.counts[Mat.ICE]).toBe(ice0);
    // the player's own lava does go
    w.paint([100, 100], Mat.LAVA, 6);
    const lava = w.grid.counts[Mat.LAVA];
    expect(lava).toBeGreaterThan(0);
    w.paint([100, 100], -1, 8);
    expect(w.grid.counts[Mat.LAVA]).toBe(0);
  });

  it('erases anything in the free sandbox', () => {
    const w = new World(1);
    w.paint([100, 100], Mat.STONE, 6);
    w.paint([100, 100], -1, 8);
    expect(w.grid.counts[Mat.STONE]).toBe(0);
  });
});

describe('CONTAINMENT', { timeout: 300_000 }, () => {
  it('is lost if nothing is done: the crack leaks lava to the reactor (issue #2)', () => {
    expect(play('containment', idle)).toMatchObject({ status: 'lose', reason: 'Lava reached the reactor!' });
  });

  it('is won by patching the crack with stone - a tidy patch earns 3 stars', () => {
    const r = play('containment', (w, f) => {
      if (f !== 0) return;
      const pts: number[] = [];
      for (let y = 298; y <= 340; y += 2) pts.push(399, y);
      w.paint(pts, Mat.STONE, 6);
    });
    expect(r).toMatchObject({ status: 'win', stars: 3 });
  });
});

