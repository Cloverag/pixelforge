import { RNG } from '../core/rng';
import { Mat, colorAt } from './materials';
import { drawStars, skyLayer } from './starfield';
import { BG } from './background';
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

/** what a flare jet answers to: nothing */
const NO_FORCES: readonly Force[] = [];

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

/** particle kinds */
const PK_PLAIN = 0;
const PK_SPARK = 1;
const PK_FIREFLY = 2;
/** firework shapes that behave differently after the burst */
const PK_WILLOW = 3; // gold, floats and droops into long trails
const PK_CROSS = 4; // a heavy star that splits into a cross of four
const PK_PALM = 5; // a comet that sheds sparks like a palm frond
const PK_JET = 6; // a black hole's flare: ignores every force
const PK_SHELL = 7; // a firework star: moves as plain, but a black hole's meal

/** a crossette star's life at the burst, and the life at which it splits */
const CROSS_LIFE = 85;
const CROSS_SPLIT = 60;
/** colour-wheel entries for willow gold and flare blue */
const HUE_GOLD = 8;
const HUE_JET = 34;
/**
 * When a black hole flares: when it swallows a firework. Only firework
 * material counts toward its meal - a crossette star or palm comet as 8, the
 * cluster it would have become - kept as a running average of each frame's
 * intake. Counting everything could not tell a burst from a scene that feeds
 * its hole all the time: a flat threshold flared GALAXY seven times a second,
 * and measured against the hole's own baseline, a burst into GALAXY's
 * well-fed hole (excess 4.4) sat too close to its everyday noise (3.1).
 */
const FEED_FAST = 0.1;
/** Measured over 24 rockets bursting round a hole, the running average
 *  peaks at 0.7-9.0 (the low ones mostly escaped); with nothing but
 *  fireworks counted, idle GALAXY and surprise scenes stay at 0. */
const FLARE_RATE = 2.5;
/** frames after a flare before the same hole can flare again */
const FLARE_COOL = 120;
/** a flare's shockwave ring, in frames */
const FLARE_RING = 22;

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
  /** particles that went through a portal */
  warps: number;
  /** portals opened this frame */
  portalsPlaced: number;
  swallowed: number;
  holes: number;
  vortices: number;
  pulls: number;
  rockets: number;
}

export function emptyPgStats(): PgStats {
  return { particles: 0, fountain: 0, hose: 0, sparkler: 0, sparks: 0, fireflies: 0, bumps: 0, notes: [], warps: 0, portalsPlaced: 0, swallowed: 0, holes: 0, vortices: 0, pulls: 0, rockets: 0 };
}

/** additive blend with saturation: overlapping particles glow brighter */
function addSat(a: number, b: number): number {
  const r = Math.min(255, (a & 255) + (b & 255) - BG.r);
  const g = Math.min(255, ((a >>> 8) & 255) + ((b >>> 8) & 255) - BG.g);
  const bl = Math.min(255, ((a >>> 16) & 255) + ((b >>> 16) & 255) - BG.b);
  return ((255 << 24) | (Math.max(0, bl) << 16) | (Math.max(0, g) << 8) | Math.max(0, r)) >>> 0;
}

/** a self-running emitter, placed by the preset scenes */
export interface Emitter {
  kind: 'fountain' | 'jet' | 'sparkler' | 'fireflies' | 'firework';
  x: number;
  y: number;
  /** unit direction, for jets */
  dx: number;
  dy: number;
  /** fire every this many frames */
  every: number;
  /** jets: speed and lifetime multipliers */
  speed?: number;
  life?: number;
  /** fireflies / fireworks: random spread of the spawn x */
  spread?: number;
  t: number;
}
const MAX_EMITTERS = 12;
/** fireflies stop spawning past this many, so a meadow does not fill up */
const FIREFLY_CAP = 260;

/** a pair of portals; b is null until the second click links it */
interface PortalPair {
  a: { x: number; y: number };
  b: { x: number; y: number } | null;
}
/** portal mouth radius, in cells */
const PORTAL_R = 6;
const MAX_PAIRS = 3;

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
  private portals: PortalPair[] = [];
  private emitters: Emitter[] = [];
  /** fireflies alive at the end of the last frame */
  private liveFireflies = 0;
  /** walks the rainbow so a fountain stream changes colour over time */
  private hueClock = 0;
  /** called with each firework burst position (for sound and screen flash) */
  onBurst: ((x: number, y: number) => void) | null = null;
  /** called when a black hole flares (a bigger boom and flash) */
  onFlare: ((x: number, y: number) => void) | null = null;
  /** what each black hole has swallowed lately; past FLARE_AT it flares.
   *  Kept out of structureHash: it follows the particles, whose float maths
   *  may differ between engines. Packed, so a joiner on the same engine
   *  flares when the host does. */
  private feed = new Map<Force, [fast: number, cool: number]>();
  /** what each black hole swallowed this frame */
  private eatenNow = new Map<Force, number>();
  /** flares still showing their shockwave: drawing only, not packed */
  private flares: { x: number; y: number; f0: number }[] = [];

  constructor(private grid: import('./grid').Grid) {}

  reset(): void {
    this.flash.fill(0);
    this.portals.length = 0;
    this.emitters.length = 0;
    this.n = 0;
    this.forces.length = 0;
    this.rockets.length = 0;
    this.feed.clear();
    this.eatenNow.clear();
    this.flares.length = 0;
  }

  /**
   * Everything the playground steps from, as bytes - for multiplayer
   * snapshots. Particles go as raw float arrays (exact), the rest as JSON
   * (exact for doubles). The bumper flash and the activity counters are
   * left out: they only drive drawing and sound.
   */
  pack(): Uint8Array {
    const head = new TextEncoder().encode(
      JSON.stringify({
        rng: this.rng.state,
        hueClock: this.hueClock,
        timeScale: this.timeScale,
        gravityOn: this.gravityOn,
        liveFireflies: this.liveFireflies,
        hose: [this.hoseX, this.hoseY, this.hoseDx, this.hoseDy],
        forces: this.forces,
        portals: this.portals,
        emitters: this.emitters,
        rockets: this.rockets,
        feed: this.forces.map((f) => this.feed.get(f) ?? [0, 0]),
      }),
    );
    const n = this.n;
    const floats = [this.px, this.py, this.pz, this.vx, this.vy, this.vz, this.life];
    const out = new Uint8Array(8 + head.length + n * 4 * floats.length + n * 2);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, head.length, true);
    out.set(head, 4);
    let o = 4 + head.length;
    dv.setUint32(o, n, true);
    o += 4;
    for (const a of floats) {
      out.set(new Uint8Array(a.buffer, 0, n * 4), o);
      o += n * 4;
    }
    out.set(this.hue.subarray(0, n), o);
    out.set(this.kind.subarray(0, n), o + n);
    return out;
  }

  unpack(buf: Uint8Array): void {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const hl = dv.getUint32(0, true);
    const h = JSON.parse(new TextDecoder().decode(buf.subarray(4, 4 + hl)));
    this.rng.state = h.rng;
    this.hueClock = h.hueClock;
    this.timeScale = h.timeScale;
    this.gravityOn = h.gravityOn;
    this.liveFireflies = h.liveFireflies;
    [this.hoseX, this.hoseY, this.hoseDx, this.hoseDy] = h.hose;
    this.forces = h.forces;
    this.portals = h.portals;
    this.emitters = h.emitters;
    this.rockets = h.rockets;
    this.feed = new Map();
    (h.feed ?? []).forEach((v: [number, number], k: number) => {
      if (this.forces[k]) this.feed.set(this.forces[k], v);
    });
    this.flares.length = 0;
    let o = 4 + hl;
    const n = dv.getUint32(o, true);
    o += 4;
    this.n = n;
    for (const a of [this.px, this.py, this.pz, this.vx, this.vy, this.vz, this.life]) {
      // copy out of the (possibly unaligned) byte buffer
      a.set(new Float32Array(buf.slice(o, o + n * 4).buffer));
      o += n * 4;
    }
    this.hue.set(buf.subarray(o, o + n));
    this.kind.set(buf.subarray(o + n, o + 2 * n));
    this.flash.fill(0);
  }

  /**
   * A fingerprint of what the players built - forces, portals, emitters,
   * gravity and speed - but not the particles. Particles run on float maths
   * (sin, sqrt) that can differ in the last bit between browser engines and
   * that a particle system amplifies within seconds; comparing them would
   * make a Chrome-and-Safari room re-send its world every few seconds.
   */
  structureHash(): number {
    const s = JSON.stringify([this.forces, this.portals, this.emitters.map((e) => ({ ...e, t: 0 })), this.gravityOn, this.timeScale]);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    return h >>> 0;
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
    this.jet(x, y, this.hoseDx, this.hoseDy);
  }

  /** A burst of five particles along unit direction (dx, dy): the hose's spray. */
  jet(x: number, y: number, dx: number, dy: number, speed = 1, life = 1): void {
    this.hueClock = (this.hueClock + 0.2) % RAINBOW_N;
    for (let k = 0; k < 5; k++) {
      const sp = (3.6 + this.rng.next() * 1.4) * speed;
      const jx = (this.rng.next() - 0.5) * 0.5;
      const jy = (this.rng.next() - 0.5) * 0.5;
      const hue = ((this.hueClock | 0) + this.rng.int(3)) % RAINBOW_N;
      this.push(x, y, (dx + jx) * sp, (dy + jy) * sp, (110 + this.rng.int(60)) * life, hue, 0, (this.rng.next() - 0.5) * 0.8);
    }
    this.st.hose += 5;
  }

  /**
   * An emitter that runs by itself, for the preset scenes: it fires every
   * `every` frames until erased or cleared.
   */
  addEmitter(e: Omit<Emitter, 't'>): void {
    if (this.emitters.length >= MAX_EMITTERS) this.emitters.shift();
    this.emitters.push({ ...e, t: 0 });
  }

  private runEmitters(): void {
    for (const e of this.emitters) {
      e.t++;
      if (e.t % e.every !== 0) continue;
      switch (e.kind) {
        case 'fountain':
          this.fountain(e.x, e.y);
          break;
        case 'jet':
          this.jet(e.x, e.y, e.dx, e.dy, e.speed ?? 1, e.life ?? 1);
          break;
        case 'sparkler':
          this.sparkler(e.x, e.y);
          break;
        case 'fireflies':
          if (this.liveFireflies < FIREFLY_CAP) this.fireflies(e.x + (this.rng.next() - 0.5) * (e.spread ?? 0), e.y);
          break;
        case 'firework':
          this.launch(e.x + (this.rng.next() - 0.5) * (e.spread ?? 0), e.y + (this.rng.next() - 0.5) * 40);
          break;
      }
    }
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

  /**
   * A shell bursts at (x, y) in one of five shapes: peony (a filled sphere),
   * ring, willow, crossette or palm. Every choice comes from the playground's
   * own RNG, so peers see the same show.
   */
  firework(x: number, y: number, baseHue = this.rng.int(RAINBOW_N)): void {
    const style = this.rng.next();
    if (style < 0.3) this.peony(x, y, baseHue);
    else if (style < 0.45) this.ringShell(x, y, baseHue);
    else if (style < 0.65) this.willow(x, y);
    else if (style < 0.82) this.crossette(x, y, baseHue);
    else this.palm(x, y, baseHue);
    this.onBurst?.(x, y);
  }

  /** A particle slot: a new one, or a random old one when the pool is full. */
  private slot(): number {
    return this.n < CAP ? this.n++ : this.rng.int(CAP);
  }

  private star(i: number, x: number, y: number, vx: number, vy: number, vz: number, life: number, hue: number, kind: number): void {
    this.px[i] = x;
    this.py[i] = y;
    this.pz[i] = 0;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.life[i] = life;
    this.hue[i] = hue;
    this.kind[i] = kind;
  }

  /** the classic: a filled sphere, mostly one colour */
  private peony(x: number, y: number, baseHue: number): void {
    const count = 110 + this.rng.int(50);
    for (let k = 0; k < count; k++) {
      const a = this.rng.next() * Math.PI * 2;
      const sp = 0.6 + this.rng.next() * 3.4;
      // a random direction on the sphere; projected flat, a filled disk
      const cz = this.rng.next() * 2 - 1;
      const rxy = Math.sqrt(1 - cz * cz);
      const hue = this.rng.chance(0.75) ? (baseHue + this.rng.int(3)) % RAINBOW_N : (baseHue + RAINBOW_N / 2) % RAINBOW_N;
      this.star(this.slot(), x, y, Math.cos(a) * rxy * sp, Math.sin(a) * rxy * sp, cz * sp, 50 + this.rng.range(20, 70), hue, PK_SHELL);
    }
  }

  /** a crisp ring, seen at a random tilt and turn */
  private ringShell(x: number, y: number, hue: number): void {
    const count = 72;
    const sp = 2.4 + this.rng.next() * 0.6;
    const tilt = 0.45 + this.rng.next() * 0.55;
    const spin = this.rng.next() * Math.PI;
    const cs = Math.cos(spin);
    const sn = Math.sin(spin);
    const depth = Math.sqrt(1 - tilt * tilt);
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2;
      const ux = Math.cos(a);
      const uy = Math.sin(a) * tilt;
      const vx = (ux * cs - uy * sn) * sp;
      const vy = (ux * sn + uy * cs) * sp;
      this.star(this.slot(), x, y, vx, vy, Math.sin(a) * depth * sp, 60 + this.rng.int(20), (hue + this.rng.int(2)) % RAINBOW_N, PK_SHELL);
    }
  }

  /** gold that floats, slows and droops into long trails */
  private willow(x: number, y: number): void {
    const count = 90;
    for (let k = 0; k < count; k++) {
      const a = this.rng.next() * Math.PI * 2;
      const sp = 0.8 + this.rng.next() * 2;
      const cz = this.rng.next() * 2 - 1;
      const rxy = Math.sqrt(1 - cz * cz);
      this.star(this.slot(), x, y, Math.cos(a) * rxy * sp, Math.sin(a) * rxy * sp, cz * sp, 150 + this.rng.int(60), HUE_GOLD + this.rng.int(3), PK_WILLOW);
    }
  }

  /** a dozen heavy stars; each splits into a cross of four (in step) */
  private crossette(x: number, y: number, hue: number): void {
    const count = 14;
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + this.rng.next() * 0.3;
      const sp = 2.2 + this.rng.next() * 0.8;
      this.star(this.slot(), x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0, CROSS_LIFE, hue, PK_CROSS);
    }
  }

  /** a few thick comets that shed sparks as they arc (in step) */
  private palm(x: number, y: number, hue: number): void {
    const count = 8;
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + this.rng.next() * 0.25;
      const sp = 2.6 + this.rng.next() * 0.7;
      this.star(this.slot(), x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0, 70 + this.rng.int(20), hue, PK_PALM);
    }
  }

  /**
   * A black hole that swallows a burst whole flares: a shockwave ring, a big
   * boom and flash, and twin jets of light out of its poles. The jets ignore
   * every force, or the hole would swallow its own flare and flare again.
   */
  private flare(h: Force): void {
    this.flares.push({ x: h.x, y: h.y, f0: this.frame });
    this.onFlare?.(h.x, h.y);
    for (const side of [-1, 1]) {
      for (let k = 0; k < 36; k++) {
        this.push(
          h.x + (this.rng.next() - 0.5) * 3,
          h.y + side * 9,
          (this.rng.next() - 0.5) * 0.5,
          side * (4 + this.rng.next() * 1.5),
          34 + this.rng.int(20),
          (HUE_JET + this.rng.int(4)) % RAINBOW_N,
          0,
          0,
          PK_JET,
        );
      }
    }
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

  /**
   * Portals come in pairs: a click opens an orange portal, the next click
   * its blue partner. Beyond MAX_PAIRS the oldest pair closes.
   */
  placePortal(x: number, y: number): void {
    const last = this.portals[this.portals.length - 1];
    if (last && !last.b) last.b = { x, y };
    else {
      if (this.portals.length >= MAX_PAIRS) this.portals.shift();
      this.portals.push({ a: { x, y }, b: null });
    }
    this.st.portalsPlaced++;
  }

  /**
   * Through a portal: a particle inside one mouth leaves the other, just
   * outside it along its direction of travel, with its velocity unchanged.
   * Skipped if that spot is inside a wall - the particle would be stuck.
   */
  private warp(i: number): void {
    const x = this.px[i];
    const y = this.py[i];
    for (const p of this.portals) {
      if (!p.b) continue;
      for (const [from, to] of [[p.a, p.b], [p.b, p.a]] as const) {
        const dx = x - from.x;
        const dy = y - from.y;
        if (dx * dx + dy * dy > PORTAL_R * PORTAL_R) continue;
        const sp = Math.hypot(this.vx[i], this.vy[i]);
        const ux = sp > 0.05 ? this.vx[i] / sp : 0;
        const uy = sp > 0.05 ? this.vy[i] / sp : 1;
        const nx = to.x + ux * (PORTAL_R + 2);
        const ny = to.y + uy * (PORTAL_R + 2);
        if (this.solidAt(nx, ny)) return;
        this.px[i] = nx;
        this.py[i] = ny;
        this.st.warps++;
        return;
      }
    }
  }

  eraseNear(x: number, y: number, r = 14): void {
    this.forces = this.forces.filter((f) => (f.x - x) ** 2 + (f.y - y) ** 2 > r * r);
    const near = (q: { x: number; y: number } | null) => q !== null && (q.x - x) ** 2 + (q.y - y) ** 2 <= r * r;
    this.portals = this.portals.filter((p) => !near(p.a) && !near(p.b));
    this.emitters = this.emitters.filter((e) => !near(e));
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
      // a hash of particle and frame, not the sim RNG: drawing (and pack3d)
      // must not consume random numbers the simulation depends on
      const h = Math.imul(i * 0x9e3779b1 + this.frame * 0x85ebca6b, 0xc2b2ae35) >>> 24;
      g = 0.7 + (h / 255) * 0.7;
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
        if (msg.phase === 'up') break;
        if (msg.dx !== undefined && msg.dy !== undefined) this.jet(msg.x, msg.y, msg.dx, msg.dy);
        else this.hose(msg.x, msg.y, msg.phase);
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
      case 'portal':
        if (msg.phase === 'down') this.placePortal(msg.x, msg.y);
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
    // portals: 4 orange, 5 blue, 6 an orange still waiting for its partner
    for (const p of this.portals) {
      out.push(p.b ? 4 : 6, p.a.x, p.a.y);
      if (p.b) out.push(5, p.b.x, p.b.y);
    }
    return out;
  }

  /** decay trails -> integrate -> rasterize heads */
  /** One simulation frame then a drawn frame: the single-player path. */
  fullRender(pix: Uint32Array, forceFull: boolean, frame: number): void {
    this.step(frame);
    this.draw(pix, forceFull, frame);
  }

  /**
   * Advance the playground one frame: emitters, rockets, every particle.
   * Kept apart from draw() because multiplayer steps several frames per
   * drawn one when catching up - moving particles inside the draw made a
   * peer's simulation depend on how often it drew.
   */
  step(frame: number): void {
    this.frame = frame;
    this.noteSeen.fill(0);
    this.holes = this.forces.filter((f) => f.kind === 'hole');
    const ts = this.timeScale;
    const drag = 1 - (1 - DRAG) * ts;

    this.runEmitters();

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
    }

    // integrate
    const g = this.grid;
    let fireflies = 0;
    for (let i = 0; i < this.n; i++) {
      let vx = this.vx[i];
      let vy = this.vy[i];
      const firefly = this.kind[i] === PK_FIREFLY;
      if (firefly) fireflies++;

      if (firefly) {
        // wander, unhurried, and never fall
        vx = (vx + (this.rng.next() - 0.5) * 0.14 * ts) * (1 - 0.04 * ts);
        vy = (vy + (this.rng.next() - 0.5) * 0.14 * ts) * (1 - 0.04 * ts);
      } else if (this.gravityOn && this.kind[i] !== PK_JET) {
        const kd = this.kind[i];
        vy += GRAVITY * (kd === PK_SPARK ? 0.5 : kd === PK_WILLOW ? 0.45 : kd === PK_PALM ? 0.8 : 1) * ts;
      }
      if (this.kind[i] === PK_WILLOW) {
        // willow stars slow quickly and hang: that is what draws the trails down
        vx *= 1 - 0.03 * ts;
        vy *= 1 - 0.03 * ts;
      }

      let swallowed = false;
      let eaten: Force | null = null;
      for (const f of this.kind[i] === PK_JET ? NO_FORCES : this.forces) {
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
            eaten = f;
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
        // only fireworks feed a flare; a crossette star or palm comet is a
        // whole cluster to come, so it weighs as one
        const kd = this.kind[i];
        const meal = kd === PK_SHELL || kd === PK_WILLOW ? 1 : kd === PK_CROSS || kd === PK_PALM ? 8 : 0;
        if (eaten && meal) this.eatenNow.set(eaten, (this.eatenNow.get(eaten) ?? 0) + meal);
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
      if (this.portals.length) this.warp(i);

      this.life[i] -= ts;
      const kd = this.kind[i];
      if (kd === PK_PALM && this.rng.chance(0.85 * ts)) {
        // the frond: sparks shed behind the comet, falling away
        this.push(px, py, vx * 0.15 + (this.rng.next() - 0.5) * 0.4, vy * 0.15 + (this.rng.next() - 0.5) * 0.4, 22 + this.rng.int(16), this.hue[i], this.pz[i], 0, PK_SPARK);
      } else if (kd === PK_CROSS && this.life[i] <= CROSS_SPLIT) {
        // split into a cross of four, turned to the star's own heading
        const sp = Math.sqrt(vx * vx + vy * vy) || 1;
        const ux = vx / sp;
        const uy = vy / sp;
        for (const [cx, cy] of [[ux, uy], [-uy, ux], [-ux, -uy], [uy, -ux]] as const)
          this.push(px, py, cx * 1.7 + vx * 0.35, cy * 1.7 + vy * 0.35, 34 + this.rng.int(16), this.hue[i], this.pz[i], 0, PK_SHELL);
        this.kill(i);
        i--;
        continue;
      }
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

    this.liveFireflies = fireflies;

    // black holes: a firework swallowed whole flares
    for (const h of this.holes) {
      const c = this.eatenNow.get(h) ?? 0;
      const st = this.feed.get(h) ?? [0, 0];
      st[0] += (c - st[0]) * FEED_FAST;
      if (st[1] > 0) st[1]--;
      else if (st[0] >= FLARE_RATE) {
        st[1] = FLARE_COOL;
        this.flare(h);
      }
      this.feed.set(h, st);
    }
    this.eatenNow.clear();
    // a shockwave outlives no one: prune the finished rings here, not in draw
    while (this.flares.length && frame - this.flares[0].f0 > FLARE_RING) this.flares.shift();

  }

  /** Draw the playground into pix (trails fade here). Reads state only. */
  draw(pix: Uint32Array, forceFull: boolean, frame: number): void {
    // the sky - nebula bent by the forces - is what trails fade back to
    const sky = skyLayer(frame, this.forces);
    if (forceFull) pix.set(sky);
    // Trail decay, toward the sky. Scaling toward black instead left trails
    // darker than the background - a black wedge under every fountain. The
    // sky rides on this loop rather than a blend pass of its own: it already
    // visits every pixel.
    const nPx = SIM_W * SIM_H;
    for (let i = 0; i < nPx; i++) {
      const c = pix[i];
      const t = sky[i];
      if (c === t) continue;
      const tr = t & 255;
      const tg = (t >>> 8) & 255;
      const tb = (t >>> 16) & 255;
      const r = tr + ((((c & 255) - tr) * 230) >> 8);
      const g = tg + (((((c >>> 8) & 255) - tg) * 230) >> 8);
      const b = tb + (((((c >>> 16) & 255) - tb) * 230) >> 8);
      pix[i] =
        Math.abs(r - tr) + Math.abs(g - tg) + Math.abs(b - tb) < 4
          ? t
          : ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
    }

    // stars over the sky, behind everything else
    drawStars(pix, frame, this.forces);

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

    // rocket heads
    for (const r of this.rockets) {
      const rx = r.x | 0;
      const ry = r.y | 0;
      if (rx >= 0 && ry >= 0 && rx < SIM_W && ry < SIM_H) pix[ry * SIM_W + rx] = 0xffd8f4ff;
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
      // falling into a black hole, light is stretched toward red (gravitational redshift)
      for (const h of this.holes) {
        const d = Math.hypot(this.px[i] - h.x, this.py[i] - h.y);
        if (d < 30) {
          const t = Math.max(0, (d - 6) / 24);
          gr *= 0.35 + 0.65 * t;
          b *= t * t;
        }
      }
      r = BG.r + (r - BG.r) * fade;
      gr = BG.g + (gr - BG.g) * fade;
      b = BG.b + (b - BG.b) * fade;
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

    // black hole flares: a shockwave ring of blue-white light running out
    for (const fl of this.flares) {
      const age = frame - fl.f0;
      if (age < 0 || age > FLARE_RING) continue;
      const k = 1 - age / FLARE_RING;
      const rad = 6 + age * 4.2;
      const pts = Math.ceil(rad * 6.3);
      const col = ((255 << 24) | (((BG.b + 235 * k) | 0) << 16) | (((BG.g + 215 * k) | 0) << 8) | ((BG.r + 170 * k) | 0)) >>> 0;
      for (let j = 0; j < pts; j++) {
        const a = (j / pts) * Math.PI * 2;
        const ix = (fl.x + Math.cos(a) * rad) | 0;
        const iy = (fl.y + Math.sin(a) * rad) | 0;
        if (ix >= 0 && iy >= 0 && ix < SIM_W && iy < SIM_H) pix[iy * SIM_W + ix] = addSat(pix[iy * SIM_W + ix], col);
      }
    }

    // portals: a turning ring of light, orange and blue; one still waiting
    // for its partner pulses dim
    const pOrange = [255, 150, 60];
    const pBlue = [80, 180, 255];
    const ring = (q: { x: number; y: number }, rgb: number[], live: boolean, dir: number) => {
      const k = live ? 1 : 0.35 + 0.25 * Math.sin(frame * 0.15);
      for (let j = 0; j < 36; j++) {
        const a = (j / 36) * Math.PI * 2 + frame * 0.08 * dir;
        const bright = (j % 6 < 3 ? 1 : 0.55) * k;
        const col = ((255 << 24) | (((rgb[2] * bright) | 0) << 16) | (((rgb[1] * bright) | 0) << 8) | ((rgb[0] * bright) | 0)) >>> 0;
        const ix = (q.x + Math.cos(a) * PORTAL_R) | 0;
        const iy = (q.y + Math.sin(a) * PORTAL_R) | 0;
        if (ix >= 0 && iy >= 0 && ix < SIM_W && iy < SIM_H) pix[iy * SIM_W + ix] = col;
      }
      if (!live) return;
      // a swirl inside the mouth
      for (let j = 0; j < 10; j++) {
        const a = frame * 0.2 * dir + j * 0.9;
        const rr = 1 + (j % 5);
        const ix = (q.x + Math.cos(a) * rr) | 0;
        const iy = (q.y + Math.sin(a) * rr) | 0;
        const col = ((255 << 24) | (((rgb[2] * 0.6) | 0) << 16) | (((rgb[1] * 0.6) | 0) << 8) | ((rgb[0] * 0.6) | 0)) >>> 0;
        if (ix >= 0 && iy >= 0 && ix < SIM_W && iy < SIM_H) pix[iy * SIM_W + ix] = col;
      }
    };
    // emitter nozzles: a small glowing block that breathes
    for (const e of this.emitters) {
      const k = 0.6 + 0.4 * Math.sin((frame + e.x) * 0.12);
      const c = e.kind === 'fireflies' ? [200, 255, 120] : e.kind === 'firework' ? [255, 200, 120] : e.kind === 'sparkler' ? [255, 210, 90] : [120, 200, 255];
      const col = ((255 << 24) | (((c[2] * k) | 0) << 16) | (((c[1] * k) | 0) << 8) | ((c[0] * k) | 0)) >>> 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const ix = (e.x + dx) | 0;
          const iy = (e.y + dy) | 0;
          if (ix >= 0 && iy >= 0 && ix < SIM_W && iy < SIM_H) pix[iy * SIM_W + ix] = col;
        }
    }
    for (const p of this.portals) {
      ring(p.a, pOrange, p.b !== null, 1);
      if (p.b) ring(p.b, pBlue, true, -1);
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
      if (f.kind === 'hole') {
        drawBlackHole(pix, f.x, f.y, frame);
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

/** brightest a cell of the hole's light gets (of 255): the playground blooms what is bright */
const BH_PEAK = 220;
/** shadow radius (where matter is swallowed), the photon ring, and the disc's inner and outer edge, in cells */
const BH_SHADOW = 7;
const BH_PHOTON = 8.5;
const BH_IN = 10;
const BH_OUT = 36;
/** the disc seen nearly edge-on: its height over its width */
const BH_TILT = 0.26;

/** The disc's colour by temperature, 0 (cool, outside) to 1 (hot, inside): deep red, orange, yellow-white, blue-white. */
function discColour(t: number): [number, number, number] {
  const stops: [number, number, number][] = [[150, 30, 10], [255, 120, 40], [255, 225, 170], [235, 240, 255]];
  const x = Math.min(0.999, Math.max(0, t)) * (stops.length - 1);
  const i = Math.floor(x);
  const k = x - i;
  return [0, 1, 2].map((c) => stops[i][c] + (stops[i + 1][c] - stops[i][c]) * k) as [number, number, number];
}

/** The light of the disc at radius r, angle phi (0..1 per channel), or null off the disc. */
function discLight(r: number, phi: number, frame: number): [number, number, number] | null {
  if (r < BH_IN || r > BH_OUT) return null;
  // Kepler: the inner disc turns faster (angular speed ~ r^-1.5); streaks wound into spirals
  const a = phi - frame * 0.09 * Math.pow(BH_IN / r, 1.5);
  const streak = 0.6 + 0.4 * Math.sin(a * 5 + r * 0.8) * Math.sin(a * 2 - r * 0.33);
  const temp = Math.pow(BH_IN / r, 0.9);
  // Doppler: the disc turns anticlockwise, so its left side comes toward us -
  // brighter and bluer; the right side going away, dimmer and redder (about 3 to 1,
  // as in the Event Horizon Telescope's images)
  const dop = 1 - 0.3 * Math.cos(phi);
  const beam = (dop * dop * streak * (0.3 + 0.7 * temp)) / 1.69;
  const [tr, tg, tb] = discColour(temp + (dop - 1) * 0.5);
  // the edges of the disc fade
  const edge = Math.min(1, (r - BH_IN) / 2, (BH_OUT - r) / 6);
  const k = (beam * edge) / 255;
  return [tr * k, tg * k, tb * k];
}

/** Light a cell, keeping whatever is brighter already (a star, a particle). */
function lightPix(pix: Uint32Array, x: number, y: number, c: [number, number, number], w: number): void {
  if (x < 0 || y < 0 || x >= SIM_W || y >= SIM_H) return;
  const i = y * SIM_W + x;
  const o = pix[i];
  const r = Math.max(o & 255, Math.round(c[0] * w * BH_PEAK));
  const g = Math.max((o >>> 8) & 255, Math.round(c[1] * w * BH_PEAK));
  const b = Math.max((o >>> 16) & 255, Math.round(c[2] * w * BH_PEAK));
  pix[i] = ((255 << 24) | (Math.min(255, b) << 16) | (Math.min(255, g) << 8) | Math.min(255, r)) >>> 0;
}

/**
 * A black hole as the telescopes and the films show one: a hot accretion
 * disc seen nearly edge-on, its streaks orbiting faster close in (Kepler);
 * the side coming toward us brighter and bluer, the side going away dimmer
 * and redder (Doppler beaming); the far side of the disc bent up over the top
 * of the hole and faintly under it (gravitational lensing); a black shadow
 * edged by a thin photon ring. Every cell near the hole works out which part
 * of the disc (or of its lensed image) it shows, so the light is exact.
 */
export function drawBlackHole(pix: Uint32Array, cx: number, cy: number, frame: number): void {
  const x0 = Math.round(cx);
  const y0 = Math.round(cy);
  const ARCH_OUT = BH_PHOTON + 1 + (BH_OUT - BH_IN) * 0.5;
  // 1. the lensed images: the far half of the disc arched over the top, the near half faint underneath
  for (let dy = -Math.ceil(ARCH_OUT); dy <= ARCH_OUT; dy++)
    for (let dx = -Math.ceil(ARCH_OUT); dx <= ARCH_OUT; dx++) {
      const rho = Math.hypot(dx, dy);
      if (rho < BH_PHOTON + 1 || rho > ARCH_OUT) continue;
      const phi = Math.atan2(dy, dx);
      const over = dy < 0;
      const r = BH_IN + (rho - BH_PHOTON - 1) / (over ? 0.5 : 0.3);
      const c = discLight(r, phi, frame);
      if (c) lightPix(pix, x0 + dx, y0 + dy, c, over ? 0.7 : 0.25);
    }
  // 2. the disc itself: the far half (above the middle), then the shadow, the ring, the near half
  const H = Math.ceil(BH_OUT * BH_TILT);
  const disc = (near: boolean) => {
    for (let dy = near ? 1 : -H; dy <= (near ? H : 0); dy++)
      for (let dx = -BH_OUT; dx <= BH_OUT; dx++) {
        const yd = dy / BH_TILT;
        const r = Math.hypot(dx, yd);
        const c = discLight(r, Math.atan2(yd, dx), frame);
        if (c) lightPix(pix, x0 + dx, y0 + dy, c, near ? 1 : 0.6);
      }
  };
  disc(false);
  // 3. the shadow: nothing comes back from inside
  for (let dy = -BH_SHADOW; dy <= BH_SHADOW; dy++)
    for (let dx = -BH_SHADOW; dx <= BH_SHADOW; dx++) {
      if (dx * dx + dy * dy > BH_SHADOW * BH_SHADOW) continue;
      const x = x0 + dx;
      const y = y0 + dy;
      if (x >= 0 && y >= 0 && x < SIM_W && y < SIM_H) pix[y * SIM_W + x] = 0xff000000;
    }
  // 4. the photon ring: light that has gone round the hole, a thin bright edge
  for (let dy = -10; dy <= 10; dy++)
    for (let dx = -10; dx <= 10; dx++) {
      const d = Math.abs(Math.hypot(dx, dy) - BH_PHOTON);
      if (d > 0.7) continue;
      const dop = (1 - 0.3 * (dx / BH_PHOTON)) / 1.3; // brighter on the left, never past the cap
      lightPix(pix, x0 + dx, y0 + dy, [1, 0.8, 0.62], dop * (1 - d));
    }
  // 5. the near half of the disc, across the front of the shadow
  disc(true);
}
