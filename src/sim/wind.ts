import { ChunkSys } from './grid';
import { CHUNK, CHUNK_SHIFT, CHUNKS_X, CHUNKS_Y } from './protocol';

/**
 * A coarse velocity field laid over the cell grid.
 *
 * Falling sand is normally purely local: a cell only ever looks at its
 * neighbours, so nothing can push a plume of smoke sideways across the map or
 * fan a fire downwind. The wind field is the one piece of global state that
 * gets to do that.
 *
 * It is stored at chunk resolution (80x45, not 640x360) for two reasons: it is
 * 200x cheaper to decay and diffuse, and it maps 1:1 onto the chunk-sleep
 * bitmap, so a live gust can wake exactly the chunks it is blowing through
 * and nothing else. A still field costs one `active === 0` check per frame.
 */

/** Below this, a gust is spent and gets flushed to zero. */
const CUTOFF = 0.06;
/** Per-frame velocity retained. Roughly a 3s tail on a hard gust. */
const DECAY = 0.972;
/** Share of a cell's velocity handed to its four neighbours each frame. */
const SPREAD = 0.12;

export class Wind {
  private vx = new Float32Array(CHUNKS_X * CHUNKS_Y);
  private vy = new Float32Array(CHUNKS_X * CHUNKS_Y);
  private tx = new Float32Array(CHUNKS_X * CHUNKS_Y);
  private ty = new Float32Array(CHUNKS_X * CHUNKS_Y);
  /** number of field cells above CUTOFF; 0 means the whole system is free */
  private active = 0;

  get isMoving(): boolean {
    return this.active > 0;
  }

  clear(): void {
    this.vx.fill(0);
    this.vy.fill(0);
    this.active = 0;
  }

  /**
   * Adds a gust centred on a cell coordinate, falling off to nothing at
   * `radius`. `dx`/`dy` are in cells-per-frame at the centre.
   */
  addGust(cx: number, cy: number, dx: number, dy: number, radius: number): void {
    const fx = cx / CHUNK;
    const fy = cy / CHUNK;
    const fr = Math.max(1, radius / CHUNK);
    const fr2 = fr * fr;
    const x0 = Math.max(0, Math.floor(fx - fr));
    const x1 = Math.min(CHUNKS_X - 1, Math.ceil(fx + fr));
    const y0 = Math.max(0, Math.floor(fy - fr));
    const y1 = Math.min(CHUNKS_Y - 1, Math.ceil(fy + fr));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const ddx = x + 0.5 - fx;
        const ddy = y + 0.5 - fy;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 > fr2) continue;
        const fall = 1 - Math.sqrt(d2) / fr;
        const i = y * CHUNKS_X + x;
        this.vx[i] += dx * fall;
        this.vy[i] += dy * fall;
      }
    }
    this.active = this.vx.length; // recounted by the next step()
  }

  /** A blast pushes outward from its centre in every direction. */
  addBlast(cx: number, cy: number, radius: number, strength: number): void {
    const fx = cx / CHUNK;
    const fy = cy / CHUNK;
    const fr = Math.max(1, radius / CHUNK);
    const fr2 = fr * fr;
    const x0 = Math.max(0, Math.floor(fx - fr));
    const x1 = Math.min(CHUNKS_X - 1, Math.ceil(fx + fr));
    const y0 = Math.max(0, Math.floor(fy - fr));
    const y1 = Math.min(CHUNKS_Y - 1, Math.ceil(fy + fr));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const ddx = x + 0.5 - fx;
        const ddy = y + 0.5 - fy;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 > fr2 || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const fall = (1 - d / fr) * strength;
        const i = y * CHUNKS_X + x;
        this.vx[i] += (ddx / d) * fall;
        this.vy[i] += (ddy / d) * fall;
      }
    }
    this.active = this.vx.length;
  }

  /**
   * Decays and diffuses the field, then wakes every chunk still carrying a
   * gust so settled material downwind gets a chance to move.
   */
  step(chunks: ChunkSys): void {
    if (this.active === 0) return;
    const { vx, vy, tx, ty } = this;
    let live = 0;

    for (let y = 0; y < CHUNKS_Y; y++) {
      const row = y * CHUNKS_X;
      for (let x = 0; x < CHUNKS_X; x++) {
        const i = row + x;
        let ax = vx[i];
        let ay = vy[i];
        // 4-neighbour diffusion, clamped at the walls so gusts pile up
        // against the edge of the world instead of leaking out of it
        const l = x > 0 ? i - 1 : i;
        const r = x < CHUNKS_X - 1 ? i + 1 : i;
        const u = y > 0 ? i - CHUNKS_X : i;
        const d = y < CHUNKS_Y - 1 ? i + CHUNKS_X : i;
        ax += (vx[l] + vx[r] + vx[u] + vx[d] - 4 * ax) * SPREAD;
        ay += (vy[l] + vy[r] + vy[u] + vy[d] - 4 * ay) * SPREAD;
        ax *= DECAY;
        ay *= DECAY;
        if (ax * ax + ay * ay < CUTOFF * CUTOFF) {
          tx[i] = 0;
          ty[i] = 0;
        } else {
          tx[i] = ax;
          ty[i] = ay;
          live++;
          chunks.wakeCell(x << CHUNK_SHIFT, y << CHUNK_SHIFT);
          // dirty is normally only set by a cell write, but a windy chunk
          // has to repaint every frame or its drifting specks freeze
          chunks.dirty[i] = 1;
        }
      }
    }

    this.vx = tx;
    this.vy = ty;
    this.tx = vx;
    this.ty = vy;
    this.active = live;
  }

  /** Horizontal velocity at a cell coordinate. */
  atX(x: number, y: number): number {
    if (this.active === 0) return 0;
    return this.vx[(y >> CHUNK_SHIFT) * CHUNKS_X + (x >> CHUNK_SHIFT)];
  }

  /** Vertical velocity at a cell coordinate. Positive is downward. */
  atY(x: number, y: number): number {
    if (this.active === 0) return 0;
    return this.vy[(y >> CHUNK_SHIFT) * CHUNKS_X + (x >> CHUNK_SHIFT)];
  }

  /**
   * Turns a velocity component into a -1/0/+1 nudge.
   *
   * The sim moves in whole cells, so a velocity of 0.3 has to become "a 30%
   * chance of one cell" rather than a third of a cell. `roll` is the caller's
   * random draw in [0,1), passed in so the world keeps its single seeded RNG.
   */
  static nudge(v: number, susceptibility: number, roll: number): number {
    const a = v * susceptibility;
    if (a === 0) return 0;
    const mag = Math.min(1, Math.abs(a));
    if (roll >= mag) return 0;
    return a > 0 ? 1 : -1;
  }
}
