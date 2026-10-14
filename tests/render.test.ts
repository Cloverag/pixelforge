import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { Mat, rampIndexAt } from '../src/sim/materials';
import { SIM_H, SIM_W } from '../src/sim/protocol';

const N = SIM_W * SIM_H;

function diff(a: Uint32Array, b: Uint32Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

/** A world with things that move and things that settle. */
function busyWorld(): World {
  const w = new World(9);
  for (let x = 0; x < SIM_W; x++) w.grid.setXY(x, 340, Mat.WALL);
  for (let y = 80; y < 100; y++)
    for (let x = 300; x < 340; x++) w.grid.setXY(x, y, Mat.SAND);
  for (let y = 80; y < 90; y++)
    for (let x = 200; x < 230; x++) w.grid.setXY(x, y, Mat.WATER);
  w.grid.setXY(100, 100, Mat.WALL); // changes once, then never again
  return w;
}

function lum(abgr: number): number {
  return (abgr & 255) + ((abgr >>> 8) & 255) + ((abgr >>> 16) & 255);
}

describe('pixel art shading', () => {
  /**
   * The bug this pins: colour was keyed on screen position, so a grain
   * changed colour on every frame it fell. A lone grain in free fall must
   * look identical at every height.
   */
  it('a falling grain keeps its own colour', () => {
    const w = new World(3);
    w.grid.setXY(320, 20, Mat.SAND);
    const buf = new Uint32Array(N);
    const seen = new Set<number>();
    let fell = 0;
    for (let n = 0; n < 60; n++) {
      w.step();
      w.renderInto(buf, true);
      let y = -1;
      for (let yy = 0; yy < SIM_H && y < 0; yy++)
        if (w.grid.get(320, yy) === Mat.SAND) y = yy;
      // wind drift could carry it off column; the world is still, so it won't
      expect(y).toBeGreaterThanOrEqual(0);
      if (y > 20) fell = y;
      // the rendered pixel, so this fails if either the grid stops carrying
      // the shade or the rasterizer stops reading it
      seen.add(buf[y * SIM_W + 320]);
    }
    expect(fell).toBeGreaterThan(40);
    expect(seen.size).toBe(1);
  });

  it('the old position rule really did change colour as it fell', () => {
    // guard on the test above: if every row hashed to the same ramp entry,
    // "keeps its colour" would pass on the old code too
    const picks = new Set<number>();
    for (let y = 20; y < 80; y++) picks.add(rampIndexAt(Mat.SAND, 320, y, 0, 0));
    expect(picks.size).toBeGreaterThan(1);
  });

  it('lights the top face of a pile and the waterline of a pool', () => {
    const w = new World(5);
    for (let y = 200; y < 220; y++)
      for (let x = 100; x < 140; x++) {
        w.grid.setXY(x, y, Mat.WALL);
        w.grid.setXY(x + 200, y, Mat.WATER);
      }
    const buf = new Uint32Array(N);
    w.renderInto(buf, true);
    let topWall = 0, midWall = 0, topWater = 0, midWater = 0;
    for (let x = 105; x < 135; x++) {
      topWall += lum(buf[200 * SIM_W + x]);
      midWall += lum(buf[210 * SIM_W + x]);
      topWater += lum(buf[200 * SIM_W + x + 200]);
      midWater += lum(buf[210 * SIM_W + x + 200]);
    }
    expect(topWall).toBeGreaterThan(midWall * 1.15);
    expect(topWater).toBeGreaterThan(midWater * 1.25);
    // and an overhang's underside is in shadow
    const under = lum(buf[219 * SIM_W + 120]);
    expect(under).toBeLessThan(midWall / 30);
  });
});

describe('lighting across chunk edges', () => {
  /**
   * A wall's lit top row is decided by the cell above it. When the wall's top
   * row is the first row of a chunk, that cell lives in the chunk above, so
   * covering it dirties only that chunk - unless Grid.markDirty reaches over.
   * The busy-world convergence test does not catch this (checked by deleting
   * the reach: it stayed green), hence a test aimed straight at it.
   */
  it.each([
    ['above', 207, 208],  // write in the row above a chunk's first row
    ['below', 216, 215],  // write under a chunk's last row (bevel shadow)
    ['two above', 206, 208], // liquid second-row reach
  ])('repaints when the neighbour %s changes', (_n, writeY, readY) => {
    const w = new World(1);
    // for the two-row case the pool's surface sits at 207, so 208 is the
    // second row and reads 206 - one chunk up and two rows away
    const liquid = writeY === 206;
    const mat = liquid ? Mat.WATER : Mat.WALL;
    for (let y = liquid ? 207 : 208; y < 216; y++)
      for (let x = 96; x < 104; x++) w.grid.setXY(x, y, mat);
    const buf = new Uint32Array(N);
    w.renderInto(buf, true);
    w.grid.setXY(100, writeY, Mat.STONE);
    w.renderInto(buf, false);
    const truth = new Uint32Array(N);
    w.renderInto(truth, true);
    expect(buf[readY * SIM_W + 100]).toBe(truth[readY * SIM_W + 100]);
  });
});

describe('incremental rasterization', () => {
  it('converges on the full render when one buffer is reused', () => {
    const w = busyWorld();
    const buf = new Uint32Array(N);
    w.renderInto(buf, true);
    for (let n = 0; n < 240; n++) {
      w.step();
      w.renderInto(buf, false);
    }
    const truth = new Uint32Array(N);
    w.renderInto(truth, true);
    expect(diff(buf, truth)).toBe(0);
  });

  /**
   * The reason the worker keeps an authoritative `master` buffer instead of
   * rasterizing straight into whichever frame buffer arrived.
   *
   * renderInto paints only dirty chunks and clears the flag as it goes, so a
   * change reaches exactly one buffer. With the frame buffers ping-ponging,
   * the other one kept its old content for that chunk forever and settled
   * material strobed at 30 Hz between its last two states. If this test ever
   * goes green, the double-buffer hazard is gone and `master` can be dropped.
   */
  it('does NOT converge when two buffers alternate - hence master', () => {
    const w = busyWorld();
    const a = new Uint32Array(N);
    const b = new Uint32Array(N);
    w.renderInto(a, true);
    w.renderInto(b, true);
    const bufs = [a, b];
    for (let n = 0; n < 240; n++) {
      w.step();
      w.renderInto(bufs[n & 1], false);
    }
    const truth = new Uint32Array(N);
    w.renderInto(truth, true);
    expect(diff(a, truth) + diff(b, truth)).toBeGreaterThan(0);
  });
});
