import { Mat } from './materials';
import type { PSys } from './particles';
import { PG_BUMPER } from './particles';
import { SIM_H, SIM_W } from './protocol';
import type { Grid } from './grid';
import type { SurprisePlan } from './surprise';

/**
 * One-click demo scenes for the particle playground. Each one shows off a
 * different part of the toy, and keeps running by itself (emitters) so a
 * first-time visitor sees it move without having to hold the mouse.
 */
export interface PresetInfo {
  id: string;
  label: string;
  tip: string;
  /** whether the scene wants gravity on; main syncs the GRAVITY lamp */
  gravity: boolean;
}

interface Builder {
  parts: PSys;
  /** a thick straight line of material from (x0, y0) to (x1, y1) */
  line(x0: number, y0: number, x1: number, y1: number, mat: number, thick?: number): void;
  /** a filled disc */
  disc(x: number, y: number, r: number, mat: number): void;
  set(x: number, y: number, mat: number): void;
}

interface Preset extends PresetInfo {
  build(b: Builder): void;
}

const unit = (x: number, y: number): [number, number] => {
  const d = Math.hypot(x, y);
  return [x / d, y / d];
};

const PRESETS: Preset[] = [
  {
    id: 'galaxy',
    label: 'GALAXY',
    tip: 'Jets feeding a black hole: matter spirals in and vanishes',
    gravity: false,
    build({ parts }) {
      const cx = SIM_W / 2;
      const cy = SIM_H / 2;
      parts.placeForce('blackhole', cx, cy);
      // four jets on a ring, firing tangentially so the stream spirals
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2;
        parts.addEmitter({
          kind: 'jet',
          x: cx + Math.cos(a) * 112,
          y: cy + Math.sin(a) * 112,
          dx: -Math.sin(a),
          dy: Math.cos(a),
          every: 3,
          speed: 0.62,
        });
      }
    },
  },
  {
    id: 'fountains',
    label: 'FOUNTAINS',
    tip: 'A row of fountains in a basin, with fireworks overhead',
    gravity: true,
    build({ parts, line }) {
      line(60, 334, 580, 334, Mat.WALL, 3);
      line(60, 290, 60, 334, Mat.WALL, 3);
      line(580, 290, 580, 334, Mat.WALL, 3);
      for (let k = 0; k < 5; k++)
        parts.addEmitter({ kind: 'fountain', x: 120 + k * 100, y: 326, dx: 0, dy: -1, every: 1 });
      parts.addEmitter({ kind: 'firework', x: SIM_W / 2, y: 90, dx: 0, dy: 0, every: 55, spread: 420 });
    },
  },
  {
    id: 'pinball',
    label: 'PINBALL',
    tip: 'Jets ricochet off musical bumpers - every hit plays a note',
    gravity: true,
    build({ parts, line, disc }) {
      // side rails and a funnel, all bumpers
      line(8, 20, 8, 300, PG_BUMPER, 3);
      line(632, 20, 632, 300, PG_BUMPER, 3);
      line(8, 300, 270, 340, PG_BUMPER, 3);
      line(632, 300, 370, 340, PG_BUMPER, 3);
      line(90, 150, 230, 215, PG_BUMPER, 3);
      line(550, 150, 410, 215, PG_BUMPER, 3);
      // pop bumpers: small discs at different heights, so different notes
      disc(200, 95, 9, PG_BUMPER);
      disc(320, 140, 9, PG_BUMPER);
      disc(440, 95, 9, PG_BUMPER);
      disc(320, 250, 7, PG_BUMPER);
      // aimed a little upward: level, the arcs dropped onto the rails before
      // ever reaching the pop bumpers
      const [lx, ly] = unit(1, -0.32);
      parts.addEmitter({ kind: 'jet', x: 24, y: 60, dx: lx, dy: ly, every: 4, speed: 0.95 });
      parts.addEmitter({ kind: 'jet', x: 616, y: 60, dx: -lx, dy: ly, every: 4, speed: 0.95 });
    },
  },
  {
    id: 'stairs',
    label: 'MUSIC STAIRS',
    tip: 'Seven drips on seven bumper steps, each on its own beat: a tune that plays itself',
    gravity: true,
    build({ parts, line }) {
      // Seven steps down to the right; each lower step is a lower note. A
      // single stream down the stairs stalled by the fourth step - air drag
      // eats a drop's sideways speed - so each step gets its own drip, and
      // the drips run on different beats (multiples of 15 frames), which
      // makes an interlocking rhythm instead of a scale.
      const beats = [30, 45, 60, 90, 45, 60, 120];
      for (let k = 0; k < 7; k++) {
        const x = 70 + k * 72;
        const y = 70 + k * 38;
        line(x, y, x + 56, y, PG_BUMPER, 3);
        parts.addEmitter({ kind: 'jet', x: x + 28, y: y - 14, dx: 0, dy: 1, every: beats[k], speed: 0.25, life: 0.3 });
      }
    },
  },
  {
    id: 'meadow',
    label: 'MEADOW',
    tip: 'Fireflies drift over the hills around a crackling campfire',
    gravity: true,
    build({ parts, set }) {
      const hill = (x: number) => (300 + 18 * Math.sin(x / 70) + 8 * Math.sin(x / 23 + 1)) | 0;
      for (let x = 0; x < SIM_W; x++) for (let y = hill(x); y < SIM_H; y++) set(x, y, Mat.PLANT);
      for (const x of [140, 320, 500])
        parts.addEmitter({ kind: 'fireflies', x, y: hill(x) - 40, dx: 0, dy: 0, every: 12, spread: 120 });
      parts.addEmitter({ kind: 'sparkler', x: 320, y: hill(320) - 3, dx: 0, dy: -1, every: 2 });
    },
  },
  {
    id: 'loop',
    label: 'PORTAL LOOP',
    tip: 'A fountain and a jet chase each other through two pairs of portals',
    gravity: true,
    build({ parts, line }) {
      // funnel into the bottom portal, which comes out at the top
      line(190, 300, 312, 348, Mat.WALL, 2);
      line(450, 300, 328, 348, Mat.WALL, 2);
      parts.placePortal(320, 344);
      parts.placePortal(320, 30);
      parts.addEmitter({ kind: 'fountain', x: 320, y: 250, dx: 0, dy: -1, every: 1 });
      // a jet into a side portal that opens high on the right, over the funnel
      parts.placePortal(110, 180);
      // exits travelling right: placed here, its arc lands in the funnel
      parts.placePortal(190, 70);
      const [jx, jy] = unit(1, -0.12);
      parts.addEmitter({ kind: 'jet', x: 30, y: 184, dx: jx, dy: jy, every: 3, speed: 1 });
    },
  },
];

/** What the HUD and main need to know: no build functions. */
export const PRESET_INFO: PresetInfo[] = PRESETS.map(({ id, label, tip, gravity }) => ({ id, label, tip, gravity }));

function makeBuilder(grid: Grid, parts: PSys): Builder {
  const set = (x: number, y: number, mat: number) => {
    x |= 0;
    y |= 0;
    if (x >= 0 && y >= 0 && x < SIM_W && y < SIM_H) grid.setXY(x, y, mat);
  };
  const disc = (x: number, y: number, r: number, mat: number) => {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) set(x + dx, y + dy, mat);
  };
  const line = (x0: number, y0: number, x1: number, y1: number, mat: number, thick = 2) => {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    const r = Math.max(0, (thick - 1) / 2);
    for (let k = 0; k <= n; k++) {
      const x = x0 + ((x1 - x0) * k) / n;
      const y = y0 + ((y1 - y0) * k) / n;
      if (r < 0.5) set(x, y, mat);
      else disc(x, y, Math.round(r), mat);
    }
  };
  return { parts, line, disc, set };
}

/** Build preset `id` into an already cleared playground. */
export function buildPreset(id: string, grid: Grid, parts: PSys): boolean {
  const p = PRESETS.find((q) => q.id === id);
  if (!p) return false;
  parts.gravityOn = p.gravity;
  p.build(makeBuilder(grid, parts));
  return true;
}

/** Build a SURPRISE ME scene into an already cleared playground. */
export function buildSurprise(plan: SurprisePlan, grid: Grid, parts: PSys): void {
  const b = makeBuilder(grid, parts);
  parts.gravityOn = plan.gravity;
  for (const [x0, y0, x1, y1, mat, thick] of plan.lines) b.line(x0, y0, x1, y1, mat, thick);
  for (const [x, y, r, mat] of plan.discs) b.disc(x, y, r, mat);
  for (const [kind, x, y] of plan.forces) parts.placeForce(kind, x, y);
  for (const [x, y] of plan.portals) parts.placePortal(x, y);
  for (const e of plan.emitters) parts.addEmitter(e);
}
