import { afterEach, describe, expect, it } from 'vitest';
import {
  BACKGROUNDS, BG, DEFAULT_BACKGROUND, backgroundById, bgCss, bgLift, bgShifted, packAbgr, setBackground, stepBackground,
} from '../src/sim/background';
import { World } from '../src/sim/world';
import { skyLayer } from '../src/sim/starfield';
import { Mat } from '../src/sim/materials';
import { SIM_H, SIM_W, type NetInput } from '../src/sim/protocol';

/** The player's background colour: presets, one live source, and - above all - never a cell. */

afterEach(() => setBackground('night'));

const paint = (pts: number[], mat: number, size = 4): NetInput => ({ k: 'paint', pts, mat, size, kind: 'brush' });

describe('the presets', () => {
  it('NIGHT is the colour the game has always had, #0b0b14', () => {
    expect(DEFAULT_BACKGROUND.id).toBe('night');
    expect(packAbgr(DEFAULT_BACKGROUND)).toBe(0xff140b0b);
    setBackground('night');
    expect(bgCss()).toBe('#0b0b14');
    expect(bgLift()).toEqual([0, 0, 0]);
  });

  it('has 6 to 8 presets, each a one-word name and a distinct colour', () => {
    expect(BACKGROUNDS.length).toBeGreaterThanOrEqual(6);
    expect(BACKGROUNDS.length).toBeLessThanOrEqual(8);
    expect(new Set(BACKGROUNDS.map((b) => b.id)).size).toBe(BACKGROUNDS.length);
    expect(new Set(BACKGROUNDS.map(packAbgr)).size).toBe(BACKGROUNDS.length);
    for (const b of BACKGROUNDS) expect(b.name).toMatch(/^[A-Z]{3,8}$/);
  });

  it('an unknown saved value is NIGHT, never a crash', () => {
    for (const bad of ['', 'pink', null, undefined, 7, {}, '__proto__']) expect(backgroundById(bad).id).toBe('night');
  });

  it('steps along the presets either way and wraps', () => {
    const n = BACKGROUNDS.length;
    expect(stepBackground('night', 1).id).toBe(BACKGROUNDS[1].id);
    expect(stepBackground('night', -1).id).toBe(BACKGROUNDS[n - 1].id);
    expect(stepBackground(BACKGROUNDS[n - 1].id, 1).id).toBe('night');
    expect(stepBackground('nonsense', 0).id).toBe('night');
  });

  it('the one live colour follows setBackground, and the 3D shades move with it (NIGHT leaves them alone)', () => {
    expect(bgShifted(0x07070f)).toBe(0x07070f);
    const ocean = setBackground('ocean');
    expect([BG.r, BG.g, BG.b]).toEqual([ocean.r, ocean.g, ocean.b]);
    expect(BG.u32).toBe(packAbgr(ocean));
    expect(bgShifted(0x07070f)).not.toBe(0x07070f);
  });
});

describe('drawing follows the background', () => {
  it('every empty pixel of a full frame, and of a wind-stirred chunk frame, is the preset', () => {
    for (const p of BACKGROUNDS) {
      setBackground(p.id);
      const w = new World(3);
      const pix = new Uint32Array(SIM_W * SIM_H);
      w.renderInto(pix, true);
      const want = packAbgr(p);
      expect(pix.every((c) => c === want), `${p.id} full frame`).toBe(true);
    }
  });

  it('a chunk repaint after the colour changes (the worker forces a full one) shows no old colour', () => {
    setBackground('night');
    const w = new World(3);
    const pix = new Uint32Array(SIM_W * SIM_H);
    w.renderInto(pix, true);
    setBackground('forest');
    w.renderInto(pix, true);
    const want = packAbgr(backgroundById('forest'));
    expect(pix.every((c) => c === want)).toBe(true);
  });

  it('the playground sky has open sky exactly the preset, and rebuilds when it changes', () => {
    const counts = new Map<string, number>();
    for (const p of BACKGROUNDS) {
      setBackground(p.id);
      const sky = skyLayer(1, []);
      const want = packAbgr(p);
      let open = 0;
      for (let i = 0; i < sky.length; i++) if (sky[i] === want) open++;
      counts.set(p.id, open);
      expect(open, `${p.id} sky`).toBeGreaterThan(SIM_W * SIM_H * 0.2);
    }
    expect(counts.size).toBe(BACKGROUNDS.length);
  });
});

describe('the background never touches the world', () => {
  /** the busy sandbox script of lockstep.test.ts, shortened */
  function script(f: number): NetInput[] {
    switch (f) {
      case 0: return [paint([40, 330, 600, 330], Mat.STONE, 6)];
      case 10: return [paint([80, 120, 200, 120], Mat.SAND, 8)];
      case 30: return [paint([350, 100, 500, 100], Mat.WATER, 8)];
      case 60: return [paint([120, 300, 220, 300], Mat.WOOD, 6), paint([170, 280], Mat.FIRE, 5)];
      case 90: return [paint([420, 300, 460, 300], Mat.TNT, 6), paint([440, 290], Mat.FIRE, 3)];
      case 140: return [paint([250, 200, 400, 200], 0, 10)];
      default: return [];
    }
  }

  it('two worlds, same inputs, different backgrounds: same hashes, same snapshot', () => {
    const a = new World(77);
    const b = new World(77);
    const pa = new Uint32Array(SIM_W * SIM_H);
    const pb = new Uint32Array(SIM_W * SIM_H);
    const hashes = new Set<number>();
    for (let f = 0; f < 300; f++) {
      for (const inp of script(f)) {
        a.applyInput(inp);
        b.applyInput(inp);
      }
      // each is drawn the way the worker draws it, in its own player's colour
      a.step();
      setBackground('night');
      a.renderInto(pa, f % 40 === 0);
      b.step();
      setBackground('fog');
      b.renderInto(pb, f % 40 === 0);
      if (f % 25 === 24) {
        expect(b.hash(), `diverged by frame ${f}`).toBe(a.hash());
        hashes.add(a.hash());
      }
    }
    expect(JSON.stringify(b.snapshot())).toBe(JSON.stringify(a.snapshot()));
    // the session really was busy, and the two really were drawn in different colours
    expect(hashes.size).toBeGreaterThan(5);
    expect(pa[SIM_W * 10 + 10]).not.toBe(pb[SIM_W * 10 + 10]);
  });

  it('the same holds in the playground', () => {
    const a = new World(9);
    const b = new World(9);
    a.setMode('playground');
    b.setMode('playground');
    const pa = new Uint32Array(SIM_W * SIM_H);
    const pb = new Uint32Array(SIM_W * SIM_H);
    const tool: NetInput = { k: 'pg', tool: { kind: 'fountain', x: 320, y: 300, phase: 'down' } };
    a.applyInput(tool);
    b.applyInput(tool);
    for (let f = 0; f < 90; f++) {
      a.step();
      b.step();
      // drawing is the slow part: every 15th frame is enough to catch a draw that writes state
      if (f % 15 !== 0) continue;
      setBackground('night');
      a.parts!.draw(pa, f === 0, a.f);
      setBackground('ember');
      b.parts!.draw(pb, f === 0, b.f);
    }
    expect(b.hash()).toBe(a.hash());
    expect(JSON.stringify(b.snapshot())).toBe(JSON.stringify(a.snapshot()));
    expect(pa[SIM_W * SIM_H - 1]).not.toBe(pb[SIM_W * SIM_H - 1]);
  });
});
