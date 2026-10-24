import { describe, expect, it } from 'vitest';
import { skyLayer, type Bender } from '../src/sim/starfield';
import { World } from '../src/sim/world';
import { DEFAULT_BACKGROUND, packAbgr } from '../src/sim/background';
import { SIM_H, SIM_W } from '../src/sim/protocol';

/** the game's default empty colour (NIGHT): these tests draw on it */
const PG_BG = packAbgr(DEFAULT_BACKGROUND);

/** pixels of a frame that differ from the flat background */
function lit(pix: Uint32Array): number {
  let n = 0;
  for (let i = 0; i < pix.length; i++) if (pix[i] !== PG_BG) n++;
  return n;
}

describe('playground sky', () => {
  it('an empty playground is not a black void', () => {
    const w = new World(5);
    w.setMode('playground');
    const pix = new Uint32Array(SIM_W * SIM_H);
    w.parts!.draw(pix, true, 1);
    // nebula and stars cover a real share of the screen
    expect(lit(pix)).toBeGreaterThan(SIM_W * SIM_H * 0.2);
  });

  it('a black hole casts a dark shadow in the sky', () => {
    // find a spot the nebula covers, so the shadow has something to hide
    const open = skyLayer(1, []);
    let cx = -1;
    let cy = -1;
    for (let y = 100; y < SIM_H - 100 && cx < 0; y += 10)
      for (let x = 100; x < SIM_W - 100; x += 10)
        if (open[y * SIM_W + x] !== PG_BG) {
          cx = x;
          cy = y;
          break;
        }
    expect(cx).toBeGreaterThan(0);
    const hole: Bender = { kind: 'hole', x: cx, y: cy };
    const sky = skyLayer(2, [hole]);
    for (let dy = -8; dy <= 8; dy++)
      for (let dx = -8; dx <= 8; dx++) expect(sky[(cy + dy) * SIM_W + cx + dx]).toBe(PG_BG);
  });

  it('a vortex stirs the nebula, then lets it settle', () => {
    const v: Bender = { kind: 'vortex', x: 320, y: 180 };
    const at = (f: number) => skyLayer(f, [v]).slice();
    const first = at(10);
    const later = at(312); // a redraw frame: stirring repaints every 3rd frame
    let moved = 0;
    for (let i = 0; i < first.length; i++) if (first[i] !== later[i]) moved++;
    expect(moved).toBeGreaterThan(500);
    // long after, even with no frames drawn in between (a hidden tab): one
    // last redraw winds it fully, and then it holds still
    const settledA = at(2000);
    let wound = 0;
    for (let i = 0; i < later.length; i++) if (later[i] !== settledA[i]) wound++;
    expect(wound).toBeGreaterThan(500);
    const settledB = at(2600);
    expect(Array.from(settledB)).toEqual(Array.from(settledA));
    // a new force far away rebuilds the whole sky; the old vortex must come
    // back as it settled, not wound on by every frame since
    const far: Bender = { kind: 'attract', x: 40, y: 40 };
    const rebuilt = skyLayer(3000, [v, far]);
    for (let y = 140; y < 220; y++)
      for (let x = 280; x < 360; x++) expect(rebuilt[y * SIM_W + x]).toBe(settledA[y * SIM_W + x]);
  });

  it('drawing never changes the shared simulation', () => {
    const drawn = new World(9);
    const plain = new World(9);
    for (const w of [drawn, plain]) {
      w.setMode('playground');
      w.loadPreset('galaxy');
      w.parts!.placeForce('blackhole', 200, 150);
      w.parts!.placeForce('vortex', 440, 200);
    }
    const pix = new Uint32Array(SIM_W * SIM_H);
    for (let f = 0; f < 240; f++) {
      drawn.step();
      drawn.parts!.draw(pix, f === 0, drawn.f);
      plain.step();
    }
    expect(drawn.hash()).toBe(plain.hash());
    expect(drawn.parts!.count).toBe(plain.parts!.count);
  });
});
