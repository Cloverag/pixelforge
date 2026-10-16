import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { Mat } from '../src/sim/materials';
import { PG_BUMPER } from '../src/sim/particles';
import type { NetInput } from '../src/sim/protocol';
import { gunzip, gzip, packSnapshot, unpackSnapshot } from '../src/net/pack';

/**
 * The playground in a room: the same lockstep as the sandbox. On one engine
 * the whole show - every particle - must come out identical for the same
 * inputs, and a joiner restored mid-show must match the original exactly.
 */

const pgFull = (w: World) => {
  // everything, particles included (the room's fingerprint checks less)
  const p = w.parts!.pack();
  let h = 0x811c9dc5;
  for (let i = 0; i < p.length; i++) h = Math.imul(h ^ p[i], 0x01000193);
  return (h ^ w.hash()) >>> 0;
};

function script(f: number): NetInput[] {
  const pg = (kind: string, x: number, y: number, phase: 'down' | 'move' = 'down', extra = {}) =>
    ({ k: 'pg', tool: { kind, x, y, phase, ...extra } }) as NetInput;
  if (f === 0) return [{ k: 'mode', m: 'playground' }];
  if (f === 2) return [{ k: 'paint', pts: [100, 300, 540, 300], mat: PG_BUMPER, size: 3, kind: 'brush' }];
  if (f === 4) return [pg('blackhole', 320, 150), pg('portal', 80, 320), pg('portal', 560, 40)];
  const out: NetInput[] = [];
  if (f >= 10 && f < 200) out.push(pg('fountain', 200, 280, 'move'), pg('hose', 100, 100, 'move', { dx: 0.8, dy: 0.6 }));
  // 170: a rocket is still climbing when the joiner's snapshot is taken at 180
  // (these sat after an early return for frames 10-199 and never fired)
  if (f === 50 || f === 140 || f === 170) out.push(pg('firework', 400, 100));
  if (out.length) return out;
  if (f === 220) return [{ k: 'pgGravity', on: false }, { k: 'pgTime', scale: 0.33 }];
  if (f === 300) return [{ k: 'pgSurprise', seed: 4242 }];
  return [];
}

const run = (w: World, from: number, to: number, out: number[]) => {
  for (let f = from; f < to; f++) {
    for (const i of script(f)) w.applyInput(i);
    w.step();
    if (f % 25 === 24) out.push(pgFull(w));
  }
};

describe('playground lockstep', { timeout: 120_000 }, () => {
  it('two worlds fed the same playground inputs stay identical, particles and all', () => {
    const a = new World(7), b = new World(7);
    const ha: number[] = [], hb: number[] = [];
    run(a, 0, 600, ha);
    run(b, 0, 600, hb);
    expect(hb).toEqual(ha);
    expect(a.mode).toBe('playground');
    expect(a.parts!.count).toBeGreaterThan(50);
  });

  it('a joiner restored mid-show (through pack + gzip) matches the original exactly', async () => {
    const orig = new World(7);
    run(orig, 0, 180, []);
    expect((orig.parts as unknown as { rockets: unknown[] }).rockets.length).toBeGreaterThan(0);
    const snap = unpackSnapshot(await gunzip(await gzip(packSnapshot(orig.snapshot()))));
    const joiner = new World(99);
    joiner.restore(snap);
    expect(joiner.mode).toBe('playground');
    expect(pgFull(joiner)).toBe(pgFull(orig));
    const ho: number[] = [], hj: number[] = [];
    run(orig, 180, 500, ho);
    run(joiner, 180, 500, hj);
    expect(hj).toEqual(ho);
  });

  it('the room fingerprint sees what was built, not the particles', () => {
    const w = new World(3);
    w.applyInput({ k: 'mode', m: 'playground' });
    w.applyInput({ k: 'pg', tool: { kind: 'fountain', x: 300, y: 300, phase: 'down' } });
    for (let n = 0; n < 30; n++) w.step();
    const h0 = w.hash();
    // nudge one particle: not structure, the room must not notice
    (w.parts as unknown as { px: Float32Array }).px[0] += 3;
    expect(w.hash()).toBe(h0);
    // a new vortex is structure: it must
    w.applyInput({ k: 'pg', tool: { kind: 'vortex', x: 100, y: 100, phase: 'down' } });
    expect(w.hash()).not.toBe(h0);
    // and so is a wall
    const h1 = w.hash();
    w.grid.setXY(10, 10, Mat.WALL);
    expect(w.hash()).not.toBe(h1);
  });

  it('drawing does not change the simulation (catch-up peers draw less often)', () => {
    const a = new World(5), b = new World(5);
    const pix = new Uint32Array(640 * 360);
    for (const w of [a, b]) {
      w.applyInput({ k: 'mode', m: 'playground' });
      w.applyInput({ k: 'pg', tool: { kind: 'sparkler', x: 300, y: 200, phase: 'down' } });
    }
    for (let n = 0; n < 200; n++) {
      if (n < 100) for (const w of [a, b]) w.applyInput({ k: 'pg', tool: { kind: 'sparkler', x: 300, y: 200, phase: 'move' } });
      a.step();
      a.parts!.draw(pix, false, a.f); // draws every frame
      b.step();
      if (n % 7 === 0) b.parts!.draw(pix, false, b.f); // draws now and then
    }
    expect(pgFull(b)).toBe(pgFull(a));
  });
});
