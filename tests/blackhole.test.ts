import { describe, expect, it } from 'vitest';
import { drawBlackHole } from '../src/sim/particles';
import { SIM_H, SIM_W } from '../src/sim/protocol';

/** The playground's black hole picture keeps to the physics it claims. */
describe('black hole picture', () => {
  const pix = new Uint32Array(SIM_W * SIM_H).fill(0xff000000);
  drawBlackHole(pix, 320, 180, 40);
  const lum = (x: number, y: number) => {
    const c = pix[y * SIM_W + x];
    return (c & 255) + ((c >>> 8) & 255) + ((c >>> 16) & 255);
  };
  const sum = (x0: number, y0: number, x1: number, y1: number) => {
    let s = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) s += lum(x, y);
    return s;
  };

  it('the shadow is black, edged by a bright photon ring', () => {
    for (let d = -5; d <= 5; d++) expect(lum(320 + d, 180 - 3)).toBe(0);
    expect(lum(320, 180 - 8) + lum(320, 180 - 9)).toBeGreaterThan(100);
  });

  it('Doppler: the side of the disc coming toward us (left) is brighter than the side going away', () => {
    const left = sum(320 - 34, 178, 320 - 12, 184);
    const right = sum(320 + 12, 178, 320 + 34, 184);
    expect(left).toBeGreaterThan(right * 2);
    expect(right).toBeGreaterThan(0); // dimmer, not gone
  });

  it('lensing: the far side of the disc arches over the top, brighter than the faint image underneath', () => {
    const over = sum(300, 180 - 22, 340, 180 - 10);
    const under = sum(300, 180 + 10, 340, 180 + 22);
    expect(over).toBeGreaterThan(under * 1.5);
    expect(under).toBeGreaterThan(0);
  });

  it('never brighter than its cap, so the playground bloom does not wash it out', () => {
    let max = 0;
    for (const c of pix) max = Math.max(max, c & 255, (c >>> 8) & 255, (c >>> 16) & 255);
    expect(max).toBeLessThanOrEqual(230);
    expect(max).toBeGreaterThan(120);
  });
});
