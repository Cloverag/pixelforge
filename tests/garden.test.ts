import { describe, expect, it } from 'vitest';
import { bouquet, FLOWER_KINDS, openness, plantAt } from '../src/garden/flowers';
import { RAMP } from '../src/garden/ascii';

describe('the ASCII garden', () => {
  it('a bouquet is the same for the same seed, and different for another', () => {
    expect(bouquet(42, 0)).toEqual(bouquet(42, 0));
    expect(bouquet(42, 0)).not.toEqual(bouquet(43, 0));
  });

  it('a bouquet stays on screen, its stems gather at one tie, and it is mostly lilies', () => {
    for (let seed = 1; seed < 50; seed++) {
      const b = bouquet(seed, 0);
      expect(b.length).toBe(11);
      for (const f of b) {
        expect(f.x - f.r, `seed ${seed}`).toBeGreaterThan(0);
        expect(f.x + f.r, `seed ${seed}`).toBeLessThan(640);
        expect(f.y - f.r, `seed ${seed}`).toBeGreaterThan(0);
        expect(f.y, `seed ${seed}`).toBeLessThan(330);
        expect(Math.abs(f.sx - 320)).toBeLessThanOrEqual(8);
        expect(f.sy).toBe(330);
        expect(f.petal).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
    const all = Array.from({ length: 30 }, (_, s) => bouquet(s + 1, 0)).flat();
    expect(all.filter((f) => f.kind === 'lily').length / all.length).toBeGreaterThan(0.6);
  });

  it('is drawn back to front: blooms further up come first', () => {
    const b = bouquet(7, 0);
    for (let i = 1; i < b.length; i++) expect(b[i].y + b[i].r * 0.5).toBeGreaterThanOrEqual(b[i - 1].y + b[i - 1].r * 0.5);
  });

  it('a planted flower grows from the ground below it and opens over one second', () => {
    for (const k of FLOWER_KINDS) {
      const f = plantAt(k, 200, 100, 30, 5, 1);
      expect(f.sy).toBe(352);
      expect(f.y).toBeLessThan(f.sy);
      expect(openness(f, 5)).toBe(0);
      expect(openness(f, 5.5)).toBeGreaterThan(0.5);
      expect(openness(f, 7)).toBe(1);
    }
  });

  it('the text ramp runs from empty to full ink', () => {
    expect(RAMP[0]).toBe(' ');
    expect(RAMP.at(-1)).toBe('@');
    expect(new Set(RAMP).size).toBe(RAMP.length);
  });
});
