import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { Mat, MATS } from '../src/sim/materials';
import { SAND_DEMOS, SANDBOX_SCENES } from '../src/game/sanddemos';

/** The title screen's sandbox demos are plain brush strokes; they must still do what their names say. */
function demo(name: string): World {
  const w = new World(5);
  w.applyInput({ k: 'mode', m: 'sand' });
  for (const s of SAND_DEMOS.find((d) => d.name === name)!.strokes) w.applyInput({ k: 'paint', pts: s.pts, mat: s.mat, size: s.size, kind: 'brush' });
  return w;
}

describe('sandbox demos behind the title screen', { timeout: 120_000 }, () => {
  it('are made of strokes a player could paint, inside the world', () => {
    for (const d of SAND_DEMOS)
      for (const s of d.strokes) {
        expect(MATS[s.mat].placeable, `${d.name} ${MATS[s.mat].name}`).toBe(true);
        for (let i = 0; i < s.pts.length; i += 2) {
          expect(s.pts[i]).toBeGreaterThanOrEqual(0);
          expect(s.pts[i]).toBeLessThanOrEqual(640);
          expect(s.pts[i + 1]).toBeGreaterThanOrEqual(0);
          expect(s.pts[i + 1]).toBeLessThanOrEqual(360);
        }
      }
  });

  it('FLOWER PONDS grows flowers within 20 seconds', () => {
    const w = demo('FLOWER PONDS');
    for (let f = 0; f < 1200; f++) w.step();
    expect(w.grid.counts[Mat.FLORA]).toBeGreaterThan(100);
  });

  it('VOLCANO: the lava reaches the water (steam or stone appears)', () => {
    const w = demo('VOLCANO');
    const stone0 = w.grid.counts[Mat.STONE];
    let steam = 0;
    for (let f = 0; f < 1500; f++) {
      w.step();
      steam = Math.max(steam, w.grid.counts[Mat.STEAM]);
    }
    expect(steam + (w.grid.counts[Mat.STONE] - stone0)).toBeGreaterThan(20);
  });

  it('TNT DEMOLITION: the torch lights the fuse and the charges go off', () => {
    const w = demo('TNT DEMOLITION');
    const tnt0 = w.grid.counts[Mat.TNT];
    expect(tnt0).toBeGreaterThan(50);
    for (let f = 0; f < 1500 && w.grid.counts[Mat.TNT] > 0; f++) w.step();
    expect(w.grid.counts[Mat.TNT]).toBeLessThan(tnt0 * 0.1);
  });

  it('WATERFALL: the lake spills into the valley and the seeds grow', () => {
    const w = demo('WATERFALL');
    for (let f = 0; f < 1500; f++) w.step();
    let low = 0;
    for (let y = 290; y < 330; y++) for (let x = 300; x < 600; x++) if (w.grid.get(x, y) === Mat.WATER) low++;
    expect(low).toBeGreaterThan(300);
    expect(w.grid.counts[Mat.FLORA] + w.grid.counts[Mat.PLANT]).toBeGreaterThan(30);
  });
});

describe('the sandbox scenes built on the new charges', { timeout: 180_000 }, () => {
  const scene = (name: string): World => {
    const w = new World(5);
    w.applyInput({ k: 'mode', m: 'sand' });
    for (const s of SANDBOX_SCENES.find((d) => d.name === name)!.strokes) w.applyInput({ k: 'paint', pts: s.pts, mat: s.mat, size: s.size, kind: 'brush' });
    return w;
  };
  const booms = (w: World, frames: number): number => {
    let n = 0;
    for (let f = 0; f < frames; f++) {
      w.step();
      n += w.takeEvents().booms.length / 3;
    }
    return n;
  };

  it('are made of strokes a player could paint, inside the world', () => {
    for (const d of SANDBOX_SCENES)
      for (const s of d.strokes) {
        expect(MATS[s.mat].placeable, `${d.name} ${MATS[s.mat].name}`).toBe(true);
        for (let i = 0; i < s.pts.length; i += 2) {
          expect(s.pts[i]).toBeGreaterThanOrEqual(0);
          expect(s.pts[i]).toBeLessThanOrEqual(640);
          expect(s.pts[i + 1]).toBeGreaterThanOrEqual(0);
          expect(s.pts[i + 1]).toBeLessThanOrEqual(360);
        }
      }
  });

  it('DEMOLITION YARD waits for the button, then all of it goes', () => {
    const w = scene('DEMOLITION YARD');
    expect(booms(w, 300)).toBe(0);
    const c4 = w.grid.counts[Mat.C4];
    expect(c4).toBeGreaterThan(100);
    const sandHigh = (): number => {
      let n = 0;
      for (let y = 200; y < 260; y++) for (let x = 60; x < 140; x++) if (w.grid.get(x, y) === Mat.SAND) n++;
      return n;
    };
    const high0 = sandHigh();
    expect(high0).toBeGreaterThan(1000);
    w.applyInput({ k: 'detonate' });
    expect(booms(w, 120)).toBeGreaterThan(100);
    expect(w.grid.counts[Mat.C4]).toBe(0);
    expect(w.grid.counts[Mat.TNT]).toBe(0);
    expect(w.grid.counts[Mat.NITRO]).toBe(0); // the cup fell with the deck
    // the frame's foot went and the tower pours out of it like an hourglass,
    // leaving a little on the frame's shoulders
    for (let f = 0; f < 900; f++) w.step();
    expect(sandHigh()).toBeLessThan(high0 / 3);
  });

  it('NITRO DRIP: drops land as blasts and set the TNT going, on their own', () => {
    const w = scene('NITRO DRIP');
    const tnt0 = w.grid.counts[Mat.TNT];
    // the first blast is a drop landing on the ground - not the trough going up
    let first: number[] = [];
    for (let f = 0; f < 600 && !first.length; f++) {
      w.step();
      first = w.takeEvents().booms;
    }
    expect(first.length).toBeGreaterThan(0);
    expect(first[1]).toBeGreaterThan(250);
    expect(booms(w, 900)).toBeGreaterThan(10);
    expect(w.grid.counts[Mat.TNT]).toBeLessThan(tnt0 * 0.2);
  });

  it('ANTIMATTER RAIN eats into the town, and the WALL hopper holds', () => {
    const w = scene('ANTIMATTER RAIN');
    const town = w.grid.counts[Mat.STONE] + w.grid.counts[Mat.GLASS] + w.grid.counts[Mat.WOOD];
    const wall = w.grid.counts[Mat.WALL];
    for (let f = 0; f < 900; f++) w.step();
    expect(town - (w.grid.counts[Mat.STONE] + w.grid.counts[Mat.GLASS] + w.grid.counts[Mat.WOOD])).toBeGreaterThan(150);
    expect(w.grid.counts[Mat.WALL]).toBe(wall);
  });

  it('THERMITE DRILL: the torches light it and it melts down into the rock', () => {
    const w = scene('THERMITE DRILL');
    const stone0 = w.grid.counts[Mat.STONE];
    let lava = 0;
    let steam = 0;
    for (let f = 0; f < 900; f++) {
      w.step();
      lava = Math.max(lava, w.grid.counts[Mat.LAVA]);
      steam = Math.max(steam, w.grid.counts[Mat.STEAM]);
    }
    expect(w.grid.counts[Mat.GLASS]).toBeGreaterThan(5); // the sand it went through
    expect(stone0 - w.grid.counts[Mat.STONE]).toBeGreaterThan(20);
    expect(lava).toBeGreaterThan(10);
  });
});
