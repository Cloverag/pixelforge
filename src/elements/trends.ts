import { HARMONICS, L_LETTER, lastSubshell, periodGroup, type Subshell } from './atom';

/**
 * The ELEMENTS table's trends: colour every element by one of PubChem's
 * numbers, see what is solid, liquid or gas at a temperature, or what was
 * known by a year; and the records an element holds. Pure: screen.ts draws
 * it.
 */

/** The PubChem fields the trends read (data/elements.json). */
export interface TrendData {
  z: number;
  sym: string;
  name: string;
  block: string;
  mass: number | null;
  melt: number | null;
  boil: number | null;
  density: number | null;
  en: number | null;
  radius: number | null;
  ie: number | null;
  ea: number | null;
  year: string | null;
}

export type NumKey = 'melt' | 'boil' | 'density' | 'en' | 'radius' | 'ie' | 'ea';

export interface NumProp {
  key: NumKey;
  label: string;
  /** what a value reads as: "1337 K" */
  fmt(v: number): string;
  /** densities span six orders of magnitude (hydrogen gas to osmium): coloured on a log scale */
  log?: boolean;
  /** "highest melting point", "lowest ..." */
  most: string;
  least: string;
}

const kelvin = (v: number) => `${v < 10 ? v : Math.round(v)} K (${Math.round(v - 273.15)} °C)`;

/**
 * Where a PubChem number is not what its label says at normal pressure. The
 * panel shows the note beside the value, and no record is claimed from it.
 */
export const CAVEATS: Record<string, Partial<Record<NumKey, string>>> = {
  He: { melt: 'only under pressure: at normal pressure helium never freezes' },
  C: { melt: 'at high pressure: at normal pressure carbon sublimes, it does not melt' },
  As: { melt: 'under pressure: at normal pressure arsenic sublimes' },
};
export const NUM_PROPS: NumProp[] = [
  { key: 'melt', label: 'MELTING POINT', fmt: kelvin, most: 'highest melting point', least: 'lowest melting point' },
  { key: 'boil', label: 'BOILING POINT', fmt: kelvin, most: 'highest boiling point', least: 'lowest boiling point' },
  { key: 'density', label: 'DENSITY', fmt: (v) => `${v < 0.01 ? v.toPrecision(3) : +v.toFixed(3)} g/cm³`, log: true, most: 'densest', least: 'least dense' },
  { key: 'en', label: 'ELECTRONEGATIVITY', fmt: (v) => `${v} (Pauling)`, most: 'most electronegative', least: 'least electronegative' },
  { key: 'radius', label: 'ATOMIC RADIUS', fmt: (v) => `${v} pm`, most: 'largest atom', least: 'smallest atom' },
  { key: 'ie', label: 'IONIZATION ENERGY', fmt: (v) => `${v} eV`, most: 'highest ionization energy', least: 'lowest ionization energy' },
  { key: 'ea', label: 'ELECTRON AFFINITY', fmt: (v) => `${v} eV`, most: 'highest electron affinity', least: 'lowest electron affinity' },
];

/** Every way the table can be coloured. */
export type ColourBy = 'category' | 'block' | 'state' | 'known' | NumKey;
export const COLOUR_BY: { id: ColourBy; label: string }[] = [
  { id: 'category', label: 'CATEGORY' },
  { id: 'block', label: 'BLOCK (s p d f)' },
  { id: 'state', label: 'STATE AT A TEMPERATURE' },
  { id: 'known', label: 'KNOWN BY A YEAR' },
  ...NUM_PROPS.map((p) => ({ id: p.key, label: p.label })),
];

/** a perceptual ramp, dark violet to yellow (viridis-like), so low reads dark */
const RAMP: [number, number, number][] = [
  [0.27, 0.0, 0.33],
  [0.23, 0.32, 0.55],
  [0.13, 0.57, 0.55],
  [0.37, 0.79, 0.38],
  [0.99, 0.91, 0.14],
];

/** t in 0..1 -> '#rrggbb' along the ramp */
export function ramp(t: number): string {
  const x = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const k = x - i;
  const c = RAMP[i].map((a, j) => a + (RAMP[i + 1][j] - a) * k);
  return '#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}

/** The ramp's domain for a property: the smallest and largest known value. */
export function domain(all: TrendData[], p: NumProp): { min: number; max: number } {
  const vs = all.map((e) => e[p.key]).filter((v): v is number => v !== null && (!p.log || v > 0));
  return { min: Math.min(...vs), max: Math.max(...vs) };
}

/** Where a value sits on the ramp, 0..1 (on a log scale for density). */
export function position(v: number, d: { min: number; max: number }, log = false): number {
  if (log) return (Math.log10(v) - Math.log10(d.min)) / (Math.log10(d.max) - Math.log10(d.min));
  return (v - d.min) / (d.max - d.min);
}

export type State = 'solid' | 'liquid' | 'gas' | 'unknown';

/**
 * Solid, liquid or gas at T kelvin, by PubChem's melting and boiling points.
 * Unknown when the points needed are missing (most of the superheavies).
 */
export function stateAt(e: Pick<TrendData, 'melt' | 'boil'>, t: number): State {
  if (e.boil !== null && t >= e.boil) return 'gas';
  if (e.melt === null) return 'unknown';
  if (t < e.melt) return 'solid';
  if (e.boil === null) return 'unknown';
  return 'liquid';
}

/** The year discovered, or -Infinity for "Ancient". */
export function yearOf(e: Pick<TrendData, 'year'>): number | null {
  if (e.year === null) return null;
  if (e.year === 'Ancient') return -Infinity;
  const y = Number(e.year);
  return Number.isFinite(y) ? y : null;
}

/**
 * The records an element holds among the 118, by PubChem's numbers: "the
 * highest ionization energy of any element". Only the very top and bottom of
 * each property, and only against elements that have a value for it.
 */
export function records(e: TrendData, all: TrendData[]): string[] {
  const out: string[] = [];
  for (const p of NUM_PROPS) {
    const v = e[p.key];
    if (v === null || CAVEATS[e.sym]?.[p.key]) continue;
    // a caveated value is no record, and does not stand in the way of one
    const known = all.filter((x) => !CAVEATS[x.sym]?.[p.key]).map((x) => x[p.key]).filter((x): x is number => x !== null);
    if (known.length < 2) continue;
    if (v === Math.max(...known)) out.push(`The ${p.most} of any element: ${p.fmt(v)}.`);
    else if (v === Math.min(...known)) out.push(`The ${p.least} of any element: ${p.fmt(v)}.`);
    else if (GROUP_PROPS.includes(p.key)) {
      // otherwise the top or bottom of its own column, if the column has enough values to mean something
      const g = periodGroup(e.z).group;
      if (g === null) continue;
      const col = all
        .filter((x) => periodGroup(x.z).group === g && !CAVEATS[x.sym]?.[p.key])
        .map((x) => x[p.key])
        .filter((x): x is number => x !== null);
      if (col.length < 3) continue;
      if (v === Math.max(...col)) out.push(`The ${p.most} in group ${g}: ${p.fmt(v)}.`);
      else if (v === Math.min(...col)) out.push(`The ${p.least} in group ${g}: ${p.fmt(v)}.`);
    }
  }
  return out;
}

/** the properties also ranked within a group */
const GROUP_PROPS: NumKey[] = ['melt', 'density', 'en'];

// ---- orbital box diagrams ----

/** One subshell as boxes: each box holds 0, 1 or 2 electrons. */
export interface BoxRow {
  label: string;
  boxes: number[];
}

/** Madelung order: by n + l, then n */
const madelung = (a: Subshell, b: Subshell) => a.n + a.l - (b.n + b.l) || a.n - b.n;

/**
 * The outer orbitals as boxes: every subshell of the outermost shell, plus
 * the one filled last if it lies deeper (iron's 3d under 4s), in filling
 * order. Hund's rule: a subshell's boxes each take one electron before any
 * takes a second.
 */
export function boxRows(subs: Subshell[]): BoxRow[] {
  const top = Math.max(...subs.map((s) => s.n));
  const last = lastSubshell(subs);
  const shown = subs.filter((s) => s.n === top || s === last || (s.l >= 2 && s.e < 2 * (2 * s.l + 1)));
  return [...new Set(shown)].sort(madelung).map((s) => {
    const k = HARMONICS[s.l].length;
    const boxes = new Array<number>(k).fill(0);
    for (let i = 0; i < s.e; i++) boxes[i % k]++;
    return { label: `${s.n}${L_LETTER[s.l]}`, boxes };
  });
}
