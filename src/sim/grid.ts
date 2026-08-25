import { CHUNK, CHUNK_SHIFT, CHUNKS_X, CHUNKS_Y } from './protocol';
import { Mat, NMATS } from './materials';

/** materials that must tick every frame regardless of chunk activity */
const ETERNAL_MATS = new Set<number>([Mat.TORCH, Mat.VOID, Mat.CLONE]);

export class ChunkSys {
  /** chunks to simulate next frame */
  private nxt: Uint8Array;
  /** chunks simulated this frame */
  act: Uint8Array;
  /** chunks needing pixel repaint */
  dirty: Uint8Array;
  /** active chunk indices sorted bottom-up */
  list: number[] = [];

  constructor() {
    const n = CHUNKS_X * CHUNKS_Y;
    this.nxt = new Uint8Array(n);
    this.act = new Uint8Array(n);
    this.dirty = new Uint8Array(n);
  }

  wakeCell(x: number, y: number): void {
    const cx = x >> CHUNK_SHIFT;
    const cy = y >> CHUNK_SHIFT;
    if (cx < 0 || cy < 0 || cx >= CHUNKS_X || cy >= CHUNKS_Y) return;
    this.nxt[cy * CHUNKS_X + cx] = 1;
  }

  wakeRect(x0: number, y0: number, x1: number, y1: number): void {
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(x1, CHUNKS_X * CHUNK - 1);
    y1 = Math.min(y1, CHUNKS_Y * CHUNK - 1);
    for (let y = y0 >> CHUNK_SHIFT; y <= y1 >> CHUNK_SHIFT; y++)
      for (let x = x0 >> CHUNK_SHIFT; x <= x1 >> CHUNK_SHIFT; x++)
        this.nxt[y * CHUNKS_X + x] = 1;
  }

  wakeAll(): void {
    this.nxt.fill(1);
  }

  beginFrame(): void {
    const tmp = this.act;
    this.act = this.nxt;
    this.nxt = tmp;
    this.nxt.fill(0);
    this.list.length = 0;
    // bottom-up rows, left-to-right within a row
    for (let cy = CHUNKS_Y - 1; cy >= 0; cy--) {
      for (let cx = 0; cx < CHUNKS_X; cx++) {
        if (this.act[cy * CHUNKS_X + cx]) this.list.push(cy * CHUNKS_X + cx);
      }
    }
  }

  /** Active chunks wake their 8-chunk halo for the next frame.
   *  Without this, settled material beside an active region (e.g. water
   *  waiting to flow into a void drain) sleeps forever: its chunk only
   *  wakes on writes to itself, and no write will ever come. */
  spreadHalo(): void {
    for (let ci = 0; ci < this.act.length; ci++) {
      if (!this.act[ci]) continue;
      const cx = ci % CHUNKS_X;
      const cy = (ci / CHUNKS_X) | 0;
      const x0 = Math.max(0, cx - 1);
      const x1 = Math.min(CHUNKS_X - 1, cx + 1);
      const y0 = Math.max(0, cy - 1);
      const y1 = Math.min(CHUNKS_Y - 1, cy + 1);
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++)
          this.nxt[y * CHUNKS_X + x] = 1;
    }
  }
}

export class Grid {
  cells: Uint8Array;
  meta: Uint8Array;
  /** per-frame "already updated" flag */
  clock: Uint8Array;
  counts = new Int32Array(NMATS);
  chunks: ChunkSys;
  /** indices of eternal cells - woken every frame by the world */
  eternals = new Set<number>();

  constructor(public W: number, public H: number) {
    const n = W * H;
    this.cells = new Uint8Array(n);
    this.meta = new Uint8Array(n);
    this.clock = new Uint8Array(n);
    this.chunks = new ChunkSys();
  }

  idx(x: number, y: number): number {
    return y * this.W + x;
  }

  /** Out of bounds reads as WALL so particles stop at edges. */
  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return 1;
    return this.cells[y * this.W + x];
  }

  metaAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return 0;
    return this.meta[y * this.W + x];
  }

  /** Write a cell: updates counts, wakes sim + render chunks. */
  setXY(x: number, y: number, mat: number, metaVal = 0): void {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return;
    this.setI(y * this.W + x, mat, metaVal);
  }

  setI(i: number, mat: number, metaVal = 0): void {
    const old = this.cells[i];
    if (old === mat) {
      if (metaVal !== 0 && mat !== 0) this.meta[i] = metaVal;
      return;
    }
    this.counts[old]--;
    this.counts[mat]++;
    this.cells[i] = mat;
    this.meta[i] = metaVal;
    if (ETERNAL_MATS.has(mat)) this.eternals.add(i);
    if (ETERNAL_MATS.has(old)) this.eternals.delete(i);
    const W = this.W;
    const y = (i / W) | 0;
    const x = i - y * W;
    this.chunks.wakeCell(x, y);
    this.chunks.dirty[(y >> CHUNK_SHIFT) * CHUNKS_X + (x >> CHUNK_SHIFT)] = 1;
  }

  clearEternals(): void {
    this.eternals.clear();
  }

  /** rescan the grid after a bulk load that bypassed setI */
  rebuildEternals(): void {
    this.eternals.clear();
    for (let i = 0; i < this.cells.length; i++)
      if (ETERNAL_MATS.has(this.cells[i])) this.eternals.add(i);
  }

  /** Swap contents of two cells. Pure move: counts unchanged. Clocks swap too,
   *  so a particle that moves into not-yet-scanned territory isn't updated twice. */
  swap(a: number, b: number): void {
    const ca = this.cells[a], cb = this.cells[b];
    const ma = this.meta[a], mb = this.meta[b];
    const ka = this.clock[a], kb = this.clock[b];
    this.cells[a] = cb; this.cells[b] = ca;
    this.meta[a] = mb; this.meta[b] = ma;
    this.clock[a] = kb; this.clock[b] = ka;
    const W = this.W;
    const ay = (a / W) | 0, ax = a - ay * W;
    const by = (b / W) | 0, bx = b - by * W;
    this.chunks.wakeCell(ax, ay);
    this.chunks.wakeCell(bx, by);
    this.chunks.dirty[(ay >> CHUNK_SHIFT) * CHUNKS_X + (ax >> CHUNK_SHIFT)] = 1;
    this.chunks.dirty[(by >> CHUNK_SHIFT) * CHUNKS_X + (bx >> CHUNK_SHIFT)] = 1;
  }
}
