import { RNG, hash2d } from '../core/rng';
import { buildPreset, buildSurprise } from './presets';
import { planSurprise } from './surprise';
import { Grid } from './grid';
import {
  Cat, GRAINY, LIT, Lit, MATS, Mat, NMATS, OPEN, SHADED, Shade, WIND_SUSC,
  Flora, applyShade, colorAt, offRamp, petal, rampIndexAt, SPARK_LIFE,
} from './materials';
import { CHUNK, CHUNK_SHIFT, CHUNKS_X, CHUNKS_Y, SIM_H, SIM_W, Stats, ChallengeResult, Mode, PaintKind, SimEvents, emptyEvents, NetInput, Snapshot } from './protocol';
import { PSys } from './particles';
import { Wind } from './wind';
import { CHALLENGES, ChallengeDef, starsFor } from './challenges';

const BG = MATS[Mat.EMPTY].ramp[0];
/** frames from fire touching TNT to the blast: long enough to see it blink
 *  and back away, short enough that it still reads as cause and effect */
export const TNT_FUSE = 70;
/** liquid meta bits 0-1: last flow direction */
const LQ_DIR = 3;
const LQ_RIGHT = 1;
const LQ_LEFT = 2;
/** liquid meta bits 2-4: fall speed, built while free-falling */
const LQ_V_SHIFT = 2;
const LQ_V_MAX = 7;
/** fall speed at which an impact splashes (about 4 cells of free fall) */
const LQ_SPLASH = 4;
const code2 = (d: number) => (d > 0 ? LQ_RIGHT : LQ_LEFT);
/** turbine spin at which it starts sparking wire */
const TURBINE_LIVE = 40;
/** slide reach at which a liquid flows freely; below it, it oozes */
const LQ_RUNNY = 4;
/** how far a liquid looks along its surface for somewhere lower */
const LQ_SCAN = 128;
/** drifting dust mote in a windy empty cell; ABGR for a dim slate blue */
const WIND_DUST = 0xff3a2c22;

interface Source {
  mat: number;
  x: number;
  y: number;
  w: number;
  h: number;
  every: number;
  untilFrame: number;
}

class ActiveChallenge {
  def: ChallengeDef;
  frame = 0;
  done = false;
  result: ChallengeResult | null = null;
  sources: Source[] = [];
  used = new Int32Array(NMATS);

  constructor(private w: World, def: ChallengeDef) {
    this.def = def;
    this.reset();
  }

  reset(): void {
    const g = this.w.grid;
    g.cells.fill(0);
    g.meta.fill(0);
    g.clock.fill(0);
    g.counts.fill(0);
    g.counts[Mat.EMPTY] = g.cells.length;
    g.eternals.clear();
    g.chunks.wakeAll();
    this.frame = 0;
    this.done = false;
    this.result = null;
    this.used.fill(0);
    this.def.setup(this.w);
    this.sources = (this.def.sources ?? []).map((s) => ({
      mat: s.mat,
      x: s.x,
      y: s.y,
      w: s.w,
      h: s.h,
      every: s.every ?? 1,
      untilFrame: s.untilFrame ?? 9999999,
    }));
  }

  tickSources(): void {
    for (const s of this.sources) {
      if (this.frame >= s.untilFrame) continue;
      if (s.every <= 1 || this.frame % s.every === 0) {
        for (let y = s.y; y < s.y + s.h; y++)
          for (let x = s.x; x < s.x + s.w; x++)
            if (this.w.grid.get(x, y) === Mat.EMPTY)
              this.w.grid.setXY(x, y, s.mat);
      }
      this.w.grid.chunks.wakeRect(s.x - 2, s.y - 2, s.x + s.w + 2, s.y + s.h + 2);
    }
  }

  check(): void {
    if (this.done) return;
    const status = this.def.check(this.w, this.frame, this.used);
    if (status === 'running') return;
    this.done = true;
    const stars =
      status === 'win' ? starsFor(this.def, this.w, this.frame, this.used) : 0;
    this.result = {
      id: this.def.id,
      status,
      reason:
        status === 'win' ? 'Objective complete!' : this.def.loseReason ?? 'Failed',
      stars,
      timeFrames: this.frame,
    };
  }
}

export class World {
  grid: Grid;
  rng: RNG;
  mode: Mode = 'sand';
  parts: PSys | null = null;
  challenge: ActiveChallenge | null = null;
  /** global velocity field; still (and free) until something disturbs it */
  wind = new Wind();
  shake = 0;
  /** what happened since the last takeEvents() - drives sound and flashes */
  events: SimEvents = emptyEvents();
  /** total sim frames elapsed (drives animation + row hashes) */
  f = 0;

  constructor(seed = 1234567) {
    this.grid = new Grid(SIM_W, SIM_H);
    this.grid.counts[Mat.EMPTY] = SIM_W * SIM_H;
    this.rng = new RNG(seed);
    this.parts = new PSys(this.grid);
    // a firework burst is a small blast as far as sound and screen go
    this.parts.onBurst = (x, y) => this.events.booms.push(x | 0, y | 0, 4);
  }

  clear(): void {
    const g = this.grid;
    g.cells.fill(0);
    g.meta.fill(0);
    g.clock.fill(0);
    g.counts.fill(0);
    g.counts[Mat.EMPTY] = g.cells.length;
    g.eternals.clear();
    g.chunks.wakeAll();
    this.wind.clear();
    this.shake = 0;
    this.events = emptyEvents();
  }

  /**
   * The playground's CLEAR: walls and bumpers live in the grid, particles,
   * forces and portals in the particle system - clearing only the second
   * left every wall standing.
   */
  clearPlayground(): void {
    this.clear();
    this.parts?.reset();
  }

  /** Replace the playground with a SURPRISE ME scene for `seed`. */
  loadSurprise(seed: number): void {
    if (!this.parts) return;
    this.clearPlayground();
    buildSurprise(planSurprise(seed), this.grid, this.parts);
  }

  /** Replace the playground with one of the demo scenes. */
  loadPreset(id: string): boolean {
    if (!this.parts) return false;
    this.clearPlayground();
    return buildPreset(id, this.grid, this.parts);
  }

  // ---------- multiplayer: snapshots, fingerprints, inputs ----------

  snapshot(): Snapshot {
    const g = this.grid;
    return {
      f: this.f,
      rng: this.rng.state,
      shadeSeed: g.shadeSeed,
      cells: g.cells.slice(),
      meta: g.meta.slice(),
      clock: g.clock.slice(),
      shade: g.shade.slice(),
      wake: g.chunks.saveWake(),
      wind: this.wind.save(),
    };
  }

  restore(s: Snapshot): void {
    const g = this.grid;
    this.f = s.f;
    this.rng.state = s.rng;
    g.shadeSeed = s.shadeSeed;
    g.cells.set(s.cells);
    g.meta.set(s.meta);
    g.clock.set(s.clock);
    g.shade.set(s.shade);
    g.chunks.restoreWake(s.wake);
    this.wind.restore(s.wind);
    g.counts.fill(0);
    for (let i = 0; i < g.cells.length; i++) g.counts[g.cells[i]]++;
    g.rebuildEternals();
    this.mode = 'sand';
    this.challenge = null;
    this.parts?.reset();
    this.events = emptyEvents();
  }

  /**
   * A 32-bit fingerprint of the simulation state (FNV-1a). Peers compare it
   * to notice a desync; colours (shade) are left out - they cannot change
   * what happens next.
   */
  hash(): number {
    let h = 0x811c9dc5;
    for (const p of this.hashParts()) h = Math.imul(h ^ p, 0x01000193);
    return h >>> 0;
  }

  /**
   * The fingerprint by component - cells, meta, clock, wake, wind, rng,
   * frame - so a desync report can say which part of the state went first.
   */
  hashParts(): number[] {
    const fnv = (b: Uint8Array) => {
      let h = 0x811c9dc5;
      for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 0x01000193);
      return h >>> 0;
    };
    const g = this.grid;
    const w = this.wind.save();
    return [
      fnv(g.cells),
      fnv(g.meta),
      fnv(g.clock),
      fnv(g.chunks.saveWake()),
      fnv(new Uint8Array(w.buffer, w.byteOffset, w.byteLength)),
      this.rng.state >>> 0,
      this.f,
    ];
  }

  /** Apply one player's action; in multiplayer, at the frame the host chose. */
  applyInput(inp: NetInput): void {
    if (inp.k === 'paint') this.paint(inp.pts, inp.mat, inp.size, inp.kind);
    else this.clear();
  }

  /** Hand over everything that happened since the last call, and reset. */
  takeEvents(): SimEvents {
    const e = this.events;
    this.events = emptyEvents();
    return e;
  }

  loadChallenge(id: string): boolean {
    const def = CHALLENGES.find((c) => c.id === id);
    if (!def) return false;
    this.mode = 'sand';
    this.parts?.reset();
    this.challenge = new ActiveChallenge(this, def);
    return true;
  }

  toSandbox(): void {
    this.mode = 'sand';
    this.parts?.reset();
    this.challenge = null;
    this.clear();
  }

  paint(pts: number[], rawMat: number, size: number, kind: PaintKind = 'brush'): void {
    if (kind === 'wind') {
      this.blow(pts, size);
      return;
    }
    const mat = rawMat === -1 ? Mat.EMPTY : rawMat;
    if (mat < 0 || mat >= NMATS) return;
    if (kind === 'flood') {
      this.floodFill(pts[0], pts[1], mat);
      return;
    }
    const ch = this.challenge;
    // Timed materials (fire, smoke, steam) keep their remaining life in meta.
    // Painting them with meta 0 meant they died on their first tick, before
    // fire ever looked at its neighbours - so painted fire could not light
    // wood, oil or TNT, and only gunpowder (which checks for fire itself)
    // ever reacted to it.
    const life = MATS[mat].life;
    for (let p = 0; p < pts.length; p += 2) {
      const cx = pts[p];
      const cy = pts[p + 1];
      const r = size >> 1;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r + 1) continue;
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= SIM_W || y >= SIM_H) continue;
          const i = this.grid.idx(x, y);
          if (mat !== Mat.EMPTY && this.grid.cells[i] === mat) continue;
          if (mat !== Mat.EMPTY && this.grid.cells[i] !== Mat.EMPTY && MATS[this.grid.cells[i]].cat === Cat.SOLID && mat !== Mat.EMPTY && !ERASES_SOLID.has(mat)) {
            // painting over solids only allowed by eraser or wall-like materials
            continue;
          }
          if (ch) {
            const budget = ch.def.budget?.[mat];
            if (budget !== undefined && ch.used[mat] >= budget) continue;
            ch.used[mat]++;
          }
          this.grid.setXY(x, y, mat, life ? this.rng.range(life[0], life[1]) : 0);
        }
      }
    }
  }

  /**
   * Turns a brush stroke into gusts along its path.
   *
   * The stroke's own direction is the wind direction and its length is the
   * strength, so a slow drag is a breeze and a fast swipe is a blast. A click
   * with no drag puffs outward instead, which is the only sensible reading of
   * a stroke with no direction. Costs no challenge budget - air is free.
   */
  private blow(pts: number[], size: number): void {
    const n = pts.length >> 1;
    if (n === 0) return;
    const radius = Math.max(10, size * 3);
    const dx = pts[(n - 1) * 2] - pts[0];
    const dy = pts[(n - 1) * 2 + 1] - pts[1];
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) {
      this.wind.addBlast(pts[0], pts[1], radius, 0.9);
      return;
    }
    const strength = Math.min(3.2, 0.5 + len * 0.09);
    const ux = (dx / len) * strength;
    const uy = (dy / len) * strength;
    // one gust per third-of-a-radius, so a fast swipe lays a continuous
    // corridor of wind rather than a string of disconnected puffs
    const stride = Math.max(1, Math.floor(radius / 3));
    for (let k = 0; k < n; k += stride)
      this.wind.addGust(pts[k * 2], pts[k * 2 + 1], ux, uy, radius);
  }

  /** Flood fill: replace the connected region under the start cell. */
  private floodFill(sx: number, sy: number, mat: number): void {
    if (sx < 0 || sy < 0 || sx >= SIM_W || sy >= SIM_H) return;
    const g = this.grid;
    const ch = this.challenge;
    const target = g.get(sx, sy);
    if (target === mat || target === 1) return; // walls are irreplaceable
    const stack: number[] = [sy * SIM_W + sx];
    const seen = new Uint8Array(SIM_W * SIM_H);
    let placed = 0;
    const CAP = 30000;
    while (stack.length > 0 && placed < CAP) {
      const i = stack.pop()!;
      if (seen[i]) continue;
      seen[i] = 1;
      if (g.cells[i] !== target) continue;
      const x = i % SIM_W;
      const y = (i / SIM_W) | 0;
      if (mat !== Mat.EMPTY && ch) {
        const budget = ch.def.budget?.[mat];
        if (budget !== undefined && ch.used[mat] >= budget) break;
        ch.used[mat]++;
      }
      g.setXY(x, y, mat);
      placed++;
      if (x > 0) stack.push(i - 1);
      if (x < SIM_W - 1) stack.push(i + 1);
      if (y > 0) stack.push(i - SIM_W);
      if (y < SIM_H - 1) stack.push(i + SIM_W);
    }
  }

  step(): void {
    this.f++;
    if (this.mode === 'playground') {
      // integration + rasterization happen in parts.fullRender (worker-driven)
      return;
    }

    const ch = this.challenge;
    if (ch && !ch.done) {
      ch.frame++;
      ch.tickSources();
    }

    const g = this.grid;
    // eternal cells (torch/void/clone) must tick even in sleeping chunks -
    // they cannot wake themselves once their chunk sleeps (chicken-and-egg)
    for (const i of g.eternals) {
      const y = (i / g.W) | 0;
      g.chunks.wakeCell(i - y * g.W, y);
    }
    // must run before beginFrame(), which swaps the wake bitmap in: a chunk
    // the wind is blowing through has to be awake on the frame the gust
    // reaches it, not the one after
    this.wind.step(g.chunks);
    g.clock.fill(0); // per-frame updated flags

    g.chunks.beginFrame();
    const list = g.chunks.list;
    for (let li = 0; li < list.length; li++) {
      const ci = list[li];
      const cx = ci % CHUNKS_X;
      const cy = (ci / CHUNKS_X) | 0;
      const y0 = cy << CHUNK_SHIFT;
      const x0 = cx << CHUNK_SHIFT;
      for (let y = y0 + CHUNK - 1; y >= y0; y--) {
        const ltr = ((hash2d(cx * CHUNK + 7, y * 31 + this.f) & 1) === 0);
        if (ltr) {
          for (let x = x0; x < x0 + CHUNK; x++) this.updateCell(x, y);
        } else {
          for (let x = x0 + CHUNK - 1; x >= x0; x--) this.updateCell(x, y);
        }
      }
    }

    if (ch) ch.check();
    g.chunks.spreadHalo();
    if (this.shake > 0) this.shake--;
  }

  private updateCell(x: number, y: number): void {
    const g = this.grid;
    const i = g.idx(x, y);
    const m = g.cells[i];
    if (m === Mat.EMPTY) return;
    if (g.clock[i] !== 0) return; // already moved this frame
    g.clock[i] = 1;
    switch (m) {
      case Mat.SAND:
        // wet sand turns to mud; the water stays (GARDENER budgets water)
        if (this.rng.chance(0.03) && this.adjacent(x, y, Mat.WATER)) {
          this.grid.setXY(x, y, Mat.MUD);
          break;
        }
        this.powder(x, y, m);
        break;
      case Mat.MUD:
        this.mud(x, y);
        break;
      case Mat.TURBINE:
        this.turbine(x, y, i);
        break;
      case Mat.ANT:
        this.ant(x, y, i);
        break;
      case Mat.BIRD:
        this.bird(x, y, i);
        break;
      case Mat.GUNPOWDER:
        this.powder(x, y, m);
        break;
      case Mat.SEED:
        this.seed(x, y);
        break;
      case Mat.WATER:
        this.liquid(x, y, m);
        break;
      case Mat.OIL:
        this.liquid(x, y, m);
        break;
      case Mat.ACID:
        this.acid(x, y);
        break;
      case Mat.LAVA:
        this.lava(x, y);
        break;
      case Mat.FIRE:
        this.fire(x, y, i);
        break;
      case Mat.SMOKE:
        this.gas(x, y, Mat.EMPTY, 0.25);
        break;
      case Mat.STEAM:
        this.steam(x, y);
        break;
      case Mat.PLANT:
        this.plant(x, y);
        break;
      case Mat.FLORA:
        this.flora(x, y, i);
        break;
      case Mat.FUSE:
        this.fuse(x, y);
        break;
      case Mat.EMBER:
        this.ember(x, y, i);
        break;
      case Mat.ICE:
        this.ice(x, y);
        break;
      case Mat.ASH:
        this.powder(x, y, m);
        break;
      case Mat.SNOW:
        this.snow(x, y);
        break;
      case Mat.SALT:
        this.salt(x, y);
        break;
      case Mat.TNT:
        this.tnt(x, y, i);
        break;
      case Mat.WIRE:
        this.wire(x, y, i);
        break;
      case Mat.TORCH:
        this.torch(x, y);
        break;
      case Mat.CLONE:
        this.clone(x, y);
        break;
      case Mat.VOID:
        this.voidCell(x, y);
        break;
      default:
        break; // static solids
    }
  }

  // ---------- movement ----------

  /** Try moving material m from (x,y) to (nx,ny).
   *  Falling/sideways: enter empty or lighter fluids (sink).
   *  Rising (dy<0): enter empty or heavier fluids (buoyancy). */
  private canEnter(t: number, dens: number, dy: number): boolean {
    if (t === 1) return false; // WALL
    if (t === Mat.EMPTY) return true;
    const tc = MATS[t].cat;
    if (tc !== Cat.LIQUID && tc !== Cat.GAS) return false;
    return dy < 0 ? dens < MATS[t].dens : dens > MATS[t].dens;
  }

  private nearFire(x: number, y: number): boolean {
    const g = this.grid;
    return (
      g.get(x - 1, y) === Mat.FIRE || g.get(x + 1, y) === Mat.FIRE ||
      g.get(x, y - 1) === Mat.FIRE || g.get(x, y + 1) === Mat.FIRE
    );
  }

  private tryMoveTo(x: number, y: number, nx: number, ny: number, dens: number): boolean {
    // flammable matter trying to flee while touching flame catches alight -
    // closes the scan-order escape hatch where fuel dodges fire between ticks
    const from = this.grid.idx(x, y);
    const m = this.grid.cells[from];
    const md = MATS[m];
    if (md.flam > 0 && this.nearFire(x, y)) {
      if (this.rng.chance(Math.max(0.25, md.flam))) {
        if (m === Mat.GUNPOWDER) {
          this.explode(x, y, 5);
          return true;
        }
        if (m === Mat.WOOD) this.grid.setI(from, Mat.EMBER, this.rng.range(70, 150));
        else this.grid.setI(from, Mat.FIRE, this.rng.range(12, 42));
        return true;
      }
    }
    const dy = ny - y;
    const t = this.grid.get(nx, ny);
    if (!this.canEnter(t, dens, dy)) return false;
    const to = this.grid.idx(nx, ny);
    // displacement ignition: flammable matter entering open flame combusts
    if (t === Mat.FIRE) {
      const mv = this.grid.cells[from];
      if (MATS[mv].flam > 0) {
        if (mv === Mat.GUNPOWDER) {
          this.explode(nx, ny, 5);
          this.grid.setI(from, Mat.EMPTY);
          return true;
        }
        this.grid.setI(to, mv === Mat.WOOD ? mv : Mat.FIRE, mv === Mat.WOOD ? this.rng.range(70, 150) : this.rng.range(12, 42));
        this.grid.setXY(x, y, Mat.FIRE, this.rng.range(12, 42));
        return true;
      }
    }
    this.grid.swap(from, to);
    return true;
  }

  private powder(x: number, y: number, m: number): void {
    const dens = MATS[m].dens;
    const susc = WIND_SUSC[m];
    if (susc !== 0 && this.wind.isMoving) {
      const wx = Wind.nudge(this.wind.atX(x, y), susc, this.rng.next());
      if (wx !== 0) {
        // downwind-and-down first: a grain caught in a gust should still be
        // falling, just on a slant
        if (this.tryMoveTo(x, y, x + wx, y + 1, dens)) return;
        if (this.tryMoveTo(x, y, x + wx, y, dens)) return;
      }
    }
    if (this.tryMoveTo(x, y, x, y + 1, dens)) return;
    const first = this.rng.chance(0.5);
    const d1 = first ? 1 : -1;
    const d2 = first ? -1 : 1;
    if (this.tryMoveTo(x, y, x + d1, y + 1, dens)) return;
    if (this.tryMoveTo(x, y, x + d2, y + 1, dens)) return;
  }

  /**
   * Liquids: fall, then slide sideways only toward somewhere to fall.
   *
   * The old rule flipped a coin and slid to the farthest opening every tick,
   * so a partly filled top layer shuffled back and forth forever - measured,
   * a settled pool still swapped ~62 cells per frame 2000 frames after
   * landing and its chunks never slept. Sliding only toward a drop (an empty
   * cell below, within reach) keeps everything that makes water level -
   * any slope has a drop somewhere along it - while a flat partial layer,
   * which has nowhere lower to go, rests. A first attempt that instead
   * counted reversals and put cells to sleep froze slopes like sand (surface
   * range 54-64 cells): a resting cell never woke its chunk to look again.
   *
   * meta holds the last flow direction (LQ_*), which travels with the cell
   * and breaks ties, so a stream keeps going the way it was going.
   */
  private liquid(x: number, y: number, m: number): void {
    const g = this.grid;
    const i = g.idx(x, y);
    const dens = MATS[m].dens;
    const susc = WIND_SUSC[m];
    let wx = 0;
    if (susc !== 0 && this.wind.isMoving) {
      wx = Wind.nudge(this.wind.atX(x, y), susc, this.rng.next());
      const wy = Wind.nudge(this.wind.atY(x, y), susc, this.rng.next());
      // an updraught can tear droplets off the surface and throw them; this
      // is the only way a liquid ever moves upward, so it stays rare
      if (wy < 0 && this.tryMoveTo(x, y, x + wx, y - 1, dens)) return;
    }
    const meta = g.meta[i];
    const stored = meta & LQ_DIR;
    const v = (meta >> LQ_V_SHIFT) & LQ_V_MAX;
    const d1 = wx !== 0 ? wx : stored === LQ_RIGHT ? 1 : stored === LQ_LEFT ? -1 : this.rng.chance(0.5) ? 1 : -1;
    const d2 = -d1;
    const code = (d: number) => (d > 0 ? LQ_RIGHT : LQ_LEFT);

    // free fall with momentum: speed builds a step per tick while nothing is
    // under it, and a fast drop covers several cells per tick
    if (this.tryMoveTo(x, y, x, y + 1, dens)) {
      let cy = y + 1;
      const extra = v >> 1;
      for (let s = 0; s < extra; s++) {
        if (g.cells[g.idx(x, cy)] !== m) break; // caught fire on the way
        if (!this.tryMoveTo(x, cy, x, cy + 1, dens)) break;
        cy++;
      }
      this.setLiquidState(x, cy, m, code(d1), Math.min(LQ_V_MAX, v + 1));
      this.wakeSurface(x, y);
      return;
    }
    if (v > 0) {
      // Caught up with liquid that is itself still in the air: not an
      // impact. Keep the speed and wait. Splashing off it threw sideways
      // streaks out of the middle of every waterfall.
      const b = g.get(x, y + 1);
      const bLiquid = b !== 1 && MATS[b].cat === Cat.LIQUID;
      if (bLiquid && this.isOpen(g.get(x, y + 2))) return;
      // landed hard: the speed has to go somewhere
      if (v >= LQ_SPLASH && this.splash(x, y, m, d1, v)) return;
      // Stopped falling, so the speed is gone. Leaving it set froze whole
      // columns: the cell above saw "still falling" below and waited forever.
      g.meta[i] = meta & LQ_DIR;
    }

    if (this.tryMoveTo(x, y, x + d1, y + 1, dens)) {
      this.setLiquidDir(x + d1, y + 1, m, code(d1));
      this.wakeSurface(x, y);
      return;
    }
    if (this.tryMoveTo(x, y, x + d2, y + 1, dens)) {
      this.setLiquidDir(x + d2, y + 1, m, code(d2));
      this.wakeSurface(x, y);
      return;
    }

    const disp = MATS[m].disp;
    if (wx !== 0) {
      // a gust pushes regardless of slope, and further: that is what makes a
      // pool visibly stream rather than just pick a side
      const tx = this.openRun(x, y, wx, disp + 5);
      if (tx !== x) {
        g.swap(i, g.idx(tx, y));
        this.setLiquidDir(tx, y, m, code(wx));
      }
      return;
    }
    // Viscosity: thick liquids ooze. Sliding a full cell every tick toward
    // the nearest drop, lava (disp 1) ran off a 7-cell ledge in 7 frames;
    // the old random wobble only ever drifted it slowly. Water and acid
    // always slide, oil 3/4 of the time, lava 1/4.
    if (disp < LQ_RUNNY && !this.rng.chance(disp / LQ_RUNNY)) return;
    // slide toward the nearest drop, travel direction first. Look far, move
    // at most disp: with the search capped at disp a pool froze as a ramp
    // falling one row per ~disp cells, since a cell further than that from
    // the next step down saw nowhere to go.
    // Surface cells also look through their own liquid: the whole top row
    // of a terrace can then drain toward the drop at once (crudely, pressure)
    // instead of one edge cell at a time, which levelled a pool too slowly.
    // Runny liquids only: lava (disp 1) jumping a whole terrace in a frame
    // poured off a 7-cell ledge in 3 frames, which is not how lava moves.
    // a floating grain on top still makes this the surface - otherwise the
    // flow went round floating ash and never carried it anywhere
    const above = g.get(x, y - 1);
    const floater = above !== 1 && MATS[above].cat === Cat.POWDER && MATS[above].dens < dens;
    const surface = disp >= 3 && (this.isOpen(above) || floater);
    for (const dx of [d1, d2]) {
      const k = this.dropStep(x, y, dx, disp, surface ? m : -1);
      if (k > 0) {
        const tx = x + dx * k;
        g.swap(i, g.idx(tx, y));
        this.setLiquidDir(tx, y, m, code(dx));
        this.carryRun(x, y - 1, dx, k, dens);
        this.wakeSurface(x, y);
        return;
      }
    }
  }

  /**
   * A fast-falling liquid hit something. Its speed becomes, in order of
   * preference: a kicked-aside grain of powder (waterfalls dig), a droplet
   * thrown up and out (spray), or a dash sideways along the surface. Returns
   * false if there was nowhere for any of it to go.
   */
  private splash(x: number, y: number, m: number, d: number, v: number): boolean {
    const g = this.grid;
    const i = g.idx(x, y);
    const side = this.rng.chance(0.65) ? d : -d;
    const below = g.get(x, y + 1);
    if (below !== 1 && MATS[below].cat === Cat.POWDER && this.rng.chance(0.4)) {
      // knock the grain up and aside; the liquid drops into its place next tick
      for (const [kx, ky] of [[side, 0], [side, 1], [-side, 0]] as const) {
        if (this.isOpen(g.get(x + kx, y + ky))) {
          g.swap(g.idx(x, y + 1), g.idx(x + kx, y + ky));
          this.setLiquidState(x, y, m, code2(side), v - 2);
          return true;
        }
      }
    }
    if (this.rng.chance(0.5)) {
      const up = 1 + this.rng.int(2);
      const out = 1 + this.rng.int(2);
      const tx = x + side * out;
      const ty = y - up;
      if (this.isOpen(g.get(x + side, y - 1)) && this.isOpen(g.get(tx, ty))) {
        g.swap(i, g.idx(tx, ty));
        this.setLiquidState(tx, ty, m, code2(side), 0);
        return true;
      }
    }
    const tx = this.openRun(x, y, side, MATS[m].disp + v);
    if (tx !== x) {
      g.swap(i, g.idx(tx, y));
      this.setLiquidState(tx, y, m, code2(side), 0);
      this.carry(x, y - 1, side, MATS[m].dens);
      return true;
    }
    this.setLiquidState(x, y, m, code2(d), 0);
    return false;
  }

  /**
   * A surface cell just flowed k cells toward dx, so that whole stretch of
   * surface is moving: nudge the floating grains above it downstream.
   * Nudging only the grain over the starting cell moved floating ash ~3
   * cells in 400 frames - it mostly sank into the hole instead. Walk from
   * the far end so a grain is not pushed twice in one pass.
   */
  private carryRun(x: number, y: number, dx: number, k: number, dens: number): void {
    for (let j = k - 1; j >= 0; j--) {
      if (this.rng.chance(0.5)) this.carry(x + dx * j, y, dx, dens);
    }
  }

  /** Flowing liquid drags a floating grain (lighter than it) one cell along. */
  private carry(x: number, y: number, dx: number, dens: number): void {
    const g = this.grid;
    const t = g.get(x, y);
    if (t === 1 || MATS[t].cat !== Cat.POWDER || MATS[t].dens >= dens) return;
    if (this.isOpen(g.get(x + dx, y))) g.swap(g.idx(x, y), g.idx(x + dx, y));
  }

  /**
   * A liquid just left (x, y), which is a new drop for any liquid on the row
   * above within LQ_SCAN. Chunk wake-ups only reach a chunk or two, so
   * without this a cell 60 cells along never heard about it, slept, and a
   * pool settled as a ramp (surface range 21 measured) instead of level.
   */
  private wakeSurface(x: number, y: number): void {
    if (y > 0) this.grid.chunks.wakeRect(x - LQ_SCAN, y - 1, x + LQ_SCAN, y - 1);
  }

  /** Direction only: any sideways or diagonal move spends the fall speed. */
  private setLiquidDir(x: number, y: number, m: number, dir: number): void {
    this.setLiquidState(x, y, m, dir, 0);
  }

  private setLiquidState(x: number, y: number, m: number, dir: number, v: number): void {
    const g = this.grid;
    const i = g.idx(x, y);
    // tryMoveTo can turn the mover into something else (fire); leave that be
    if (g.cells[i] === m) g.meta[i] = dir | (Math.max(0, v) << LQ_V_SHIFT);
  }

  private isOpen(t: number): boolean {
    return t === Mat.EMPTY || (t !== 1 && MATS[t].cat === Cat.GAS);
  }

  /** Farthest x reachable along open cells toward dx, up to reach. */
  private openRun(x: number, y: number, dx: number, reach: number): number {
    let tx = x;
    for (let k = 0; k < reach; k++) {
      if (!this.isOpen(this.grid.get(tx + dx, y))) break;
      tx += dx;
    }
    return tx;
  }

  /**
   * How far to move toward dx to head for the nearest drop (an open cell
   * with open space or a VOID under it, or the cell beside a VOID) within
   * LQ_SCAN, or 0 if there is none. Water on a flat floor otherwise rests,
   * so without the VOID cases a drain left a film of water around it.
   *
   * Over open cells it slides at most `disp`. If `through` is a liquid id,
   * runs of that liquid are passable for the search, and the move is a jump
   * to the first open cell past them - the far edge of the terrace.
   */
  private dropStep(x: number, y: number, dx: number, disp: number, through: number): number {
    const g = this.grid;
    let firstOpen = 0;
    let crossed = false;
    for (let k = 1; k <= LQ_SCAN; k++) {
      const t = g.get(x + dx * k, y);
      if (this.isOpen(t)) {
        if (firstOpen === 0) firstOpen = k;
        // a VOID below is a drain: as good as a drop
        const below = g.get(x + dx * k, y + 1);
        if (this.isOpen(below) || below === Mat.VOID) {
          return crossed ? firstOpen : Math.min(k, disp);
        }
      } else if (t === Mat.VOID) {
        // a drain in the wall: head for the cell beside it
        if (firstOpen === 0) return 0;
        return crossed ? firstOpen : Math.min(k - 1, disp);
      } else if (t === through && firstOpen === 0) {
        crossed = true;
      } else {
        return 0;
      }
    }
    return 0;
  }

  private gasStep(x: number, y: number, m: number): void {
    const dens = MATS[m].dens;
    const susc = WIND_SUSC[m];
    if (susc !== 0 && this.wind.isMoving) {
      const wx = Wind.nudge(this.wind.atX(x, y), susc, this.rng.next());
      const wy = Wind.nudge(this.wind.atY(x, y), susc, this.rng.next());
      // a gust wins over buoyancy for the frame it lands on, so smoke
      // actually bends downwind instead of climbing straight up through it
      if ((wx !== 0 || wy !== 0) && this.tryMoveTo(x, y, x + wx, y + wy, dens)) return;
      if (wx !== 0 && this.tryMoveTo(x, y, x + wx, y, dens)) return;
    }
    const up = this.tryMoveTo(x, y, x + this.rng.int(3) - 1, y - 1, dens);
    if (!up) {
      const dx = this.rng.int(3) - 1;
      if (dx !== 0) this.tryMoveTo(x, y, x + dx, y, dens);
    }
  }

  private gas(x: number, y: number, become: number, becomeChance: number): void {
    const g = this.grid;
    const i = g.idx(x, y);
    const life = g.meta[i];
    g.chunks.wakeCell(x, y); // lifetime ticks even when blocked
    if (life <= 1) {
      g.setXY(x, y, this.rng.chance(becomeChance) ? become : Mat.EMPTY);
      return;
    }
    g.meta[i] = life - 1;
    this.gasStep(x, y, Mat.SMOKE);
  }

  private steam(x: number, y: number): void {
    const g = this.grid;
    const i = g.idx(x, y);
    const life = g.meta[i];
    g.chunks.wakeCell(x, y);
    if (life <= 1) {
      const condense = this.rng.chance(0.3) || g.get(x, y - 1) === 1;
      g.setXY(x, y, condense ? Mat.WATER : Mat.EMPTY);
      return;
    }
    g.meta[i] = life - 1;
    this.gasStep(x, y, Mat.STEAM);
  }

  // ---------- behaviors & reactions ----------

  private seed(x: number, y: number): void {
    // "sprouts on wet ground": water, or mud
    if (this.adjacent(x, y, Mat.WATER) || this.adjacent(x, y, Mat.MUD)) {
      this.grid.setXY(x, y, Mat.PLANT, 0);
      return;
    }
    this.powder(x, y, Mat.SEED);
  }

  private plant(x: number, y: number): void {
    const g = this.grid;
    const gen = g.meta[g.idx(x, y)];
    if (gen >= 10) return;
    // keep trying while there is water to drink
    if (
      g.get(x - 1, y) === Mat.WATER || g.get(x + 1, y) === Mat.WATER ||
      g.get(x, y - 1) === Mat.WATER || g.get(x, y + 1) === Mat.WATER ||
      g.get(x - 1, y - 1) === Mat.WATER || g.get(x + 1, y - 1) === Mat.WATER
    ) {
      g.chunks.wakeCell(x, y);
    }
    if (!this.rng.chance(0.12)) return;
    const dirs = [[1, 0], [-1, 0], [0, -1], [0, 1], [1, -1], [-1, -1]];
    const pick = this.rng.int(dirs.length);
    for (let d = 0; d < dirs.length; d++) {
      const nx = x + dirs[(pick + d) % dirs.length][0];
      const ny = y + dirs[(pick + d) % dirs.length][1];
      if (g.get(nx, ny) === Mat.WATER) {
        g.setXY(nx, ny, Mat.PLANT, gen + 1);
        this.trySprout(nx, ny);
        return;
      }
    }
  }

  /**
   * A plant that has just grown up to open air may push a bud into it.
   * Buds keep their distance from other flora so a pond grows a scatter of
   * flowers rather than a lawn of stems.
   */
  private trySprout(x: number, y: number): void {
    const g = this.grid;
    if (g.get(x, y - 1) !== Mat.EMPTY) return;
    if (!this.rng.chance(0.3)) return;
    // big blooms are up to 7 wide, so keep sprouts further apart than that
    for (let dy = 1; dy <= 4; dy++)
      for (let dx = -5; dx <= 5; dx++)
        if (g.get(x + dx, y - dy) === Mat.FLORA) return;
    g.setXY(x, y - 1, Mat.FLORA, Flora.BUD | this.rng.range(7, 22));
  }

  /**
   * Flora: only buds tick. A bud climbs one cell at a time (leaving stem
   * behind, swaying now and then, dropping leaves to the sides) until its
   * height runs out or it is blocked, then blooms. Every other part is inert,
   * so a finished flower costs nothing and lets its chunk sleep.
   */
  private flora(x: number, y: number, i: number): void {
    const g = this.grid;
    const meta = g.meta[i];
    if ((meta & Flora.BUD) === 0) return;
    g.chunks.wakeCell(x, y);
    if (!this.rng.chance(0.07)) return;
    const height = meta & 0x7f;
    if (height === 0) {
      this.bloom(x, y, i);
      return;
    }
    if (this.rng.chance(0.2)) this.leaf(x, y, this.rng.chance(0.5) ? 1 : -1);
    const drift = this.rng.chance(0.18) ? (this.rng.chance(0.5) ? 1 : -1) : 0;
    const tx = x + drift;
    if (g.get(tx, y - 1) !== Mat.EMPTY) {
      this.bloom(x, y, i);
      return;
    }
    // same material, so setI would skip the repaint - write meta and touch
    g.meta[i] = Flora.STEM;
    g.touch(x, y);
    g.setXY(tx, y - 1, Mat.FLORA, Flora.BUD | (height - 1));
  }

  /**
   * A leaf off the stem at (x, y): a two-tone blade angled up and out,
   * light on top and darker underneath.
   */
  private leaf(x: number, y: number, side: number): void {
    const g = this.grid;
    const put = (px: number, py: number, part: number) => {
      if (g.get(px, py) === Mat.EMPTY) g.setXY(px, py, Mat.FLORA, part);
    };
    put(x + side, y, Flora.LEAF_DARK);
    put(x + side * 2, y - 1, Flora.LEAF);
    put(x + side * 2, y, Flora.LEAF_DARK);
    if (this.rng.chance(0.6)) put(x + side * 3, y - 1, Flora.LEAF);
    if (this.rng.chance(0.4)) put(x + side * 3, y - 2, Flora.LEAF);
  }

  /**
   * End of a stem. Usually a flower - daisy, full bloom, tulip or sunflower,
   * in one of Flora.HUES colours with lighter tips - sometimes a leafy tip.
   * Shapes are written as offsets from the bud; put() only fills empty
   * cells, so a bloom never overwrites its own stem or a neighbour.
   */
  private bloom(x: number, y: number, i: number): void {
    const g = this.grid;
    g.touch(x, y);
    const put = (dx: number, dy: number, part: number) => {
      if (g.get(x + dx, y + dy) === Mat.EMPTY) g.setXY(x + dx, y + dy, Mat.FLORA, part);
    };
    const roll = this.rng.next();
    const hue = this.rng.int(Flora.HUES);
    const main = petal(hue, 0);
    const tip = petal(hue, 1);

    if (roll < 0.14) {
      // leafy tip: a little fan of leaves instead of a flower
      g.meta[i] = Flora.LEAF;
      put(-1, -1, Flora.LEAF);
      put(1, -1, Flora.LEAF);
      put(0, -2, Flora.LEAF);
      put(-2, -1, Flora.LEAF_DARK);
      put(2, -1, Flora.LEAF_DARK);
      return;
    }
    if (roll < 0.42) {
      // daisy: a cross of petals with lighter tips round a yellow eye
      g.meta[i] = Flora.CENTER;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const) put(dx, dy, main);
      for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [-2, -1], [2, -1], [-1, -2], [1, -2]] as const) put(dx, dy, tip);
      return;
    }
    if (roll < 0.66) {
      // full bloom: a round head, darker heart, light rim
      g.meta[i] = main;
      for (let dy = -3; dy <= 1; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const cy = dy + 1; // centre the disc a cell above the bud
          const d2 = dx * dx + cy * cy;
          if (d2 > 5 || (dx === 0 && dy === 1)) continue;
          put(dx, dy, d2 >= 4 ? tip : main);
        }
      put(0, -1, Flora.CENTER);
      return;
    }
    if (roll < 0.88) {
      // tulip: a cup, open at the top
      g.meta[i] = main;
      for (const [dx, dy] of [[-1, 0], [1, 0], [-1, -1], [0, -1], [1, -1], [-2, -1], [2, -1], [-1, -2], [1, -2]] as const) put(dx, dy, main);
      for (const [dx, dy] of [[-2, -2], [2, -2], [-1, -3], [1, -3], [0, -2]] as const) put(dx, dy, tip);
      return;
    }
    // sunflower: big, always yellow, with a brown seed head
    const yel = petal(4, 0);
    const yelTip = petal(4, 1);
    g.meta[i] = Flora.CENTER_DARK;
    for (let dy = -4; dy <= 2; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const cy = dy + 1;
        const d2 = dx * dx + cy * cy;
        if (d2 > 10 || (dx === 0 && dy >= 1)) continue;
        put(dx, dy, d2 <= 2 ? Flora.CENTER_DARK : d2 >= 7 ? yelTip : yel);
      }
  }

  // ---------- mud, turbines and creatures ----------

  /**
   * Mud: heavy and sticky. Gripped on both sides (by mud or a solid) it
   * holds instead of falling, which is what lets a tunnel roof or a bridge
   * stand; it slumps away only very slowly. Free mud falls, and slides
   * diagonally only now and then, so it piles steep. Heat bakes it to sand.
   */
  private mud(x: number, y: number): void {
    const g = this.grid;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const t = g.get(x + dx, y + dy);
      if ((t === Mat.FIRE || t === Mat.LAVA || t === Mat.EMBER) && this.rng.chance(0.08)) {
        g.setXY(x, y, Mat.SAND);
        if (g.get(x, y - 1) === Mat.EMPTY) g.setXY(x, y - 1, Mat.STEAM, this.rng.range(60, 140));
        this.events.sizzles++;
        return;
      }
    }
    const grips = (t: number) => t === Mat.MUD || t === 1 || (t !== Mat.EMPTY && MATS[t].cat === Cat.SOLID);
    if (grips(g.get(x - 1, y)) && grips(g.get(x + 1, y)) && !this.rng.chance(0.002)) return;
    const dens = MATS[Mat.MUD].dens;
    if (this.tryMoveTo(x, y, x, y + 1, dens)) return;
    if (!this.rng.chance(0.12)) return;
    // Buried mud never slumps - only a grain with nothing on it does. With
    // every cell free to slide, shaft walls slid into the shaft and ants
    // could never dig deeper than a dent.
    if (g.get(x, y - 1) === Mat.MUD) return;
    // only slide where the drop is two deep: mud stands at ~2:1 where sand
    // lies at 45 degrees (it slumped exactly like sand before this)
    const d = this.rng.chance(0.5) ? 1 : -1;
    // ...and only toward an open face at least two cells wide: the rims of
    // a one-cell shaft slumped in and refilled it (measured: dug to 3 deep,
    // back to 1 twenty frames later with no ant involved)
    for (const dx of [d, -d]) {
      if (
        this.isOpen(g.get(x + dx, y + 2)) &&
        this.isOpen(g.get(x + dx * 2, y + 1)) &&
        this.tryMoveTo(x, y, x + dx, y + 1, dens)
      ) return;
    }
  }

  /**
   * Turbine: meta is spin (0..255). Wind across it, or liquid falling past
   * it (a water wheel), spins it up; otherwise it spins down. While it spins
   * hard enough it pulses sparks into touching wire, faster with more spin -
   * so it slots straight into the WIRE / TNT / TORCH kit.
   */
  private turbine(x: number, y: number, i: number): void {
    const g = this.grid;
    let spin = g.meta[i];
    let drive = 0;
    if (this.wind.isMoving) drive += Math.hypot(this.wind.atX(x, y), this.wind.atY(x, y));
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, -1], [0, 1]] as const) {
      const ni = g.idx(x + dx, y + dy);
      const t = g.get(x + dx, y + dy);
      if (t !== 1 && MATS[t].cat === Cat.LIQUID && ((g.meta[ni] >> LQ_V_SHIFT) & LQ_V_MAX) > 0) drive += 0.5;
    }
    if (drive > 0.15) spin = Math.min(255, spin + 6 + Math.round(drive * 20));
    else spin = Math.max(0, spin - 3);
    if (spin !== g.meta[i]) {
      g.meta[i] = spin;
      g.touch(x, y);
    }
    if (spin === 0) return;
    g.chunks.wakeCell(x, y); // keep turning (and spinning down) while it moves
    if (spin < TURBINE_LIVE) return;
    const period = spin > 180 ? 3 : spin > 100 ? 6 : 12;
    if (this.f % period !== 0) return;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (g.get(nx, ny) === Mat.WIRE && g.meta[g.idx(nx, ny)] === 0) {
        g.meta[g.idx(nx, ny)] = SPARK_LIFE;
        g.chunks.wakeCell(nx, ny);
      }
    }
  }

  /** Something an ant can dig out and carry. */
  private diggable(t: number): boolean {
    return t === Mat.SAND || t === Mat.MUD;
  }

  /**
   * Ant. meta bit 0: facing left; bit 1: carrying a grain; bit 2: the grain
   * is mud (else sand); bits 3-5: steps walked on the surface while carrying.
   *
   * Two modes. Empty-handed it digs: from the surface now and then straight
   * down (a shaft), underground mostly straight ahead (a gallery, whose mud
   * roof holds because it is gripped on both sides). Carrying, it heads for
   * open air - climbing, clinging to shaft walls - and only drops the grain
   * after walking a few steps on the surface. Dropping it as soon as it saw
   * sky meant every ant refilled its own hole and nothing was ever dug.
   */
  private ant(x: number, y: number, i: number): void {
    const g = this.grid;
    g.chunks.wakeCell(x, y);
    const dens = MATS[Mat.ANT].dens;
    const open = (dx: number, dy: number) => this.isOpen(g.get(x + dx, y + dy));
    // cling to anything beside it; fall only with nothing to hold
    if (open(0, 1) && open(-1, 0) && open(1, 0)) {
      this.tryMoveTo(x, y, x, y + 1, dens);
      return;
    }
    if (!this.rng.chance(0.8)) return;
    let meta = g.meta[i];
    let d = meta & 1 ? -1 : 1;
    const flip = () => {
      d = -d;
      meta ^= 1;
    };
    const carrying = (meta & 2) !== 0;
    const surface = open(0, -1);
    let nx = x;
    let ny = y;

    // between two walls (a shaft) or under a roof (a gallery)
    const enclosed = (!open(-1, 0) && !open(1, 0)) || !surface;

    if (carrying) {
      if (surface && !open(0, 1) && !enclosed) {
        const steps = (meta >> 3) & 7;
        if (steps >= 6) {
          // far enough from the hole: put the grain down behind
          const grain = meta & 4 ? Mat.MUD : Mat.SAND;
          if (open(-d, 0)) g.setXY(x - d, y, grain);
          else g.setXY(x, y - 1, grain);
          meta &= 1;
          flip(); // and head back to the hole for the next grain
        } else {
          meta = (meta & ~(7 << 3)) | ((steps + 1) << 3);
        }
      }
      if (enclosed && open(0, -1)) {
        // climbing out of a shaft: at the mouth, step out onto the rim
        // (climbing straight up just fell back in)
        if (open(d, -1) && !open(d, 0)) {
          nx = x + d;
          ny = y - 1;
        } else if (open(-d, -1) && !open(-d, 0)) {
          flip();
          nx = x + d;
          ny = y - 1;
        } else {
          ny = y - 1;
        }
      }
    } else {
      // Clinging to the walls is how a loaded ant climbs out - and without
      // this it is also how an empty one stayed stuck at the mouth of every
      // shaft, so no hole ever got deeper than the first cell.
      if (enclosed && open(0, 1)) {
        g.meta[i] = meta;
        this.tryMoveTo(x, y, x, y + 1, dens);
        return;
      }
      const below = g.get(x, y + 1);
      const ahead = g.get(x + d, y);
      const inShaft = !open(-1, 0) && !open(1, 0) && surface;
      // how far down the shaft: walled, open cells above this one
      let depth = 0;
      if (inShaft)
        while (depth < 8 && open(0, -depth - 1) && !open(-1, -depth - 1) && !open(1, -depth - 1)) depth++;
      // Start a shaft from the surface now and then and sink it straight
      // down; only once it is deep, branch galleries off it. Branching from a
      // one-cell pit just widened every pit into a shallow trench.
      const deepShaft = inShaft && depth >= 4;
      // starting a new shaft is rare, so an ant comes back to the one it has
      // (at 3% a step it began a fresh hole on every trip home)
      const digDown = inShaft ? (deepShaft ? 0.04 : 0.15) : enclosed ? 0.02 : 0.006;
      const digAhead = inShaft ? (deepShaft ? 0.15 : 0) : enclosed ? 0.3 : 0;
      if (this.diggable(below) && this.rng.chance(digDown)) {
        g.setXY(x, y + 1, Mat.EMPTY);
        g.meta[i] = meta | 2 | (below === Mat.MUD ? 4 : 0);
        return;
      }
      if (this.diggable(ahead) && this.rng.chance(digAhead)) {
        g.setXY(x + d, y, Mat.EMPTY);
        meta |= 2 | (ahead === Mat.MUD ? 4 : 0);
        flip(); // turn round and carry it out
        g.meta[i] = meta;
        return;
      }
      // down the hole with empty hands: stay and keep digging; wandering
      // straight back out left every hole one cell deep
      if (enclosed && !this.rng.chance(0.15)) {
        g.meta[i] = meta;
        return;
      }
    }

    if (ny === y) {
      if (this.rng.chance(0.01)) flip();
      if (open(d, 0)) {
        // A cliff ahead (deep AND wide): usually turn back. A narrow hole is
        // a shaft, and down a shaft is where an ant wants to go - treating
        // any 2-deep drop as a cliff kept ants out of their own holes.
        const cliff = open(d, 1) && open(d, 2) && open(d, 3) && open(d * 2, 1);
        if (cliff && this.rng.chance(0.9)) flip();
        else nx = x + d;
      } else if (open(d, -1)) {
        nx = x + d; // step up
        ny = y - 1;
      } else if (open(d, 1)) {
        nx = x + d; // step down into a dip or a tunnel mouth
        ny = y + 1;
      } else if (surface && !carrying && this.diggable(g.get(x + d, y)) && this.rng.chance(0.2)) {
        const t = g.get(x + d, y);
        g.setXY(x + d, y, Mat.EMPTY);
        meta |= 2 | (t === Mat.MUD ? 4 : 0);
        flip();
      } else {
        flip();
      }
    }
    g.meta[i] = meta;
    if (nx !== x || ny !== y) this.tryMoveTo(x, y, nx, ny, dens);
  }

  /** Where a bird can sit. */
  private perchable(t: number): boolean {
    return t === Mat.FLORA || t === Mat.PLANT || t === Mat.WOOD || t === Mat.STONE || t === Mat.WALL || t === 1;
  }

  /**
   * Bird. meta bit 0: heading left; bits 3-7: perch timer (x8 frames).
   * Flies with a random bob, keeps a few cells clear of the ground or water,
   * goes over or turns at obstacles, is pushed by wind, and now and then
   * settles on a plant, flower, wood or stone for a while.
   */
  private bird(x: number, y: number, i: number): void {
    const g = this.grid;
    g.chunks.wakeCell(x, y);
    let meta = g.meta[i];
    let perch = meta >> 3;
    if (perch > 0) {
      if (!this.perchable(g.get(x, y + 1))) perch = 0;
      else if (this.f % 8 === 0) perch--;
      g.meta[i] = (meta & 7) | (perch << 3);
      if (perch > 0) return;
    }
    if (!this.rng.chance(0.75)) return;
    let d = meta & 1 ? -1 : 1;
    // how close is the ground (or water) below?
    let clear = 0;
    while (clear < 16 && this.isOpen(g.get(x, y + clear + 1))) clear++;
    if (clear === 0 && this.perchable(g.get(x, y + 1)) && this.rng.chance(0.04)) {
      g.meta[i] = (meta & 7) | ((6 + this.rng.int(25)) << 3);
      return;
    }
    // cruise: well clear of the ground, climbing when lower than that (birds
    // that only kept 4 cells off the floor skimmed along it)
    const bob = this.rng.chance(0.3) ? (this.rng.chance(0.5) ? -1 : 1) : 0;
    let dy = clear < 4 ? -1 : clear < 14 && this.rng.chance(0.5) ? -1 : y < 12 ? 1 : bob;
    let dx = d;
    if (this.wind.isMoving) {
      const wx = Wind.nudge(this.wind.atX(x, y), 0.9, this.rng.next());
      const wy = Wind.nudge(this.wind.atY(x, y), 0.9, this.rng.next());
      if (wx !== 0) dx = wx;
      if (wy !== 0) dy = wy;
    }
    if (this.rng.chance(0.006)) {
      d = -d;
      meta ^= 1;
    }
    const dens = MATS[Mat.BIRD].dens;
    g.meta[i] = meta;
    if (this.isOpen(g.get(x + dx, y + dy)) && this.tryMoveTo(x, y, x + dx, y + dy, dens)) return;
    if (this.isOpen(g.get(x + dx, y - 1)) && this.tryMoveTo(x, y, x + dx, y - 1, dens)) return;
    g.meta[i] = meta ^ 1; // blocked: turn round
  }

  private acid(x: number, y: number): void {
    const g = this.grid;
    g.chunks.wakeCell(x, y); // corrosion is probabilistic - stay hot
    const pick = this.rng.int(4);
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const nx = x + dirs[pick][0];
    const ny = y + dirs[pick][1];
    const t = g.get(nx, ny);
    if (t !== Mat.EMPTY && t !== 1 && t !== Mat.ACID) {
      const resist = MATS[t].acidChance;
      if (resist > 0 && this.rng.chance(resist)) {
        g.setXY(nx, ny, Mat.EMPTY);
        if (this.rng.chance(0.5)) {
          g.setXY(x, y, Mat.EMPTY);
          return;
        }
      }
    }
    this.liquid(x, y, Mat.ACID);
  }

  private lava(x: number, y: number): void {
    const g = this.grid;
    g.chunks.wakeCell(x, y); // lava stays hot/animated and keeps reacting
    const pick = this.rng.int(4);
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const nx = x + dirs[pick][0];
    const ny = y + dirs[pick][1];
    const t = g.get(nx, ny);
    switch (t) {
      case Mat.WATER:
        g.setXY(x, y, Mat.STONE);
        g.setXY(nx, ny, Mat.STEAM, this.rng.range(90, 220));
        this.events.sizzles++;
        return;
      case Mat.ICE:
      case Mat.SNOW:
        g.setXY(nx, ny, Mat.WATER);
        if (this.rng.chance(0.3)) {
          g.setXY(x, y, Mat.STONE);
          return;
        }
        break;
      case Mat.SAND:
        if (this.rng.chance(0.04)) g.setXY(nx, ny, Mat.GLASS);
        break;
      case Mat.STONE:
        if (this.rng.chance(0.002)) g.setXY(nx, ny, Mat.LAVA);
        break;
      case Mat.WOOD:
        g.setXY(nx, ny, Mat.EMBER, this.rng.range(70, 150));
        break;
      case Mat.PLANT:
      case Mat.OIL:
      case Mat.SEED:
        g.setXY(nx, ny, Mat.FIRE, this.rng.range(12, 42));
        break;
      case Mat.GUNPOWDER:
        this.explode(nx, ny, 5);
        return;
      case Mat.TNT:
        this.lightTnt(nx, ny, TNT_FUSE);
        break;
      default:
        break;
    }
    if (g.get(x, y - 1) === Mat.EMPTY && this.rng.chance(0.02)) {
      g.setXY(x, y - 1, Mat.FIRE, this.rng.range(8, 20));
    }
    this.liquid(x, y, Mat.LAVA);
  }

  private fire(x: number, y: number, i: number): void {
    const g = this.grid;
    const life = g.meta[i];
    g.chunks.wakeCell(x, y); // fire is always dynamic (anim + spread)
    if (life <= 1) {
      g.setXY(x, y, this.rng.chance(0.3) ? Mat.SMOKE : Mat.EMPTY, this.rng.range(60, 160));
      return;
    }
    g.meta[i] = life - 1;

    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    // sample every neighbor each tick - fire must reliably catch contact
    for (let d = 0; d < 4; d++) {
      const nx = x + dirs[d][0];
      const ny = y + dirs[d][1];
      const t = g.get(nx, ny);
      if (t === Mat.WATER) {
        g.setXY(x, y, Mat.EMPTY);
        if (this.rng.chance(0.4)) g.setXY(nx, ny, Mat.STEAM, this.rng.range(90, 220));
        this.events.sizzles++;
        return;
      }
      if (t === Mat.ICE) {
        g.setXY(nx, ny, Mat.WATER);
        g.setXY(x, y, Mat.EMPTY);
        return;
      }
      const td = MATS[t];
      if (td.flam > 0 && this.rng.chance(td.flam)) {
        if (t === Mat.GUNPOWDER) {
          this.explode(nx, ny, 5);
          return;
        }
        if (t === Mat.WOOD) g.setXY(nx, ny, Mat.EMBER, this.rng.range(70, 150));
        else g.setXY(nx, ny, Mat.FIRE, this.rng.range(12, 42));
        this.events.ignites++;
      }
      if (t === Mat.FUSE) {
        g.meta[g.idx(nx, ny)] = Math.max(g.meta[g.idx(nx, ny)], 6);
        g.chunks.wakeCell(nx, ny);
      }
      if (t === Mat.TNT) this.lightTnt(nx, ny, TNT_FUSE);
    }

    // stick to fuel while there is any: burning clings instead of floating off
    const nUp = g.get(x, y - 1);
    const nDown = g.get(x, y + 1);
    const nL = g.get(x - 1, y);
    const nR = g.get(x + 1, y);
    const fuelNear =
      MATS[nUp].flam > 0 || MATS[nDown].flam > 0 ||
      MATS[nL].flam > 0 || MATS[nR].flam > 0 ||
      nUp === Mat.FUSE || nDown === Mat.FUSE || nL === Mat.FUSE || nR === Mat.FUSE;

    if (!fuelNear) {
      // free-floating ember: drifts upward like a hot gas, including sideways
      const up = this.tryMoveTo(x, y, x + this.rng.int(3) - 1, y - 1, MATS[Mat.FIRE].dens);
      if (!up) {
        const dx = this.rng.int(3) - 1;
        if (dx !== 0) this.tryMoveTo(x, y, x + dx, y, MATS[Mat.FIRE].dens);
      }
    }
  }

  private fuse(x: number, y: number): void {
    const g = this.grid;
    const i = g.idx(x, y);
    const burning = g.meta[i];
    if (burning === 0) {
      if (
        g.get(x - 1, y) === Mat.FIRE || g.get(x + 1, y) === Mat.FIRE ||
        g.get(x, y - 1) === Mat.FIRE || g.get(x, y + 1) === Mat.FIRE ||
        g.get(x - 1, y) === Mat.LAVA || g.get(x + 1, y) === Mat.LAVA ||
        g.get(x, y - 1) === Mat.LAVA || g.get(x, y + 1) === Mat.LAVA ||
        g.get(x - 1, y) === Mat.EMBER || g.get(x + 1, y) === Mat.EMBER
      ) {
        g.meta[i] = 6;
        g.chunks.wakeCell(x, y);
      }
      return;
    }
    g.chunks.wakeCell(x, y); // burning fuse keeps ticking
    if (burning === 1) {
      g.setXY(x, y, Mat.FIRE, this.rng.range(10, 24));
      // fuse-lit TNT (fire alone cannot ignite it - spark or fuse only)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (g.get(x + dx, y + dy) === Mat.TNT) {
          this.explode(x + dx, y + dy, 9);
          return;
        }
      }
      return;
    }
    g.meta[i] = burning - 1;
    const spread = (sx: number, sy: number) => {
      if (g.get(sx, sy) === Mat.FUSE) {
        const si = g.idx(sx, sy);
        if (g.meta[si] < 6) {
          g.meta[si] = 6;
          g.chunks.wakeCell(sx, sy);
        }
      }
    };
    spread(x - 1, y);
    spread(x + 1, y);
    spread(x, y - 1);
    spread(x, y + 1);
  }

  private ember(x: number, y: number, i: number): void {
    const g = this.grid;
    const life = g.meta[i];
    g.chunks.wakeCell(x, y); // embers smolder until gone
    if (life <= 1) {
      // wood -> ember -> ash closes the burn chain: a fire now leaves a
      // drift of something the wind can pick up, instead of nothing at all
      const r = this.rng.next();
      if (r < 0.35) g.setXY(x, y, Mat.SMOKE, this.rng.range(60, 160));
      else if (r < 0.75) g.setXY(x, y, Mat.ASH);
      else g.setXY(x, y, Mat.EMPTY);
      return;
    }
    // half-rate decay, so embers smolder about twice as long as flame.
    // This used to gate on `life & 1`, which decremented only from an even
    // value: an ember fell to the first odd number and stuck there forever,
    // never becoming smoke and never letting its chunk sleep. Gate on the
    // frame instead, which is what "every other tick" actually means.
    if ((this.f & 1) === 0) g.meta[i] = life - 1;
    if (g.get(x, y - 1) === Mat.EMPTY && this.rng.chance(0.15)) {
      g.setXY(x, y - 1, Mat.FIRE, this.rng.range(10, 30));
    }
    if (this.adjacent(x, y, Mat.WATER)) g.setXY(x, y, Mat.EMPTY);
  }

  private ice(x: number, y: number): void {
    if (
      this.adjacent(x, y, Mat.FIRE) || this.adjacent(x, y, Mat.LAVA) ||
      this.adjacent(x, y, Mat.EMBER) || this.adjacent(x, y, Mat.SALT)
    ) {
      this.grid.setXY(x, y, Mat.WATER);
    }
  }

  // ---------- winter pack (P1) ----------

  private snow(x: number, y: number): void {
    const g = this.grid;
    // 8-dir heat/water sense: chasing melt sources are rarely 4-adjacent
    // at process time (scan-order dodge), diagonals keep the contact real
    let hot = false;
    let wet = false;
    let salty = false;
    for (let dy = -1; dy <= 1 && !hot; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const t = g.get(x + dx, y + dy);
        if (t === Mat.FIRE || t === Mat.LAVA || t === Mat.EMBER) hot = true;
        else if (t === Mat.WATER) wet = true;
        else if (t === Mat.SALT) salty = true;
      }
    }
    if (hot || wet) {
      if (this.rng.chance(0.3)) {
        g.setXY(x, y, Mat.WATER);
        return;
      }
    }
    if (salty && this.rng.chance(0.4)) {
      g.setXY(x, y, Mat.WATER);
      return;
    }
    // floaty fall: only moves ~2 of every 3 frames
    if (this.rng.chance(0.66)) this.powder(x, y, Mat.SNOW);
    else g.chunks.wakeCell(x, y);
  }

  private salt(x: number, y: number): void {
    const g = this.grid;
    // dissolves in water
    if (this.adjacent(x, y, Mat.WATER) && this.rng.chance(0.4)) {
      g.setXY(x, y, Mat.EMPTY);
      return;
    }
    // melts ice and snow on contact (salt is consumed half the time)
    const pick = this.rng.int(4);
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const nx = x + dirs[pick][0];
    const ny = y + dirs[pick][1];
    const t = g.get(nx, ny);
    if ((t === Mat.ICE || t === Mat.SNOW) && this.rng.chance(0.35)) {
      g.setXY(nx, ny, Mat.WATER);
      if (this.rng.chance(0.5)) {
        g.setXY(x, y, Mat.EMPTY);
        return;
      }
    }
    this.powder(x, y, Mat.SALT);
  }

  // ---------- electricity (F1) ----------

  private wire(x: number, y: number, i: number): void {
    const g = this.grid;
    const m = g.meta[i];
    if (m === 0) return; // idle wire sleeps (chunk-friendly)
    g.chunks.wakeCell(x, y);
    if (m === SPARK_LIFE) {
      this.sparkBurst(x, y); // leading edge of the pulse
      this.events.zaps++;
    }
    g.meta[i] = m - 1;
    // live wire continuously electrifies water resting on/next to it
    if (this.rng.chance(0.06)) {
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [dx, dy] of dirs) {
        if (g.get(x + dx, y + dy) === Mat.WATER) {
          g.setXY(x + dx, y + dy, Mat.STEAM, this.rng.range(90, 220));
          break;
        }
      }
    }
  }

  /** effects at the leading edge of a traveling spark */
  private sparkBurst(x: number, y: number): void {
    const g = this.grid;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      const t = g.get(nx, ny);
      switch (t) {
        case Mat.WIRE:
          if (g.meta[g.idx(nx, ny)] === 0) {
            g.meta[g.idx(nx, ny)] = SPARK_LIFE;
            g.chunks.wakeCell(nx, ny);
          }
          break;
        case Mat.WATER:
          if (this.rng.chance(0.25)) g.setXY(nx, ny, Mat.STEAM, this.rng.range(90, 220));
          break;
        case Mat.FUSE:
          g.meta[g.idx(nx, ny)] = Math.max(g.meta[g.idx(nx, ny)], 6);
          g.chunks.wakeCell(nx, ny);
          break;
        case Mat.GUNPOWDER:
          this.explode(nx, ny, 5);
          return;
        case Mat.TNT:
          this.explode(nx, ny, 9);
          return;
        case Mat.WOOD:
          if (this.rng.chance(0.5)) g.setXY(nx, ny, Mat.EMBER, this.rng.range(70, 150));
          break;
        case Mat.OIL:
        case Mat.PLANT:
        case Mat.SEED:
          if (this.rng.chance(0.5)) g.setXY(nx, ny, Mat.FIRE, this.rng.range(12, 42));
          break;
        default:
          break;
      }
    }
  }

  private torch(x: number, y: number): void {
    const g = this.grid;
    g.chunks.wakeCell(x, y); // torches pulse forever
    if (this.f % 3 !== 0) return;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (g.get(nx, ny) === Mat.WIRE && g.meta[g.idx(nx, ny)] === 0) {
        g.meta[g.idx(nx, ny)] = SPARK_LIFE;
        g.chunks.wakeCell(nx, ny);
      }
    }
    if (g.get(x, y - 1) === Mat.EMPTY && this.rng.chance(0.04)) {
      g.setXY(x, y - 1, Mat.FIRE, this.rng.range(10, 24));
    }
  }

  // ---------- clone & void (F2) ----------

  private clone(x: number, y: number): void {
    const g = this.grid;
    const i = g.idx(x, y);
    const stored = g.meta[i];
    if (stored === 0) {
      // capture the first interesting material that touches us
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [dx, dy] of dirs) {
        const t = g.get(x + dx, y + dy);
        if (
          t !== Mat.EMPTY && t !== Mat.WALL && t !== Mat.CLONE &&
          t !== Mat.VOID && t !== Mat.WIRE && t !== Mat.TORCH
        ) {
          g.meta[i] = t;
          g.chunks.wakeCell(x, y);
          return;
        }
      }
      // nothing to capture yet - stay hot so we notice new neighbors
      g.chunks.wakeCell(x, y);
      return;
    }
    g.chunks.wakeCell(x, y);
    if (this.f % 6 !== 0) return;
    // emit stored material into adjacent empty cells
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const pick = this.rng.int(4);
    for (let d = 0; d < 4; d++) {
      const nx = x + dirs[(pick + d) % 4][0];
      const ny = y + dirs[(pick + d) % 4][1];
      if (g.get(nx, ny) === Mat.EMPTY) {
        g.setXY(nx, ny, stored, MATS[stored].life ? this.rng.range(MATS[stored].life![0], MATS[stored].life![1]) : 0);
        return;
      }
    }
  }

  private voidCell(x: number, y: number): void {
    const g = this.grid;
    let ate = false;
    // 8 neighbors: liquids disperse across 1-cell gaps without ever resting
    // in the cell above the void, so diagonal reach is required to catch them
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        const t = g.get(nx, ny);
        if (
          t !== Mat.EMPTY && t !== Mat.WALL && t !== Mat.VOID &&
          t !== Mat.CLONE && t !== Mat.WIRE && t !== Mat.TORCH
        ) {
          g.setXY(nx, ny, Mat.EMPTY);
          ate = true;
        }
      }
    }
    // always hot: voids are rare and must notice new neighbors
    g.chunks.wakeCell(x, y);
    void ate;
  }

  private adjacent(x: number, y: number, mat: number): boolean {
    const g = this.grid;
    return (
      g.get(x - 1, y) === mat || g.get(x + 1, y) === mat ||
      g.get(x, y - 1) === mat || g.get(x, y + 1) === mat
    );
  }

  /**
   * A lit TNT cell counts down in its meta byte and blows at 1. Unlit TNT
   * (meta 0) never ticks, so a settled stack costs nothing.
   */
  private tnt(x: number, y: number, i: number): void {
    const g = this.grid;
    const left = g.meta[i];
    if (left === 0) return;
    if (left <= 1) {
      this.explode(x, y, 9);
      return;
    }
    g.meta[i] = left - 1;
    g.chunks.wakeCell(x, y);
    g.touch(x, y); // the blink is drawn from meta, so repaint every tick
  }

  /** Start (or shorten) a TNT cell's fuse. Never lengthens a running one. */
  private lightTnt(x: number, y: number, frames: number): void {
    const g = this.grid;
    if (g.get(x, y) !== Mat.TNT) return;
    const i = g.idx(x, y);
    const cur = g.meta[i];
    if (cur !== 0 && cur <= frames) return;
    if (cur === 0) this.events.fuses++;
    g.meta[i] = frames;
    g.chunks.wakeCell(x, y);
    g.touch(x, y);
  }

  explode(cx: number, cy: number, r: number): void {
    const g = this.grid;
    const r2 = r * r;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const x = cx + dx;
        const y = cy + dy;
        const t = g.get(x, y);
        if (t === 1 || t === Mat.GLASS) continue;
        // TNT caught in the outer ring is lit on a hair trigger instead of
        // erased, so a stack goes off as a rolling chain, not one pop
        if (t === Mat.TNT && d2 > r2 * 0.45) {
          this.lightTnt(x, y, this.rng.range(3, 10));
          continue;
        }
        if (d2 <= r2 * 0.45) {
          g.setXY(x, y, Mat.FIRE, this.rng.range(14, 40));
        } else if (this.rng.chance(0.75)) {
          g.setXY(x, y, this.rng.chance(0.35) ? Mat.SMOKE : Mat.EMPTY);
        }
      }
    }
    this.shake = Math.min(30, this.shake + r * 2);
    this.events.booms.push(cx, cy, r);
    // the shock front is what makes a blast read as a blast: smoke and fire
    // get thrown outward instead of politely rising from the crater
    this.wind.addBlast(cx, cy, r * 5, r * 0.22);
    g.chunks.wakeRect(cx - r - 2, cy - r - 2, cx + r + 2, cy + r + 2);
  }

  // ---------- rasterization ----------

  renderInto(pix: Uint32Array, forceFull: boolean): void {
    const g = this.grid;
    const dirty = g.chunks.dirty;
    if (forceFull) {
      pix.fill(BG);
      const n = g.W * g.H;
      for (let i = 0; i < n; i++) {
        const m = g.cells[i];
        if (m === Mat.EMPTY) continue;
        pix[i] = this.shadeCell(i, i % g.W, (i / g.W) | 0, m);
      }
      dirty.fill(0);
      return;
    }
    const W = g.W;
    const windy = this.wind.isMoving;
    for (let cy = 0; cy < CHUNKS_Y; cy++) {
      for (let cx = 0; cx < CHUNKS_X; cx++) {
        const ci = cy * CHUNKS_X + cx;
        if (!dirty[ci]) continue;
        dirty[ci] = 0;
        const x0 = cx << CHUNK_SHIFT;
        const y0 = cy << CHUNK_SHIFT;
        // the field is constant across a chunk, so sample it once per chunk
        const vx = windy ? this.wind.atX(x0, y0) : 0;
        const vy = windy ? this.wind.atY(x0, y0) : 0;
        const speed = Math.sqrt(vx * vx + vy * vy);
        const specks = speed > 0 ? Math.min(140, speed * 90) : 0;
        for (let y = y0; y < y0 + CHUNK; y++) {
          let i = y * W + x0;
          for (let x = x0; x < x0 + CHUNK; x++, i++) {
            const m = g.cells[i];
            if (m !== Mat.EMPTY) {
              pix[i] = this.shadeCell(i, x, y, m);
            } else if (specks === 0) {
              pix[i] = BG;
            } else {
              pix[i] = this.windSpeck(x, y, vx, vy, specks);
            }
          }
        }
      }
    }
  }

  /**
   * One cell's final colour: the grain's own ramp entry, then lit by what it
   * borders. Reads at most two cells up and one down/sideways - Grid.markDirty
   * repaints across chunk edges to exactly that reach, so keep them in step.
   */
  private shadeCell(i: number, x: number, y: number, m: number): number {
    const g = this.grid;
    const cells = g.cells;
    const W = g.W;
    const v = this.shadeOf(i, x, y, m, cells, W);
    const meta = g.meta[i];
    // energized wire and lit TNT leave the ramp, so they are not in the table
    if (offRamp(m, meta)) return applyShade(colorAt(m, x, y, this.f, meta), v);
    const r = GRAINY[m] ? g.shade[i] & 3 : rampIndexAt(m, x, y, this.f, meta);
    return SHADED[(((m << 2) | r) << 3) | v];
  }

  /** Which lit version (Shade.*) a cell shows, from its neighbours alone. */
  private shadeOf(i: number, x: number, y: number, m: number, cells: Uint8Array, W: number): number {
    const lit = LIT[m];
    if (lit === Lit.NONE) return Shade.BASE;
    // out of bounds counts as closed, so nothing lights up against the frame
    const openUp = y > 0 && OPEN[cells[i - W]] === 1;
    if (lit === Lit.SURFACE) {
      if (openUp) return Shade.WATERLINE;
      return y > 1 && OPEN[cells[i - 2 * W]] === 1 ? Shade.SECOND_ROW : Shade.BASE;
    }
    if (lit === Lit.TOP) return openUp ? Shade.POWDER_TOP : Shade.BASE;
    if (openUp) return Shade.SOLID_TOP;
    if (y < this.grid.H - 1 && OPEN[cells[i + W]] === 1) return Shade.UNDER;
    if (x > 0 && OPEN[cells[i - 1]] === 1) return Shade.LEFT;
    if (x < W - 1 && OPEN[cells[i + 1]] === 1) return Shade.RIGHT;
    return Shade.BASE;
  }

  /**
   * A drifting dust mote, or the background.
   *
   * Wind moves other people's material and is otherwise invisible, which
   * makes an empty room feel broken when you fan it. Rather than draw arrows
   * over the art, we sample a fixed noise field at a position that slides
   * backwards along the wind vector - the pattern is static, the sampling
   * window moves, and the eye reads the result as air travelling.
   */
  private windSpeck(x: number, y: number, vx: number, vy: number, specks: number): number {
    const drift = this.f * 0.5;
    const sx = (x - vx * drift) | 0;
    const sy = (y - vy * drift) | 0;
    return (hash2d(sx, sy) & 1023) < specks ? WIND_DUST : BG;
  }

  stats(): Stats {
    const counts: number[] = new Array(NMATS);
    for (let i = 0; i < NMATS; i++) counts[i] = this.grid.counts[i];
    const used: number[] = new Array(NMATS).fill(0);
    const budget: (number | null)[] = new Array(NMATS).fill(null);
    const ch = this.challenge;
    if (ch) {
      for (let i = 0; i < NMATS; i++) used[i] = ch.used[i];
      if (ch.def.budget) {
        for (const k of Object.keys(ch.def.budget)) {
          const mat = Number(k);
          budget[mat] = ch.def.budget[mat] ?? null;
        }
      }
    }
    return { counts, used, budget };
  }
}

/** materials that can overwrite solid cells when painted */
export const ERASES_SOLID = new Set<number>([
  Mat.WALL, Mat.ACID, Mat.WIRE, Mat.TORCH, Mat.CLONE, Mat.VOID, Mat.TNT,
]);

export type { Stats, ChallengeResult };
