/**
 * Time of day: where the sun and the moon are, what colour the sky is, and
 * how much light falls on the world - for any moment of the cycle.
 *
 * Pure (no GL, no clock), so the renderer asks it once a frame and the tests
 * can walk the whole day. Presentation only: it never touches a cell, so it
 * is not in the snapshot or a room, and each player's sky is their own.
 *
 * t runs 0..1 around the day: 0 sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight.
 */

export type Rgb = [number, number, number];

export interface Daylight {
  /** unit vector from a cell toward the light (the sun by day, the moon by night), +y up */
  dir: [number, number];
  /** the direct light's colour times its strength */
  sun: Rgb;
  /** light from the whole sky: what a cell in shadow still gets */
  ambient: Rgb;
  skyTop: Rgb;
  skyHorizon: Rgb;
  /** where the sun and the moon are, in screen UV (0..1, +y up); below 0 is set */
  sunPos: [number, number];
  moonPos: [number, number];
  /** 0 by day, 1 at full night: stars, and how much fire lights the world */
  night: number;
}

/** The sky modes the deck offers; 'flat' is the classic look (the SKY colours, no lighting). */
export type SkyMode = 'flat' | 'cycle' | 'day' | 'night';
export const SKY_MODES: readonly SkyMode[] = ['cycle', 'day', 'night'];

/** One full day in auto mode, in seconds: long enough to build in, short enough to see turn. */
export const DAY_SECONDS = 360;

interface Key {
  t: number;
  skyTop: Rgb;
  skyHorizon: Rgb;
  sun: Rgb;
  ambient: Rgb;
  night: number;
}

const hex = (h: number): Rgb => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

/** The day's keyframes; the sky blends between neighbours. */
const KEYS: Key[] = [
  { t: 0.0, skyTop: hex(0x2b3a6b), skyHorizon: hex(0xf2a46b), sun: [0.95, 0.62, 0.38], ambient: [0.42, 0.38, 0.46], night: 0.25 },
  { t: 0.08, skyTop: hex(0x3f6fb4), skyHorizon: hex(0xf6d2a2), sun: [1.05, 0.9, 0.7], ambient: [0.5, 0.52, 0.58], night: 0 },
  { t: 0.25, skyTop: hex(0x3d7fd6), skyHorizon: hex(0xa9d4f2), sun: [1.08, 1.04, 0.95], ambient: [0.58, 0.62, 0.7], night: 0 },
  { t: 0.42, skyTop: hex(0x3f6fb4), skyHorizon: hex(0xf6d2a2), sun: [1.05, 0.88, 0.66], ambient: [0.5, 0.5, 0.56], night: 0 },
  { t: 0.5, skyTop: hex(0x34305e), skyHorizon: hex(0xe8735a), sun: [0.92, 0.5, 0.36], ambient: [0.4, 0.32, 0.42], night: 0.3 },
  { t: 0.58, skyTop: hex(0x10142e), skyHorizon: hex(0x2e2850), sun: [0.3, 0.34, 0.48], ambient: [0.2, 0.22, 0.32], night: 0.85 },
  { t: 0.75, skyTop: hex(0x070a1c), skyHorizon: hex(0x16203e), sun: [0.34, 0.4, 0.56], ambient: [0.16, 0.18, 0.28], night: 1 },
  { t: 0.92, skyTop: hex(0x10142e), skyHorizon: hex(0x2e2850), sun: [0.3, 0.34, 0.48], ambient: [0.2, 0.22, 0.32], night: 0.85 },
  { t: 1.0, skyTop: hex(0x2b3a6b), skyHorizon: hex(0xf2a46b), sun: [0.95, 0.62, 0.38], ambient: [0.42, 0.38, 0.46], night: 0.25 },
];

const mix = (a: number, b: number, k: number) => a + (b - a) * k;
const mixRgb = (a: Rgb, b: Rgb, k: number): Rgb => [mix(a[0], b[0], k), mix(a[1], b[1], k), mix(a[2], b[2], k)];
/** smooth in and out of each keyframe, so the sky never jumps */
const ease = (k: number) => k * k * (3 - 2 * k);

/** An arc across the sky for a body that is up from `rise` to `rise + 0.5`. */
function arc(t: number, rise: number): [number, number] {
  const k = (((t - rise) % 1) + 1) % 1; // 0..1 since it rose
  if (k > 0.5) return [0.5, -1]; // set: below the horizon
  const a = k / 0.5; // 0..1 across the sky
  return [0.06 + 0.88 * a, 0.12 + 0.72 * Math.sin(Math.PI * a)];
}

export function daylightAt(tIn: number): Daylight {
  const t = ((tIn % 1) + 1) % 1;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].t <= t) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const k = ease((t - a.t) / (b.t - a.t));
  const sunPos = arc(t, 0);
  const moonPos = arc(t, 0.5);
  // the light comes from whichever is up (between them, the brighter of the two arcs)
  const up = sunPos[1] >= 0 ? sunPos : moonPos;
  const dx = up[0] - 0.5;
  const dy = Math.max(up[1], 0.12);
  const n = Math.hypot(dx, dy);
  return {
    dir: [dx / n, dy / n],
    sun: mixRgb(a.sun, b.sun, k),
    ambient: mixRgb(a.ambient, b.ambient, k),
    skyTop: mixRgb(a.skyTop, b.skyTop, k),
    skyHorizon: mixRgb(a.skyHorizon, b.skyHorizon, k),
    sunPos,
    moonPos,
    night: mix(a.night, b.night, k),
  };
}

/** The time of day a mode shows at `seconds` since the page opened. */
export function timeOfDay(mode: SkyMode, seconds: number): number {
  if (mode === 'day') return 0.22;
  if (mode === 'night') return 0.72;
  // start each visit mid-morning, not in the dark
  return (0.12 + seconds / DAY_SECONDS) % 1;
}

const SKY_KEY = 'pf-sky-mode';

/** The saved sky mode, defensively: anything unknown is the day cycle. */
export function loadSkyMode(): SkyMode {
  try {
    const v = localStorage.getItem(SKY_KEY);
    if (v === 'flat' || v === 'cycle' || v === 'day' || v === 'night') return v;
  } catch {
    /* private mode */
  }
  return 'cycle';
}

export function saveSkyMode(m: SkyMode): void {
  try {
    localStorage.setItem(SKY_KEY, m);
  } catch {
    /* private mode: it just will not persist */
  }
}
