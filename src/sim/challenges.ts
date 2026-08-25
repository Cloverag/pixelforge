import type { World } from './world';
import { Mat } from './materials';
import { SIM_H, SIM_W } from './protocol';

export interface SourceDef {
  mat: number;
  x: number;
  y: number;
  w: number;
  h: number;
  every?: number;
  untilFrame?: number;
}

export interface ChallengeDef {
  id: string;
  name: string;
  desc: string;
  hint: string;
  /** materials shown in the palette */
  allowed: number[];
  budget?: Partial<Record<number, number>>;
  timeLimit: number;
  loseReason?: string;
  setup(w: World): void;
  sources?: SourceDef[];
  check(
    w: World,
    frame: number,
    used: Int32Array,
  ): 'running' | 'win' | 'lose';
  stars?(w: World, frame: number): number;
}

// ---------- painter helpers ----------

function fillRect(
  w: World,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  m: number,
): void {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) w.grid.setXY(x, y, m);
}

function countIn(
  w: World,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  m: number,
): number {
  const g = w.grid;
  let n = 0;
  for (let y = Math.max(0, y0); y <= Math.min(SIM_H - 1, y1); y++)
    for (let x = Math.max(0, x0); x <= Math.min(SIM_W - 1, x1); x++)
      if (g.cells[y * SIM_W + x] === m) n++;
  return n;
}

/** energized (meta > 0) wire cells in a region */
function countSparked(
  w: World,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const g = w.grid;
  let n = 0;
  for (let y = Math.max(0, y0); y <= Math.min(SIM_H - 1, y1); y++)
    for (let x = Math.max(0, x0); x <= Math.min(SIM_W - 1, x1); x++) {
      const i = y * SIM_W + x;
      if (g.cells[i] === Mat.WIRE && g.meta[i] > 0) n++;
    }
  return n;
}

function house(
  w: World,
  x: number,
  y: number,
  wid: number,
  hei: number,
): void {
  // hollow box, 2-thick walls, interior platform
  fillRect(w, x, y, x + wid - 1, y + hei - 1, Mat.WOOD);
  fillRect(w, x + 2, y + 2, x + wid - 3, y + hei - 3, Mat.EMPTY);
  const midY = y + ((hei / 2) | 0);
  fillRect(w, x + 2, midY, x + wid - 3, midY + 1, Mat.WOOD);
}

function tree(w: World, x: number, baseY: number, h: number): void {
  fillRect(w, x - 1, baseY - h / 3, x + 1, baseY, Mat.WOOD);
  fillRect(w, x - 6, baseY - h, x + 6, baseY - h / 3, Mat.PLANT);
  fillRect(w, x - 4, baseY - h - 8, x + 4, baseY - h, Mat.PLANT);
}

// ---------- challenges (laid out for 640x360) ----------

export const CHALLENGES: ChallengeDef[] = [
  {
    id: 'aqueduct',
    name: 'AQUEDUCT',
    desc: 'Route the spring into the basin. Build channels before the valley floods.',
    hint: 'Water flows down and sideways. Long sloped channels beat steep drops.',
    allowed: [Mat.WALL, Mat.STONE],
    budget: { [Mat.WALL]: 3400, [Mat.STONE]: 2000 },
    timeLimit: 5400,
    loseReason: 'The valley flooded',
    sources: [
      { mat: Mat.WATER, x: 24, y: 8, w: 4, h: 3, every: 1 },
    ],
    setup(w) {
      fillRect(w, 0, 352, 639, 359, Mat.WALL);
      // basin on the right
      fillRect(w, 533, 295, 537, 351, Mat.STONE);
      fillRect(w, 608, 295, 612, 351, Mat.STONE);
      // decorative hills
      fillRect(w, 80, 314, 173, 351, Mat.WALL);
      fillRect(w, 266, 304, 333, 351, Mat.WALL);
      fillRect(w, 413, 320, 480, 351, Mat.WALL);
    },
    check(w, _frame) {
      const goal = countIn(w, 538, 281, 607, 353, Mat.WATER);
      if (goal >= 1700) return 'win';
      const leaked = countIn(w, 40, 343, 519, 351, Mat.WATER);
      if (leaked >= 450) return 'lose';
      return 'running';
    },
    stars(_w, frame) {
      if (frame < 2700) return 3;
      if (frame < 4200) return 2;
      return 1;
    },
  },

  {
    id: 'firefighter',
    name: 'FIRE WATCH',
    desc: 'Lightning hit the east grove. Save the village before it burns.',
    hint: 'Drop water directly on embers. Wet wood does not burn.',
    allowed: [Mat.WATER],
    timeLimit: 7200,
    loseReason: 'The village burned down',
    setup(w) {
      fillRect(w, 0, 337, 639, 359, Mat.STONE);
      house(w, 160, 275, 80, 62);
      house(w, 293, 264, 85, 73);
      house(w, 440, 278, 75, 59);
      tree(w, 80, 336, 48);
      tree(w, 123, 336, 37);
      tree(w, 587, 336, 50);
      tree(w, 624, 336, 39);
      // ignition point
      for (let i = 0; i < 6; i++)
        w.grid.setXY(595 + (i % 3), 290 - ((i / 3) | 0) * 3, Mat.FIRE, 30 + i * 4);
    },
    check(w, _frame, _used) {
      const wood = w.grid.counts[Mat.WOOD];
      const burning =
        w.grid.counts[Mat.FIRE] + w.grid.counts[Mat.EMBER];
      if (wood < 1550) return 'lose';
      if (burning === 0 && wood >= 1550) return 'win';
      return 'running';
    },
    stars(w) {
      const wood = w.grid.counts[Mat.WOOD];
      if (wood >= 2100) return 3;
      if (wood >= 1800) return 2;
      return 1;
    },
  },

  {
    id: 'icebreaker',
    name: 'ICE BREAKER',
    desc: 'Melt the glacier wall blocking the pass. Lava is rationed.',
    hint: 'Lava dies when it touches meltwater. Slow drips beat floods.',
    allowed: [Mat.LAVA],
    budget: { [Mat.LAVA]: 2600 },
    timeLimit: 5400,
    loseReason: 'Out of time - the pass is still frozen',
    // star rating handled in starsFor() (needs used[])
    setup(w) {
      fillRect(w, 0, 346, 639, 359, Mat.STONE);
      fillRect(w, 309, 126, 331, 345, Mat.ICE);
      // ledges so meltwater drains away from remaining ice
      fillRect(w, 280, 253, 308, 257, Mat.STONE);
      fillRect(w, 332, 197, 363, 201, Mat.STONE);
    },
    check(w) {
      if (w.grid.counts[Mat.ICE] === 0) return 'win';
      return 'running';
    },
  },
];

export function starsFor(def: ChallengeDef, w: World, frame: number, used: Int32Array): number {
  switch (def.id) {
    case 'icebreaker': {
      const spare = used[Mat.LAVA];
      if (spare >= 900) return 3;
      if (spare >= 350) return 2;
      return 1;
    }
    case 'containment': {
      if (frame < 3600) return 3;
      if (frame < 4800) return 2;
      return 1;
    }
    case 'gardener':
      return frame < 4800 ? 3 : frame < 6200 ? 2 : 1;
    case 'demolition': {
      const spare = used[Mat.GUNPOWDER];
      if (spare >= 380) return 3;
      if (spare >= 150) return 2;
      return 1;
    }
    default:
      return def.stars?.(w, frame) ?? 1;
  }
}

CHALLENGES.push(
  {
    id: 'containment',
    name: 'CONTAINMENT',
    desc: 'The volcano is venting into the reservoir. Patch the crack before lava reaches the reactor.',
    hint: 'Stone walls hold. The crack leaks sideways - plug it high.',
    allowed: [Mat.STONE],
    budget: { [Mat.STONE]: 2400 },
    timeLimit: 7200,
    loseReason: 'Lava reached the reactor!',
    sources: [
      { mat: Mat.LAVA, x: 264, y: 5, w: 6, h: 3, every: 1, untilFrame: 2400 },
    ],
    setup(w) {
      fillRect(w, 0, 346, 639, 359, Mat.STONE);
      // reservoir bowl
      fillRect(w, 157, 211, 161, 345, Mat.STONE);
      fillRect(w, 397, 211, 401, 345, Mat.STONE);
      fillRect(w, 157, 341, 401, 345, Mat.STONE);
      // the crack (player must patch)
      fillRect(w, 397, 288, 401, 300, Mat.EMPTY);
      // reactor housing on the right
      fillRect(w, 573, 281, 639, 345, Mat.WALL);
      fillRect(w, 581, 292, 629, 334, Mat.GLASS);
    },
    check(w, frame) {
      const danger = countIn(w, 506, 334, 639, 345, Mat.LAVA);
      if (danger >= 220) return 'lose';
      if (
        frame > 2600 &&
        danger === 0 &&
        w.grid.counts[Mat.LAVA] >= 950
      )
        return 'win';
      return 'running';
    },
  },

  {
    id: 'gardener',
    name: 'GARDENER',
    desc: 'Dead hillsides. Sow seeds and water them into a living meadow.',
    hint: 'Plants drink neighboring water to grow. Sprinkle, do not drown.',
    allowed: [Mat.SEED, Mat.WATER],
    budget: { [Mat.SEED]: 370, [Mat.WATER]: 6500 },
    timeLimit: 7200,
    loseReason: 'Out of time - the meadow never grew',
    setup(w) {
      fillRect(w, 0, 352, 639, 359, Mat.STONE);
      // mounds with sandy caps
      const mound = (cx: number, top: number, half: number) => {
        for (let dy = 0; dy <= 351 - top; dy++) {
          const inset = ((dy * half) / (351 - top)) | 0;
          fillRect(w, cx - half + inset, top + dy, cx + half - inset, top + dy, Mat.STONE);
        }
        fillRect(w, cx - half + 8, top - 1, cx + half - 8, top, Mat.SAND);
      };
      mound(133, 236, 56);
      mound(320, 214, 64);
      mound(512, 242, 53);
    },
    check(w) {
      if (w.grid.counts[Mat.PLANT] >= 3000) return 'win';
      return 'running';
    },
  },

  {
    id: 'demolition',
    name: 'DEMOLITION',
    desc: 'Breach the tower. Fuse and powder are limited - make every blast count.',
    hint: 'Fuse burns slowly along its length. Rig charges low, watch them climb.',
    allowed: [Mat.GUNPOWDER, Mat.FUSE],
    budget: { [Mat.GUNPOWDER]: 750, [Mat.FUSE]: 190 },
    timeLimit: 4200,
    loseReason: 'Out of time - the tower still stands',
    setup(w) {
      fillRect(w, 0, 352, 639, 359, Mat.WALL);
      // pillars
      fillRect(w, 253, 112, 269, 351, Mat.STONE);
      fillRect(w, 370, 112, 386, 351, Mat.STONE);
      // floors
      fillRect(w, 270, 154, 369, 157, Mat.WOOD);
      fillRect(w, 270, 225, 369, 228, Mat.WOOD);
      fillRect(w, 270, 295, 369, 298, Mat.WOOD);
      // glass keystone (blast-proof crown)
      fillRect(w, 296, 81, 344, 111, Mat.GLASS);
      fillRect(w, 306, 64, 333, 80, Mat.GLASS);
    },
    check(w, _frame) {
      const standing = countIn(w, 246, 112, 393, 279, Mat.STONE);
      if (standing < 1460) return 'win';
      return 'running';
    },
  },

  {
    id: 'beacon',
    name: 'SPARK THE BEACON',
    desc: 'The signal tower is dead. Bridge the broken wire with your spool before dawn.',
    hint: 'Sparks hop cell to cell - a single missing cell breaks the whole circuit.',
    allowed: [Mat.WIRE],
    budget: { [Mat.WIRE]: 420 },
    timeLimit: 3600,
    loseReason: 'Out of time - the beacon stays dark',
    setup(w) {
      fillRect(w, 0, 340, 639, 359, Mat.WALL);
      // torch house
      fillRect(w, 36, 250, 46, 302, Mat.WALL);
      w.grid.setXY(51, 296, Mat.TORCH); // adjacent to the stub - circuit starts live
      // circuit stubs with three gaps at different heights
      fillRect(w, 52, 296, 90, 297, Mat.WIRE);   // stub from torch
      fillRect(w, 150, 270, 210, 271, Mat.WIRE); // segment 2 (higher)
      fillRect(w, 270, 270, 330, 271, Mat.WIRE); // segment 3
      fillRect(w, 390, 300, 452, 301, Mat.WIRE); // segment 4 (lower)
      fillRect(w, 452, 300, 556, 301, Mat.WIRE); // into the beacon
      // beacon tower: glass shell, live wire core
      fillRect(w, 540, 200, 600, 320, Mat.GLASS);
      fillRect(w, 556, 216, 584, 304, Mat.EMPTY);
      fillRect(w, 560, 240, 580, 300, Mat.WIRE);
    },
    check(w, _frame, _used) {
      if (countSparked(w, 556, 216, 584, 304) > 0) return 'win';
      return 'running';
    },
    stars(_w, frame) {
      if (frame < 1200) return 3;
      if (frame < 2400) return 2;
      return 1;
    },
  },
);
