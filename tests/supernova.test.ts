import { describe, expect, it } from 'vitest';
import { Grid } from '../src/sim/grid';
import { NOVA_COLLAPSE, NOVA_REMNANT, NOVA_SWELL, PSys } from '../src/sim/particles';
import { SIM_H, SIM_W } from '../src/sim/protocol';

const X = 320;
const Y = 180;
const BLAST = NOVA_SWELL + NOVA_COLLAPSE;

function star(): { p: PSys; booms: [number, number][]; run: (frames: number) => void } {
  const p = new PSys(new Grid(SIM_W, SIM_H));
  const booms: [number, number][] = [];
  p.onNova = (x, y) => booms.push([x, y]);
  p.tool({ kind: 'supernova', x: X, y: Y, phase: 'down' });
  let f = 0;
  return { p, booms, run: (frames) => { for (let k = 0; k < frames; k++) p.step(f++); } };
}
const holes = (p: PSys) => p.forces.filter((f) => f.kind === 'hole');
const meanY = (p: PSys) => {
  const out = new Float32Array(p.count * 6);
  const n = p.pack3d(out);
  let s = 0;
  for (let i = 0; i < n; i++) s += out[i * 6 + 1];
  return s / n;
};

describe('SUPERNOVA: a star that swells, collapses, explodes and leaves a black hole', () => {
  it('goes off once, at the end of its collapse, and not before', () => {
    const { p, booms, run } = star();
    run(BLAST - 1);
    expect(booms).toEqual([]);
    const before = p.count;
    run(1);
    expect(booms).toEqual([[X, Y]]);
    expect(p.count - before).toBeGreaterThanOrEqual(500);
    run(60);
    expect(booms.length).toBe(1);
  });

  it('leaves a black hole where it was, once the shell has flown clear', () => {
    const { p, run } = star();
    run(BLAST + NOVA_REMNANT - 2);
    expect(holes(p)).toEqual([]);
    expect(p.packForces().some((v, i) => i % 3 === 0 && v >= 7 && v < 8)).toBe(false);
    run(2);
    expect(holes(p).map((h) => [h.x, h.y])).toEqual([[X, Y]]);
  });

  it('shows its star to the 3D view while it swells, growing', () => {
    const { p, run } = star();
    run(10);
    const early = p.packForces()[0];
    run(NOVA_SWELL - 20);
    const late = p.packForces()[0];
    expect(Math.floor(early)).toBe(7);
    expect(late).toBeGreaterThan(early);
  });

  it('a nebula floats where the star was: gravity is for fireworks, not space', () => {
    const { p, run } = star();
    run(BLAST + 40);
    // a firework's stars fall ~70 cells in 40 frames; the nebula stays round its star
    expect(Math.abs(meanY(p) - Y)).toBeLessThan(15);
  });

  it('a room sees the same supernova: a snapshot mid-swell carries on identically', () => {
    const a = star();
    a.run(60);
    const b = new PSys(new Grid(SIM_W, SIM_H));
    b.unpack(a.p.pack());
    expect(b.structureHash()).toBe(a.p.structureHash());
    for (let f = 60; f < BLAST + NOVA_REMNANT + 5; f++) {
      a.p.step(f);
      b.step(f);
    }
    expect(b.pack()).toEqual(a.p.pack());
    expect(holes(b).length).toBe(1);
  });

  it('slow-mo slows the countdown with everything else', () => {
    const { p, booms, run } = star();
    p.timeScale = 1 / 3;
    run(BLAST * 2);
    expect(booms).toEqual([]);
    run(BLAST + 1);
    expect(booms.length).toBe(1);
  });
});
