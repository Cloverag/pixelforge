import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { PG_BG } from '../src/sim/particles';
import { PRESET_INFO } from '../src/sim/presets';
import { Mat } from '../src/sim/materials';
import { SIM_H, SIM_W } from '../src/sim/protocol';

const N = SIM_W * SIM_H;

function scene(id: string): World {
  const w = new World(5);
  w.mode = 'playground';
  expect(w.loadPreset(id)).toBe(true);
  return w;
}

function run(w: World, frames: number, onStats?: (st: ReturnType<NonNullable<World['parts']>['takeStats']>) => void) {
  const pix = new Uint32Array(N).fill(PG_BG);
  for (let n = 0; n < frames; n++) {
    w.parts!.fullRender(pix, false, n);
    const st = w.parts!.takeStats();
    onStats?.(st);
  }
}

// each scene runs hundreds of frames; 4 s alone, more on a busy machine
describe('playground scenes', { timeout: 30_000 }, () => {
  it('there are six, with unique ids', () => {
    expect(PRESET_INFO.length).toBe(6);
    expect(new Set(PRESET_INFO.map((p) => p.id)).size).toBe(6);
  });

  for (const p of PRESET_INFO) {
    it(`${p.label} keeps itself running`, () => {
      const w = scene(p.id);
      run(w, 300);
      expect(w.parts!.count).toBeGreaterThan(0);
      // still emitting well after the start: it is a scene, not a burst
      run(w, 300);
      expect(w.parts!.count).toBeGreaterThan(10);
    });
  }

  it('loading a scene replaces what was there', () => {
    const w = new World(5);
    w.mode = 'playground';
    for (let x = 0; x < SIM_W; x++) w.grid.setXY(x, 5, Mat.WALL);
    w.parts!.placeForce('vortex', 100, 100);
    w.loadPreset('galaxy');
    expect(w.grid.get(10, 5)).toBe(Mat.EMPTY);
    // galaxy has exactly its black hole (kind 3), no leftover vortex
    expect(w.parts!.packForces()).toEqual([3, SIM_W / 2, SIM_H / 2]);
  });

  it('galaxy turns gravity off; fountains turns it on', () => {
    expect(scene('galaxy').parts!.gravityOn).toBe(false);
    expect(scene('fountains').parts!.gravityOn).toBe(true);
    expect(PRESET_INFO.find((p) => p.id === 'galaxy')!.gravity).toBe(false);
  });

  it('galaxy feeds its black hole; portal loop uses its portals', () => {
    let swallowed = 0;
    run(scene('galaxy'), 300, (st) => (swallowed += st.swallowed));
    expect(swallowed).toBeGreaterThan(100);
    let warps = 0;
    run(scene('loop'), 300, (st) => (warps += st.warps));
    expect(warps).toBeGreaterThan(50);
  });

  /** a single stream down the stairs stalled by the fourth step */
  it('music stairs plays every one of its seven steps', () => {
    const notes = new Set<number>();
    run(scene('stairs'), 600, (st) => {
      for (let k = 0; k < st.notes.length; k += 2) notes.add(st.notes[k]);
    });
    expect(notes.size).toBeGreaterThanOrEqual(7);
  });

  it('pinball rings its bumpers', () => {
    let notes = 0;
    run(scene('pinball'), 300, (st) => (notes += st.notes.length / 2));
    expect(notes).toBeGreaterThan(50);
  });

  it('erasing an emitter stops it', () => {
    const w = scene('fountains');
    for (let k = 0; k < 5; k++) w.parts!.eraseNear(120 + k * 100, 326, 6);
    w.parts!.eraseNear(SIM_W / 2, 90, 6); // the fireworks launcher
    run(w, 400);
    expect(w.parts!.count).toBe(0);
  });
});
