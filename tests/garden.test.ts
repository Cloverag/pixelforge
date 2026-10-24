import { describe, expect, it } from 'vitest';
import { bouquet, decodeGarden, encodeGarden, FLOWER_KINDS, openness, plantAt } from '../src/garden/flowers';
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

describe('the eye of words and the 3D lilies', () => {
  it('the eye blinks briefly about every 4.5 s: open most of the time, shut for a moment', async () => {
    const { lidOpen } = await import('../src/garden/eye');
    let open = 0;
    let shut = 0;
    for (let t = 0; t < 45; t += 0.01) {
      const o = lidOpen(t);
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThanOrEqual(1);
      if (o === 1) open++;
      if (o < 0.1) shut++;
    }
    expect(open / (open + shut)).toBeGreaterThan(0.9);
    expect(shut).toBeGreaterThan(0);
  });

  it('a lily bouquet is the same for a seed, and every lily is six tepals of 36 quads', async () => {
    const { buildLilies, lilyBuildTime } = await import('../src/garden/lily3d');
    const a = buildLilies(5);
    expect(a).toEqual(buildLilies(5));
    // 5 lilies x (6 tepals x 36 quads + a leaf of 12)
    expect(a.quads.length).toBe(5 * (6 * 36 + 12));
    for (const q of a.quads) for (const p of q.p) for (const c of p) expect(Number.isFinite(c)).toBe(true);
    expect(lilyBuildTime(a)).toBeGreaterThan(3);
    expect(lilyBuildTime(a)).toBeLessThan(8);
  });

  it('a garden link brings back every flower: kind, colours, place, size and turn', () => {
    const fl = [...bouquet(7, 0), ...FLOWER_KINDS.map((k, i) => plantAt(k, 60 + i * 110, 200, 20 + i, 0, 99 + i))];
    const back = decodeGarden(encodeGarden(fl), 5)!;
    expect(back).toHaveLength(fl.length);
    const turn = (a: number, b: number) => Math.min(Math.abs(a - b), Math.PI * 2 - Math.abs(a - b));
    back.forEach((g, i) => {
      const f = fl[i];
      expect([g.kind, g.petal, g.tip]).toEqual([f.kind, f.petal, f.tip]);
      for (const k of ['x', 'y', 'sx', 'sy', 'r'] as const) expect(Math.abs(g[k] - f[k])).toBeLessThanOrEqual(0.5);
      expect(turn(g.rot, ((f.rot % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2))).toBeLessThan(0.03);
      expect(turn(g.phase, f.phase)).toBeLessThan(0.03);
      // they open one after another from when the link is opened
      expect(g.born).toBeCloseTo(5 + i * 0.12);
    });
  });

  it('a link that is not a garden is refused, not half-read', () => {
    const good = encodeGarden(bouquet(3, 0));
    expect(decodeGarden(good.slice(0, -5), 0)).toBeNull(); // cut short
    expect(decodeGarden('!!!', 0)).toBeNull(); // not base64
    expect(decodeGarden('Ag', 0)).toBeNull(); // another version
    // a kind that does not exist (the top four bits past the last kind)
    const b = Uint8Array.from(atob(good.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    b[1] = 0xf0;
    const bad = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(decodeGarden(bad, 0)).toBeNull();
  });
});
