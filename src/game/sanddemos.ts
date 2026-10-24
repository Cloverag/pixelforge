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

export const SAND_DEMOS: SandDemo[] = [ponds, volcano];
