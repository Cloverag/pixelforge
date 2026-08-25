import { RNG, hash2d } from '../core/rng';
import { Grid } from './grid';
import { Cat, MATS, Mat, NMATS, colorAt, SPARK_LIFE } from './materials';
import {
  CHUNK,
  CHUNK_SHIFT,
  CHUNKS_X,
  CHUNKS_Y,
  SIM_H,
  SIM_W,
  Stats,
  ChallengeResult,
  Mode,
} from './protocol';
import { PSys } from './particles';
import { CHALLENGES, ChallengeDef, starsFor } from './challenges';

const BG = MATS[Mat.EMPTY].ramp[0];

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
  shake = 0;
  /** total sim frames elapsed (drives animation + row hashes) */
  f = 0;

  constructor(seed = 1234567) {
    this.grid = new Grid(SIM_W, SIM_H);
    this.grid.counts[Mat.EMPTY] = SIM_W * SIM_H;
    this.rng = new RNG(seed);
    this.parts = new PSys(this.grid);
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
    this.shake = 0;
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

  paint(pts: number[], rawMat: number, size: number, kind: 'brush' | 'flood' = 'brush'): void {
    const mat = rawMat === -1 ? Mat.EMPTY : rawMat;
    if (mat < 0 || mat >= NMATS) return;
    if (kind === 'flood') {
      this.floodFill(pts[0], pts[1], mat);
      return;
    }
    const ch = this.challenge;
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
          this.grid.setXY(x, y, mat);
        }
      }
    }
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
      case Mat.FUSE:
        this.fuse(x, y);
        break;
      case Mat.EMBER:
        this.ember(x, y, i);
        break;
      case Mat.ICE:
        this.ice(x, y);
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
    if (this.tryMoveTo(x, y, x, y + 1, dens)) return;
    const first = this.rng.chance(0.5);
    const d1 = first ? 1 : -1;
    const d2 = first ? -1 : 1;
    if (this.tryMoveTo(x, y, x + d1, y + 1, dens)) return;
    if (this.tryMoveTo(x, y, x + d2, y + 1, dens)) return;
  }

  private liquid(x: number, y: number, m: number): void {
    const dens = MATS[m].dens;
    if (this.tryMoveTo(x, y, x, y + 1, dens)) return;
    const first = this.rng.chance(0.5);
    const d1 = first ? 1 : -1;
    const d2 = first ? -1 : 1;
    if (this.tryMoveTo(x, y, x + d1, y + 1, dens)) return;
    if (this.tryMoveTo(x, y, x + d2, y + 1, dens)) return;
    // horizontal dispersion: slide to farthest contiguous opening
    const disp = MATS[m].disp;
    for (const dx of [d1, d2]) {
      let tx = x;
      for (let k = 0; k < disp; k++) {
        const nx = tx + dx;
        const t = this.grid.get(nx, y);
        if (t === Mat.EMPTY || (t !== 1 && MATS[t].cat === Cat.GAS)) tx = nx;
        else break;
      }
      if (tx !== x) {
        this.grid.swap(this.grid.idx(x, y), this.grid.idx(tx, y));
        return;
      }
    }
  }

  private gasStep(x: number, y: number, m: number): void {
    const up = this.tryMoveTo(x, y, x + this.rng.int(3) - 1, y - 1, MATS[m].dens);
    if (!up) {
      const dx = this.rng.int(3) - 1;
      if (dx !== 0) this.tryMoveTo(x, y, x + dx, y, MATS[m].dens);
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
    if (
      this.adjacent(x, y, Mat.WATER)
    ) {
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
        return;
      }
    }
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
        return;
      case Mat.ICE:
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
      }
      if (t === Mat.FUSE) {
        g.meta[g.idx(nx, ny)] = Math.max(g.meta[g.idx(nx, ny)], 6);
        g.chunks.wakeCell(nx, ny);
      }
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
      g.setXY(x, y, this.rng.chance(0.4) ? Mat.SMOKE : Mat.EMPTY, this.rng.range(60, 160));
      return;
    }
    if ((life & 1) === 0) g.meta[i] = life - 1;
    if (g.get(x, y - 1) === Mat.EMPTY && this.rng.chance(0.15)) {
      g.setXY(x, y - 1, Mat.FIRE, this.rng.range(10, 30));
    }
    if (this.adjacent(x, y, Mat.WATER)) g.setXY(x, y, Mat.EMPTY);
  }

  private ice(x: number, y: number): void {
    if (
      this.adjacent(x, y, Mat.FIRE) || this.adjacent(x, y, Mat.LAVA) ||
      this.adjacent(x, y, Mat.EMBER)
    ) {
      this.grid.setXY(x, y, Mat.WATER);
    }
  }

  // ---------- electricity (F1) ----------

  private wire(x: number, y: number, i: number): void {
    const g = this.grid;
    const m = g.meta[i];
    if (m === 0) return; // idle wire sleeps (chunk-friendly)
    g.chunks.wakeCell(x, y);
    if (m === SPARK_LIFE) this.sparkBurst(x, y); // leading edge of the pulse
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
        if (d2 <= r2 * 0.45) {
          g.setXY(x, y, Mat.FIRE, this.rng.range(14, 40));
        } else if (this.rng.chance(0.75)) {
          g.setXY(x, y, this.rng.chance(0.35) ? Mat.SMOKE : Mat.EMPTY);
        }
      }
    }
    this.shake = Math.min(30, this.shake + r * 2);
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
        pix[i] = colorAt(m, i % g.W, (i / g.W) | 0, this.f, g.meta[i]);
      }
      dirty.fill(0);
      return;
    }
    const W = g.W;
    for (let cy = 0; cy < CHUNKS_Y; cy++) {
      for (let cx = 0; cx < CHUNKS_X; cx++) {
        const ci = cy * CHUNKS_X + cx;
        if (!dirty[ci]) continue;
        dirty[ci] = 0;
        const x0 = cx << CHUNK_SHIFT;
        const y0 = cy << CHUNK_SHIFT;
        for (let y = y0; y < y0 + CHUNK; y++) {
          let i = y * W + x0;
          for (let x = x0; x < x0 + CHUNK; x++, i++) {
            const m = g.cells[i];
            pix[i] = m === Mat.EMPTY ? BG : colorAt(m, x, y, this.f, g.meta[i]);
          }
        }
      }
    }
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
  Mat.WALL, Mat.ACID, Mat.WIRE, Mat.TORCH, Mat.CLONE, Mat.VOID,
]);

export type { Stats, ChallengeResult };
