import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { Mat } from '../src/sim/materials';
import { CHUNK_SHIFT, CHUNKS_X } from '../src/sim/protocol';

/**
 * Embers used to be immortal. The half-rate decay was gated on `life & 1`,
 * which only ever decrements from an even value, so an ember fell to the
 * first odd number and stopped: it never became smoke, and it kept calling
 * wakeCell() on its chunk every frame forever.
 */
describe('ember burnout', () => {
  it('burns out instead of smoldering forever', () => {
    const w = new World(9);
    w.grid.setXY(300, 200, Mat.WALL);
    w.grid.setXY(300, 199, Mat.EMBER, 40);
    for (let n = 0; n < 200; n++) w.step();
    expect(w.grid.get(300, 199)).not.toBe(Mat.EMBER);
    expect(w.grid.counts[Mat.EMBER]).toBe(0);
  });

  it('decays from an odd starting life too', () => {
    const w = new World(9);
    w.grid.setXY(300, 200, Mat.WALL);
    w.grid.setXY(300, 199, Mat.EMBER, 41);
    for (let n = 0; n < 200; n++) w.step();
    expect(w.grid.counts[Mat.EMBER]).toBe(0);
  });

  it('takes longer to die than an equivalent flame', () => {
    const life = (mat: number): number => {
      const w = new World(9);
      w.grid.setXY(300, 200, Mat.WALL);
      w.grid.setXY(300, 199, mat, 40);
      let n = 0;
      while (n < 400 && w.grid.counts[mat] > 0) {
        w.step();
        n++;
      }
      return n;
    };
    // half-rate decay means an ember should outlast a flame of the same life
    expect(life(Mat.EMBER)).toBeGreaterThan(life(Mat.FIRE));
  });

  it('lets its chunk fall asleep once it is gone', () => {
    const w = new World(9);
    w.grid.setXY(300, 200, Mat.WALL);
    w.grid.setXY(300, 199, Mat.EMBER, 40);
    for (let n = 0; n < 400; n++) w.step();
    const ci = (199 >> CHUNK_SHIFT) * CHUNKS_X + (300 >> CHUNK_SHIFT);
    // an immortal ember woke this chunk on every frame, forever
    expect(w.grid.chunks.act[ci]).toBe(0);
  });
});
