import { openness, type Flower } from './flowers';

/**
 * Draws the garden as vector art on a 2D canvas: stems, leaves, and each
 * kind of bloom from curves and gradients. The ASCII filter (ascii.ts) turns
 * this picture into coloured text; with the filter off it is shown as is.
 *
 * `k` scales the world's 640 x 360 up to the canvas.
 */
export function drawGarden(g: CanvasRenderingContext2D, flowers: Flower[], now: number, k: number, stars: boolean): void {
  const W = g.canvas.width;
  const H = g.canvas.height;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  if (stars) drawStars(g, W, H, now);
  g.setTransform(k, 0, 0, k, 0, 0);
  // stems and leaves under every bloom
  for (const f of flowers) drawStem(g, f, now);
  for (const f of flowers) drawBloom(g, f, now);
}

/** A slow sway: the bloom moves, the stem's foot stays. */
function sway(f: Flower, now: number): number {
  return Math.sin(now * 0.9 + f.phase) * 2.2;
}

function drawStars(g: CanvasRenderingContext2D, W: number, H: number, now: number): void {
  for (let i = 0; i < 90; i++) {
    const x = ((i * 9301 + 49297) % 233280) / 233280;
    const y = ((i * 4253 + 1931) % 104729) / 104729;
    const tw = 0.4 + 0.6 * Math.abs(Math.sin(now * 1.3 + i));
    g.fillStyle = `rgba(255,255,255,${0.5 * tw})`;
    g.fillRect(x * W, y * H, 2, 2);
  }
}

function drawStem(g: CanvasRenderingContext2D, f: Flower, now: number): void {
  const o = openness(f, now);
  if (o <= 0) return;
  const bx = f.x + sway(f, now);
  const by = f.y;
  // the stem grows up from its foot as the bloom opens
  const ex = f.sx + (bx - f.sx) * o;
  const ey = f.sy + (by - f.sy) * o;
  const mx = (f.sx + ex) / 2 + (bx - f.sx) * 0.25;
  const my = (f.sy + ey) / 2;
  g.strokeStyle = '#3f9a3a';
  g.lineWidth = 2.4;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(f.sx, f.sy);
  g.quadraticCurveTo(mx, my, ex, ey);
  g.stroke();
  // two leaves part-way up, one on each side
  for (const [t, side] of [[0.35, -1], [0.6, 1]] as const) {
    const lx = f.sx + (ex - f.sx) * t;
    const ly = f.sy + (ey - f.sy) * t;
    leaf(g, lx, ly, side, 16 * o, o);
  }
}

function leaf(g: CanvasRenderingContext2D, x: number, y: number, side: number, len: number, o: number): void {
  const grad = g.createLinearGradient(x, y, x + side * len, y - len * 0.5);
  grad.addColorStop(0, '#2e7d2a');
  grad.addColorStop(1, '#8fd45a');
  g.fillStyle = grad;
  g.globalAlpha = o;
  g.beginPath();
  g.moveTo(x, y);
  g.quadraticCurveTo(x + side * len * 0.6, y - len * 0.9, x + side * len, y - len * 0.45);
  g.quadraticCurveTo(x + side * len * 0.5, y - len * 0.05, x, y);
  g.fill();
  g.globalAlpha = 1;
}

function drawBloom(g: CanvasRenderingContext2D, f: Flower, now: number): void {
  const o = openness(f, now);
  if (o <= 0) return;
  g.save();
  g.translate(f.x + sway(f, now), f.y);
  g.rotate(f.rot + Math.sin(now * 0.7 + f.phase) * 0.04);
  const r = f.r * (0.25 + 0.75 * o);
  if (f.kind === 'lily') lily(g, r, f);
  else if (f.kind === 'tulip') tulip(g, r, f);
  else if (f.kind === 'daisy') ray(g, r, f, 16, 0.22, '#f2c230');
  else if (f.kind === 'sunflower') ray(g, r, f, 22, 0.3, '#5a3416');
  else rose(g, r, f);
  g.restore();
}

/** A petal from the centre to its tip at (len, 0), `w` wide, its tip bent. */
function petal(g: CanvasRenderingContext2D, len: number, w: number, bend: number): void {
  g.beginPath();
  g.moveTo(0, 0);
  g.bezierCurveTo(len * 0.3, -w, len * 0.75, -w * 0.9, len, bend);
  g.bezierCurveTo(len * 0.75, w * 0.9, len * 0.3, w, 0, 0);
}

/** Six pointed petals in two rings, a darker throat, a midrib, freckles and long stamens. */
function lily(g: CanvasRenderingContext2D, r: number, f: Flower): void {
  for (let ring = 0; ring < 2; ring++) {
    for (let i = 0; i < 3; i++) {
      g.save();
      g.rotate((i * Math.PI * 2) / 3 + ring * (Math.PI / 3));
      const len = r * (ring ? 0.92 : 1);
      const grad = g.createLinearGradient(0, 0, len, 0);
      // the back ring a step darker, so the front petals stand out
      grad.addColorStop(0, shade(f.petal, -0.55));
      grad.addColorStop(0.35, shade(f.petal, ring ? 0 : -0.2));
      grad.addColorStop(1, shade(f.tip, ring ? 0 : -0.15));
      g.fillStyle = grad;
      petal(g, len, r * 0.15, r * 0.12);
      g.fill();
      // a dark outline: in text, the gaps between petals are what draw the star
      g.strokeStyle = 'rgba(0,0,0,0.85)';
      g.lineWidth = Math.max(1.6, r * 0.06);
      g.stroke();
      // midrib and freckles
      g.strokeStyle = shade(f.petal, -0.25);
      g.lineWidth = 0.8;
      g.beginPath();
      g.moveTo(r * 0.1, 0);
      g.lineTo(len * 0.85, r * 0.05);
      g.stroke();
      g.fillStyle = shade(f.petal, -0.5);
      for (let s = 0; s < 4; s++) g.fillRect(len * (0.18 + s * 0.08), (s % 2 ? 1 : -1) * r * 0.05, 1.4, 1.4);
      g.restore();
    }
  }
  // stamens: thin pale lines with dark anthers
  g.strokeStyle = '#d8e8a0';
  g.lineWidth = 0.9;
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 + 0.3;
    const ex = Math.cos(a) * r * 0.55;
    const ey = Math.sin(a) * r * 0.55;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(ex, ey);
    g.stroke();
    g.fillStyle = '#6a2a12';
    g.fillRect(ex - 1.5, ey - 1, 3, 2);
  }
}

/** A cup of three overlapping petals, seen from the side. */
function tulip(g: CanvasRenderingContext2D, r: number, f: Flower): void {
  g.rotate(-f.rot); // tulips stand upright
  for (const [dx, w] of [[-0.45, 0.55], [0.45, 0.55], [0, 0.6]] as const) {
    const grad = g.createLinearGradient(0, r, 0, -r);
    grad.addColorStop(0, shade(f.petal, -0.3));
    grad.addColorStop(1, f.tip);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(dx * r - w * r, r * 0.2);
    g.quadraticCurveTo(dx * r - w * r, -r * 0.9, dx * r, -r);
    g.quadraticCurveTo(dx * r + w * r, -r * 0.9, dx * r + w * r, r * 0.2);
    g.quadraticCurveTo(dx * r, r * 0.8, dx * r - w * r, r * 0.2);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.8)';
    g.lineWidth = Math.max(1.4, r * 0.05);
    g.stroke();
  }
}

/** A daisy or a sunflower: a ring of thin petals around a disc. */
function ray(g: CanvasRenderingContext2D, r: number, f: Flower, n: number, disc: number, discCol: string): void {
  for (let i = 0; i < n; i++) {
    g.save();
    g.rotate((i * Math.PI * 2) / n);
    const grad = g.createLinearGradient(0, 0, r, 0);
    grad.addColorStop(0, shade(f.petal, -0.2));
    grad.addColorStop(1, f.tip);
    g.fillStyle = grad;
    petal(g, r, r * 0.1, 0);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.7)';
    g.lineWidth = Math.max(1.2, r * 0.04);
    g.stroke();
    g.restore();
  }
  const d = g.createRadialGradient(0, 0, 0, 0, 0, r * disc);
  d.addColorStop(0, shade(discCol, 0.25));
  d.addColorStop(1, shade(discCol, -0.3));
  g.fillStyle = d;
  g.beginPath();
  g.arc(0, 0, r * disc, 0, Math.PI * 2);
  g.fill();
}

/** A rose: petals wound in a spiral, darker in the heart. */
function rose(g: CanvasRenderingContext2D, r: number, f: Flower): void {
  for (let i = 18; i >= 0; i--) {
    const t = i / 18;
    const a = i * 2.4;
    const rr = r * (0.2 + 0.8 * t);
    g.fillStyle = shade(f.petal, -0.4 + 0.5 * t);
    g.beginPath();
    g.ellipse(Math.cos(a) * rr * 0.25, Math.sin(a) * rr * 0.25, rr * 0.55, rr * 0.38, a, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = f.tip;
  g.globalAlpha = 0.5;
  g.beginPath();
  g.arc(-r * 0.2, -r * 0.25, r * 0.3, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;
}

/** Lighter (amt > 0) or darker (amt < 0) version of a '#rrggbb' colour. */
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt));
  const r = f((n >> 16) & 255);
  const gg = f((n >> 8) & 255);
  const b = f(n & 255);
  return `#${((r << 16) | (gg << 8) | b).toString(16).padStart(6, '0')}`;
}
