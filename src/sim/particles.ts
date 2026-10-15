import { RNG } from '../core/rng';
import { Mat, colorAt } from './materials';
import { SIM_H, SIM_W, PgToolMsg } from './protocol';

const CAP = 24000;
export const PG_CAP = CAP;
const DRAG = 0.985;
const MAXV = 5;
const GRAVITY = 0.09;

interface Force {
  kind: 'attract' | 'repel' | 'vortex' | 'hole';
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

/** particle kinds */
const PK_PLAIN = 0;
const PK_SPARK = 1;
const PK_FIREFLY = 2;

/** the playground's bouncy wall is painted as GLASS: it reads as a bumper */
export const PG_BUMPER = Mat.GLASS;

/**
 * Bumpers are an instrument: a hit plays one of NOTE_COUNT notes (three
 * octaves of a pentatonic scale, so any mix sounds consonant), chosen by
 * height - higher on screen, higher pitch.
 */
export const NOTE_COUNT = 15;
export function noteAt(y: number): number {
  const n = Math.floor(((SIM_H - y) / SIM_H) * NOTE_COUNT);
  return Math.max(0, Math.min(NOTE_COUNT - 1, n));
}
/** flash colour for a note: low notes red, high notes violet */
function noteHue(note: number): number {
  return Math.round((note / (NOTE_COUNT - 1)) * 50);
}

/** Playground activity since the last frame, for the sound design. */
export interface PgStats {
  particles: number;
  fountain: number;
  hose: number;
  sparkler: number;
  sparks: number;
  fireflies: number;
  bumps: number;
  /** bumper notes struck this frame, as [note, x] pairs, one per note */
  notes: number[];
  swallowed: number;
  holes: number;
  vortices: number;
  pulls: number;
  rockets: number;
}

export function emptyPgStats(): PgStats {
  return { particles: 0, fountain: 0, hose: 0, sparkler: 0, sparks: 0, fireflies: 0, bumps: 0, notes: [], swallowed: 0, holes: 0, vortices: 0, pulls: 0, rockets: 0 };
}
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
  /** what a particle is: PK_* (plain, spark, firefly) */
  private kind = new Uint8Array(CAP);
  private rng = new RNG(987654321);
  private frame = 0;
  /** this frame's black holes, for dimming what falls in */
  private holes: Force[] = [];
  /** 1 = normal speed; slow-mo runs the playground at a fraction of it */
  timeScale = 1;
  /** last hose point and direction, so a held hose keeps spraying its way */
  private hoseX = -1;
  private hoseY = -1;
  private hoseDx = 0;
  private hoseDy = -1;
  /** activity since the last takeStats(), for the sound design */
  private st = emptyPgStats();
  /** per-cell bumper flash, 0..255, decaying each frame */
  private flash = new Uint8Array(SIM_W * SIM_H);
  /** notes already struck this frame: one entry per note is plenty */
  private noteSeen = new Uint8Array(NOTE_COUNT);

  forces: Force[] = [];
  gravityOn = true;
  private rockets: Rocket[] = [];
  /** walks the rainbow so a fountain stream changes colour over time */
  private hueClock = 0;
  /** called with each firework burst position (for sound and screen flash) */
  onBurst: ((x: number, y: number) => void) | null = null;

  constructor(private grid: import('./grid').Grid) {}

  reset(): void {
    this.flash.fill(0);
    this.n = 0;
    this.forces.length = 0;
    this.rockets.length = 0;
  }

  /** Hand over activity counters since the last call, and reset them. */
  takeStats(): PgStats {
    const s = this.st;
    let fireflies = 0;
    let sparks = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.kind[i] === PK_FIREFLY) fireflies++;
      else if (this.kind[i] === PK_SPARK) sparks++;
    }
    s.particles = this.n;
    s.fireflies = fireflies;
    s.sparks = sparks;
    s.holes = this.forces.filter((f) => f.kind === 'hole').length;
    s.vortices = this.forces.filter((f) => f.kind === 'vortex').length;
    s.pulls = this.forces.filter((f) => f.kind === 'attract' || f.kind === 'repel').length;
    s.rockets = this.rockets.length;
    this.st = emptyPgStats();
    return s;
  }

  get count(): number {
    return this.n;
  }

  private push(x: number, y: number, vx: number, vy: number, life: number, hue: number, z = 0, vz = 0, kind = PK_PLAIN): void {
    if (this.n >= CAP) return;
    const i = this.n++;
    this.kind[i] = kind;
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
    this.st.fountain += 4;
  }

  /** Sparkler: short-lived gold sparks spat in every direction. */
  sparkler(x: number, y: number): void {
    for (let k = 0; k < 7; k++) {
      const a = this.rng.next() * Math.PI * 2;
      const cz = this.rng.next() * 2 - 1;
      const rxy = Math.sqrt(1 - cz * cz);
      const sp = 1.5 + this.rng.next() * 3.5;
      const hue = 6 + this.rng.int(6); // orange through gold
      this.push(x, y, Math.cos(a) * rxy * sp, Math.sin(a) * rxy * sp, 8 + this.rng.int(16), hue, 0, cz * sp, PK_SPARK);
    }
    this.st.sparkler += 7;
  }

  /**
   * Hose: sprays the way the pointer is moving; held still, it keeps the
   * last direction (straight up to begin with).
   */
  hose(x: number, y: number, phase: 'down' | 'move' | 'up'): void {
    if (phase === 'down' || this.hoseX < 0) {
      this.hoseX = x;
      this.hoseY = y;
    }
    const dx = x - this.hoseX;
    const dy = y - this.hoseY;
    const d = Math.hypot(dx, dy);
    if (d > 2) {
      this.hoseDx = dx / d;
      this.hoseDy = dy / d;
      this.hoseX = x;
      this.hoseY = y;
    }
    this.hueClock = (this.hueClock + 0.2) % RAINBOW_N;
    for (let k = 0; k < 5; k++) {
      const sp = 3.6 + this.rng.next() * 1.4;
      const jx = (this.rng.next() - 0.5) * 0.5;
      const jy = (this.rng.next() - 0.5) * 0.5;
      const hue = ((this.hueClock | 0) + this.rng.int(3)) % RAINBOW_N;
      this.push(x, y, (this.hoseDx + jx) * sp, (this.hoseDy + jy) * sp, 110 + this.rng.int(60), hue, 0, (this.rng.next() - 0.5) * 0.8);
    }
    this.st.hose += 5;
  }

  /** Fireflies: slow, wandering, blinking, and they ignore gravity. */
  fireflies(x: number, y: number): void {
    for (let k = 0; k < 5; k++) {
      const a = this.rng.next() * Math.PI * 2;
      const r = this.rng.next() * 10;
      const hue = 13 + this.rng.int(8); // warm yellow-green
      this.push(
        x + Math.cos(a) * r, y + Math.sin(a) * r,
        (this.rng.next() - 0.5) * 0.6, (this.rng.next() - 0.5) * 0.6,
        700 + this.rng.int(700), hue, (this.rng.next() - 0.5) * 30, (this.rng.next() - 0.5) * 0.3, PK_FIREFLY,
      );
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
      this.kind[i] = PK_PLAIN;
      // mostly one colour, a few sparks from the far side of the wheel
      this.hue[i] = this.rng.chance(0.75) ? (baseHue + this.rng.int(3)) % RAINBOW_N : (baseHue + RAINBOW_N / 2) % RAINBOW_N;
    }
    this.onBurst?.(x, y);
  }

  placeForce(kind: 'attractor' | 'repulsor' | 'vortex' | 'blackhole', x: number, y: number): void {
    if (this.forces.length >= 8) this.forces.shift();
    const internal: Force['kind'] =
      kind === 'attractor' ? 'attract' : kind === 'repulsor' ? 'repel' : kind === 'blackhole' ? 'hole' : 'vortex';
    this.forces.push({
      kind: internal,
      x,
      y,
      str: internal === 'vortex' ? 0.5 : internal === 'hole' ? 0.7 : 0.28,
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
    this.kind[i] = this.kind[last];
  }

  private solidAt(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= SIM_W || y >= SIM_H) return true;
    return this.grid.cells[(y | 0) * SIM_W + (x | 0)] !== Mat.EMPTY;
  }

  /** A particle hit the bumper at (x, y): play its note and light it up. */
  private strike(x: number, y: number): void {
    this.st.bumps++;
    const note = noteAt(y);
    if (!this.noteSeen[note] && this.st.notes.length < 16) {
      this.noteSeen[note] = 1;
      this.st.notes.push(note, x | 0);
    }
    const cx = x | 0;
    const cy = y | 0;
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const fx = cx + dx;
        const fy = cy + dy;
        if (fx < 0 || fy < 0 || fx >= SIM_W || fy >= SIM_H) continue;
        const k = fy * SIM_W + fx;
        if (this.grid.cells[k] === PG_BUMPER) this.flash[k] = 255;
      }
  }

  /** How much speed a bounce off (x, y) keeps: bumpers give it all back. */
  private restitution(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= SIM_W || y >= SIM_H) return 0.55;
    return this.grid.cells[(y | 0) * SIM_W + (x | 0)] === PG_BUMPER ? 1.0 : 0.55;
  }

  /**
   * Brightness multiplier for a particle this frame: fireflies blink, sparks
   * flicker, everything else is steady.
   */
  private glow(i: number): number {
    const k = this.kind[i];
    let g = 1;
    if (k === PK_FIREFLY) {
      const s = Math.sin(this.frame * 0.07 + (this.hue[i] * 1.7 + i * 0.37));
      g = 0.12 + 0.95 * Math.max(0, s) ** 3;
    } else if (k === PK_SPARK) {
      g = 0.7 + this.rng.next() * 0.7;
    }
    // Matter dims as it falls into a black hole. Without this everything
    // it gathered piled up additively into a white sun over a black core.
    for (const h of this.holes) {
      const d = Math.hypot(this.px[i] - h.x, this.py[i] - h.y);
      if (d < 26) g *= Math.max(0.05, (d - 5) / 21);
    }
    return g;
  }

  tool(msg: PgToolMsg): void {
    switch (msg.kind) {
      case 'fountain':
        if (msg.phase !== 'up') this.fountain(msg.x, msg.y);
        break;
      case 'sparkler':
        if (msg.phase !== 'up') this.sparkler(msg.x, msg.y);
        break;
      case 'hose':
        if (msg.phase !== 'up') this.hose(msg.x, msg.y, msg.phase);
        break;
      case 'fireflies':
        if (msg.phase !== 'up') this.fireflies(msg.x, msg.y);
        break;
      case 'firework':
        if (msg.phase === 'down') this.launch(msg.x, msg.y);
        break;
      case 'attractor':
      case 'repulsor':
      case 'vortex':
      case 'blackhole':
        if (msg.phase === 'down') this.placeForce(msg.kind, msg.x, msg.y);
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
      const fade = this.kind[i] === PK_FIREFLY ? 1 : Math.min(1, this.life[i] / 40);
      const c = RAINBOW[this.hue[i]];
      const gain = 2.2 * fade * this.glow(i);
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
    for (const f of this.forces)
      out.push(f.kind === 'attract' ? 0 : f.kind === 'repel' ? 1 : f.kind === 'vortex' ? 2 : 3, f.x, f.y);
    return out;
  }

  /** decay trails -> integrate -> rasterize heads */
  fullRender(pix: Uint32Array, forceFull: boolean, frame: number): void {
    if (forceFull) pix.fill(PG_BG);
    this.frame = frame;
    this.noteSeen.fill(0);
    this.holes = this.forces.filter((f) => f.kind === 'hole');
    const ts = this.timeScale;
    const drag = 1 - (1 - DRAG) * ts;

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
        if (c === Mat.EMPTY) continue;
        const y = (i / SIM_W) | 0;
        const base = colorAt(c, i % SIM_W, y, frame, 0);
        const f = this.flash[i];
        if (f > 0 && c === PG_BUMPER) {
          // a struck bumper glows in its note's colour, and is drawn as
          // light (alpha 255) so the cinematic pass blooms it
          const k = f / 255;
          const h = RAINBOW[noteHue(noteAt(y))];
          const mix = (sh: number) =>
            // the hue alone: brightened further, the bloom washed it to white
            Math.min(255, (((base >>> sh) & 255) * (1 - k) + ((h >>> sh) & 255) * k) | 0);
          pix[i] = ((255 << 24) | (mix(16) << 16) | (mix(8) << 8) | mix(0)) >>> 0;
          this.flash[i] = f > 14 ? f - 14 : 0;
          continue;
        }
        // alpha 253 tags a wall for the cinematic composite to light
        pix[i] = ((base & 0x00ffffff) | (253 << 24)) >>> 0;
      }
    }

    // rockets: climb with a wobble, shed sparks, burst at their target height
    for (let k = this.rockets.length - 1; k >= 0; k--) {
      const r = this.rockets[k];
      r.vx = Math.max(-0.6, Math.min(0.6, r.vx + (this.rng.next() - 0.5) * 0.15));
      r.x += r.vx * ts;
      r.y += r.vy * ts;
      r.vy *= 1 - 0.015 * ts;
      if (this.rng.chance(0.8 * ts)) this.push(r.x, r.y + 1, (this.rng.next() - 0.5) * 0.4, 0.6, 18 + this.rng.int(14), (r.hue + 2) % RAINBOW_N);
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
      const firefly = this.kind[i] === PK_FIREFLY;

      if (firefly) {
        // wander, unhurried, and never fall
        vx = (vx + (this.rng.next() - 0.5) * 0.14 * ts) * (1 - 0.04 * ts);
        vy = (vy + (this.rng.next() - 0.5) * 0.14 * ts) * (1 - 0.04 * ts);
      } else if (this.gravityOn) {
        vy += GRAVITY * (this.kind[i] === PK_SPARK ? 0.5 : 1) * ts;
      }

      let swallowed = false;
      for (const f of this.forces) {
        const dx = f.x - this.px[i];
        const dy = f.y - this.py[i];
        const d2 = dx * dx + dy * dy;
        const R = f.kind === 'hole' ? 120 : 130;
        if (d2 > R * R || d2 < 1) continue;
        const d = Math.sqrt(d2);
        const falloff = 1 - d / R;
        const ux = dx / d;
        const uy = dy / d;
        const k = f.str * falloff * ts;
        if (f.kind === 'attract') {
          vx += ux * k * 2;
          vy += uy * k * 2;
        } else if (f.kind === 'repel') {
          vx -= ux * k * 2;
          vy -= uy * k * 2;
        } else if (f.kind === 'vortex') {
          vx += -uy * k * 3;
          vy += ux * k * 3;
        } else {
          // black hole: a hard pull with a swirl, so matter spirals in
          if (d < 7) {
            swallowed = true;
            break;
          }
          vx += ux * k * 3 - uy * k * 1.1;
          vy += uy * k * 3 + ux * k * 1.1;
          // Close in, matter loses energy (the accretion disc). Without it a
          // particle moving 5 cells a frame skipped past the core and
          // slingshot into a permanent orbit instead of falling in.
          if (d < 30) {
            vx *= 1 - 0.08 * ts;
            vy *= 1 - 0.08 * ts;
          }
        }
      }
      if (swallowed) {
        this.st.swallowed++;
        this.kill(i);
        i--;
        continue;
      }

      vx *= drag;
      vy *= drag;
      // depth: drag, an attractor pulls toward its plane, and a soft wall
      // keeps the cloud from drifting off the stage
      let vz = this.vz[i] * drag;
      for (const f of this.forces) if (f.kind === 'attract' || f.kind === 'hole') vz -= this.pz[i] * 0.004 * ts;
      this.pz[i] += vz * ts;
      if (this.pz[i] > 70 || this.pz[i] < -70) vz = -vz * 0.5;
      this.vz[i] = vz;
      const spd2 = vx * vx + vy * vy;
      if (spd2 > MAXV * MAXV) {
        const s = MAXV / Math.sqrt(spd2);
        vx *= s;
        vy *= s;
      }

      // Axis-separated collision with painted walls, in sub-steps of at most
      // one cell: moving up to MAXV cells at once, a particle jumped clean
      // over a one-cell wall (measured: through a bumper to the screen's
      // bottom). Bumpers give back all the speed.
      let bounced = false;
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(vx), Math.abs(vy)) * ts));
      let sx = (vx * ts) / steps;
      let sy = (vy * ts) / steps;
      let px = this.px[i];
      let py = this.py[i];
      for (let k = 0; k < steps; k++) {
        if (!this.solidAt(px + sx, py)) px += sx;
        else {
          const e = this.restitution(px + sx, py);
          vx = -vx * e;
          sx = -sx * e;
          bounced = true;
          if (e >= 1) this.strike(px + sx, py);
        }
        if (!this.solidAt(px, py + sy)) py += sy;
        else {
          const e = this.restitution(px, py + sy);
          vy = -vy * e;
          sy = -sy * e;
          bounced = true;
          if (e >= 1) this.strike(px, py + sy);
        }
      }
      this.px[i] = px;
      this.py[i] = py;
      this.vx[i] = vx;
      this.vy[i] = vy;

      this.life[i] -= ts;
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
      const fade = (this.kind[i] === PK_FIREFLY ? 1 : Math.min(1, this.life[i] / 40)) * this.glow(i);
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
      // clamp: a flickering spark brighter than full would carry into the
      // next byte - and the top byte is the alpha tag the composite reads
      const col = ((255 << 24) | (Math.min(255, b | 0) << 16) | (Math.min(255, gr | 0) << 8) | Math.min(255, r | 0)) >>> 0;
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
    const mHole = u32('#ffb36b');
    for (const f of this.forces) {
      if (f.kind === 'hole') {
        // a black core inside a turning ring of hot matter
        for (let dy = -3; dy <= 3; dy++)
          for (let dx = -3; dx <= 3; dx++) if (dx * dx + dy * dy <= 9) dot(f.x + dx, f.y + dy, 0xff000000);
        for (let k = 0; k < 28; k++) {
          const a = frame * 0.12 + (k / 28) * Math.PI * 2;
          const rr = 5 + (k & 1);
          dot(f.x + Math.cos(a) * rr, f.y + Math.sin(a) * rr * 0.55, k % 4 === 0 ? 0xffe8f6ff : mHole);
        }
        continue;
      }
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
