import { describe, expect, it } from 'vitest';
import { RNG } from '../src/core/rng';

describe('RNG', () => {
  /**
   * The state used to grow without bound; past 2^53 additions rounded and
   * the sequence changed. A copy restored from the 32-bit state then
   * disagreed with the original - a multiplayer desync around frame 2400.
   */
  it('a copy made after millions of draws continues the same sequence', () => {
    const a = new RNG(12345);
    for (let k = 0; k < 6_000_000; k++) a.next();
    expect(a.state).toBeLessThan(2 ** 32);
    const b = new RNG(0);
    b.state = a.state;
    for (let k = 0; k < 2000; k++) expect(b.next()).toBe(a.next());
  });

  it('the sequence for a seed is exactly what the unwrapped version gave', () => {
    // the old algorithm, for comparison (exact while its state stays < 2^53)
    let s0 = 42;
    const old = () => {
      let t = (s0 += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const r = new RNG(42);
    for (let k = 0; k < 100_000; k++) expect(r.next()).toBe(old());
  });
});
