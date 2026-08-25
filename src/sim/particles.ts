import { RNG } from '../core/rng';
import { Mat } from './materials';
import { SIM_H, SIM_W, PgToolMsg } from './protocol';

const CAP = 24000;
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

/** vivid playground palette */
const HUES = [
  '#ff4b5c', '#ff8f3f', '#ffd93f', '#a8e63f', '#3fe86c', '#3fe8c8',
  '#3fb4ff', '#6b6bff', '#a83fff', '#e33fff', '#ff3fa8', '#ffffff',
].map(u32);

export const PG_BG = u32('#0b0b14');

export class PSys {
  private n = 0;
  private px = new Float32Array(CAP);
  private py = new Float32Array(CAP);
  private vx = new Float32Array(CAP);
  private vy = new Float32Array(CAP);
  private life = new Float32Array(CAP);
  private hue = new Uint8Array(CAP);
  private rng = new RNG(987654321);

  forces: Force[] = [];
  gravityOn = true;

  constructor(private grid: import('./grid').Grid) {}

  reset(): void {
    this.n = 0;
    this.forces.length = 0;
  }

  get count(): number {
    return this.n;
  }

  private push(x: number, y: number, vx: number, vy: number, life: number): void {
    if (this.n >= CAP) return;
    const i = this.n++;
    this.px[i] = x;
    this.py[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = life;
    this.hue[i] = this.rng.int(HUES.length);
  }

  fountain(x: number, y: number): void {
    for (let k = 0; k < 4; k++) {
      const a = -Math.PI / 2 + (this.rng.next() - 0.5) * 1.1;
      const sp = 1.5 + this.rng.next() * 2.5;
      this.push(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 90 + this.rng.range(30, 90));
    }
  }

  firework(x: number, y: number): void {
    const count = 110 + this.rng.int(50);
    const baseHue = this.rng.int(HUES.length);
    for (let k = 0; k < count; k++) {
      const a = this.rng.next() * Math.PI * 2;
      const sp = 0.6 + this.rng.next() * 3.4;
      let i: number;
      if (this.n < CAP) i = this.n++;
      else i = this.rng.int(CAP);
      this.px[i] = x;
      this.py[i] = y;
      this.vx[i] = Math.cos(a) * sp;
      this.vy[i] = Math.sin(a) * sp;
      this.life[i] = 50 + this.rng.range(20, 70);
      this.hue[i] = this.rng.chance(0.7) ? baseHue : (baseHue + 6) % HUES.length;
    }
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
    this.vx[i] = this.vx[last];
    this.vy[i] = this.vy[last];
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
        if (msg.phase === 'down') this.firework(msg.x, msg.y);
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

  /** decay trails -> integrate -> rasterize heads */
  fullRender(pix: Uint32Array, forceFull: boolean, frame: number): void {
    if (forceFull) pix.fill(PG_BG);

    // trail decay
    const nPx = SIM_W * SIM_H;
    for (let i = 0; i < nPx; i++) {
      const c = pix[i];
      if (c === PG_BG) continue;
      const r = ((c & 255) * 238) >> 8;
      const g = (((c >>> 8) & 255) * 238) >> 8;
      const b = (((c >>> 16) & 255) * 238) >> 8;
      pix[i] = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
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
      let col = HUES[this.hue[i]];
      if (fade < 1) {
        const r = ((col & 255) * fade) | 0;
        const gr = (((col >>> 8) & 255) * fade) | 0;
        const b = (((col >>> 16) & 255) * fade) | 0;
        col = ((255 << 24) | (b << 16) | (gr << 8) | r) >>> 0;
      }
      pix[idx] = col;
      const v2 = this.vx[i] * this.vx[i] + this.vy[i] * this.vy[i];
      if (v2 > 4) {
        const mx = (x - this.vx[i] * 0.5) | 0;
        const my = (y - this.vy[i] * 0.5) | 0;
        if (mx >= 0 && my >= 0 && mx < SIM_W && my < SIM_H)
          pix[my * SIM_W + mx] = col;
      }
    }

    // force markers
    const mA = u32('#6ef0e0');
    const mR = u32('#f06e9e');
    const mV = u32('#c9f06e');
    for (const f of this.forces) {
      const col = f.kind === 'attract' ? mA : f.kind === 'repel' ? mR : mV;
      const rr = 3;
      for (let dy = -rr; dy <= rr; dy++)
        for (let dx = -rr; dx <= rr; dx++) {
          if (Math.abs(dx) + Math.abs(dy) > rr) continue;
          const x = (f.x + dx) | 0;
          const y = (f.y + dy) | 0;
          if (x < 0 || y < 0 || x >= SIM_W || y >= SIM_H) continue;
          pix[y * SIM_W + x] = col;
        }
    }

    void frame;
  }
}
