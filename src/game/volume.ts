/**
 * Sound volumes as pure functions: three buses (master, music, effects), each
 * 0-10 and mutable, kept in localStorage as one JSON string that is parsed
 * defensively - anything invalid falls back to the defaults.
 */

export type Bus = 'master' | 'music' | 'sfx';

export interface Volumes {
  master: number;
  music: number;
  sfx: number;
  /** a muted bus keeps its level, so unmuting restores it */
  mute: { master: boolean; music: boolean; sfx: boolean };
}

export const DEFAULT_VOLUMES: Volumes = {
  master: 8,
  music: 5,
  sfx: 8,
  mute: { master: false, music: false, sfx: false },
};

export const MAX_VOLUME = 10;

/** A volume as a whole number in 0-10 (anything else becomes 0 or 10). */
export function clampVolume(v: number): number {
  return Math.max(0, Math.min(MAX_VOLUME, Math.round(v)));
}

/** The gain of a 0-10 volume: (v/10)^2, a perceptual curve (half way is a quarter of the power). */
export function gainOf(v: number): number {
  const c = clampVolume(v) / MAX_VOLUME;
  return c * c;
}

/** What a bus is set to now: its gain, or 0 while muted. */
export function busGain(v: Volumes, bus: Bus): number {
  return v.mute[bus] ? 0 : gainOf(v[bus]);
}

/** Parse the stored string: every field that is not a number (or boolean, for mutes) takes its default. */
export function parseVolumes(raw: string | null): Volumes {
  const d = DEFAULT_VOLUMES;
  let o: unknown;
  try {
    o = raw === null ? null : JSON.parse(raw);
  } catch {
    o = null;
  }
  if (typeof o !== 'object' || o === null || Array.isArray(o)) return { ...d, mute: { ...d.mute } };
  const r = o as Record<string, unknown>;
  const num = (x: unknown, dflt: number): number =>
    typeof x === 'number' && Number.isFinite(x) ? clampVolume(x) : dflt;
  const m = typeof r.mute === 'object' && r.mute !== null && !Array.isArray(r.mute) ? (r.mute as Record<string, unknown>) : {};
  const flag = (x: unknown): boolean => x === true;
  return {
    master: num(r.master, d.master),
    music: num(r.music, d.music),
    sfx: num(r.sfx, d.sfx),
    mute: { master: flag(m.master), music: flag(m.music), sfx: flag(m.sfx) },
  };
}

/** Left/Right: one step, stopping at the ends. */
export function stepVolume(v: number, d: number): number {
  return clampVolume(v + d);
}

/** Enter (mouse and touch have no Left/Right): one step up, wrapping 10 -> 0. */
export function cycleVolume(v: number): number {
  return clampVolume(v) >= MAX_VOLUME ? 0 : clampVolume(v) + 1;
}

/** A 10-cell bar for OPTIONS: ■■■■■□□□□□ */
export function volumeBar(v: number): string {
  const n = clampVolume(v);
  return '■'.repeat(n) + '□'.repeat(MAX_VOLUME - n);
}

const KEY = 'pf-volumes';

export function loadVolumes(): Volumes {
  try {
    return parseVolumes(localStorage.getItem(KEY));
  } catch {
    return parseVolumes(null);
  }
}

export function saveVolumes(v: Volumes): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* private mode: the volumes just do not persist */
  }
}
