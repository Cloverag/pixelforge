import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { Mat } from '../src/sim/materials';
import { CHEM_SCENES } from '../src/sim/chemscenes';

/**
 * The CHEM LAB's ready-made experiments must do what their buttons say,
 * and arrive as a room input: only in the chem lab, the same for everyone.
 */

function scene(id: string, seed = 5): World {
  const w = new World(seed);
  w.applyInput({ k: 'mode', m: 'chem' });
  w.applyInput({ k: 'chemScene', id });
  return w;
}

/** Step, remembering the most of each material seen at any one frame. */
function watch(w: World, frames: number, mats: number[]): Map<number, number> {
  const peak = new Map(mats.map((m) => [m, 0]));
  for (let f = 0; f < frames; f++) {
    w.step();
    for (const m of mats) peak.set(m, Math.max(peak.get(m)!, w.grid.counts[m]));
  }
  return peak;
}

describe('chem lab experiments', { timeout: 120_000 }, () => {
  it('ALKALI BATH: all three metals fizz into hydrogen and lye', () => {
    const w = scene('alkali');
    const before = [Mat.LI, Mat.NA, Mat.K].map((m) => w.grid.counts[m]);
    const peak = watch(w, 600, [Mat.H, Mat.LYE]);
    expect(peak.get(Mat.H)).toBeGreaterThan(0);
    expect(peak.get(Mat.LYE)).toBeGreaterThan(0);
    [Mat.LI, Mat.NA, Mat.K].forEach((m, k) => expect(w.grid.counts[m]).toBeLessThan(before[k]));
  });

  it('THERMITE: the magnesium fuse burns into the crucible and makes molten iron', () => {
    const w = scene('thermite');
    const peak = watch(w, 600, [Mat.FLAME_WHITE, Mat.LAVA]);
    expect(peak.get(Mat.FLAME_WHITE)).toBeGreaterThan(0);
    expect(peak.get(Mat.LAVA)).toBeGreaterThan(0);
  });

  it('FLAME TESTS: every metal colours a flame', () => {
    const flames = [Mat.FLAME_CRIMSON, Mat.FLAME_YELLOW, Mat.FLAME_LILAC, Mat.FLAME_ORANGE, Mat.FLAME_APPLE, Mat.FLAME_GREEN];
    const w = scene('flames');
    const peak = watch(w, 600, flames);
    expect(flames.filter((m) => peak.get(m) === 0)).toEqual([]);
    // and the colours are what you see: tinted flame outnumbers plain fire
    // (a bed of burning wood made the same tints but drowned them in orange)
    let tinted = 0, plain = 0;
    for (let f = 0; f < 120; f++) {
      w.step();
      tinted += flames.reduce((s, m) => s + w.grid.counts[m], 0);
      plain += w.grid.counts[Mat.FIRE] + w.grid.counts[Mat.EMBER];
    }
    expect(tinted).toBeGreaterThan(plain * 3);
  });

  it('FLAME TESTS: the burner stays a thin line', () => {
    // seven cups, each a bed 2 rows deep and 57 cells wide. The 3x test above
    // guards the tinting; it cannot tell a thin bed from a thick one (the old
    // 28-row bed scored 4.7x against 5.7x), so pin the bed itself, exactly:
    // a block of torch is a yellow glow that tints every flame the same
    expect(scene('flames').grid.counts[Mat.TORCH]).toBe(7 * 2 * 57);
  });

  it('ELEPHANT TOOTHPASTE: the foam pours out of the flask, and the iodide is never used up', () => {
    const w = scene('toothpaste');
    const iodide = w.grid.counts[Mat.IODIDE];
    for (let f = 0; f < 900; f++) w.step();
    // outside the flask: above its mouth (row 150) or beside its base (96 cells either side of x 320)
    let out = 0;
    for (let y = 0; y < 360; y++)
      for (let x = 0; x < 640; x++) if (w.grid.cells[y * 640 + x] === Mat.FOAM && (y < 150 || Math.abs(x - 320) > 98)) out++;
    expect(out).toBeGreaterThan(2000);
    expect(w.grid.counts[Mat.IODIDE]).toBe(iodide);
  });

  it('ELEPHANT TOOTHPASTE: no iodide, no foam', () => {
    const w = scene('toothpaste');
    for (let i = 0; i < w.grid.cells.length; i++) if (w.grid.cells[i] === Mat.IODIDE) w.grid.setXY(i % 640, (i / 640) | 0, Mat.EMPTY);
    for (let f = 0; f < 600; f++) w.step();
    expect(w.grid.counts[Mat.FOAM]).toBe(0);
  });

  it('foam in the open spreads and slumps; it does not grow spires', () => {
    const w = new World(5);
    w.applyInput({ k: 'mode', m: 'chem' });
    for (let x = 0; x < 640; x++) w.grid.setXY(x, 359, Mat.STONE);
    for (let f = 0; f < 900; f++) {
      // a steady source on the floor, fed full every frame the way a flask's mouth is:
      // in a flask it climbs; in the open it must not (a heap whose top grew up was a field of spires)
      if (f < 600) {
        const i = 358 * 640 + 320;
        if (w.grid.cells[i] === Mat.FOAM) w.grid.meta[i] = 0x7f;
        else w.grid.setXY(320, 358, Mat.FOAM, 0x7f);
      }
      w.step();
    }
    let top = 359;
    for (let i = 0; i < w.grid.cells.length; i++) if (w.grid.cells[i] === Mat.FOAM) top = Math.min(top, (i / 640) | 0);
    expect(w.grid.counts[Mat.FOAM]).toBeGreaterThan(100);
    expect(358 - top).toBeLessThan(30);
  });

  it('SILVER MIRROR: the wetted glass turns to silver, the dry neck stays glass', () => {
    const w = scene('mirror');
    const neck = () => {
      let n = 0;
      for (let y = 160; y < 200; y++) for (let x = 300; x < 341; x++) if (w.grid.cells[y * 640 + x] === Mat.GLASS) n++;
      return n;
    };
    const neck0 = neck();
    for (let f = 0; f < 900; f++) w.step();
    expect(w.grid.counts[Mat.MIRROR]).toBeGreaterThan(400);
    expect(w.grid.counts[Mat.TOLLENS]).toBe(0); // the darkening reached all of it
    expect(neck()).toBe(neck0);
  });

  it('SILVER MIRROR: no sugar, no silver', () => {
    const w = scene('mirror');
    for (let i = 0; i < w.grid.cells.length; i++) if (w.grid.cells[i] === Mat.GLUCOSE) w.grid.setXY(i % 640, (i / 640) | 0, Mat.EMPTY);
    for (let f = 0; f < 600; f++) w.step();
    expect(w.grid.counts[Mat.MIRROR] + w.grid.counts[Mat.SILVER_SOL]).toBe(0);
  });

  it('silver soaks only a few cells into glass, not through every piece it touches', () => {
    const w = new World(5);
    w.applyInput({ k: 'mode', m: 'chem' });
    // a thick glass slab (x 200-299) with silvering solution against its left face
    for (let y = 200; y < 300; y++) {
      for (let x = 200; x < 300; x++) w.grid.setXY(x, y, Mat.GLASS);
      for (let x = 190; x < 200; x++) w.grid.setXY(x, y, Mat.SILVER_SOL);
    }
    for (let x = 185; x < 305; x++) w.grid.setXY(x, 300, Mat.WALL);
    for (let y = 190; y < 300; y++) w.grid.setXY(189, y, Mat.WALL);
    for (let f = 0; f < 1500; f++) w.step();
    let deepest = 0;
    for (let i = 0; i < w.grid.cells.length; i++) if (w.grid.cells[i] === Mat.MIRROR) deepest = Math.max(deepest, i % 640);
    expect(w.grid.counts[Mat.MIRROR]).toBeGreaterThan(100);
    expect(deepest).toBeLessThan(204); // the face (x 200) and 3 cells in
  });

  it('builds the same bench for everyone, and only in the chem lab', () => {
    for (const s of CHEM_SCENES) {
      // different seeds: a scene that rolled the world's RNG would differ
      const a = scene(s.id, 1), b = scene(s.id, 999);
      expect(a.grid.cells.every((c, i) => c === b.grid.cells[i] && a.grid.meta[i] === b.grid.meta[i])).toBe(true);
      expect(a.grid.counts[Mat.EMPTY]).toBeLessThan(a.grid.cells.length);
    }
    const sand = new World(5);
    sand.applyInput({ k: 'chemScene', id: 'alkali' });
    expect(sand.grid.counts[Mat.EMPTY]).toBe(sand.grid.cells.length);
  });
});
