import { describe, expect, it } from 'vitest';
import { Cat, MATS, Mat, NMATS, SHADED, withMat } from '../src/sim/materials';

/**
 * The frame's alpha byte carries each cell's material id for the GL composite
 * (crisp cells, light from light sources only, later shading and shadows).
 * 255 means "not a cell" and 253 is the playground's wall tag, so ids must
 * stay clear of both.
 */
describe('the frame format: alpha is the material id', () => {
  it('every material id fits below 128, clear of 253 (walls) and 255 (no cell)', () => {
    expect(NMATS).toBeLessThan(128);
  });

  it('every shaded colour of every material carries its own id, and its colour is untouched', () => {
    for (let m = 1; m < NMATS; m++) {
      if (!MATS[m]) continue;
      for (let i = 0; i < 32; i++) {
        const c = SHADED[(m << 5) | i];
        expect(c >>> 24, MATS[m].name).toBe(m);
      }
    }
    expect(withMat(0xff336699, 7) >>> 0).toBe(0x07336699);
  });

  it('the composite knows liquids and light sources by id (lava glows, it is not a pool)', async () => {
    // the shader module touches no GL at import time
    const { materialInfo } = await import('../src/render/glrenderer');
    const lut = materialInfo();
    expect(lut[Mat.WATER * 4]).toBe(255);
    expect(lut[Mat.LAVA * 4]).toBe(0);
    expect(lut[Mat.LAVA * 4 + 1]).toBe(255);
    expect(lut[Mat.FIRE * 4 + 1]).toBe(255);
    for (const m of [Mat.SAND, Mat.SNOW, Mat.STONE, Mat.WATER]) expect(lut[m * 4 + 1], MATS[m].name).toBe(0);
    for (let m = 0; m < NMATS; m++) if (MATS[m]?.cat === Cat.LIQUID && m !== Mat.LAVA) expect(lut[m * 4], MATS[m].name).toBe(255);
  });
});

describe('the shaders', () => {
  it('define every function before they use it (else WebGL refuses them and the game drops to 2D)', async () => {
    const { SHADERS } = await import('../src/render/glrenderer');
    for (const [name, src] of Object.entries(SHADERS)) {
      const defs = [...src.matchAll(/\n(?:vec[234]|float|int|bool|void) (\w+)\(/g)].map((m) => ({ fn: m[1], at: m.index! }));
      for (const { fn, at } of defs) {
        if (fn === 'main') continue;
        const first = src.search(new RegExp(`\\b${fn}\\(`));
        expect(first, `${name}: ${fn} used before it is defined`).toBeGreaterThanOrEqual(at);
      }
    }
  });
});
