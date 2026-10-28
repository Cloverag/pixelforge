import { Mat } from '../sim/materials';

/**
 * The sandbox's demos behind the title screen: worlds made of ordinary brush
 * strokes, sent as the same paint inputs a player's brush sends, so the
 * sandbox's own rules do the rest - seeds sprout into flowers, lava meets
 * water. Coordinates are the world's 640 x 360.
 */

export interface SandStroke {
  mat: number;
  size: number;
  /** a polyline: x, y, x, y, ... */
  pts: number[];
}

export interface SandDemo {
  name: string;
  strokes: SandStroke[];
  /** what to try, said when the sandbox loads it */
  hint?: string;
}

/**
 * A polyline through the corners given. A paint input stamps the brush at each
 * point it lists (a real brush sends many), so the segments are filled in with
 * points a third of a brush apart.
 */
function line(mat: number, size: number, ...corners: number[]): SandStroke {
  const pts = [corners[0], corners[1]];
  for (let i = 2; i < corners.length; i += 2) {
    const [x0, y0, x1, y1] = [corners[i - 2], corners[i - 1], corners[i], corners[i + 1]];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / Math.max(1, size / 3)));
    for (let k = 1; k <= n; k++) pts.push(Math.round(x0 + ((x1 - x0) * k) / n), Math.round(y0 + ((y1 - y0) * k) / n));
  }
  return { mat, size, pts };
}

/** Two ponds in a stone basin; seeds dropped in grow up to the surface and bloom. */
const ponds: SandDemo = {
  name: 'FLOWER PONDS',
  strokes: [
    line(Mat.SAND, 24, 0, 352, 640, 352),
    line(Mat.SAND, 20, 0, 336, 640, 336),
    line(Mat.SAND, 16, 0, 318, 110, 324, 150, 334),
    line(Mat.SAND, 16, 490, 334, 540, 318, 640, 314),
    line(Mat.STONE, 6, 150, 330, 490, 330),
    line(Mat.STONE, 6, 150, 330, 150, 296),
    line(Mat.STONE, 6, 490, 330, 490, 296),
    line(Mat.STONE, 6, 320, 330, 320, 306),
    line(Mat.WATER, 10, 158, 322, 312, 322),
    line(Mat.WATER, 10, 328, 322, 482, 322),
    line(Mat.WATER, 8, 158, 312, 312, 312),
    line(Mat.WATER, 8, 328, 312, 482, 312),
    ...Array.from({ length: 13 }, (_, i) => line(Mat.SEED, 4, 168 + i * 25, 286, 170 + i * 25, 286)),
  ],
};

/** A sand mountain with lava in its crater, running down into pools of water. */
const volcano: SandDemo = {
  name: 'VOLCANO',
  strokes: [
    line(Mat.STONE, 24, 0, 352, 640, 352),
    // the mountain, in layers from the foot up
    ...Array.from({ length: 12 }, (_, i) => {
      const y = 340 - i * 10;
      const half = 230 - i * 17;
      return line(Mat.SAND, 12, 320 - half, y, 320 + half, y);
    }),
    // lava heaped on the summit spills down both flanks into the pools at the foot
    line(Mat.LAVA, 16, 290, 214, 350, 214),
    line(Mat.LAVA, 14, 296, 198, 344, 198),
    line(Mat.LAVA, 12, 304, 184, 336, 184),
    line(Mat.WATER, 16, 8, 334, 84, 334),
    line(Mat.WATER, 16, 556, 334, 632, 334),
    line(Mat.WOOD, 4, 110, 300, 110, 270),
    line(Mat.PLANT, 8, 104, 266, 116, 262),
    line(Mat.WOOD, 4, 530, 300, 530, 268),
    line(Mat.PLANT, 8, 524, 264, 536, 260),
  ],
};

/** A torch at one end of a long fuse, TNT under a wooden hut at the other: it burns down, then the blast. */
const tnt: SandDemo = {
  name: 'TNT DEMOLITION',
  strokes: [
    line(Mat.STONE, 24, 0, 352, 640, 352),
    line(Mat.SAND, 20, 0, 336, 640, 336),
    line(Mat.SAND, 14, 0, 322, 200, 324, 640, 322),
    // the hut: walls, a roof, the charges in its floor
    // the walls stand just clear of the fuse, which runs in under them
    line(Mat.WOOD, 4, 400, 304, 400, 262),
    line(Mat.WOOD, 4, 500, 304, 500, 262),
    line(Mat.WOOD, 4, 392, 260, 450, 236, 508, 260),
    line(Mat.TNT, 8, 412, 310, 488, 310),
    // the fuse runs along the ground from the torch to the charges (about 10 s of burning)
    line(Mat.TORCH, 6, 292, 308, 298, 308),
    line(Mat.FUSE, 3, 301, 310, 408, 310),
    // a pond beside it to catch the debris
    line(Mat.STONE, 5, 540, 316, 540, 296),
    line(Mat.WATER, 10, 548, 312, 632, 312),
  ],
};

/** A lake held up on a cliff spills over the edge into the valley, where seeds wait. */
const waterfall: SandDemo = {
  name: 'WATERFALL',
  strokes: [
    line(Mat.STONE, 24, 0, 352, 640, 352),
    line(Mat.SAND, 16, 0, 338, 640, 338),
    // the cliff on the left, its lake behind a lip on the edge
    ...Array.from({ length: 9 }, (_, i) => line(Mat.STONE, 12, 0, 330 - i * 14, 250 - i * 6, 330 - i * 14)),
    line(Mat.STONE, 6, 0, 210, 0, 120),
    line(Mat.WATER, 14, 8, 200, 190, 200),
    line(Mat.WATER, 14, 8, 186, 190, 186),
    line(Mat.WATER, 14, 8, 172, 190, 172),
    line(Mat.WATER, 12, 8, 158, 190, 158),
    // the valley: a stone basin to collect it, and seeds on its floor
    line(Mat.STONE, 6, 300, 330, 600, 330),
    line(Mat.STONE, 6, 600, 330, 600, 300),
    ...Array.from({ length: 10 }, (_, i) => line(Mat.SEED, 4, 320 + i * 28, 322, 322 + i * 28, 322)),
  ],
};

/** Charges set in a sand tower, a house and a bridge, waiting for the big red button. */
const yard: SandDemo = {
  name: 'DEMOLITION YARD',
  hint: 'DEMOLITION YARD: PRESS K TO BLOW IT ALL UP - THEN V FOR THE REPLAY',
  strokes: [
    line(Mat.STONE, 24, 0, 352, 640, 352),
    line(Mat.SAND, 20, 0, 336, 640, 336),
    // a tower of sand in a wooden frame, C4 packed into its foot (painted
    // after, so it sits inside): the frame goes, and the tower pours down
    ...Array.from({ length: 14 }, (_, i) => line(Mat.SAND, 10, 76, 316 - i * 8, 124, 316 - i * 8)),
    line(Mat.WOOD, 4, 70, 326, 70, 200),
    line(Mat.WOOD, 4, 130, 326, 130, 200),
    line(Mat.WOOD, 4, 70, 200, 130, 200),
    line(Mat.C4, 6, 74, 320, 126, 320),
    // a stack of TNT crates beside it, for the chain
    line(Mat.TNT, 8, 166, 322, 194, 322),
    line(Mat.TNT, 8, 172, 314, 188, 314),
    // a wooden house with C4 under its floor
    line(Mat.WOOD, 4, 232, 324, 232, 274),
    line(Mat.WOOD, 4, 328, 324, 328, 274),
    line(Mat.WOOD, 4, 224, 272, 280, 244, 336, 272),
    line(Mat.C4, 4, 240, 322, 320, 322),
    // a wooden bridge on stone pillars over a pond, a charge on each pillar
    // and one under the deck, and a cup of NITRO on it that falls when it goes
    line(Mat.STONE, 8, 430, 326, 430, 270),
    line(Mat.STONE, 8, 590, 326, 590, 270),
    line(Mat.WATER, 12, 444, 318, 576, 318),
    line(Mat.WOOD, 6, 424, 266, 596, 266),
    line(Mat.C4, 4, 430, 302, 430, 292),
    line(Mat.C4, 4, 590, 302, 590, 292),
    line(Mat.C4, 4, 470, 268, 550, 268),
    line(Mat.WOOD, 2, 494, 262, 494, 250),
    line(Mat.WOOD, 2, 516, 262, 516, 250),
    line(Mat.NITRO, 4, 498, 258, 512, 258),
  ],
};

/**
 * NITRO trickles out of a trough high up and falls on a pyramid of TNT and
 * the huts beside it: every drop that lands is a blast, and the first sets
 * the TNT going.
 */
const nitroDrip: SandDemo = {
  name: 'NITRO DRIP',
  hint: 'NITRO DRIP: EVERY DROP THAT LANDS GOES OFF',
  strokes: [
    line(Mat.STONE, 24, 0, 352, 640, 352),
    line(Mat.SAND, 20, 0, 336, 640, 336),
    // the trough: a floor sloping down to the right, closed at the left, and
    // an end wall that stops three cells short of the floor - the nozzle
    line(Mat.WALL, 3, 40, 100, 262, 130),
    line(Mat.WALL, 3, 40, 70, 40, 100),
    line(Mat.WALL, 3, 264, 92, 264, 124),
    // in thin layers lying on the slope: painted in a lump, the top of it fell
    // onto the rest, and a drop that long is a blast (the trough went up first)
    ...[3.5, 7, 10.5].map((up) => line(Mat.NITRO, 4, 48, Math.round(100 + (8 * 30) / 222 - up), 256, Math.round(100 + (216 * 30) / 222 - up))),
    // under the nozzle: a pyramid of TNT, and wooden huts either side
    line(Mat.TNT, 8, 244, 322, 292, 322),
    line(Mat.TNT, 8, 252, 314, 284, 314),
    line(Mat.TNT, 6, 260, 307, 276, 307),
    line(Mat.WOOD, 4, 180, 324, 180, 290),
    line(Mat.WOOD, 4, 220, 324, 220, 290),
    line(Mat.WOOD, 4, 174, 288, 200, 274, 226, 288),
    line(Mat.WOOD, 4, 320, 324, 320, 290),
    line(Mat.WOOD, 4, 360, 324, 360, 290),
    line(Mat.WOOD, 4, 314, 288, 340, 274, 366, 288),
  ],
};

/** A shower of antimatter over a little town, and a hopper that keeps pouring it on the biggest block. */
const antimatterRain: SandDemo = {
  name: 'ANTIMATTER RAIN',
  hint: 'ANTIMATTER RAIN: ONLY WALL CAN HOLD IT',
  strokes: [
    line(Mat.WALL, 12, 0, 354, 640, 354),
    line(Mat.SAND, 14, 0, 342, 640, 342),
    // the town: stone, wood, a glass tower, a big stone block, trees
    ...Array.from({ length: 10 }, (_, i) => line(Mat.STONE, 8, 100, 330 - i * 8, 160, 330 - i * 8)),
    line(Mat.WOOD, 4, 200, 334, 200, 290),
    line(Mat.WOOD, 4, 260, 334, 260, 290),
    line(Mat.WOOD, 4, 194, 288, 230, 266, 266, 288),
    ...Array.from({ length: 16 }, (_, i) => line(Mat.GLASS, 6, 300, 332 - i * 7, 330, 332 - i * 7)),
    ...Array.from({ length: 8 }, (_, i) => line(Mat.STONE, 10, 400, 328 - i * 10, 540, 328 - i * 10)),
    line(Mat.WOOD, 3, 580, 334, 580, 300),
    line(Mat.PLANT, 10, 572, 296, 588, 292),
    line(Mat.WOOD, 3, 50, 334, 50, 304),
    line(Mat.PLANT, 10, 42, 300, 58, 296),
    // the shower: scattered drops across the sky
    ...Array.from({ length: 24 }, (_, i) => line(Mat.ANTIMATTER, 3, 60 + i * 22, 20 + ((i * 37) % 50), 61 + i * 22, 20 + ((i * 37) % 50))),
    // the hopper over the big block: a WALL funnel with a three-cell throat
    line(Mat.WALL, 3, 420, 60, 467, 110),
    line(Mat.WALL, 3, 520, 60, 473, 110),
    line(Mat.ANTIMATTER, 8, 440, 74, 500, 74),
    line(Mat.ANTIMATTER, 8, 452, 88, 488, 88),
  ],
};

/**
 * Three piles of thermite, each lit by a torch, burn down through what lies
 * under them: sand fused to a glass tube, stone to lava, a pocket of water
 * flashed to steam - until the bedrock WALL stops them.
 */
const thermiteDrill: SandDemo = {
  name: 'THERMITE DRILL',
  hint: 'THERMITE DRILL: IT BURNS DOWN THROUGH STONE - ONLY WALL STOPS IT',
  strokes: [
    line(Mat.WALL, 8, 0, 354, 640, 354),
    ...Array.from({ length: 6 }, (_, i) => line(Mat.STONE, 10, 0, 344 - i * 9, 640, 344 - i * 9)),
    // a pocket of water in the middle of the rock, and wood under the right-hand drill
    line(Mat.WATER, 10, 300, 318, 340, 318),
    line(Mat.WOOD, 8, 460, 300, 500, 300),
    ...Array.from({ length: 4 }, (_, i) => line(Mat.SAND, 10, 0, 290 - i * 9, 640, 290 - i * 9)),
    // the drills: a pile each, a torch touching its side
    ...[160, 320, 480].flatMap((x) => [
      line(Mat.THERMITE, 8, x - 10, 252, x + 10, 252),
      line(Mat.THERMITE, 6, x - 6, 246, x + 6, 246),
      line(Mat.TORCH, 4, x - 14, 252, x - 14, 252),
    ]),
  ],
};

export const SAND_DEMOS: SandDemo[] = [ponds, volcano, tnt, waterfall, nitroDrip, thermiteDrill, antimatterRain];

/** The sandbox's SCENES: the charged yard first, then everything that also plays behind the title screen. */
export const SANDBOX_SCENES: SandDemo[] = [yard, nitroDrip, antimatterRain, thermiteDrill, ponds, volcano, tnt, waterfall];
