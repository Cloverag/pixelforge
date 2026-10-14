import { RNG } from '../core/rng';
import { Mat, colorAt } from './materials';
import { SIM_H, SIM_W, PgToolMsg } from './protocol';

const CAP = 24000;
export const PG_CAP = CAP;
const DRAG = 0.985;
const MAXV = 5;
const GRAVITY = 0.09;

interface Force {
  kind: 'attract' | 'repel' | 'vortex';
  x: number;
  y: number;
  str: number;
}

function u32(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (((255 << 24) | (b << 16) | (g << 8) | r) >>> 0);
}

/**
 * A smooth 64-step rainbow. Particles used to pick one of 12 hues at random,
 * so every stream read as confetti; now an emitter walks the wheel over
 * time and a stream is a ribbon of neighbouring colours.
 */
const RAINBOW_N = 64;
const RAINBOW: number[] = [];
for (let k = 0; k < RAINBOW_N; k++) {
  const h = (k / RAINBOW_N) * 6;
  const c = 0.78; // saturation x value: vivid but not neon
  const xx = c * (1 - Math.abs((h % 2) - 1));
  const [r, g, b] =
    h < 1 ? [c, xx, 0] : h < 2 ? [xx, c, 0] : h < 3 ? [0, c, xx] : h < 4 ? [0, xx, c] : h < 5 ? [xx, 0, c] : [c, 0, xx];
  const m = 1 - c;
  const to = (v: number) => Math.round((v + m * 0.55) * 255);
  RAINBOW.push((((255 << 24) | (to(b) << 16) | (to(g) << 8) | to(r)) >>> 0));
}

export const PG_BG = u32('#0b0b14');
const BG_R = PG_BG & 255;
const BG_G = (PG_BG >>> 8) & 255;
const BG_B = (PG_BG >>> 16) & 255;

/** additive blend with saturation: overlapping particles glow brighter */
function addSat(a: number, b: number): number {
  const r = Math.min(255, (a & 255) + (b & 255) - BG_R);
  const g = Math.min(255, ((a >>> 8) & 255) + ((b >>> 8) & 255) - BG_G);
  const bl = Math.min(255, ((a >>> 16) & 255) + ((b >>> 16) & 255) - BG_B);
  return ((255 << 24) | (Math.max(0, bl) << 16) | (Math.max(0, g) << 8) | Math.max(0, r)) >>> 0;
}

interface Rocket {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ty: number;
  hue: number;
}

export class PSys {
  private n = 0;
  private px = new Float32Array(CAP);
  private py = new Float32Array(CAP);
  /**
   * Depth, for the 3D view only. The 2D view ignores it and every rule
   * (walls, forces, water) stays two-dimensional; in 3D a firework is a
   * shell and a fountain has some thickness instead of being a sheet.
   */
  private pz = new Float32Array(CAP);
  private vx = new Float32Array(CAP);
  private vy = new Float32Array(CAP);
  private vz = new Float32Array(CAP);
  private life = new Float32Array(CAP);
  private hue = new Uint8Array(CAP);
  private rng = new RNG(987654321);

  forces: Force[] = [];
  gravityOn = true;
  private rockets: Rocket[] = [];
  /** walks the rainbow so a fountain stream changes colour over time */
  private hueClock = 0;
  /** called with each firework burst position (for sound and screen flash) */
  onBurst: ((x: number, y: number) => void) | null = null;

  constructor(private grid: import('./grid').Grid) {}

  reset(): void {
    this.n = 0;
    this.forces.length = 0;
    this.rockets.length = 0;
  }

  get count(): number {
    return this.n;
  }

  private push(x: number, y: number, vx: number, vy: number, life: number, hue: number, z = 0, vz = 0): void {
    if (this.n >= CAP) return;
    const i = this.n++;
    this.px[i] = x;
    this.py[i] = y;
    this.pz[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.life[i] = life;
    this.hue[i] = hue;
  }

  fountain(x: number, y: number): void {
    this.hueClock = (this.hueClock + 0.12) % RAINBOW_N;
    const base = this.hueClock | 0;
    for (let k = 0; k < 4; k++) {
      const a = -Math.PI / 2 + (this.rng.next() - 0.5) * 1.1;
      const sp = 1.5 + this.rng.next() * 2.5;
      const hue = (base + this.rng.int(4)) % RAINBOW_N;
      this.push(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 90 + this.rng.range(30, 90), hue, 0, (this.rng.next() - 0.5) * 1.2);
    }
  }

  /** Launch a rocket from the bottom edge that bursts at (x, y). */
  launch(x: number, y: number): void {
    if (this.rockets.length >= 12) return;
    const lx = x + (this.rng.next() - 0.5) * 30;
    // start below the target, but above anything in the way: launched from
    // the bottom edge, a rocket under a wall just burst against it
    let sy = y;
    while (sy < SIM_H - 2 && sy < y + 140 && !this.solidAt(lx, sy + 1)) sy++;
    if (sy - y < 12) {
      this.firework(x, y); // no room to fly: burst on the spot
      return;
    }
    this.rockets.push({
      x: lx,
      y: sy,
      vx: 0,
      vy: -(3.6 + this.rng.next() * 0.8),
      ty: y,
      hue: this.rng.int(RAINBOW_N),
    });
  }

  firework(x: number, y: number, baseHue = this.rng.int(RAINBOW_N)): void {
    const count = 110 + this.rng.int(50);
    for (let k = 0; k < count; k++) {
      const a = this.rng.next() * Math.PI * 2;
      const sp = 0.6 + this.rng.next() * 3.4;
      let i: number;
      if (this.n < CAP) i = this.n++;
      else i = this.rng.int(CAP);
      // a shell: a random direction on the sphere. Projected flat it is the
      // same filled disk the 2D view always showed.
      const cz = this.rng.next() * 2 - 1;
      const rxy = Math.sqrt(1 - cz * cz);
      this.px[i] = x;
      this.py[i] = y;
      this.pz[i] = 0;
      this.vx[i] = Math.cos(a) * rxy * sp;
      this.vy[i] = Math.sin(a) * rxy * sp;
      this.vz[i] = cz * sp;
      this.life[i] = 50 + this.rng.range(20, 70);
      // mostly one colour, a few sparks from the far side of the wheel
      this.hue[i] = this.rng.chance(0.75) ? (baseHue + this.rng.int(3)) % RAINBOW_N : (baseHue + RAINBOW_N / 2) % RAINBOW_N;
    }
    this.onBurst?.(x, y);
  }

  placeForce(kind: 'attractor' | 'repulsor' | 'vortex', x: number, y: number): void {
    if (this.forces.length >= 8) this.forces.shift();
    const internal: Force['kind'] =
      kind === 'attractor' ? 'attract' : kind === 'repulsor' ? 'repel' : 'vortex';
    this.forces.push({
      kind: internal,
      x,
      y,
      str: internal === 'vortex' ? 0.5 : 0.28,
    });
  }

  eraseNear(x: number, y: number, r = 14): void {
    this.forces = this.forces.filter((f) => (f.x - x) ** 2 + (f.y - y) ** 2 > r * r);
    for (let i = 0; i < this.n; ) {
      const dx = this.px[i] - x;
      const dy = this.py[i] - y;
      if (dx * dx + dy * dy < r * r) this.kill(i);
      else i++;
    }
  }

  private kill(i: number): void {
    const last = --this.n;
    this.px[i] = this.px[last];
    this.py[i] = this.py[last];
    this.pz[i] = this.pz[last];
    this.vx[i] = this.vx[last];
    this.vy[i] = this.vy[last];
    this.vz[i] = this.vz[last];
    this.life[i] = this.life[last];
    this.hue[i] = this.hue[last];
  }

  private solidAt(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= SIM_W || y >= SIM_H) return true;
    return this.grid.cells[(y | 0) * SIM_W + (x | 0)] !== Mat.EMPTY;
  }

  tool(msg: PgToolMsg): void {
    switch (msg.kind) {
      case 'fountain':
        if (msg.phase !== 'up') this.fountain(msg.x, msg.y);
        break;
      case 'firework':
        if (msg.phase === 'down') this.launch(msg.x, msg.y);
        break;
      case 'attractor':
      case 'repulsor':
      case 'vortex':
        if (msg.phase === 'down')
          this.placeForce(msg.kind as 'attractor' | 'repulsor' | 'vortex', msg.x, msg.y);
        break;
      case 'erase':
        if (msg.phase !== 'up') {
          this.eraseNear(msg.x, msg.y);
          const r = 8;
          for (let dy = -r; dy <= r; dy++)
            for (let dx = -r; dx <= r; dx++) {
              if (dx * dx + dy * dy > r * r) continue;
              const x = (msg.x + dx) | 0;
              const y = (msg.y + dy) | 0;
              if (x < 0 || y < 0 || x >= SIM_W || y >= SIM_H) continue;
              if (this.grid.cells[y * SIM_W + x] !== Mat.EMPTY)
                this.grid.setXY(x, y, Mat.EMPTY);
            }
        }
        break;
    }
  }

  /**
   * Particles for the 3D view: x, y, z and a linear, over-bright RGB per
   * particle (6 floats). Same colour rule as the 2D raster - rainbow hue,
   * white-hot when fast, fading out at the end of life - but in linear
   * light and pushed past 1.0 so the 3D bloom treats them as light.
   * Returns how many were written.
   */
  pack3d(out: Float32Array): number {
    const n = Math.min(this.n, (out.length / 6) | 0);
    for (let i = 0; i < n; i++) {
      const o = i * 6;
      out[o] = this.px[i];
      out[o + 1] = this.py[i];
      out[o + 2] = this.pz[i];
      const v2 = this.vx[i] * this.vx[i] + this.vy[i] * this.vy[i] + this.vz[i] * this.vz[i];
      const hot = Math.min(0.55, v2 / 30);
      const fade = Math.min(1, this.life[i] / 40);
      const c = RAINBOW[this.hue[i]];
      const gain = 2.2 * fade;
      const ch = (v: number) => {
        const s = (v + (255 - v) * hot) / 255;
        return s * s * gain; // ~sRGB -> linear, then over-bright
      };
      out[o + 3] = ch(c & 255);
      out[o + 4] = ch((c >>> 8) & 255);
      out[o + 5] = ch((c >>> 16) & 255);
    }
    return n;
  }

  /** Force markers for the 3D view: [kind 0/1/2, x, y] triples. */
  packForces(): number[] {
    const out: number[] = [];
    for (const f of this.forces) out.push(f.kind === 'attract' ? 0 : f.kind === 'repel' ? 1 : 2, f.x, f.y);
    return out;
  }

  /** decay trails -> integrate -> rasterize heads */
  fullRender(pix: Uint32Array, forceFull: boolean, frame: number): void {
    if (forceFull) pix.fill(PG_BG);

    // Trail decay, toward the background. Scaling toward black instead left
    // trails darker than the background - a black wedge under every fountain.
    const nPx = SIM_W * SIM_H;
    for (let i = 0; i < nPx; i++) {
      const c = pix[i];
      if (c === PG_BG) continue;
      const r = BG_R + ((((c & 255) - BG_R) * 230) >> 8);
      const g = BG_G + (((((c >>> 8) & 255) - BG_G) * 230) >> 8);
      const b = BG_B + (((((c >>> 16) & 255) - BG_B) * 230) >> 8);
      pix[i] =
        Math.abs(r - BG_R) + Math.abs(g - BG_G) + Math.abs(b - BG_B) < 4
          ? PG_BG
          : ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
    }

    // draw painted grid cells (WALL brush constructions) so they are visible
    {
      const cells = this.grid.cells;
      for (let i = 0; i < nPx; i++) {
        const c = cells[i];
        // alpha 253 tags a wall for the cinematic composite to light
        if (c !== Mat.EMPTY)
          pix[i] = ((colorAt(c, i % SIM_W, (i / SIM_W) | 0, frame, 0) & 0x00ffffff) | (253 << 24)) >>> 0;
      }
    }

    // rockets: climb with a wobble, shed sparks, burst at their target height
    for (let k = this.rockets.length - 1; k >= 0; k--) {
      const r = this.rockets[k];
      r.vx = Math.max(-0.6, Math.min(0.6, r.vx + (this.rng.next() - 0.5) * 0.15));
      r.x += r.vx;
      r.y += r.vy;
      r.vy *= 0.985;
      if (this.rng.chance(0.8)) this.push(r.x, r.y + 1, (this.rng.next() - 0.5) * 0.4, 0.6, 18 + this.rng.int(14), (r.hue + 2) % RAINBOW_N);
      if (r.y <= r.ty || r.vy > -0.6 || this.solidAt(r.x, r.y)) {
        this.firework(r.x, r.y, r.hue);
        this.rockets.splice(k, 1);
        continue;
      }
      const rx = r.x | 0;
      const ry = r.y | 0;
      if (rx >= 0 && ry >= 0 && rx < SIM_W && ry < SIM_H) pix[ry * SIM_W + rx] = 0xffd8f4ff;
    }

    // integrate
    const g = this.grid;
    for (let i = 0; i < this.n; i++) {
      let vx = this.vx[i];
      let vy = this.vy[i];

      if (this.gravityOn) vy += GRAVITY;

      for (const f of this.forces) {
        const dx = f.x - this.px[i];
        const dy = f.y - this.py[i];
        const d2 = dx * dx + dy * dy;
        const R = 130;
        if (d2 > R * R || d2 < 1) continue;
        const d = Math.sqrt(d2);
        const falloff = 1 - d / R;
        const ux = dx / d;
        const uy = dy / d;
        if (f.kind === 'attract') {
          vx += ux * f.str * falloff * 2;
          vy += uy * f.str * falloff * 2;
        } else if (f.kind === 'repel') {
          vx -= ux * f.str * falloff * 2;
          vy -= uy * f.str * falloff * 2;
        } else {
          vx += -uy * f.str * falloff * 3;
          vy += ux * f.str * falloff * 3;
        }
      }

      vx *= DRAG;
      vy *= DRAG;
      // depth: drag, an attractor pulls toward its plane, and a soft wall
      // keeps the cloud from drifting off the stage
      let vz = this.vz[i] * DRAG;
      for (const f of this.forces) if (f.kind === 'attract') vz -= this.pz[i] * 0.004;
      this.pz[i] += vz;
      if (this.pz[i] > 70 || this.pz[i] < -70) vz = -vz * 0.5;
      this.vz[i] = vz;
      const spd2 = vx * vx + vy * vy;
      if (spd2 > MAXV * MAXV) {
        const s = MAXV / Math.sqrt(spd2);
        vx *= s;
        vy *= s;
      }

      // axis-separated collision with painted walls
      const nx = this.px[i] + vx;
      const ny = this.py[i] + vy;
      let bounced = false;
      if (!this.solidAt(nx, this.py[i])) this.px[i] = nx;
      else { this.vx[i] = -vx * 0.55; bounced = true; }
      if (!this.solidAt(this.px[i], ny)) this.py[i] = ny;
      else { this.vy[i] = -vy * 0.55; bounced = true; }

      this.life[i] -= 1;
      const ix = this.px[i] | 0;
      const iy = this.py[i] | 0;
      const oob =
        ix < -4 || iy < -4 || ix > SIM_W + 4 || iy > SIM_H + 4;
      if (
        this.life[i] <= 0 || oob ||
        (!bounced && iy >= 0 && iy < SIM_H && ix >= 0 && ix < SIM_W &&
          g.cells[iy * SIM_W + ix] === Mat.WATER)
      ) {
        this.kill(i);
        i--;
      }
    }

    // rasterize heads (+ motion stretch)
    for (let i = 0; i < this.n; i++) {
      const x = this.px[i] | 0;
      const y = this.py[i] | 0;
      if (x < 0 || y < 0 || x >= SIM_W || y >= SIM_H) continue;
      const idx = y * SIM_W + x;
      const fade = Math.min(1, this.life[i] / 40);
      const v2 = this.vx[i] * this.vx[i] + this.vy[i] * this.vy[i];
      // fast particles run white-hot; dying ones fade into the background
      const hot = Math.min(0.55, v2 / 30);
      const base = RAINBOW[this.hue[i]];
      let r = (base & 255) + ((255 - (base & 255)) * hot);
      let gr = ((base >>> 8) & 255) + ((255 - ((base >>> 8) & 255)) * hot);
      let b = ((base >>> 16) & 255) + ((255 - ((base >>> 16) & 255)) * hot);
      r = BG_R + (r - BG_R) * fade;
      gr = BG_G + (gr - BG_G) * fade;
      b = BG_B + (b - BG_B) * fade;
      const col = ((255 << 24) | ((b | 0) << 16) | ((gr | 0) << 8) | (r | 0)) >>> 0;
      pix[idx] = addSat(pix[idx], col);
      if (v2 > 4) {
        const mx = (x - this.vx[i] * 0.5) | 0;
        const my = (y - this.vy[i] * 0.5) | 0;
        if (mx >= 0 && my >= 0 && mx < SIM_W && my < SIM_H)
          pix[my * SIM_W + mx] = addSat(pix[my * SIM_W + mx], col);
      }
    }

    // force markers, animated: attractors pull a ring inward, repulsors
    // push one outward, vortices spin three arms
    const mA = u32('#6ef0e0');
    const mR = u32('#f06e9e');
    const mV = u32('#c9f06e');
    const dot = (x: number, y: number, col: number) => {
      const ix = x | 0;
      const iy = y | 0;
      if (ix >= 0 && iy >= 0 && ix < SIM_W && iy < SIM_H) pix[iy * SIM_W + ix] = col;
    };
    for (const f of this.forces) {
      const col = f.kind === 'attract' ? mA : f.kind === 'repel' ? mR : mV;
      dot(f.x, f.y, col);
      if (f.kind === 'vortex') {
        for (let arm = 0; arm < 3; arm++)
          for (let rr = 2; rr <= 6; rr++) {
            const a = frame * 0.15 + (arm * Math.PI * 2) / 3 + rr * 0.35;
            dot(f.x + Math.cos(a) * rr, f.y + Math.sin(a) * rr, col);
          }
      } else {
        const phase = (frame % 24) / 24;
        const rr = f.kind === 'attract' ? 8 - phase * 6 : 2 + phase * 6;
        const steps = Math.max(8, (rr * 6) | 0);
        for (let k = 0; k < steps; k++) {
          const a = (k / steps) * Math.PI * 2;
          dot(f.x + Math.cos(a) * rr, f.y + Math.sin(a) * rr, col);
        }
      }
    }

    void frame;
  }
}
