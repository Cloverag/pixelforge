import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { Mat, WIND_SUSC, Cat, MATS } from '../src/sim/materials';
import { Wind } from '../src/sim/wind';
import { SIM_W } from '../src/sim/protocol';

function stepN(w: World, n: number): void {
  for (let i = 0; i < n; i++) w.step();
}

/** Mean x of every cell holding `mat`, or null if there are none left. */
function centroidX(w: World, mat: number): number | null {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < w.grid.cells.length; i++) {
    if (w.grid.cells[i] !== mat) continue;
    sum += i % SIM_W;
    n++;
  }
  return n === 0 ? null : sum / n;
}

describe('wind field', () => {
  it('is still until something disturbs it', () => {
    const w = new World(11);
    expect(w.wind.isMoving).toBe(false);
    expect(w.wind.atX(100, 100)).toBe(0);
    expect(w.wind.atY(100, 100)).toBe(0);
  });

  it('carries smoke downwind', () => {
    const w = new World(5);
    for (let x = 150; x < 170; x++) w.grid.setXY(x, 200, Mat.SMOKE, 200);
    const before = centroidX(w, Mat.SMOKE)!;
    w.wind.addGust(160, 200, 1.4, 0, 60);
    stepN(w, 40);
    const after = centroidX(w, Mat.SMOKE);
    expect(after).not.toBeNull();
    expect(after!).toBeGreaterThan(before + 5);
  });

  it('blows the other way when the gust does', () => {
    const w = new World(5);
    for (let x = 150; x < 170; x++) w.grid.setXY(x, 200, Mat.SMOKE, 200);
    const before = centroidX(w, Mat.SMOKE)!;
    w.wind.addGust(160, 200, -1.4, 0, 60);
    stepN(w, 40);
    expect(centroidX(w, Mat.SMOKE)!).toBeLessThan(before - 5);
  });

  it('leaves smoke alone when the field is still', () => {
    const w = new World(5);
    for (let x = 150; x < 170; x++) w.grid.setXY(x, 200, Mat.SMOKE, 200);
    const before = centroidX(w, Mat.SMOKE)!;
    stepN(w, 40);
    // smoke wanders on its own, but with no wind it should not travel
    expect(Math.abs(centroidX(w, Mat.SMOKE)! - before)).toBeLessThan(4);
  });

  it('runs out and stops costing anything', () => {
    const w = new World(3);
    w.wind.addGust(320, 180, 2, 0, 40);
    stepN(w, 1);
    expect(w.wind.isMoving).toBe(true);
    stepN(w, 400);
    expect(w.wind.isMoving).toBe(false);
    expect(w.wind.atX(320, 180)).toBe(0);
  });

  it('is cleared with the world', () => {
    const w = new World(3);
    w.wind.addGust(320, 180, 2, 0, 40);
    stepN(w, 1);
    w.clear();
    expect(w.wind.isMoving).toBe(false);
  });

  it('is stirred by explosions', () => {
    const w = new World(3);
    expect(w.wind.isMoving).toBe(false);
    w.explode(320, 180, 9);
    w.step();
    expect(w.wind.isMoving).toBe(true);
    // the shock front points away from the centre on both sides, inside the
    // blast radius (5x the crater, so ~45 cells for an r=9 explosion)
    expect(w.wind.atX(350, 180)).toBeGreaterThan(0);
    expect(w.wind.atX(290, 180)).toBeLessThan(0);
    // and does not reach across the whole map
    expect(w.wind.atX(600, 180)).toBe(0);
  });

  it('does not move liquids or solids', () => {
    expect(WIND_SUSC[Mat.WATER]).toBe(0);
    expect(WIND_SUSC[Mat.LAVA]).toBe(0);
    expect(WIND_SUSC[Mat.STONE]).toBe(0);
    expect(WIND_SUSC[Mat.WALL]).toBe(0);
    for (let m = 0; m < WIND_SUSC.length; m++) {
      if (!MATS[m]) continue;
      if (MATS[m].cat === Cat.LIQUID || MATS[m].cat === Cat.SOLID)
        expect(WIND_SUSC[m]).toBe(0);
    }
  });

  it('moves light powders more than heavy ones', () => {
    expect(WIND_SUSC[Mat.SNOW]).toBeGreaterThan(WIND_SUSC[Mat.SAND]);
    expect(WIND_SUSC[Mat.SMOKE]).toBe(1);
  });
});

describe('Wind.nudge', () => {
  it('is a coin flip weighted by velocity', () => {
    // 0.5 velocity at full susceptibility: half the rolls should move
    expect(Wind.nudge(0.5, 1, 0.4)).toBe(1);
    expect(Wind.nudge(0.5, 1, 0.6)).toBe(0);
    expect(Wind.nudge(-0.5, 1, 0.4)).toBe(-1);
  });

  it('never exceeds one cell however hard the gust', () => {
    expect(Wind.nudge(50, 1, 0.99)).toBe(1);
    expect(Wind.nudge(-50, 1, 0.99)).toBe(-1);
  });

  it('is inert at zero velocity or zero susceptibility', () => {
    expect(Wind.nudge(0, 1, 0)).toBe(0);
    expect(Wind.nudge(9, 0, 0)).toBe(0);
  });
});

describe('the wind brush', () => {
  it('blows without placing anything', () => {
    const w = new World(3);
    const before = w.grid.counts[Mat.EMPTY];
    w.paint([100, 100, 110, 100, 120, 100], Mat.SAND, 8, 'wind');
    expect(w.grid.counts[Mat.SAND]).toBe(0);
    expect(w.grid.counts[Mat.EMPTY]).toBe(before);
    w.step();
    expect(w.wind.isMoving).toBe(true);
    expect(w.wind.atX(115, 100)).toBeGreaterThan(0);
  });

  it('puffs outward when the stroke has no direction', () => {
    const w = new World(3);
    w.paint([300, 180], Mat.SAND, 8, 'wind');
    w.step();
    expect(w.wind.isMoving).toBe(true);
  });
});

describe('ash', () => {
  it('is what wood ends up as', () => {
    const w = new World(21);
    // a wood block with fire on top of it
    for (let y = 200; y < 206; y++)
      for (let x = 300; x < 312; x++) w.grid.setXY(x, y, Mat.WOOD);
    for (let x = 300; x < 312; x++) w.grid.setXY(x, 199, Mat.FIRE, 40);
    const wood0 = w.grid.counts[Mat.WOOD];
    stepN(w, 400);
    // wood is only 6% flammable per tick, so a lit face chars rather than
    // the whole block going up; what matters is that what burns leaves ash
    expect(w.grid.counts[Mat.WOOD]).toBeLessThan(wood0);
    expect(w.grid.counts[Mat.ASH]).toBeGreaterThan(0);
  });

  it('blows further than sand in the same gust', () => {
    const drift = (mat: number): number => {
      const w = new World(4);
      // a floor to land on, so grains travel instead of falling off-screen
      for (let x = 0; x < SIM_W; x++) w.grid.setXY(x, 300, Mat.WALL);
      for (let x = 200; x < 210; x++) w.grid.setXY(x, 250, mat);
      const before = centroidX(w, mat)!;
      for (let i = 0; i < 120; i++) {
        w.wind.addGust(205, 260, 2.5, 0, 90);
        w.step();
      }
      return centroidX(w, mat)! - before;
    };
    const ash = drift(Mat.ASH);
    const sand = drift(Mat.SAND);
    expect(ash).toBeGreaterThan(sand);
    expect(sand).toBeGreaterThanOrEqual(0);
  });
});
