import type { Grid } from './grid';
import { MATS, Mat } from './materials';
import { SIM_H, SIM_W } from './protocol';

/**
 * The CHEM LAB's ready-made experiments. Each builds into a cleared world
 * from fixed coordinates only - no randomness - so every player in a room
 * builds the same bench on the same frame (it travels as a NetInput).
 */

export interface ChemScene {
  id: string;
  label: string;
  tip: string;
  build(g: Grid): void;
}

const FLOOR = SIM_H - 1;

function put(g: Grid, x: number, y: number, m: number): void {
  if (x < 0 || y < 0 || x >= SIM_W || y >= SIM_H) return;
  const life = MATS[m].life;
  // a fixed life, not a rolled one: the scene must not touch the RNG
  g.setXY(x, y, m, life ? life[1] : 0);
}

function rect(g: Grid, x0: number, y0: number, x1: number, y1: number, m: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(g, x, y, m);
}

/** A glass vessel: floor and two walls, open on top. */
function tank(g: Grid, x0: number, y0: number, x1: number, y1: number): void {
  rect(g, x0, y1 - 1, x1, y1, Mat.GLASS);
  rect(g, x0, y0, x0 + 1, y1, Mat.GLASS);
  rect(g, x1 - 1, y0, x1, y1, Mat.GLASS);
}

/**
 * A graduated cylinder on a wide foot: a glass tube `hw` cells either side of
 * `cx` (walls 2 thick) from `top` down, filled with `fill` from row `level`,
 * marked every 20 rows.
 */
function cylinder(g: Grid, cx: number, top: number, hw: number, fill: number, level: number): void {
  rect(g, cx - hw - 16, FLOOR - 2, cx + hw + 16, FLOOR, Mat.GLASS);
  tank(g, cx - hw - 1, top, cx + hw + 1, FLOOR - 2);
  for (let y = FLOOR - 22; y > top + 10; y -= 20) rect(g, cx - hw - 4, y, cx - hw - 2, y, Mat.GLASS);
  rect(g, cx - hw + 1, level, cx + hw - 1, FLOOR - 4, fill);
}

/** A round-bottomed flask: a glass ball of radius r with a neck to `top`, filled with `fill` from row `level`. */
function roundFlask(g: Grid, cx: number, cy: number, r: number, nw: number, top: number, fill: number, level: number): void {
  for (let y = cy - r; y <= cy + r; y++)
    for (let x = cx - r; x <= cx + r; x++) {
      const d = Math.hypot(x - cx, y - cy);
      // the ball's shell, open at the top where the neck joins
      if (d <= r && d >= r - 3.5 && !(y < cy && Math.abs(x - cx) < nw)) put(g, x, y, Mat.GLASS);
      else if (d < r - 3.5 && y >= level) put(g, x, y, fill);
    }
  const join = Math.round(cy - Math.sqrt(r * r - nw * nw));
  rect(g, cx - nw - 2, top, cx - nw, join, Mat.GLASS);
  rect(g, cx + nw, top, cx + nw + 2, join, Mat.GLASS);
}

export const CHEM_SCENES: ChemScene[] = [
  {
    id: 'alkali',
    label: 'ALKALI BATH',
    tip: 'Lithium, sodium and potassium dropped into water, one after another',
    build(g) {
      tank(g, 120, 220, 520, FLOOR);
      rect(g, 122, 260, 518, FLOOR - 2, Mat.WATER);
      // higher drops land later: lithium first, potassium last and loudest
      rect(g, 180, 200, 199, 211, Mat.LI);
      rect(g, 310, 140, 329, 151, Mat.NA);
      rect(g, 440, 60, 459, 71, Mat.K);
    },
  },
  {
    id: 'thermite',
    label: 'THERMITE',
    tip: 'A magnesium fuse burns along a shelf into aluminium and rust: molten iron',
    build(g) {
      // the crucible, brim level with the shelf, on a wooden floor over ice
      tank(g, 300, 166, 380, 260);
      for (let y = 166; y < 258; y++) for (let x = 302; x < 378; x++) put(g, x, y, (x + y) & 1 ? Mat.AL : Mat.RUST);
      rect(g, 302, 258, 377, 260, Mat.WOOD);
      rect(g, 280, 300, 400, FLOOR, Mat.ICE);
      // the fuse: one unbroken magnesium ribbon along the shelf and across
      // the top of the mix, lit at the far end
      rect(g, 140, 166, 299, 167, Mat.GLASS);
      rect(g, 140, 164, 377, 165, Mat.MG);
      rect(g, 140, 160, 143, 163, Mat.FIRE);
    },
  },
  {
    id: 'flames',
    label: 'FLAME TESTS',
    tip: 'Seven metals on torch burners, each giving off its own colour of flame',
    build(g) {
      const metals = [Mat.LI, Mat.NA, Mat.K, Mat.CA, Mat.SR, Mat.BA, Mat.CU];
      metals.forEach((m, k) => {
        const x0 = 40 + k * 82;
        tank(g, x0, FLOOR - 70, x0 + 60, FLOOR);
        // a torch bed is a steady burner: heat without an orange flame of
        // its own (burning wood drowned every colour in plain fire). Two rows
        // is enough heat; twenty rows were a yellow block whose glow tinted
        // every flame the same.
        rect(g, x0 + 2, FLOOR - 3, x0 + 58, FLOOR - 2, Mat.TORCH);
        for (let x = x0 + 3; x < x0 + 58; x += 2) put(g, x, FLOOR - 4, m);
      });
    },
  },
  {
    id: 'critical',
    label: 'CRITICAL MASS',
    tip: 'Two lumps of uranium: the small one lets its neutrons escape and fizzles; the big one keeps them and runs away',
    build(g) {
      rect(g, 0, FLOOR - 3, SIM_W - 1, FLOOR, Mat.STONE);
      rect(g, 80, 286, 140, FLOOR - 4, Mat.STONE); // a plinth for the small one
      rect(g, 100, 266, 119, 285, Mat.U);
      rect(g, 380, 256, 479, FLOOR - 4, Mat.U);
    },
  },
  {
    id: 'reactor',
    label: 'REACTOR',
    tip: 'Uranium caged in boron rods, in a pool. Erase some rods and the water boils; erase them all and...',
    build(g) {
      rect(g, 0, FLOOR - 3, SIM_W - 1, FLOOR, Mat.STONE);
      tank(g, 180, 170, 460, FLOOR - 4);
      rect(g, 184, 190, 456, FLOOR - 6, Mat.WATER);
      // the core: fuel in a grid of boron control rods every 12 cells
      for (let y = 230; y <= 330; y++)
        for (let x = 260; x <= 380; x++) put(g, x, y, (x - 260) % 12 === 0 || (y - 230) % 12 === 0 ? Mat.B : Mat.U);
    },
  },
  {
    id: 'toothpaste',
    label: 'ELEPHANT TOOTHPASTE',
    tip: 'Iodide dropped into a cylinder of strong peroxide: it splits into oxygen, and a column of foam shoots out of the top',
    build(g) {
      // a tall narrow cylinder, as the demonstration is done: it fills in
      // a moment and the foam leaves it as a column (a wide flask took
      // seven seconds to fill, then oozed)
      cylinder(g, 320, 150, 15, Mat.PEROXIDE, 230);
      // the iodide, a spoonful just dropped in
      rect(g, 312, 214, 328, 222, Mat.IODIDE);
    },
  },
  {
    id: 'mirror',
    label: 'SILVER MIRROR',
    tip: "Sugar dropped into Tollens' reagent: the liquid turns dark as silver forms, and the silver plates the flask into a mirror",
    build(g) {
      rect(g, 270, 343, 370, FLOOR, Mat.WOOD); // a block for it to sit on
      roundFlask(g, 320, 276, 66, 13, 160, Mat.TOLLENS, 222);
      rect(g, 314, 116, 326, 122, Mat.GLUCOSE);
    },
  },
];

/** Build scene `id` into an already cleared grid; false if there is none. */
export function buildChemScene(id: string, g: Grid): boolean {
  const s = CHEM_SCENES.find((q) => q.id === id);
  if (!s) return false;
  s.build(g);
  return true;
}
