import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { PG_BG } from '../src/sim/particles';
import { SIM_H, SIM_W } from '../src/sim/protocol';

const N = SIM_W * SIM_H;

function playground(): World {
  const w = new World(7);
  w.mode = 'playground';
  return w;
}

describe('particle playground', () => {
  /**
   * Trails used to fade by scaling toward black, so wherever particles had
   * passed ended up darker than the background - a black wedge under every
   * fountain. Nothing should ever be darker than the background.
   */
  it('trails fade back to the background, never below it', () => {
    const w = playground();
    const pix = new Uint32Array(N).fill(PG_BG);
    for (let n = 0; n < 160; n++) {
      if (n < 60) w.parts!.tool({ kind: 'fountain', x: 320, y: 300, phase: 'move' });
      w.parts!.fullRender(pix, false, n);
    }
    const br = PG_BG & 255, bg = (PG_BG >>> 8) & 255, bb = (PG_BG >>> 16) & 255;
    let darker = 0;
    for (let i = 0; i < N; i++) {
      const c = pix[i];
      if ((c & 255) < br - 1 && ((c >>> 8) & 255) < bg - 1 && ((c >>> 16) & 255) < bb - 1) darker++;
    }
    expect(darker).toBe(0);
  });

  it('a firework launches a rocket that bursts near where you clicked', () => {
    const w = playground();
    const pix = new Uint32Array(N).fill(PG_BG);
    w.parts!.tool({ kind: 'firework', x: 320, y: 120, phase: 'down' });
    let burst: number[] | null = null;
    for (let n = 0; n < 120 && !burst; n++) {
      w.parts!.fullRender(pix, false, n);
      const b = w.takeEvents().booms;
      if (b.length) burst = b;
      // the burst is not instant: there is a rocket in flight first
      if (n === 0) expect(b.length).toBe(0);
    }
    expect(burst).not.toBeNull();
    expect(Math.abs(burst![1] - 120)).toBeLessThan(12);
  });

  it('packs a firework shell for the 3D view: real depth, light-bright colour', () => {
    const w = playground();
    const pix = new Uint32Array(N).fill(PG_BG);
    w.parts!.firework(320, 150);
    for (let n = 0; n < 12; n++) w.parts!.fullRender(pix, false, n);
    const out = new Float32Array(24000 * 6);
    const n = w.parts!.pack3d(out);
    expect(n).toBeGreaterThan(80);
    let zMin = Infinity, zMax = -Infinity, overBright = 0;
    for (let i = 0; i < n; i++) {
      zMin = Math.min(zMin, out[i * 6 + 2]);
      zMax = Math.max(zMax, out[i * 6 + 2]);
      if (Math.max(out[i * 6 + 3], out[i * 6 + 4], out[i * 6 + 5]) > 1) overBright++;
    }
    // a shell, not a flat disk
    expect(zMax - zMin).toBeGreaterThan(20);
    // bright enough for the bloom to treat as light
    expect(overBright).toBeGreaterThan(n / 4);
  });
});
