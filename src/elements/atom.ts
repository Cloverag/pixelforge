import { placeOf } from '../ui/periodic';

/**
 * The ELEMENTS mode's numbers, worked out from an element's electron
 * configuration (PubChem's, in data/elements.json) and its place in the
 * table. Nothing here is drawn; atom3d.ts and the panel read it.
 */

/** One subshell: 3p⁶ is { n: 3, l: 1, e: 6 }. */
export interface Subshell {
  n: number;
  /** 0 s, 1 p, 2 d, 3 f */
  l: number;
  e: number;
}

export const L_LETTER = 'spdf';
/** the shells' letters, K for n = 1 */
export const SHELL_LETTER = 'KLMNOPQ';

/** The noble-gas cores a configuration can start from. */
const CORE_Z: Record<string, number> = { He: 2, Ne: 10, Ar: 18, Kr: 36, Xe: 54, Rn: 86 };

/** "[Ne]3s2 3p6" without its core, "(predicted)" and the like dropped. */
function ownSubshells(config: string): Subshell[] {
  const out: Subshell[] = [];
  for (const m of config.matchAll(/(\d)([spdf])(\d+)/g)) out.push({ n: Number(m[1]), l: L_LETTER.indexOf(m[2]), e: Number(m[3]) });
  return out;
}

/**
 * Every occupied subshell of an element, its noble-gas core written out.
 * `configOf` gives the configuration of an element by symbol (for the core).
 */
export function subshells(config: string, configOf: (sym: string) => string | null): Subshell[] {
  const core = /^\[([A-Z][a-z]?)\]/.exec(config);
  const own = ownSubshells(config);
  if (!core) return own;
  const coreConfig = configOf(core[1]);
  if (!coreConfig || !(core[1] in CORE_Z)) throw new Error(`unknown core ${core[1]}`);
  return [...subshells(coreConfig, configOf), ...own];
}

/** Electrons in each shell, K first: argon is [2, 8, 8]. */
export function shellCounts(subs: Subshell[]): number[] {
  const n = Math.max(0, ...subs.map((s) => s.n));
  const counts = new Array<number>(n).fill(0);
  for (const s of subs) counts[s.n - 1] += s.e;
  return counts;
}

/**
 * The subshell filled last in the Madelung order (lowest n + l first, then
 * lowest n): the one the element "adds". For copper ([Ar]4s1 3d10) it is 3d.
 * The 3D atom draws this subshell's orbitals.
 */
export function lastSubshell(subs: Subshell[]): Subshell {
  let best = subs[0];
  for (const s of subs) {
    const k = s.n + s.l;
    const kb = best.n + best.l;
    if (k > kb || (k === kb && s.n > best.n)) best = s;
  }
  return best;
}

/** "[Ne]3s2 3p6" -> "[Ne] 3s² 3p⁶", with any "(predicted)" kept. */
export function prettyConfig(config: string): string {
  const sup = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  return config
    .replace(/\](?=\d)/, '] ')
    .replace(/(\d[spdf])(\d+)/g, (_, sub: string, e: string) => sub + [...e].map((d) => sup[Number(d)]).join(''));
}

/** Period (1-7) and group (1-18; null for the lanthanides and actinides). */
export function periodGroup(z: number): { period: number; group: number | null } {
  const [col, row] = placeOf(z);
  if (row >= 9) return { period: row - 3, group: null };
  return { period: row, group: col };
}

/** The table's block: s, p, d or f, by where the element stands. */
export function blockOf(z: number): 's' | 'p' | 'd' | 'f' {
  const { group } = periodGroup(z);
  if (group === null) return 'f';
  if (z === 2 || group <= 2) return 's';
  if (group >= 13) return 'p';
  return 'd';
}

// ---- orbital shapes ----

/**
 * The real spherical harmonics up to f, as functions of a unit direction:
 * the angular part of a hydrogen-like orbital. Each entry is the orbital's
 * usual name and Y(x, y, z), normalised (∫|Y|² = 1 over the sphere).
 */
type Y = (x: number, y: number, z: number) => number;
const PI = Math.PI;
export const HARMONICS: { name: string; y: Y }[][] = [
  [{ name: 's', y: () => Math.sqrt(1 / (4 * PI)) }],
  [
    { name: 'pz', y: (_x, _y, z) => Math.sqrt(3 / (4 * PI)) * z },
    { name: 'px', y: (x) => Math.sqrt(3 / (4 * PI)) * x },
    { name: 'py', y: (_x, y) => Math.sqrt(3 / (4 * PI)) * y },
  ],
  [
    { name: 'dz²', y: (_x, _y, z) => Math.sqrt(5 / (16 * PI)) * (3 * z * z - 1) },
    { name: 'dxz', y: (x, _y, z) => Math.sqrt(15 / (4 * PI)) * x * z },
    { name: 'dyz', y: (_x, y, z) => Math.sqrt(15 / (4 * PI)) * y * z },
    { name: 'dxy', y: (x, y) => Math.sqrt(15 / (4 * PI)) * x * y },
    { name: 'dx²−y²', y: (x, y) => Math.sqrt(15 / (16 * PI)) * (x * x - y * y) },
  ],
  [
    { name: 'fz³', y: (_x, _y, z) => Math.sqrt(7 / (16 * PI)) * z * (5 * z * z - 3) },
    { name: 'fxz²', y: (x, _y, z) => Math.sqrt(21 / (32 * PI)) * x * (5 * z * z - 1) },
    { name: 'fyz²', y: (_x, y, z) => Math.sqrt(21 / (32 * PI)) * y * (5 * z * z - 1) },
    { name: 'fxyz', y: (x, y, z) => Math.sqrt(105 / (4 * PI)) * x * y * z },
    { name: 'fz(x²−y²)', y: (x, y, z) => Math.sqrt(105 / (16 * PI)) * z * (x * x - y * y) },
    { name: 'fx(x²−3y²)', y: (x, y) => Math.sqrt(35 / (32 * PI)) * x * (x * x - 3 * y * y) },
    { name: 'fy(3x²−y²)', y: (x, y) => Math.sqrt(35 / (32 * PI)) * y * (3 * x * x - y * y) },
  ],
];

/**
 * The orbitals of a subshell that hold an electron. By Hund's rule a
 * subshell fills each of its 2l + 1 orbitals singly before any pairs up, so
 * carbon's 2p² has two occupied p orbitals and argon's 3p⁶ all three.
 */
export function occupiedOrbitals(s: Subshell): { name: string; y: Y }[] {
  return HARMONICS[s.l].slice(0, Math.min(s.e, 2 * s.l + 1));
}

// ---- colour of light ----

/**
 * Wavelength (nm, 380-750) to an sRGB colour, 0-1 per channel: the usual
 * piecewise approximation of the visible spectrum (after Dan Bruton), dimmed
 * towards both ends where the eye barely sees.
 */
export function wavelengthRGB(nm: number): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  if (nm >= 380 && nm < 440) {
    r = (440 - nm) / 60;
    b = 1;
  } else if (nm < 490) {
    g = (nm - 440) / 50;
    b = 1;
  } else if (nm < 510) {
    g = 1;
    b = (510 - nm) / 20;
  } else if (nm < 580) {
    r = (nm - 510) / 70;
    g = 1;
  } else if (nm < 645) {
    r = 1;
    g = (645 - nm) / 65;
  } else if (nm <= 750) {
    r = 1;
  }
  let k = 1;
  if (nm < 420) k = 0.3 + (0.7 * (nm - 380)) / 40;
  else if (nm > 700) k = 0.3 + (0.7 * (750 - nm)) / 50;
  if (nm < 380 || nm > 750) k = 0;
  return [r * k, g * k, b * k];
}
