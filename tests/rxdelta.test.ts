import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { Mat } from '../src/sim/materials';
import { RULES } from '../src/sim/reactions';
import { rxDiff } from '../src/sim/rxdelta';

/**
 * The reactions readout's worker side: the difference between two reports of
 * the cumulative per-rule counts, as a sparse [rule, count, ...] list.
 */

describe('rxDiff', () => {
  it('lists only the rules that fired, as [rule, count] pairs', () => {
    const prev = Uint32Array.from([5, 0, 7, 2]);
    const next = Uint32Array.from([5, 3, 7, 6]);
    expect(rxDiff(prev, next)).toEqual([1, 3, 3, 4]);
  });

  it('is empty when nothing fired, so a quiet frame sends nothing', () => {
    const a = Uint32Array.from([4, 9, 0]);
    expect(rxDiff(a, a.slice())).toEqual([]);
  });

  it('sends the difference, not the running total', () => {
    // a world that reports every frame: the deltas add up to the total, and a
    // quiet spell after the reaction has died away reports nothing
    const w = new World(3);
    w.applyInput({ k: 'mode', m: 'chem' });
    for (let y = 100; y < 120; y++) for (let x = 100; x < 140; x++) w.grid.setXY(x, y, (x + y) & 1 ? Mat.NA : Mat.WATER);
    const last = new Uint32Array(RULES.length);
    const sum = new Uint32Array(RULES.length);
    let reports = 0;
    for (let f = 0; f < 200; f++) {
      w.step();
      const d = rxDiff(last, w.rxFired);
      last.set(w.rxFired);
      if (d.length) reports++;
      for (let i = 0; i < d.length; i += 2) sum[d[i]] += d[i + 1];
    }
    expect([...sum]).toEqual([...w.rxFired]);
    expect(sum.reduce((s, n) => s + n, 0)).toBeGreaterThan(0);
    // many frames each reported a small delta: no frame carried the whole total
    expect(reports).toBeGreaterThan(5);
    const total = sum.reduce((s, n) => s + n, 0);
    const again = rxDiff(last, w.rxFired);
    expect(again).toEqual([]);
    expect(total).toBe(w.rxFired.reduce((s, n) => s + n, 0));
  });
});
