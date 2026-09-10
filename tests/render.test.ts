import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { Mat } from '../src/sim/materials';
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
