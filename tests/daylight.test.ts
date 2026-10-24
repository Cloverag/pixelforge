import { describe, expect, it } from 'vitest';
import { daylightAt, timeOfDay } from '../src/render/daylight';

const lum = (c: [number, number, number]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

describe('time of day', () => {
  it('noon is bright and sunny, midnight is dark and starry', () => {
    const noon = daylightAt(0.25);
    const night = daylightAt(0.75);
    expect(lum(noon.sun) + lum(noon.ambient)).toBeGreaterThan(1.4);
    expect(lum(night.sun) + lum(night.ambient)).toBeLessThan(0.7);
    expect(noon.night).toBe(0);
    expect(night.night).toBe(1);
    expect(lum(noon.skyTop)).toBeGreaterThan(lum(night.skyTop) * 4);
  });

  it('the sun is up by day and set by night, the moon the other way round', () => {
    for (const t of [0.05, 0.25, 0.45]) expect(daylightAt(t).sunPos[1], `t=${t}`).toBeGreaterThan(0);
    for (const t of [0.6, 0.75, 0.9]) {
      expect(daylightAt(t).sunPos[1], `t=${t}`).toBeLessThan(0);
      expect(daylightAt(t).moonPos[1], `t=${t}`).toBeGreaterThan(0);
    }
  });

  it('the light always comes from above, as a unit vector', () => {
    for (let t = 0; t < 1; t += 0.01) {
      const d = daylightAt(t).dir;
      expect(Math.hypot(d[0], d[1])).toBeCloseTo(1, 6);
      expect(d[1], `t=${t.toFixed(2)}`).toBeGreaterThan(0);
    }
  });

  it('never jumps: neighbouring moments look almost the same, across the wrap too', () => {
    const step = 1 / 2000;
    for (let t = 0; t < 1; t += step) {
      const a = daylightAt(t);
      const b = daylightAt(t + step);
      for (const k of ['skyTop', 'skyHorizon', 'sun', 'ambient'] as const)
        for (let c = 0; c < 3; c++) expect(Math.abs(a[k][c] - b[k][c]), `${k} at t=${t.toFixed(4)}`).toBeLessThan(0.02);
    }
  });

  it('DAY and NIGHT hold still; the cycle moves and starts in the morning', () => {
    expect(timeOfDay('day', 0)).toBe(timeOfDay('day', 500));
    expect(daylightAt(timeOfDay('night', 0)).night).toBeGreaterThan(0.9);
    expect(daylightAt(timeOfDay('cycle', 0)).night).toBe(0);
    expect(timeOfDay('cycle', 60)).not.toBe(timeOfDay('cycle', 0));
  });
});
