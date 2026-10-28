import { describe, expect, it } from 'vitest';
import { Grid } from '../src/sim/grid';
import { PSys } from '../src/sim/particles';
import { SIM_H, SIM_W } from '../src/sim/protocol';
import { skyLayer } from '../src/sim/starfield';

describe('playground trails', () => {
  it('fade all the way back to the sky, darker leftovers as well as brighter ones', () => {
    const p = new PSys(new Grid(SIM_W, SIM_H));
    const pix = new Uint32Array(SIM_W * SIM_H);
    p.draw(pix, true, 0);
    // a few shades off the sky either way: a black hole's shadow left behind, and a spark's glow
    const shade = (c: number, d: number) => {
      const ch = (v: number) => Math.max(0, Math.min(255, v + d));
      return ((255 << 24) | (ch((c >>> 16) & 255) << 16) | (ch((c >>> 8) & 255) << 8) | ch(c & 255)) >>> 0;
    };
    const dark = 200 * SIM_W + 100;
    const bright = 200 * SIM_W + 500;
    pix[dark] = shade(pix[dark], -6);
    pix[bright] = shade(pix[bright], 6);
    for (let f = 1; f <= 120; f++) p.draw(pix, false, f);
    const sky = skyLayer(120, p.forces);
    expect(pix[bright]).toBe(sky[bright]);
    expect(pix[dark]).toBe(sky[dark]);
  });
});
