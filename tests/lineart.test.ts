import { describe, expect, it } from 'vitest';
import { fitRect, lineArt, maskPoints } from '../src/game/lineart';

const W = 160;
const H = 90;
const FULL = { x: 0, y: 0, w: W, h: H };

/** A grey picture, `paint` setting brightness per pixel. */
function picture(paint: (x: number, y: number) => number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const v = paint(x, y);
      px.set([v, v, v, 255], (y * W + x) * 4);
    }
  return px;
}

const count = (m: Uint8Array) => m.reduce((s, v) => s + v, 0);
const on = (m: Uint8Array, x: number, y: number) => m[y * W + x] === 1;

describe('PICTURE: a photo as line art', () => {
  it('fits a picture inside the world, centred, keeping its shape', () => {
    expect(fitRect(1920, 1080, 640, 360, 6)).toEqual({ x: 10, y: 6, w: 619, h: 348 });
    const tall = fitRect(1000, 2000, 640, 360, 6);
    expect(tall.h).toBe(348);
    expect(tall.w).toBe(174);
    expect(tall.x).toBe(Math.floor((640 - 174) / 2));
  });

  it('a white square on black becomes its outline: thin, closed, nothing inside or out', () => {
    const m = lineArt(picture((x, y) => (x >= 50 && x < 110 && y >= 20 && y < 70 ? 255 : 0)), W, H, FULL, 0.35);
    // every side of the square has its line within a cell of the edge
    for (let x = 55; x < 105; x++) {
      expect(on(m, x, 19) || on(m, x, 20), `top ${x}`).toBe(true);
      expect(on(m, x, 69) || on(m, x, 70), `bottom ${x}`).toBe(true);
    }
    for (let y = 25; y < 65; y++) {
      expect(on(m, 49, y) || on(m, 50, y), `left ${y}`).toBe(true);
      expect(on(m, 109, y) || on(m, 110, y), `right ${y}`).toBe(true);
    }
    // thin: about one line per side, not a band (perimeter 220)
    expect(count(m)).toBeLessThan(220 * 1.6);
    // and nothing away from the edges
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const near = x >= 47 && x <= 112 && y >= 17 && y <= 72 && !(x >= 53 && x <= 106 && y >= 23 && y <= 66);
        if (!near) expect(on(m, x, y), `${x},${y}`).toBe(false);
      }
  });

  it('a flat picture, or one with only faint grain, has no lines', () => {
    expect(count(lineArt(picture(() => 128), W, H, FULL, 1))).toBe(0);
    // grain of +-4: noise, not edges, even at full detail
    let s = 12345;
    const grain = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) % 9) - 4;
    expect(count(lineArt(picture(() => 128 + grain()), W, H, FULL, 1))).toBe(0);
  });

  it('where the picture ends is not an edge', () => {
    // a white picture fitted into the middle, black around it
    const r = { x: 40, y: 20, w: 80, h: 50 };
    const m = lineArt(picture((x, y) => (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h ? 255 : 0)), W, H, r, 1);
    expect(count(m)).toBe(0);
  });

  it('a faint stretch of a strong line is kept; a faint mark on its own is not', () => {
    // one edge across the picture: strong on the left, faint on the right,
    // and a faint square far from it
    const m = lineArt(
      picture((x, y) => {
        if (y >= 70 && y < 80 && x >= 120 && x < 130) return 110 + 22;
        if (y < 45) return 110;
        return x < 80 ? 255 : 110 + 90;
      }),
      W,
      H,
      FULL,
      0,
    );
    let faintPart = 0;
    for (let x = 90; x < 150; x++) if (on(m, x, 44) || on(m, x, 45)) faintPart++;
    expect(faintPart).toBeGreaterThan(50);
    let lone = 0;
    for (let y = 66; y < 84; y++) for (let x = 116; x < 134; x++) lone += m[y * W + x];
    expect(lone).toBe(0);
  });

  it('more DETAIL keeps more lines', () => {
    // texture: rings of slowly changing contrast
    const px = picture((x, y) => 128 + Math.round(100 * Math.sin(Math.hypot(x - 80, y - 45) / 2) * (0.2 + (0.8 * x) / W)));
    const low = count(lineArt(px, W, H, FULL, 0));
    const high = count(lineArt(px, W, H, FULL, 1));
    expect(high).toBeGreaterThan(low * 1.5);
  });

  it("the mask's cells become a paint input's x, y pairs", () => {
    const m = new Uint8Array(W * H);
    m[3 * W + 7] = 1;
    m[89 * W + 159] = 1;
    expect(maskPoints(m, W)).toEqual([7, 3, 159, 89]);
  });
});
