/**
 * Which recorded one-shots (public/sfx, Kenney, CC0 - see LICENSE.md there) play
 * for which sound. Data and three small pure functions only, so it can be tested
 * without an audio context. A slot with several files picks one at random,
 * never the one it played last, and varies the pitch a little.
 */

export type Slot = 'move' | 'select' | 'back' | 'deny' | 'click' | 'place' | 'boomS' | 'boomM' | 'boomL' | 'launch' | 'zap' | 'win' | 'lose' | 'star';

export interface SlotDef {
  files: string[];
  /** a level that brings the slot to about the loudness of the synth sound it replaces */
  gain: number;
}

export const SLOTS: Record<Slot, SlotDef> = {
  // Interface Sounds: a soft tick, a confirm, a back, a quiet error buzz, a click
  move: { files: ['tick_001', 'tick_002', 'tick_004'], gain: 0.6 },
  select: { files: ['confirmation_001', 'confirmation_003'], gain: 0.45 },
  back: { files: ['back_002', 'back_004'], gain: 0.7 },
  deny: { files: ['error_001', 'error_004'], gain: 0.45 },
  click: { files: ['click_002', 'click_003', 'click_004'], gain: 0.5 },
  // Impact Sounds: the softest thud - it fires on every brush stroke
  place: { files: ['impactSoft_medium_000', 'impactSoft_medium_002', 'impactSoft_medium_004'], gain: 0.22 },
  // Sci-Fi Sounds: three explosion sizes, a whoosh, a short zap
  boomS: { files: ['explosionCrunch_000'], gain: 0.7 },
  boomM: { files: ['explosionCrunch_001'], gain: 0.8 },
  boomL: { files: ['explosionCrunch_004'], gain: 0.9 },
  launch: { files: ['doorOpen_000', 'doorOpen_001', 'doorOpen_002'], gain: 0.55 },
  zap: { files: ['laserSmall_000', 'laserSmall_001', 'laserSmall_004'], gain: 1.2 },
  // Music Jingles (8-bit): rising ones for a win and a star, falling ones for a loss
  win: { files: ['jingles_NES05', 'jingles_NES12'], gain: 0.5 },
  lose: { files: ['jingles_NES04', 'jingles_NES07'], gain: 0.5 },
  star: { files: ['jingles_NES01', 'jingles_NES09', 'jingles_NES14'], gain: 0.5 },
};

/** Every file the slots name, once. */
export function allSampleFiles(): string[] {
  return [...new Set(Object.values(SLOTS).flatMap((s) => s.files))];
}

/** Which of `n` files to play: random, but never `last` when there is a choice. `r` is a number in [0, 1). */
export function pickNoRepeat(n: number, last: number, r: number): number {
  if (n <= 1) return 0;
  if (last < 0 || last >= n) return Math.min(n - 1, Math.floor(r * n)); // nothing to avoid yet
  const i = Math.floor(r * (n - 1)); // among the other n - 1
  return i >= last ? i + 1 : i;
}

/** A playback rate within +-5% of normal. `r` is a number in [0, 1). */
export function rateJitter(r: number): number {
  return 1 + (r * 2 - 1) * 0.05;
}

/** The explosion size for a blast of radius r (sim cells): chem flashes and bangs are 2-4, TNT is 9. */
export function boomSlot(r: number): 'boomS' | 'boomM' | 'boomL' {
  return r >= 9 ? 'boomL' : r > 3 ? 'boomM' : 'boomS';
}
