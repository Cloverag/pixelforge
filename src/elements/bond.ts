import type { BondPicture, PairTags, Tag } from './atom3d';

/**
 * The ELEMENTS mode's BOND view: what two elements do together. Pure: the
 * screen draws it.
 *
 * The kind of bond comes from the electronegativity gap, Δχ (Pauling's
 * scale, PubChem's values): at 1.7 or more one atom takes electrons from the
 * other (ionic), from 0.4 a shared pair sits nearer one atom (polar
 * covalent), below that it is shared about evenly. A rule of thumb, and said
 * so: real bonds run on a scale between covalent and ionic. Two metals pool
 * their outer electrons (metallic); a noble gas, with only oxidation state 0
 * in PubChem's list, is given no partner.
 *
 * The compounds are the ones scripts/fetch-bonds.mjs predicted from
 * PubChem's oxidation states and found in PubChem (data/bonds.json).
 */

export interface BondElement {
  z: number;
  sym: string;
  name: string;
  block: string;
  en: number | null;
  ox: string | null;
}

/** One compound of two elements, as PubChem has it. */
export interface Compound {
  /** the formula as written: positive element first, NaCl, CO2, CH4 */
  f: string;
  /** PubChem's title */
  name: string;
  cid: number;
  /** the strongest bond between the two elements in PubChem's structure; 0: drawn as ions */
  o: number;
  /** the charge on each element's atoms in that structure, in pair order (lower Z first) */
  q: [number, number];
}

export type BondKind = 'ionic' | 'polar' | 'nonpolar' | 'metallic' | 'none' | 'unknown';

export const IONIC_DX = 1.7;
export const POLAR_DX = 0.4;

const METALS = new Set(['Alkali metal', 'Alkaline earth metal', 'Transition metal', 'Post-transition metal', 'Lanthanide', 'Actinide']);
export const isMetal = (e: BondElement): boolean => METALS.has(e.block);

export const KIND_LABEL: Record<BondKind, string> = {
  ionic: 'IONIC',
  polar: 'POLAR COVALENT',
  nonpolar: 'NONPOLAR COVALENT',
  metallic: 'METALLIC',
  none: 'NO BOND',
  unknown: 'UNKNOWN',
};

/** each kind's colour: its badge in the panel, its zone on the Δχ bar */
export const KIND_TINT: Record<BondKind, string> = {
  ionic: '#ff8a5c',
  polar: '#ffc65c',
  nonpolar: '#8cf06a',
  metallic: '#b99cff',
  none: '#7c82b8',
  unknown: '#7c82b8',
};

/** PubChem's oxidation states as numbers: "+4, +2, -4" -> [4, 2, -4]; 0 left out */
export function oxStates(e: BondElement): number[] {
  return (e.ox ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n !== 0);
}

/** the gap in electronegativity, or null when either value is missing */
export function deltaChi(a: BondElement, b: BondElement): number | null {
  if (a.en === null || b.en === null) return null;
  return Math.round(Math.abs(a.en - b.en) * 100) / 100;
}

export function bondKind(a: BondElement, b: BondElement): BondKind {
  if (a.block === 'Noble gas' || b.block === 'Noble gas') return 'none';
  if (isMetal(a) && isMetal(b)) return 'metallic';
  const d = deltaChi(a, b);
  if (d === null) return 'unknown';
  return d >= IONIC_DX ? 'ionic' : d >= POLAR_DX ? 'polar' : 'nonpolar';
}

/** The pair in drawing order: the less electronegative on the left (it gives, or holds the δ+ end). */
export function ordered<T extends BondElement>(a: T, b: T): [T, T] {
  return a.en !== null && b.en !== null && b.en < a.en ? [b, a] : [a, b];
}

/** data/bonds.json's key for a pair: the symbols, lower Z first */
export const pairKey = (a: BondElement, b: BondElement): string => (a.z <= b.z ? `${a.sym}-${b.sym}` : `${b.sym}-${a.sym}`);

const SUB = '₀₁₂₃₄₅₆₇₈₉';
/** "Al2O3" -> "Al₂O₃" */
export const subscript = (f: string): string => f.replace(/\d/g, (d) => SUB[Number(d)]);

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
/** 2 -> "²⁺", -1 -> "⁻" */
export function chargeMark(q: number): string {
  const n = Math.abs(q);
  return (n === 1 ? '' : [...String(n)].map((d) => SUP[Number(d)]).join('')) + (q > 0 ? '⁺' : '⁻');
}

/** how many atoms of each element a formula holds: "Al2O3" -> { Al: 2, O: 3 } */
export function atomsIn(f: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of f.matchAll(/([A-Z][a-z]?)(\d*)/g)) out[m[1]] = (out[m[1]] ?? 0) + Number(m[2] || 1);
  return out;
}

/**
 * The charges an ionic picture gives the two (left, right): PubChem's, when
 * its structure is drawn as ions; else read off the formula with the right
 * element at its most negative common oxidation state (NaCl: Cl -1, so Na +1).
 */
export function ionCharges(left: BondElement, right: BondElement, c: Compound | null): [number, number] | null {
  if (c && c.o === 0 && c.q[0] !== 0 && c.q[1] !== 0) {
    return left.z <= right.z ? c.q : [c.q[1], c.q[0]];
  }
  const neg = Math.min(...oxStates(right));
  if (!(neg < 0)) return null;
  if (c) {
    const n = atomsIn(c.f);
    const pos = (-neg * n[right.sym]) / n[left.sym];
    return Number.isInteger(pos) ? [pos, neg] : null;
  }
  const pos = oxStates(left).find((x) => x > 0);
  return pos ? [pos, neg] : null;
}

/** What the 3D view plays for the pair (left, right) bonded as `kind`, in compound `c` if there is one. */
export function pictureOf(kind: BondKind, left: BondElement, right: BondElement, c: Compound | null): BondPicture {
  if (kind === 'ionic') {
    const q = ionCharges(left, right, c);
    // one atom of each: the left gives what the right can take
    return q ? { kind: 'ionic', moves: Math.min(q[0], -q[1]) } : { kind: 'apart' };
  }
  if (kind === 'polar' || kind === 'nonpolar') return { kind: 'covalent', order: c && c.o > 0 ? Math.min(3, c.o) : 1 };
  if (kind === 'metallic') return { kind: 'metallic' };
  return { kind: 'apart' };
}

/**
 * A compound the bond view draws whole, not as one atom of each: CO2 drawn
 * as one C and one O read as CO, and Al2O3 as one Al and one O showed Al³⁺
 * with only two electrons gone.
 */
export interface Molecule {
  /** a small molecule's shape round its middle atom; 'ions' for a row of ions */
  shape: 'linear' | 'bent' | 'trigonal planar' | 'trigonal pyramidal' | 'tetrahedral' | 'ions';
  /** which of the pair each atom is: 0 the left, 1 the right. A molecule's middle atom is first */
  side: (0 | 1)[];
  /** where each atom sits, in bond lengths, y up */
  at: [number, number, number][];
  /** what is bonded: two atoms, the left element's first, and the electrons that cross (ionic) */
  bonds: [number, number, number][];
}

const deg = Math.PI / 180;

/** n directions `angle` apart, tilted down from straight up (three's y) */
function cone(n: number, angle: number): [number, number, number][] {
  // the angle from the axis that puts n bonds `angle` apart: cos(angle) =
  // cos²φ + sin²φ cos(360°/n), solved for φ
  const c = Math.cos((2 * Math.PI) / n);
  const phi = Math.acos(Math.sqrt((Math.cos(angle * deg) - c) / (1 - c)));
  return Array.from({ length: n }, (_, k) => {
    const a = (k / n) * 2 * Math.PI + Math.PI / 2;
    return [Math.sin(phi) * Math.cos(a), -Math.cos(phi), Math.sin(phi) * Math.sin(a)];
  });
}

/**
 * Who gives to whom in a set of ions: each positive ion (side 0) hands its
 * `give` electrons to the nearest negative ions (by place in `side`) still
 * short of `take`. [giver, taker, electrons] for each hand-over.
 */
export function ionRoute(side: (0 | 1)[], give: number, take: number): [number, number, number][] {
  const need = side.map((x) => (x === 1 ? take : 0));
  const out: [number, number, number][] = [];
  side.forEach((x, i) => {
    let left = x === 0 ? give : 0;
    while (left > 0) {
      let j = -1;
      need.forEach((n, k) => {
        if (n > 0 && (j < 0 || Math.abs(k - i) < Math.abs(j - i))) j = k;
      });
      if (j < 0) break;
      const n = Math.min(left, need[j]);
      out.push([i, j, n]);
      need[j] -= n;
      left -= n;
    }
  });
  return out;
}

/** the most ions drawn in a row: past that they are too small to read */
const MAX_IONS = 7;

/**
 * The compound (left, right) make in `c`, drawn whole - or null, for one
 * atom of each (NaCl, PCl5, N2O4).
 *
 * One atom in the middle and two to four of the other round it (CO2, H2O,
 * NH3, CH4, MgCl2): its shape is the valence-shell rule (VSEPR), the bonds
 * and the middle atom's lone pairs spread as far apart as they can, the lone
 * pairs pressing the bonds closer (water's 104.5°). Ions just spread evenly.
 * Ions with no single middle one (Al2O3, Mg3P2): a zig-zag row, the fewer
 * kind spread among the more, each positive ion giving its electrons to the
 * nearest negative ones. `valence`: the outer electrons of (left, right).
 */
export function moleculeOf(left: BondElement, right: BondElement, c: Compound | null, pic: BondPicture, valence: [number, number]): Molecule | null {
  if (!c || (pic.kind !== 'ionic' && pic.kind !== 'covalent')) return null;
  const k = atomsIn(c.f);
  const counts = [k[left.sym] ?? 0, k[right.sym] ?? 0];
  const q = pic.kind === 'ionic' ? ionCharges(left, right, c) : null;
  if (counts[0] !== 1 && counts[1] !== 1) {
    const total = counts[0] + counts[1];
    if (!q || total > MAX_IONS) return null;
    // the fewer kind at even places among the more
    const few: 0 | 1 = counts[0] < counts[1] ? 0 : 1;
    const m = counts[few];
    const side: (0 | 1)[] = Array.from({ length: total }, () => (1 - few) as 0 | 1);
    for (let j = 0; j < m; j++) side[Math.floor(((j + 0.5) * total) / m)] = few;
    // neighbours a bond length apart, steeply zig-zagged: a flatter row ran
    // off the sides of the view
    const at = side.map((_, i): [number, number, number] => [(i - (total - 1) / 2) * 0.6, i % 2 ? -0.4 : 0.4, 0]);
    return { shape: 'ions', side, at, bonds: ionRoute(side, q[0], -q[1]) };
  }
  const center: 0 | 1 = counts[0] === 1 ? 0 : 1;
  const n = counts[1 - center];
  if (n < 2) return null;
  // a covalent middle atom's unshared electrons take room too
  const used = pic.kind === 'covalent' ? n * pic.order : 0;
  const lone = pic.kind === 'covalent' ? Math.max(0, Math.floor((valence[center] - used) / 2)) : 0;
  const steric = n + lone;
  const flat = (a: number): [number, number, number][] => [
    [Math.sin(a / 2), -Math.cos(a / 2), 0],
    [-Math.sin(a / 2), -Math.cos(a / 2), 0],
  ];
  const round = (shape: Molecule['shape'], dirs: [number, number, number][]): Molecule => {
    const side: (0 | 1)[] = [center, ...dirs.map(() => (1 - center) as 0 | 1)];
    const bonds: [number, number, number][] = q
      ? ionRoute(side, q[0], -q[1])
      : dirs.map((_, j) => (center === 0 ? [0, j + 1, 0] : [j + 1, 0, 0]));
    return { shape, side, at: [[0, 0, 0], ...dirs], bonds };
  };
  if (n === 2 && steric === 2) return round('linear', [[-1, 0, 0], [1, 0, 0]]);
  if (n === 2 && steric === 3) return round('bent', flat(119 * deg));
  if (n === 2 && steric === 4) return round('bent', flat(104.5 * deg));
  // flat, and facing the viewer: lying level it would be seen edge on
  if (n === 3 && steric === 3) return round('trigonal planar', [[0, 1, 0], [-Math.sqrt(3) / 2, -0.5, 0], [Math.sqrt(3) / 2, -0.5, 0]]);
  if (n === 3 && steric === 4) return round('trigonal pyramidal', cone(3, 107));
  if (n === 4 && steric === 4) return round('tetrahedral', cone(3, 109.47).concat([[0, 1, 0]]));
  // five or more ways round (PCl5, SF4 with its lone pair): no shape to claim
  return null;
}

/** formal charges on both atoms of a bonded structure (C⁻≡O⁺): no δ+/δ− is claimed */
const formalCharges = (c: Compound | null): c is Compound => !!c && c.o > 0 && c.q[0] !== 0 && c.q[1] !== 0;

/**
 * The labels over the bond view: the two symbols, then once the bond is
 * made the ions' charges (ionic) or δ+ and δ− (polar), and under the bond
 * the shared pairs or the electron sea.
 */
export function tagsOf(kind: BondKind, left: BondElement, right: BondElement, c: Compound | null, pic: BondPicture): PairTags {
  const plain = (e: BondElement): Tag => ({ text: e.sym, role: 'plain' });
  const same = (e: BondElement): [Tag, Tag] => [plain(e), plain(e)];
  if (pic.kind === 'ionic') {
    const q = ionCharges(left, right, c)!;
    return {
      left: [plain(left), { text: left.sym + chargeMark(q[0]), role: 'pos' }],
      right: [plain(right), { text: right.sym + chargeMark(q[1]), role: 'neg' }],
      mid: null,
    };
  }
  if (pic.kind === 'covalent') {
    const mid: Tag = { text: pic.order === 1 ? 'shared pair' : `${pic.order} shared pairs`, role: 'shared' };
    if (kind === 'polar' && !formalCharges(c)) {
      return { left: [plain(left), { text: `${left.sym} δ+`, role: 'pos' }], right: [plain(right), { text: `${right.sym} δ−`, role: 'neg' }], mid };
    }
    return { left: same(left), right: same(right), mid };
  }
  if (pic.kind === 'metallic') return { left: same(left), right: same(right), mid: { text: 'electron sea', role: 'shared' } };
  return { left: same(left), right: same(right), mid: null };
}

const lower = (e: BondElement) => e.name.toLowerCase();
const electrons = (n: number) => (n === 1 ? 'electron' : 'electrons');
const BOND_WORD = ['', 'single', 'double', 'triple'];

/**
 * The panel's account of the bond: which way the electrons go and why, in
 * a sentence or two, from the numbers alone.
 */
export function explain(kind: BondKind, left: BondElement, right: BondElement, c: Compound | null, whole = false): string {
  const same = left.z === right.z;
  const chi = (e: BondElement) => `(χ ${e.en})`;
  switch (kind) {
    case 'none': {
      const noble = left.block === 'Noble gas' ? left : right;
      return oxStates(noble).length
        ? `${noble.name} is filed with the noble gases, whose outer shells are full: no compound with it is predicted here.`
        : `${noble.name}'s outer shell is already full. PubChem lists no common oxidation state for it but 0, so no compound is predicted.`;
    }
    case 'metallic':
      return same
        ? `Metal atoms hold their outer electrons loosely: in a piece of ${lower(left)} those electrons drift among all the atoms as a shared sea, which is why metals conduct.`
        : `Both are metals: their outer electrons drift among the atoms of both as a shared sea. Metals usually mix as alloys rather than forming molecules.`;
    case 'unknown': {
      const missing = left.en === null ? left : right;
      return `PubChem gives no electronegativity for ${lower(missing)}, so the kind of bond can't be estimated.`;
    }
    case 'ionic': {
      const q = ionCharges(left, right, c);
      if (!q) return `By Δχ the bond would be ionic, but no formula follows from the oxidation states PubChem lists.`;
      const give = Math.min(q[0], -q[1]);
      let s = `${right.name} ${chi(right)} pulls on electrons far harder than ${lower(left)} ${chi(left)}: ${lower(left)} gives up ${q[0] === 1 ? 'its outer electron' : `${q[0]} electrons`}, and the ions ${left.sym}${chargeMark(q[0])} and ${right.sym}${chargeMark(q[1])} hold together by their opposite charges.`;
      if (c) {
        const n = atomsIn(c.f);
        if (n[left.sym] !== 1 || n[right.sym] !== 1) {
          s += ` In ${subscript(c.f)}, ${n[left.sym]} ${left.sym} give ${n[left.sym] * q[0]} ${electrons(n[left.sym] * q[0])} to ${n[right.sym]} ${right.sym}`;
          s += whole ? '.' : `; the picture shows one atom of each, ${give} ${electrons(give)} crossing.`;
        }
      }
      return s;
    }
    case 'polar':
    case 'nonpolar': {
      const order = c && c.o > 0 ? Math.min(3, c.o) : 0;
      const bond = order ? `a ${BOND_WORD[order]} bond, ${order} shared ${order === 1 ? 'pair' : 'pairs'}` : 'shared pairs';
      if (same) {
        return order
          ? `Two ${lower(left)} atoms pull equally (Δχ 0), so they share electrons evenly: ${bond}, in ${subscript(c!.f)}.`
          : `${left.name} atoms share electrons evenly (Δχ 0), but in larger structures, not as two-atom molecules: PubChem files no ${left.sym}₂ under ${lower(left)}'s name.`;
      }
      if (kind === 'nonpolar') return `${left.name} ${chi(left)} and ${lower(right)} ${chi(right)} pull almost equally, so they share electrons about evenly: ${bond}.`;
      const pull = `${right.name} ${chi(right)} pulls the shared electrons closer than ${lower(left)} ${chi(left)} does: ${bond}`;
      // formal charges in PubChem's structure (C⁻≡O⁺): the δ+/δ− rule would point the wrong way
      if (formalCharges(c)) {
        const [ql, qr] = left.z <= right.z ? c.q : [c.q[1], c.q[0]];
        return `${pull}. But PubChem's structure gives the atoms formal charges, ${left.sym}${chargeMark(ql)} and ${right.sym}${chargeMark(qr)}, so the simple δ+/δ− picture does not hold here.`;
      }
      return `${pull}, slightly negative (δ−) at the ${lower(right)} end and positive (δ+) at the ${lower(left)}.`;
    }
  }
}

/**
 * When PubChem's structure and the Δχ rule disagree (it draws sodium
 * hydride as ions though Δχ is 1.27; aluminium oxide with bonds though Δχ is
 * 1.83), the panel says so: the rule is a rule of thumb.
 */
export function disagreement(kind: BondKind, c: Compound | null): string | null {
  if (!c) return null;
  const ions = c.o === 0 && c.q[0] !== 0 && c.q[1] !== 0;
  if (ions && (kind === 'polar' || kind === 'nonpolar')) {
    return `PubChem draws ${subscript(c.f)} as ions all the same: the ${IONIC_DX} line is a rule of thumb, and real bonds run on a scale from covalent to ionic.`;
  }
  if (c.o > 0 && kind === 'ionic') {
    return `PubChem draws ${subscript(c.f)} with bonds all the same: the ${IONIC_DX} line is a rule of thumb, and real bonds run on a scale from covalent to ionic.`;
  }
  return null;
}

/**
 * Who the BOND view pairs an element with first: a metal with chlorine
 * (salts), anything else with hydrogen (CH4, NH3, H2O, HCl), hydrogen with
 * oxygen. The first that makes a compound on record, else the element itself.
 */
export function defaultPartner<T extends BondElement>(e: T, bySym: (s: string) => T, has: (a: T, b: T) => boolean): T {
  const order = isMetal(e) ? ['Cl', 'O', 'H'] : ['H', 'O', 'Cl', 'F'];
  for (const s of order) {
    const p = bySym(s);
    if (p.z !== e.z && has(e, p)) return p;
  }
  return e;
}
