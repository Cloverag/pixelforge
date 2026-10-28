import { describe, expect, it } from 'vitest';
import { Mat } from '../src/sim/materials';
import { REPLAY_FRAMES, REPLAY_SLOW, Replay } from '../src/sim/replay';
import { World } from '../src/sim/world';

describe('instant replay of the big red button', () => {
  it('replays the same blast slowly, then hands back the live world untouched', () => {
    const w = new World(7);
    for (let x = 200; x <= 400; x++) w.grid.setXY(x, 300, Mat.WALL);
    for (let x = 290; x <= 310; x++) for (let y = 280; y <= 299; y++) w.grid.setXY(x, y, Mat.SAND);
    for (let x = 296; x <= 304; x++) w.grid.setXY(x, 279, Mat.C4);
    const r = new Replay();
    expect(r.ready).toBe(false);

    r.arm(w);
    w.applyInput({ k: 'detonate' });
    const blast: number[] = [];
    for (let k = 0; k < 40; k++) {
      w.step();
      blast.push(w.hash());
    }
    for (let k = 0; k < 30; k++) w.step();
    const live = w.hash();
    expect(r.ready).toBe(true);

    expect(r.start(w)).toBe(true);
    expect(r.playing).toBe(true);
    // the replay's world goes the same way the live one went: the simulation is deterministic
    const again: number[] = [];
    let frames = 0;
    while (r.playing) {
      if (r.tick(w)) {
        w.step();
        if (again.length < 40) again.push(w.hash());
      }
      frames++;
    }
    expect(again).toEqual(blast);
    // a third of the speed: three display frames a tick
    expect(frames).toBeGreaterThanOrEqual((REPLAY_FRAMES - 1) * REPLAY_SLOW);
    expect(w.hash()).toBe(live);
    expect(r.ready).toBe(true); // and it can be watched again
  });

  it('ends early when asked, and is forgotten with the world', () => {
    const w = new World(7);
    w.grid.setXY(300, 299, Mat.C4);
    const r = new Replay();
    r.arm(w);
    w.applyInput({ k: 'detonate' });
    for (let k = 0; k < 20; k++) w.step();
    const live = w.hash();
    r.start(w);
    for (let k = 0; k < 10; k++) if (r.tick(w)) w.step();
    r.stop(w);
    expect(w.hash()).toBe(live);
    r.forget(w);
    expect(r.ready).toBe(false);
    expect(r.start(w)).toBe(false);
  });
});
