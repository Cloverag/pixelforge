import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { DEFAULT_BACKGROUND, packAbgr } from '../src/sim/background';
import { clearOfHoles, planSurprise } from '../src/sim/surprise';
import { SIM_H, SIM_W } from '../src/sim/protocol';
import { Mat } from '../src/sim/materials';

/** the game's default empty colour (NIGHT): these tests draw on it */
const PG_BG = packAbgr(DEFAULT_BACKGROUND);

describe('SURPRISE ME', { timeout: 120_000 }, () => {
  it('a seed always makes the same scene, and different seeds differ', () => {
    expect(planSurprise(42)).toEqual(planSurprise(42));
    const names = new Set<string>();
    for (let s = 1; s <= 60; s++) names.add(planSurprise(s).name);
    expect(names.size).toBeGreaterThan(20);
  });

  it('all four kinds of scene come up', () => {
    const kinds = new Set<string>();
    for (let s = 1; s <= 80; s++) {
      const p = planSurprise(s);
      if (p.forces.some((f) => f[0] === 'blackhole' || f[0] === 'vortex') && !p.gravity && p.lines.length === 0) kinds.add('orbit');
      else if (p.lines.length >= 4) kinds.add('cascade');
      else if (p.emitters.some((e) => e.kind === 'firework')) kinds.add('festival');
      else kinds.add('storm');
    }
    expect(kinds).toEqual(new Set(['orbit', 'cascade', 'festival', 'storm']));
  });

  /** an emitter inside a black hole never shows a particle */
  it('emitters are moved clear of black holes and kept on screen', () => {
    const plan = planSurprise(1);
    plan.forces = [['blackhole', 300, 180]];
    plan.emitters = [
      { kind: 'jet', x: 310, y: 180, dx: 1, dy: 0, every: 3 },
      { kind: 'jet', x: 300, y: 180, dx: 1, dy: 0, every: 3 }, // dead centre
      { kind: 'fountain', x: -20, y: 400, dx: 0, dy: -1, every: 1 },
    ];
    clearOfHoles(plan);
    for (const e of plan.emitters) {
      expect(Math.hypot(e.x - 300, e.y - 180)).toBeGreaterThanOrEqual(44.9);
      expect(e.x).toBeGreaterThanOrEqual(0);
      expect(e.y).toBeLessThan(SIM_H);
    }
  });

  it('no emitter is buried in its own scene\'s walls', () => {
    for (let s = 1; s <= 120; s++) {
      const w = new World(1);
      w.mode = 'playground';
      w.loadSurprise(s);
      for (const e of planSurprise(s).emitters) expect(w.grid.get(e.x | 0, e.y | 0)).toBe(Mat.EMPTY);
    }
  });

  /** cascades once measured under 40 particles on screen: sound, no show */
  it('every scene in a sample is alive and fills the screen', () => {
    for (let s = 1; s <= 24; s++) {
      const w = new World(1);
      w.mode = 'playground';
      w.loadSurprise(s * 7919);
      const pix = new Uint32Array(SIM_W * SIM_H).fill(PG_BG);
      for (let n = 0; n < 400; n++) w.parts!.fullRender(pix, false, n);
      expect(w.parts!.count, `seed ${s * 7919}: ${planSurprise(s * 7919).name}`).toBeGreaterThan(40);
    }
  });
});
