import { describe, expect, it } from 'vitest';
import { Mat } from '../src/sim/materials';
import { World } from '../src/sim/world';

/** A fresh sandbox; `put` fills a rectangle, `run` steps and collects the booms' radii. */
function sandbox() {
  const w = new World(42);
  const g = w.grid;
  const put = (m: number, x0: number, y0: number, x1 = x0, y1 = y0) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g.setXY(x, y, m);
  };
  const booms: number[] = [];
  const run = (n: number) => {
    for (let k = 0; k < n; k++) {
      w.step();
      const b = w.takeEvents().booms;
      for (let j = 2; j < b.length; j += 3) booms.push(b[j]);
    }
  };
  const count = (m: number) => g.counts[m];
  return { w, put, run, count, booms };
}

describe('NITRO: a liquid that goes off', () => {
  it('a long drop lands as a blast', () => {
    const s = sandbox();
    s.put(Mat.WALL, 280, 300, 320, 300);
    s.put(Mat.NITRO, 300, 100);
    s.run(200);
    expect(s.count(Mat.NITRO)).toBe(0);
    expect(s.booms).toContain(6);
  });

  it('poured gently into a tub, it sits there', () => {
    const s = sandbox();
    s.put(Mat.WALL, 280, 300, 320, 300);
    s.put(Mat.WALL, 280, 290, 280, 299);
    s.put(Mat.WALL, 320, 290, 320, 299);
    s.put(Mat.NITRO, 295, 297, 305, 299);
    s.run(150);
    expect(s.count(Mat.NITRO)).toBe(33);
    expect(s.booms).toEqual([]);
  });

  it('heat beside it sets it off', () => {
    const s = sandbox();
    s.put(Mat.WALL, 280, 300, 320, 300);
    s.put(Mat.NITRO, 300, 299);
    s.put(Mat.TORCH, 301, 299);
    s.run(5);
    expect(s.count(Mat.NITRO)).toBe(0);
  });
});

describe('C4 and the big red button', () => {
  it('fire will not set C4 off; the button does', () => {
    const s = sandbox();
    s.put(Mat.WALL, 280, 300, 320, 300);
    s.put(Mat.C4, 296, 295, 300, 299);
    s.put(Mat.TORCH, 301, 299);
    s.run(120);
    expect(s.count(Mat.C4)).toBe(25);
    expect(s.booms).toEqual([]);
    s.w.applyInput({ k: 'detonate' });
    s.run(10);
    expect(s.count(Mat.C4)).toBe(0);
    expect(s.booms).toContain(10);
  });

  it('the button sets off TNT and NITRO too, at once rather than on a fuse', () => {
    const s = sandbox();
    s.put(Mat.WALL, 100, 300, 500, 300);
    s.put(Mat.TNT, 150, 299);
    s.put(Mat.NITRO, 450, 299);
    s.w.applyInput({ k: 'detonate' });
    s.run(8);
    expect(s.count(Mat.TNT)).toBe(0);
    expect(s.count(Mat.NITRO)).toBe(0);
  });

  it('does nothing outside the sandbox', () => {
    const s = sandbox();
    s.put(Mat.C4, 300, 299);
    s.w.applyInput({ k: 'mode', m: 'playground' });
    s.w.applyInput({ k: 'detonate' });
    s.w.applyInput({ k: 'mode', m: 'sand' });
    s.put(Mat.C4, 300, 299);
    s.run(10);
    expect(s.count(Mat.C4)).toBe(1);
  });
});

describe('ANTIMATTER', () => {
  it('annihilates what it lands on, cell for cell', () => {
    const s = sandbox();
    s.put(Mat.STONE, 280, 280, 320, 299);
    s.put(Mat.ANTIMATTER, 295, 200, 304, 201); // 20 cells
    const stone = s.count(Mat.STONE);
    s.run(200);
    expect(s.count(Mat.ANTIMATTER)).toBe(0);
    expect(stone - s.count(Mat.STONE)).toBe(20);
  });

  it('waits in a WALL box', () => {
    const s = sandbox();
    s.put(Mat.WALL, 280, 300, 320, 300);
    s.put(Mat.ANTIMATTER, 295, 290, 304, 291);
    s.run(150);
    expect(s.count(Mat.ANTIMATTER)).toBe(20);
    expect(s.count(Mat.WALL)).toBe(41);
  });
});

describe('THERMITE', () => {
  it('lit, it burns down through stone and stops at a wall', () => {
    const s = sandbox();
    s.put(Mat.WALL, 280, 310, 320, 310);
    s.put(Mat.STONE, 280, 296, 320, 309);
    s.put(Mat.THERMITE, 298, 293, 302, 295);
    s.put(Mat.TORCH, 297, 295);
    const stone = s.count(Mat.STONE);
    s.run(400);
    expect(stone - s.count(Mat.STONE)).toBeGreaterThan(10);
    expect(s.count(Mat.WALL)).toBe(41);
  });

  it('unlit, it is just a powder', () => {
    const s = sandbox();
    s.put(Mat.STONE, 280, 296, 320, 309);
    s.put(Mat.THERMITE, 298, 293, 302, 295);
    const stone = s.count(Mat.STONE);
    s.run(200);
    expect(s.count(Mat.STONE)).toBe(stone);
    expect(s.count(Mat.THERMITE)).toBe(15);
  });

  it('fuses sand to glass on its way down', () => {
    const s = sandbox();
    s.put(Mat.WALL, 280, 320, 320, 320);
    s.put(Mat.SAND, 280, 296, 320, 319);
    s.put(Mat.THERMITE, 299, 294, 301, 295);
    s.put(Mat.TORCH, 298, 295);
    s.run(300);
    expect(s.count(Mat.GLASS)).toBeGreaterThan(3);
  });
});

describe('a slab of C4', () => {
  it('all goes up, not just its edges', () => {
    const s = sandbox();
    s.put(Mat.WALL, 250, 300, 350, 300);
    s.put(Mat.C4, 280, 290, 319, 299); // 400 cells
    s.w.applyInput({ k: 'detonate' });
    s.run(30);
    expect(s.count(Mat.C4)).toBe(0);
    // most of it blew rather than burned
    expect(s.booms.filter((r) => r === 10).length).toBeGreaterThan(300);
  });
});
