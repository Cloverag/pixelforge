import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { Mat, MATS } from '../src/sim/materials';
import { SAND_DEMOS } from '../src/game/sanddemos';

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
});
