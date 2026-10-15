import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { PG_BG, PG_BUMPER } from '../src/sim/particles';
import { Mat } from '../src/sim/materials';
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

  /** positions straight from the packed 3D buffer */
  const positions = (w: World) => {
    const out = new Float32Array(24000 * 6);
    const n = w.parts!.pack3d(out);
    const p: { x: number; y: number }[] = [];
    for (let i = 0; i < n; i++) p.push({ x: out[i * 6], y: out[i * 6 + 1] });
    return p;
  };
  const run = (w: World, frames: number, pix = new Uint32Array(N).fill(PG_BG)) => {
    for (let n = 0; n < frames; n++) w.parts!.fullRender(pix, false, n);
  };

  /**
   * Velocities used to be written back only on a bounce, so gravity, drag and
   * forces lasted one frame each: fountains fanned out in straight lines and
   * nothing ever accelerated.
   */
  it('gravity accumulates: a particle fired upward slows as it climbs', () => {
    const w = playground();
    w.parts!.fireflies(320, 100); // spawn something, then swap it for a faller
    w.parts!.reset();
    // low enough that the climb never reaches the top edge, which is a wall
    // too - bouncing off it faked the slowdown even with the bug back in
    w.parts!.tool({ kind: 'hose', x: 320, y: 300, phase: 'down' });
    run(w, 5);
    const y0 = positions(w).reduce((a, p) => a + p.y, 0);
    run(w, 10);
    const y1 = positions(w).reduce((a, p) => a + p.y, 0);
    run(w, 10);
    const y2 = positions(w).reduce((a, p) => a + p.y, 0);
    // fired upward: gravity that accumulates slows the climb. (Comparing the
    // signed displacements passed even with the bug - they are negative.)
    expect(y1 - y0).toBeLessThan(0);
    expect(Math.abs(y2 - y1)).toBeLessThan(Math.abs(y1 - y0) * 0.85);
  });

  it('a black hole pulls particles in and swallows them', () => {
    const w = playground();
    w.parts!.placeForce('blackhole', 320, 180);
    for (let k = 0; k < 10; k++) w.parts!.fireflies(300 + k * 4, 150);
    const before = w.parts!.count;
    run(w, 400);
    expect(w.parts!.count).toBeLessThan(before / 2);
    // and it said so, for the sound
    expect(w.parts!.takeStats().holes).toBe(1);
  });

  it('fireflies float: gravity does not bring them down', () => {
    const w = playground();
    for (let k = 0; k < 6; k++) w.parts!.fireflies(200 + k * 40, 150);
    run(w, 200);
    const p = positions(w);
    const meanY = p.reduce((a, q) => a + q.y, 0) / p.length;
    expect(Math.abs(meanY - 150)).toBeLessThan(25);
  });

  it('a bumper bounces particles higher than a wall does', () => {
    // particle-frames spent well above the floor, over the floor, after landing
    const airtime = (mat: number) => {
      const w = playground();
      for (let x = 200; x < 440; x++) w.grid.setXY(x, 300, mat);
      // hose aimed straight down at the floor, so the only way up is a bounce
      w.parts!.tool({ kind: 'hose', x: 320, y: 220, phase: 'down' });
      for (let k = 0; k < 30; k++) w.parts!.tool({ kind: 'hose', x: 320, y: 226, phase: 'move' });
      const pix = new Uint32Array(N).fill(PG_BG);
      let high = 0;
      // after landing (~frame 15), count particle-frames back up above 265:
      // drag eats some of the rebound, so a bumper bounce peaks ~245
      for (let n = 0; n < 110; n++) {
        w.parts!.fullRender(pix, false, n);
        if (n < 25) continue;
        for (const p of positions(w)) if (p.x > 200 && p.x < 440 && p.y > 200 && p.y < 265) high++;
      }
      return high;
    };
    const bumper = airtime(PG_BUMPER);
    expect(bumper).toBeGreaterThan(100);
    expect(bumper).toBeGreaterThan(airtime(Mat.WALL) * 3);
  });

  it('fast particles cannot tunnel through a one-cell wall', () => {
    const w = playground();
    for (let x = 100; x < 540; x++) w.grid.setXY(x, 300, Mat.WALL);
    w.parts!.tool({ kind: 'hose', x: 320, y: 120, phase: 'down' });
    for (let k = 0; k < 40; k++) w.parts!.tool({ kind: 'hose', x: 320, y: 126, phase: 'move' });
    let leaked = 0;
    const pix = new Uint32Array(N).fill(PG_BG);
    for (let n = 0; n < 90; n++) {
      w.parts!.fullRender(pix, false, n);
      for (const p of positions(w)) if (p.x > 110 && p.x < 530 && p.y > 301) leaked++;
    }
    expect(leaked).toBe(0);
  });

  it('slow-mo slows everything down', () => {
    const travel = (scale: number) => {
      const w = playground();
      w.parts!.timeScale = scale;
      w.parts!.tool({ kind: 'hose', x: 320, y: 60, phase: 'down' });
      const a = positions(w).reduce((s, p) => s + p.y, 0);
      run(w, 20);
      return positions(w).reduce((s, p) => s + p.y, 0) - a;
    };
    expect(travel(0.33)).toBeLessThan(travel(1) * 0.5);
  });

  it('reports what happened for the sound design', () => {
    const w = playground();
    w.parts!.tool({ kind: 'fountain', x: 320, y: 300, phase: 'down' });
    w.parts!.tool({ kind: 'sparkler', x: 200, y: 200, phase: 'down' });
    const st = w.parts!.takeStats();
    expect(st.fountain).toBeGreaterThan(0);
    expect(st.sparkler).toBeGreaterThan(0);
    expect(st.particles).toBe(w.parts!.count);
    // and the counters reset after being taken
    expect(w.parts!.takeStats().fountain).toBe(0);
  });
});

