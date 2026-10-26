/**
 * A picture into line art, for the sandbox's PICTURE: the outlines of a
 * photo as cells of a material - a portrait in wood to set alight, a
 * skyline in stone to pour water over.
 *
 * Edge detection written out, no library: brightness, a light blur so film
 * grain is not an edge, the Sobel operator for how fast brightness changes
 * and which way, thinning to one-cell lines (keep a cell only where it is
 * the strongest across its edge), then two thresholds - keep the strong
 * edges, and the weaker ones only where they join a strong one, so lines
 * stay whole without the noise between them. Pure: pixels in, a mask out.
 */

/** Where the picture sits in the w x h grid (fitted inside it, aspect kept). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Fit a picture of `iw` x `ih` inside `w` x `h`, `margin` cells clear all round. */
export function fitRect(iw: number, ih: number, w: number, h: number, margin: number): Rect {
  const s = Math.min((w - 2 * margin) / iw, (h - 2 * margin) / ih);
  const rw = Math.max(1, Math.round(iw * s));
  const rh = Math.max(1, Math.round(ih * s));
  return { x: Math.floor((w - rw) / 2), y: Math.floor((h - rh) / 2), w: rw, h: rh };
}

/**
 * The line art of `rgba` (w x h pixels, the picture drawn into `r`): 1 where
 * a line is. `detail` 0..1 is how much is kept - 0 only the strongest
 * outlines, 1 most of the texture.
 */
export function lineArt(rgba: Uint8ClampedArray, w: number, h: number, r: Rect, detail: number): Uint8Array {
  const n = w * h;
  // brightness (Rec. 601 weights)
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) lum[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  // 3x3 blur, [1 2 1] each way
  const blur = new Float32Array(n);
  // sampled inside the picture only: past its border it repeats its own edge
  // pixels, so the black around a fitted photo never blurs into it
  const at = (a: Float32Array, x: number, y: number) =>
    a[Math.min(r.y + r.h - 1, Math.max(r.y, y)) * w + Math.min(r.x + r.w - 1, Math.max(r.x, x))];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += at(lum, x + dx, y + dy) * (2 - Math.abs(dx)) * (2 - Math.abs(dy));
      blur[y * w + x] = s / 16;
    }
  // Sobel: gx = [-1 0 1; -2 0 2; -1 0 1], gy its transpose. Only inside the
  // picture, a cell in from its border: the border is where picture meets
  // nothing, not an edge in it.
  const mag = new Float32Array(n);
  const dir = new Uint8Array(n);
  const inside = (x: number, y: number) => x > r.x && y > r.y && x < r.x + r.w - 1 && y < r.y + r.h - 1;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      if (!inside(x, y)) continue;
      const p = (dx: number, dy: number) => blur[(y + dy) * w + x + dx];
      const gx = p(1, -1) + 2 * p(1, 0) + p(1, 1) - p(-1, -1) - 2 * p(-1, 0) - p(-1, 1);
      const gy = p(-1, 1) + 2 * p(0, 1) + p(1, 1) - p(-1, -1) - 2 * p(0, -1) - p(1, -1);
      mag[y * w + x] = Math.hypot(gx, gy);
      // the gradient's direction in four: 0 across x, 1 the / diagonal, 2 across y, 3 the \ diagonal
      const a = ((Math.atan2(gy, gx) * 180) / Math.PI + 180) % 180;
      dir[y * w + x] = a < 22.5 || a >= 157.5 ? 0 : a < 67.5 ? 1 : a < 112.5 ? 2 : 3;
    }
  // thin: a cell stays only if it is the strongest of the three across its edge
  const STEP = [[1, 0], [1, 1], [0, 1], [-1, 1]];
  const thin = new Float32Array(n);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const m = mag[i];
      if (m === 0) continue;
      const [sx, sy] = STEP[dir[i]];
      // a tie (an edge exactly between two cells) goes to one side, or every line is two cells wide
      if (m > mag[i + sy * w + sx] && m >= mag[i - sy * w - sx]) thin[i] = m;
    }
  // thresholds from the picture itself: the strong edges are the top few
  // percent of the thinned cells; weak ones half as strong
  const vals: number[] = [];
  for (let i = 0; i < n; i++) if (thin[i] > 0) vals.push(thin[i]);
  if (vals.length === 0) return new Uint8Array(n);
  vals.sort((a, b) => a - b);
  const keep = 0.06 + 0.3 * Math.min(1, Math.max(0, detail));
  // never below a floor: a flat picture's faint noise is not line art
  const hi = Math.max(24, vals[Math.min(vals.length - 1, Math.floor(vals.length * (1 - keep)))]);
  const lo = hi * 0.5;
  const out = new Uint8Array(n);
  const stack: number[] = [];
  for (let i = 0; i < n; i++)
    if (thin[i] >= hi) {
      out[i] = 1;
      stack.push(i);
    }
  // weak cells join if they touch a kept one, and so on along the line
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const j = i + dy * w + dx;
        if (nx < 0 || nx >= w || j < 0 || j >= n || out[j] || thin[j] < lo) continue;
        out[j] = 1;
        stack.push(j);
      }
  }
  return out;
}

/** The mask's cells as x, y pairs - a paint input's points. */
export function maskPoints(mask: Uint8Array, w: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < mask.length; i++) if (mask[i]) pts.push(i % w, (i / w) | 0);
  return pts;
}
