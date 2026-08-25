import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { Mat } from '../src/sim/materials';
import { SIM_H, SIM_W } from '../src/sim/protocol';

function stepN(w: World, n: number): void {
  for (let i = 0; i < n; i++) w.step();
}

describe('falling sand world', () => {
  it('sand falls through empty space', () => {
    const w = new World(42);
    w.grid.setXY(10, 10, Mat.SAND);
    stepN(w, 8);
    expect(w.grid.get(10, 18)).toBe(Mat.SAND);
    expect(w.grid.counts[Mat.SAND]).toBe(1);
  });

  it('sand grains all land on the floor', () => {
    const w = new World(7);
    for (let i = 0; i < 30; i++) w.grid.setXY(12 + (i % 16), 2 + ((i / 16) | 0) * 3, Mat.SAND);
    stepN(w, 400);
    let onFloor = 0;
    for (let y = SIM_H - 10; y < SIM_H; y++)
      for (let x = 0; x < SIM_W; x++)
        if (w.grid.get(x, y) === Mat.SAND) onFloor++;
    expect(onFloor).toBe(30);
    expect(w.grid.counts[Mat.SAND]).toBe(30);
  });

  it('sand sinks through water and rests on the pool floor', () => {
    const w = new World(99);
    for (let y = 20; y < 40; y++)
      for (let x = 40; x < 60; x++) w.grid.setXY(x, y, Mat.WATER);
    for (let x = 39; x <= 60; x++) w.grid.setXY(x, 40, Mat.WALL); // pool floor
    w.grid.setXY(50, 10, Mat.SAND);
    stepN(w, 300);
    // grain rests on the pool floor (may drift a little while sinking)
    let found = false;
    for (let x = 42; x < 58; x++)
      if (w.grid.get(x, 39) === Mat.SAND) found = true;
    expect(found).toBe(true);
    expect(w.grid.counts[Mat.WATER]).toBe(400);
  });

  it('water disperses to fill a container floor', () => {
    const w = new World(5);
    for (let y = 200; y <= 220; y++) {
      w.grid.setXY(100, y, Mat.WALL);
      w.grid.setXY(140, y, Mat.WALL);
    }
    for (let x = 100; x <= 140; x++) w.grid.setXY(x, 220, Mat.WALL);
    // pour a blob of water
    for (let y = 201; y <= 205; y++)
      for (let x = 116; x <= 124; x++) w.grid.setXY(x, y, Mat.WATER);
    stepN(w, 600);
    let left = false;
    let right = false;
    let total = 0;
    for (let x = 101; x <= 139; x++) {
      if (w.grid.get(x, 219) === Mat.WATER) {
        total++;
        if (x <= 115) left = true;
        if (x >= 125) right = true;
      }
    }
    expect(total).toBeGreaterThanOrEqual(30);
    expect(left).toBe(true);
    expect(right).toBe(true);
  });

  it('fire ignites adjacent oil', () => {
    const w = new World(11);
    w.grid.setXY(50, 49, Mat.OIL);
    w.grid.setXY(50, 50, Mat.FIRE, 40);
    stepN(w, 300);
    expect(w.grid.counts[Mat.OIL]).toBe(0);
  });

  it('lava + water makes stone + steam', () => {
    const w = new World(3);
    w.grid.setXY(60, 60, Mat.LAVA);
    w.grid.setXY(61, 60, Mat.WATER);
    stepN(w, 60);
    expect(w.grid.counts[Mat.STONE]).toBeGreaterThanOrEqual(1);
  });

  it('gunpowder chain explodes from fire contact', () => {
    const w = new World(13);
    for (let x = 76; x <= 88; x++) w.grid.setXY(x, 82, Mat.WALL); // ledge
    for (let x = 78; x <= 84; x++) w.grid.setXY(x, 80, Mat.GUNPOWDER);
    w.grid.setXY(77, 80, Mat.FIRE, 80); // directly adjacent
    stepN(w, 240);
    expect(w.grid.counts[Mat.GUNPOWDER]).toBe(0);
  });

  it('seed sprouts next to water and plants grow into it', () => {
    const w = new World(21);
    w.grid.setXY(70, 100, Mat.SEED);
    w.grid.setXY(71, 100, Mat.WATER);
    stepN(w, 600);
    expect(w.grid.counts[Mat.PLANT]).toBeGreaterThanOrEqual(1);
  });

  it('explode clears non-wall cells and increments shake', () => {
    const w = new World(17);
    for (let y = 100; y < 110; y++)
      for (let x = 100; x < 110; x++) w.grid.setXY(x, y, Mat.SAND);
    w.explode(105, 105, 6);
    expect(w.shake).toBeGreaterThan(0);
    expect(w.grid.counts[Mat.SAND]).toBeLessThan(100);
  });

  it('counts stay consistent after many paints', () => {
    const w = new World(777);
    for (let i = 0; i < 500; i++) {
      const x = w.rng.int(SIM_W);
      const y = w.rng.int(SIM_H);
      w.grid.setXY(x, y, w.rng.chance(0.5) ? Mat.SAND : Mat.EMPTY);
    }
    let actual = 0;
    for (const c of w.grid.cells) if (c === Mat.SAND) actual++;
    expect(w.grid.counts[Mat.SAND]).toBe(actual);
  });

  it('challenge load resets grid and lays out terrain', () => {
    const w = new World(8);
    w.grid.setXY(5, 5, Mat.SAND);
    expect(w.loadChallenge('aqueduct')).toBe(true);
    expect(w.grid.get(534, 320)).toBe(Mat.STONE); // basin wall
    expect(w.grid.counts[Mat.SAND]).toBe(0); // cleared
    stepN(w, 120);
    expect(w.grid.counts[Mat.WATER]).toBeGreaterThan(50); // spring pours
  });

  // ---------- F1: electricity ----------

  it('torch energizes adjacent wire', () => {
    const w = new World(31);
    w.grid.setXY(60, 100, Mat.TORCH);
    w.grid.setXY(61, 100, Mat.WIRE);
    stepN(w, 10);
    expect(w.grid.meta[w.grid.idx(61, 100)]).toBeGreaterThan(0);
  });

  it('spark pulses travel along wire', () => {
    const w = new World(32);
    w.grid.setXY(60, 100, Mat.TORCH);
    for (let x = 61; x <= 80; x++) w.grid.setXY(x, 100, Mat.WIRE);
    stepN(w, 60); // pulses move 1 cell/frame; far end is 20 away
    expect(w.grid.meta[w.grid.idx(80, 100)]).toBeGreaterThan(0);
  });

  it('wire spark detonates gunpowder', () => {
    const w = new World(33);
    w.grid.setXY(60, 100, Mat.TORCH);
    for (let x = 61; x <= 70; x++) w.grid.setXY(x, 100, Mat.WIRE);
    for (let x = 70; x <= 72; x++) w.grid.setXY(x, 101, Mat.WALL); // wide ledge
    w.grid.setXY(71, 100, Mat.GUNPOWDER); // rests beside the wire end
    stepN(w, 90);
    expect(w.grid.counts[Mat.GUNPOWDER]).toBe(0);
  });

  it('spark electrifies water into steam', () => {
    const w = new World(34);
    w.grid.setXY(60, 100, Mat.TORCH);
    w.grid.setXY(61, 100, Mat.WIRE);
    // sealed basin so the water stays against the live wire
    w.grid.setXY(61, 101, Mat.WALL);
    w.grid.setXY(61, 102, Mat.WALL);
    w.grid.setXY(62, 102, Mat.WALL);
    w.grid.setXY(63, 100, Mat.WALL);
    w.grid.setXY(63, 101, Mat.WALL);
    w.grid.setXY(63, 102, Mat.WALL);
    w.grid.setXY(62, 100, Mat.WATER);
    w.grid.setXY(62, 101, Mat.WATER);
    stepN(w, 120);
    expect(w.grid.counts[Mat.WATER]).toBeLessThan(2);
  });

  // ---------- F2: clone & void ----------

  it('clone captures falling material and emits copies', () => {
    const w = new World(35);
    w.grid.setXY(60, 96, Mat.CLONE);
    w.grid.setXY(60, 94, Mat.SAND); // falls onto clone -> captured
    stepN(w, 200);
    expect(w.grid.meta[w.grid.idx(60, 96)]).toBe(Mat.SAND);
    expect(w.grid.counts[Mat.SAND]).toBeGreaterThanOrEqual(3); // original + copies
  });

  it('void deletes neighboring material', () => {
    const w = new World(36);
    // sealed tank: side walls, floor, and a void drain in the middle
    for (let y = 88; y <= 100; y++) {
      w.grid.setXY(50, y, Mat.WALL);
      w.grid.setXY(70, y, Mat.WALL);
    }
    for (let x = 50; x <= 70; x++)
      w.grid.setXY(x, 100, x === 60 ? Mat.VOID : Mat.WALL);
    for (let y = 90; y < 100; y++)
      for (let x = 51; x < 70; x++) w.grid.setXY(x, y, Mat.WATER);
    stepN(w, 1800);
    expect(w.grid.counts[Mat.WATER]).toBe(0);
  });

  // ---------- F3: flood fill ----------

  it('flood fill replaces a connected region', () => {
    const w = new World(37);
    // sealed box of water
    for (let y = 100; y <= 120; y++) {
      w.grid.setXY(50, y, Mat.WALL);
      w.grid.setXY(70, y, Mat.WALL);
    }
    for (let x = 50; x <= 70; x++) w.grid.setXY(x, 120, Mat.WALL);
    for (let y = 110; y < 120; y++)
      for (let x = 51; x < 70; x++) w.grid.setXY(x, y, Mat.WATER);
    w.paint([60, 115], Mat.SAND, 1, 'flood');
    expect(w.grid.counts[Mat.WATER]).toBe(0);
    expect(w.grid.counts[Mat.SAND]).toBe(19 * 10);
  });

  // ---------- F4: beacon challenge ----------

  it('beacon challenge loads with torch and wire circuit', () => {
    const w = new World(38);
    expect(w.loadChallenge('beacon')).toBe(true);
    expect(w.grid.get(51, 296)).toBe(Mat.TORCH);
    expect(w.grid.get(70, 296)).toBe(Mat.WIRE);
    expect(w.grid.get(570, 270)).toBe(Mat.WIRE); // beacon core
    // pulses repeat every ~9 frames - sample a window, not one instant
    let sawSpark = false;
    for (let i = 0; i < 40; i++) {
      w.step();
      if (w.grid.meta[w.grid.idx(70, 296)] > 0) sawSpark = true;
    }
    expect(sawSpark).toBe(true);
  });
});
