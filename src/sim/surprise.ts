import { RNG } from '../core/rng';
import { Mat } from './materials';
import type { Emitter } from './particles';
import { PG_BUMPER } from './particles';
import { SIM_H, SIM_W } from './protocol';

/**
 * SURPRISE ME: a new playground scene from a seed, every click.
 *
 * Pure random placement makes mush, so each surprise picks one of a few
 * archetypes (orbit, cascade, festival, storm) and randomises inside it.
 * The result is a plain data plan, deterministic for its seed: main reads
 * it for the name and gravity, the worker builds the same plan, and the
 * tests can check hundreds of seeds for scenes that die or start broken.
 */
export interface SurprisePlan {
  name: string;
  gravity: boolean;
  /** [x0, y0, x1, y1, material, thickness] */
  lines: [number, number, number, number, number, number][];
  /** [x, y, r, material] */
  discs: [number, number, number, number][];
  emitters: Omit<Emitter, 't'>[];
  forces: ['attractor' | 'repulsor' | 'vortex' | 'blackhole', number, number][];
  /** portal clicks in order: each consecutive two form a pair */
  portals: [number, number][];
}

const ADJ = ['NEON', 'COSMIC', 'LUNAR', 'ELECTRIC', 'VELVET', 'SOLAR', 'GHOST', 'CRYSTAL', 'MIDNIGHT', 'GOLDEN', 'PRISM', 'ECHO'];
const NOUNS: Record<Archetype, string[]> = {
  orbit: ['ORBIT', 'WHIRLPOOL', 'NEBULA', 'MAELSTROM', 'HALO'],
  cascade: ['CASCADE', 'MUSIC BOX', 'CHIMES', 'WATERFALL', 'XYLOPHONE'],
  festival: ['FESTIVAL', 'PARADE', 'CARNIVAL', 'NIGHT', 'FIESTA'],
  storm: ['STORM', 'TANGLE', 'RIOT', 'MACHINE', 'KALEIDOSCOPE'],
};

type Archetype = 'orbit' | 'cascade' | 'festival' | 'storm';
const ARCHETYPES: Archetype[] = ['orbit', 'cascade', 'festival', 'storm'];

const unit = (x: number, y: number): [number, number] => {
  const d = Math.hypot(x, y) || 1;
  return [x / d, y / d];
};

export function planSurprise(seed: number): SurprisePlan {
  const r = new RNG(seed);
  const pick = <T>(a: readonly T[]): T => a[r.int(a.length)];
  const arch = pick(ARCHETYPES);
  const plan: SurprisePlan = {
    name: `${pick(ADJ)} ${pick(NOUNS[arch])}`,
    gravity: true,
    lines: [],
    discs: [],
    emitters: [],
    forces: [],
    portals: [],
  };
  const jet = (x: number, y: number, dx: number, dy: number, every: number, speed: number, life?: number) => {
    const [ux, uy] = unit(dx, dy);
    plan.emitters.push({ kind: 'jet', x, y, dx: ux, dy: uy, every, speed, life });
  };

  if (arch === 'orbit') {
    // one or two attractors of matter, fed by tangential jets
    plan.gravity = false;
    const holes = r.chance(0.35) ? 2 : 1;
    const centres: [number, number][] =
      holes === 1 ? [[SIM_W / 2 + r.range(-80, 80), SIM_H / 2 + r.range(-40, 40)]] : [[200, 180], [440, 180]];
    for (const [cx, cy] of centres) {
      plan.forces.push([r.chance(0.7) ? 'blackhole' : 'vortex', cx, cy]);
      const arms = r.range(2, holes === 1 ? 6 : 4);
      const radius = r.range(70, holes === 1 ? 125 : 95);
      const spin = r.chance(0.5) ? 1 : -1;
      const phase = r.next() * Math.PI * 2;
      for (let k = 0; k < arms; k++) {
        const a = phase + (k / arms) * Math.PI * 2;
        jet(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, -Math.sin(a) * spin, Math.cos(a) * spin, r.range(2, 5), 0.5 + r.next() * 0.25);
      }
    }
    if (r.chance(0.5)) plan.emitters.push({ kind: 'fireflies', x: SIM_W / 2, y: 60, dx: 0, dy: 0, every: 14, spread: 500 });
  } else if (arch === 'cascade') {
    // musical bumper bars at random heights, each with its own drip, and
    // sometimes a portal that carries the falling water back up
    const bars = r.range(4, 9);
    const used: number[] = [];
    for (let k = 0; k < bars; k++) {
      const x = 40 + ((k + 0.5) / bars) * (SIM_W - 120) + r.range(-12, 12);
      let y = r.range(70, 300);
      // keep bars from stacking on top of one another
      for (let tries = 0; tries < 6 && used.some((u) => Math.abs(u - y) < 18); tries++) y = r.range(70, 300);
      used.push(y);
      const w = r.range(36, 64);
      plan.lines.push([x, y, x + w, y, PG_BUMPER, 3]);
      const beat = pick([30, 45, 60, 90, 120]);
      jet(x + w / 2, y - 14, 0, 1, beat, 0.25, 0.3);
    }
    // Always a stream raining across the bars: drips alone sound busy but
    // look empty (25 of 200 cascades measured under 40 particles on screen).
    const from = r.chance(0.5) ? 1 : -1;
    jet(SIM_W / 2 - from * 260, 24, from * 0.8, 0.15, r.range(5, 9), 0.6, 1.5);
    if (r.chance(0.5)) plan.emitters.push({ kind: 'fireflies', x: SIM_W / 2, y: 50, dx: 0, dy: 0, every: 14, spread: 500 });
  } else if (arch === 'festival') {
    // fountains and sparklers on a floor, fireworks above
    const floor = r.range(318, 340);
    plan.lines.push([30, floor, SIM_W - 30, floor, r.chance(0.4) ? PG_BUMPER : Mat.WALL, 3]);
    const n = r.range(2, 6);
    for (let k = 0; k < n; k++) {
      const x = 60 + ((k + 0.5) / n) * (SIM_W - 120);
      plan.emitters.push(
        r.chance(0.7)
          ? { kind: 'fountain', x, y: floor - 8, dx: 0, dy: -1, every: 1 }
          : { kind: 'sparkler', x, y: floor - 6, dx: 0, dy: -1, every: 2 },
      );
    }
    plan.emitters.push({ kind: 'firework', x: SIM_W / 2, y: r.range(70, 130), dx: 0, dy: 0, every: r.range(35, 80), spread: 440 });
    if (r.chance(0.4)) plan.emitters.push({ kind: 'fireflies', x: SIM_W / 2, y: 100, dx: 0, dy: 0, every: 16, spread: 500 });
  } else {
    // storm: a bit of everything, kept apart
    plan.gravity = r.chance(0.7);
    const nf = r.range(1, 3);
    for (let k = 0; k < nf; k++)
      plan.forces.push([pick(['attractor', 'repulsor', 'vortex', 'blackhole'] as const), r.range(120, 520), r.range(90, 270)]);
    const ne = r.range(2, 5);
    for (let k = 0; k < ne; k++) {
      const edge = r.int(3); // left, right, top
      const x = edge === 0 ? 24 : edge === 1 ? SIM_W - 24 : r.range(80, 560);
      const y = edge === 2 ? 24 : r.range(40, 240);
      const tx = SIM_W / 2 + r.range(-120, 120);
      const ty = SIM_H / 2 + r.range(-80, 40);
      jet(x, y, tx - x, ty - y, r.range(2, 5), 0.6 + r.next() * 0.4);
    }
    const nd = r.range(0, 5);
    for (let k = 0; k < nd; k++) plan.discs.push([r.range(80, 560), r.range(80, 320), r.range(5, 10), PG_BUMPER]);
    if (r.chance(0.5)) {
      plan.portals.push([r.range(60, 200), r.range(260, 330)]);
      plan.portals.push([r.range(440, 580), r.range(40, 120)]);
    }
  }

  clearOfHoles(plan);
  return plan;
}

/**
 * Nothing may sit where a black hole would swallow it at once: an emitter
 * inside one never shows a single particle. Moves such emitters outward
 * and keeps every emitter on screen. (No archetype places one that close
 * today; this keeps a future tweak from producing a dead scene.)
 */
export function clearOfHoles(plan: SurprisePlan): void {
  for (const e of plan.emitters) {
    for (const [kind, fx, fy] of plan.forces) {
      if (kind !== 'blackhole') continue;
      const d = Math.hypot(e.x - fx, e.y - fy);
      if (d < 45) {
        const [ux, uy] = d > 0 ? [(e.x - fx) / d, (e.y - fy) / d] : [1, 0];
        e.x = fx + ux * 45;
        e.y = fy + uy * 45;
      }
    }
    e.x = Math.max(6, Math.min(SIM_W - 6, e.x));
    e.y = Math.max(6, Math.min(SIM_H - 6, e.y));
  }
}
