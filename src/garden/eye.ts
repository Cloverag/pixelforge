/**
 * EYE OF WORDS: one giant eye made of text. The whole screen is filled with
 * words and short lines; what colour each letter takes depends on which part
 * of the eye it falls on - the white, the iris, the pupil, the lids, or the
 * dark field around - so from far away the words form an eye. It blinks,
 * the iris follows the pointer, and the view breathes in and out.
 *
 * Cheap per frame: the text is laid out once, as a white mask; each frame
 * paints the eye's colours on a second canvas and keeps them only where the
 * mask has letters ('destination-in').
 */

const LINES = [
  'we see the world not as it is but as we are',
  'look closer', 'wonder', 'perception', 'every light is a story',
  'the eye keeps what the heart cannot say', 'stillness', 'eternity',
  'what you look for is looking for you', 'consciousness', 'drift',
  'between the words there is a world', 'see', 'dream', 'remember',
  'light enters, meaning stays', 'quiet', 'infinite', 'blink and begin again',
];

export interface EyePalette {
  name: string;
  field: string;
  sclera: [string, string];
  iris: [string, string, string];
  lid: string;
}

export const EYE_PALETTES: EyePalette[] = [
  { name: 'MIDNIGHT', field: '#1b2560', sclera: ['#e8f4ff', '#7fa8d8'], iris: ['#9ff3ff', '#22b8e8', '#163a8c'], lid: '#7a5cff' },
  { name: 'BIOLUMINESCENT', field: '#0d3a3a', sclera: ['#e8fff6', '#7fd8b8'], iris: ['#b6ffd8', '#1ed69a', '#0d5a5a'], lid: '#2ee8c8' },
  { name: 'ASTRAL', field: '#2a1550', sclera: ['#f6eaff', '#b494e8'], iris: ['#ffd6ff', '#b45cff', '#3a1a7a'], lid: '#ff7ad8' },
];

/** The text, laid out once in white on transparent, filling w x h. */
export function eyeTextMask(w: number, h: number, size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.font = `600 ${size}px ui-monospace, Menlo, Consolas, monospace`;
  g.textBaseline = 'top';
  const lh = Math.round(size * 1.05);
  let k = 0;
  for (let y = 0; y < h; y += lh) {
    let x = -((k * 37) % 200);
    while (x < w) {
      const s = LINES[k++ % LINES.length] + ' ';
      g.fillText(s, x, y);
      x += g.measureText(s).width;
    }
  }
  return c;
}

/** How open the lids are, 0 shut to 1 open: a blink about every 4.5 s, 0.3 s long. */
export function lidOpen(t: number): number {
  const p = t % 4.5;
  if (p > 0.3) return 1;
  const k = p / 0.3;
  // close fast, open a little slower
  return k < 0.4 ? 1 - k / 0.4 : (k - 0.4) / 0.6;
}

/**
 * Paint the eye on `g` (w x h) through `mask`. `gx, gy` in -1..1: where the
 * iris looks. `t` in seconds drives the blink and the slow zoom.
 */
export function drawEye(g: CanvasRenderingContext2D, mask: HTMLCanvasElement, w: number, h: number, t: number, gx: number, gy: number, pal: EyePalette): void {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  // the camera breathes: in toward the iris, back out to the whole eye
  const zoom = 1 + 0.18 * (0.5 - 0.5 * Math.cos(t * 0.25));
  g.translate(w / 2, h / 2);
  g.scale(zoom, zoom);
  g.translate(-w / 2, -h / 2);

  const cx = w / 2;
  const cy = h / 2;
  const ew = w * 0.42; // half width of the eye
  const eh = h * 0.36 * Math.max(0.02, lidOpen(t)); // half height, closing in a blink

  // the field: dim words everywhere, a little brighter near the eye
  // the field stays dim, so the eye stands out of the words even without the text filter
  const fg = g.createRadialGradient(cx, cy, ew * 0.4, cx, cy, w * 0.75);
  fg.addColorStop(0, pal.field);
  fg.addColorStop(1, '#030409');
  g.globalAlpha = 0.6;
  g.fillStyle = fg;
  g.fillRect(-w, -h, w * 3, h * 3);
  g.globalAlpha = 1;

  // the lids' rims, a band of bright words just outside the eye's outline
  g.lineWidth = h * 0.05;
  g.strokeStyle = pal.lid;
  lens(g, cx, cy, ew * 1.04, eh + h * 0.02);
  g.stroke();

  g.save();
  lens(g, cx, cy, ew, eh);
  g.clip();
  const sg = g.createRadialGradient(cx, cy, 0, cx, cy, ew);
  sg.addColorStop(0, pal.sclera[0]);
  sg.addColorStop(1, pal.sclera[1]);
  g.fillStyle = sg;
  g.fillRect(cx - ew, cy - h, ew * 2, h * 2);
  // the iris, looking where it is told
  const ir = h * 0.3;
  const ix = cx + gx * ew * 0.45;
  const iy = cy + gy * h * 0.12;
  const ig = g.createRadialGradient(ix, iy, ir * 0.2, ix, iy, ir);
  ig.addColorStop(0, pal.iris[0]);
  ig.addColorStop(0.55, pal.iris[1]);
  ig.addColorStop(1, pal.iris[2]);
  g.fillStyle = ig;
  g.beginPath();
  g.arc(ix, iy, ir, 0, Math.PI * 2);
  g.fill();
  // streaks radiating through the iris
  g.strokeStyle = pal.iris[0];
  g.globalAlpha = 0.35;
  g.lineWidth = 2;
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    g.beginPath();
    g.moveTo(ix + Math.cos(a) * ir * 0.35, iy + Math.sin(a) * ir * 0.35);
    g.lineTo(ix + Math.cos(a) * ir * 0.95, iy + Math.sin(a) * ir * 0.95);
    g.stroke();
  }
  g.globalAlpha = 1;
  // the pupil: nearly black, so its words almost vanish
  g.fillStyle = '#0a0a14';
  g.beginPath();
  g.arc(ix, iy, ir * 0.38, 0, Math.PI * 2);
  g.fill();
  // a highlight of light on the cornea
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(ix - ir * 0.3, iy - ir * 0.32, ir * 0.12, 0, Math.PI * 2);
  g.fill();
  // the upper lid's shadow on the eyeball
  const shadow = g.createLinearGradient(0, cy - eh, 0, cy - eh * 0.4);
  shadow.addColorStop(0, 'rgba(0,0,0,0.55)');
  shadow.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = shadow;
  g.fillRect(cx - ew, cy - eh, ew * 2, eh);
  g.restore();

  // keep the colour only where there are letters
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'destination-in';
  g.translate(w / 2, h / 2);
  g.scale(zoom, zoom);
  g.translate(-w / 2, -h / 2);
  g.drawImage(mask, 0, 0);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'destination-over';
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'source-over';
}

/** The almond outline of an eye: two curves meeting at the corners. */
function lens(g: CanvasRenderingContext2D, cx: number, cy: number, ew: number, eh: number): void {
  g.beginPath();
  g.moveTo(cx - ew, cy);
  g.bezierCurveTo(cx - ew * 0.45, cy - eh * 1.35, cx + ew * 0.45, cy - eh * 1.35, cx + ew, cy);
  g.bezierCurveTo(cx + ew * 0.45, cy + eh * 1.25, cx - ew * 0.45, cy + eh * 1.25, cx - ew, cy);
  g.closePath();
}
