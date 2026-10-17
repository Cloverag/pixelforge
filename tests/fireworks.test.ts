import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';

/** particle kinds, as particles.ts numbers them */
const SHELL = 7;
const WILLOW = 3;
const CROSS = 4;
const PALM = 5;
const JET = 6;

type Inside = { kind: Uint8Array; n: number };
const inside = (w: World) => w.parts as unknown as Inside;

function kinds(w: World): number[] {
  const p = inside(w);
  const c = new Array(8).fill(0);
  for (let i = 0; i < p.n; i++) c[p.kind[i]]++;
  return c;
}

function playground(seed = 3): World {
  const w = new World(seed);
  w.setMode('playground');
  return w;
}

/** frames at which a black hole flared (a size-9 boom) */
function flares(w: World, frames: number, each?: (f: number) => void): number[] {
  const at: number[] = [];
  for (let f = 0; f < frames; f++) {
    each?.(f);
    w.step();
    const b = w.takeEvents().booms;
    for (let k = 2; k < b.length; k += 3) if (b[k] === 9) at.push(f);
  }
  return at;
}

describe('firework shapes', () => {
  it('bursts come in every shape', () => {
    const w = playground();
    const seen = new Set<number>();
    for (let k = 0; k < 40; k++) {
      w.parts!.firework(100 + (k % 8) * 60, 120);
      for (const [kind, n] of kinds(w).entries()) if (n) seen.add(kind);
      w.parts!.reset();
    }
    for (const k of [SHELL, WILLOW, CROSS, PALM]) expect(seen.has(k)).toBe(true);
  });

  it('a crossette star splits into a cross of four', () => {
    const w = playground();
    // fire until a crossette comes up
    let stars = 0;
    for (let k = 0; k < 60 && stars === 0; k++) {
      w.parts!.reset();
      w.parts!.firework(320, 120);
      stars = kinds(w)[CROSS];
    }
    expect(stars).toBeGreaterThan(0);
    for (let f = 0; f < 40; f++) w.step();
    const after = kinds(w);
    expect(after[CROSS]).toBe(0);
    expect(after[SHELL]).toBe(stars * 4);
  });
});

describe('black hole flares', () => {
  it('a firework swallowed whole flares once, with jets', () => {
    const w = playground();
    w.parts!.placeForce('blackhole', 320, 180);
    w.parts!.firework(330, 180);
    let jets = 0;
    const at = flares(w, 300, () => {
      jets = Math.max(jets, kinds(w)[JET]);
    });
    expect(at.length).toBe(1);
    expect(jets).toBeGreaterThan(50);
  });

  it('a scene that feeds its black hole all the time does not flare', () => {
    const w = playground();
    w.loadPreset('galaxy');
    expect(flares(w, 1800)).toEqual([]);
  });

  it('a firework into a well-fed black hole still flares', () => {
    const w = playground();
    w.loadPreset('galaxy');
    const at = flares(w, 1300, (f) => {
      if (f !== 900) return;
      const h = w.parts!.forces.find((q) => q.kind === 'hole')!;
      w.parts!.firework(h.x + 20, h.y);
    });
    expect(at.length).toBe(1);
    expect(at[0]).toBeGreaterThanOrEqual(900);
  });

  it('a player who joins during the cooldown does not flare early', () => {
    // the hole has just flared and is cooling down; a joiner must know that,
    // or the next firework makes their hole flare when the host's does not
    const host = playground();
    host.parts!.placeForce('blackhole', 320, 180);
    host.parts!.firework(330, 180);
    expect(flares(host, 60).length).toBe(1);
    const guest = new World(99);
    guest.restore(host.snapshot());
    const again = (w: World) => (f: number) => {
      if (f === 5) w.parts!.firework(330, 180);
    };
    const h = flares(host, 200, again(host));
    const g = flares(guest, 200, again(guest));
    expect(g).toEqual(h);
  });
});
