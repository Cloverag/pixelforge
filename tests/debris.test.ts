import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { Mat } from '../src/sim/materials';
import { SIM_W } from '../src/sim/protocol';
import { packSnapshot, unpackSnapshot } from '../src/net/pack';

function stepN(w: World, n: number): void {
  for (let i = 0; i < n; i++) w.step();
}

/** a sand bed from y=300 down to a wall floor at 340, full width */
function sandBed(seed: number): World {
  const w = new World(seed);
  for (let x = 0; x < SIM_W; x++) {
    w.grid.setXY(x, 340, Mat.WALL);
    for (let y = 300; y < 340; y++) w.grid.setXY(x, y, Mat.SAND);
  }
  return w;
}

const pieces = (w: World) => w.debris.length / 6;

describe('TNT debris', () => {
  it('throws sand out of the crater and lands it beyond the rim', () => {
    const w = sandBed(3);
    w.explode(320, 300, 9, true);
    expect(pieces(w)).toBeGreaterThan(50);
    // let the bed settle back to a flat top everywhere the blast missed,
    // then look for sand heaped above it well away from the crater
    stepN(w, 400);
    expect(pieces(w)).toBe(0);
    let ejecta = 0;
    for (let x = 0; x < SIM_W; x++) {
      if (Math.abs(x - 320) < 20) continue;
      for (let y = 250; y < 300; y++) if (w.grid.get(x, y) === Mat.SAND) ejecta++;
    }
    expect(ejecta).toBeGreaterThan(20);
  });

  it('puts back every grain it threw', () => {
    const w = sandBed(5);
    w.explode(320, 300, 9, true);
    let flying = 0;
    for (let o = 0; o < w.debris.length; o += 6) if (w.debris[o + 4] === Mat.SAND) flying++;
    const onGround = w.grid.counts[Mat.SAND];
    expect(flying).toBeGreaterThan(0);
    stepN(w, 400);
    expect(pieces(w)).toBe(0);
    expect(w.grid.counts[Mat.SAND]).toBe(onGround + flying);
  });

  it('never passes through a one-cell roof', () => {
    const w = sandBed(9);
    for (let x = 0; x < SIM_W; x++) w.grid.setXY(x, 290, Mat.WALL);
    w.explode(320, 300, 9, true);
    // the roof is inside the blast, so a fast piece reaches it on frame one
    stepN(w, 400);
    let above = 0;
    for (let x = 0; x < SIM_W; x++) for (let y = 0; y < 290; y++) if (w.grid.get(x, y) !== Mat.EMPTY) above++;
    expect(above).toBe(0);
  });

  it('half of what burns flies as embers', () => {
    const w = new World(11);
    for (let x = 280; x < 360; x++) for (let y = 280; y < 320; y++) w.grid.setXY(x, y, Mat.WOOD);
    w.explode(320, 300, 9, true);
    let embers = 0;
    let wood = 0;
    for (let o = 0; o < w.debris.length; o += 6) {
      if (w.debris[o + 4] === Mat.EMBER) embers++;
      if (w.debris[o + 4] === Mat.WOOD) wood++;
    }
    expect(embers).toBeGreaterThan(10);
    expect(wood).toBeGreaterThan(10);
  });

  it('gunpowder still just pops: nothing flies', () => {
    const w = sandBed(13);
    w.explode(320, 300, 5);
    expect(pieces(w)).toBe(0);
  });

  it('walls and glass stay where they are', () => {
    const w = new World(17);
    for (let x = 300; x < 340; x++) for (let y = 290; y < 310; y++) w.grid.setXY(x, y, x < 320 ? Mat.WALL : Mat.GLASS);
    const walls = w.grid.counts[Mat.WALL];
    const glass = w.grid.counts[Mat.GLASS];
    w.explode(320, 300, 9, true);
    expect(pieces(w)).toBe(0);
    expect(w.grid.counts[Mat.WALL]).toBe(walls);
    expect(w.grid.counts[Mat.GLASS]).toBe(glass);
  });

  it('a peer restored mid-flight lands every piece where the host does', () => {
    const a = sandBed(21);
    a.explode(320, 300, 9, true);
    stepN(a, 12);
    expect(pieces(a)).toBeGreaterThan(20); // genuinely in the air
    const b = new World(999);
    b.restore(unpackSnapshot(packSnapshot(a.snapshot())));
    expect(b.hash()).toBe(a.hash());
    stepN(a, 300);
    stepN(b, 300);
    expect(b.hash()).toBe(a.hash());
    expect(Array.from(b.grid.cells)).toEqual(Array.from(a.grid.cells));
  });

  it('the fingerprint sees a piece in flight', () => {
    const a = sandBed(23);
    a.explode(320, 300, 9, true);
    const b = new World(1);
    b.restore(a.snapshot());
    expect(b.hash()).toBe(a.hash());
    b.debris[2] += 0.25; // one piece flying a little faster
    expect(b.hash()).not.toBe(a.hash());
  });
});
