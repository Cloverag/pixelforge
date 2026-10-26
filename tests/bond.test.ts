import { describe, expect, it } from 'vitest';
import BONDS from '../src/data/bonds.json';
import ELEMENTS from '../src/data/elements.json';
import {
  atomsIn,
  bondKind,
  chargeMark,
  defaultPartner,
  explain,
  ionCharges,
  ionRoute,
  moleculeOf,
  ordered,
  pairKey,
  pictureOf,
  subscript,
  type BondElement,
  type Compound,
} from '../src/elements/bond';

const ALL = ELEMENTS as unknown as BondElement[];
const el = (s: string) => ALL.find((e) => e.sym === s)!;
const DATA = BONDS as unknown as Record<string, Compound[]>;
const on = (a: string, b: string) => DATA[pairKey(el(a), el(b))] ?? [];
const find = (a: string, b: string, f: string) => on(a, b).find((c) => c.f === f);

describe('BOND: the kind of bond, by the electronegativity gap', () => {
  it('sodium and chlorine are ionic, hydrogen and oxygen polar, carbon and hydrogen nonpolar', () => {
    expect(bondKind(el('Na'), el('Cl'))).toBe('ionic');
    expect(bondKind(el('H'), el('O'))).toBe('polar');
    expect(bondKind(el('C'), el('H'))).toBe('nonpolar');
    expect(bondKind(el('H'), el('H'))).toBe('nonpolar');
  });

  it('two metals bond metallically, a noble gas not at all, a missing χ is unknown', () => {
    expect(bondKind(el('Fe'), el('Cu'))).toBe('metallic');
    expect(bondKind(el('Na'), el('Na'))).toBe('metallic');
    expect(bondKind(el('Ne'), el('F'))).toBe('none');
    expect(bondKind(el('Og'), el('H'))).toBe('none');
    expect(bondKind(el('Pm'), el('O'))).toBe('unknown');
  });

  it('draws the less electronegative atom on the left, whichever was picked first', () => {
    expect(ordered(el('Cl'), el('Na')).map((e) => e.sym)).toEqual(['Na', 'Cl']);
    expect(ordered(el('O'), el('H')).map((e) => e.sym)).toEqual(['H', 'O']);
    expect(pairKey(el('Cl'), el('Na'))).toBe('Na-Cl');
  });
});

describe('BOND: what the picture plays', () => {
  const nacl: Compound = { f: 'NaCl', name: 'Sodium Chloride', cid: 5234, o: 0, q: [1, -1] };
  const alumina: Compound = { f: 'Al2O3', name: 'Aluminum Oxide', cid: 9989226, o: 2, q: [0, 0] };

  it('ionic: charges from the ions PubChem draws, else from the formula', () => {
    expect(ionCharges(el('Na'), el('Cl'), nacl)).toEqual([1, -1]);
    // PubChem draws Al2O3 with bonds: oxygen at -2, three of them over two aluminiums, so +3
    expect(ionCharges(el('Al'), el('O'), alumina)).toEqual([3, -2]);
    expect(ionCharges(el('Mg'), el('O'), null)).toEqual([2, -2]);
  });

  it('one atom of each: the left gives what the right can take', () => {
    expect(pictureOf('ionic', el('Na'), el('Cl'), nacl)).toEqual({ kind: 'ionic', moves: 1 });
    expect(pictureOf('ionic', el('Mg'), el('O'), null)).toEqual({ kind: 'ionic', moves: 2 });
    expect(pictureOf('ionic', el('Al'), el('O'), alumina)).toEqual({ kind: 'ionic', moves: 2 });
  });

  it("covalent: the bond order in PubChem's structure, one pair without a compound", () => {
    const co: Compound = { f: 'CO', name: 'Carbon Monoxide', cid: 281, o: 3, q: [0, 0] };
    expect(pictureOf('polar', el('C'), el('O'), co)).toEqual({ kind: 'covalent', order: 3 });
    expect(pictureOf('nonpolar', el('C'), el('H'), null)).toEqual({ kind: 'covalent', order: 1 });
    expect(pictureOf('metallic', el('Fe'), el('Cu'), null)).toEqual({ kind: 'metallic' });
    expect(pictureOf('none', el('Ne'), el('F'), null)).toEqual({ kind: 'apart' });
  });

  it('explains the whole formula when the picture shows only one atom of each', () => {
    const s = explain('ionic', el('Al'), el('O'), alumina);
    expect(s).toMatch(/Al³⁺ and O²⁻/);
    expect(s).toMatch(/In Al₂O₃, 2 Al give 6 electrons to 3 O; the picture shows one atom of each, 2 electrons crossing/);
    expect(explain('ionic', el('Na'), el('Cl'), nacl)).not.toMatch(/the picture shows/);
  });

  it('drops the δ+/δ− claim where PubChem gives formal charges (carbon monoxide)', () => {
    const co: Compound = { f: 'CO', name: 'Carbon Monoxide', cid: 281, o: 3, q: [-1, 1] };
    const s = explain('polar', el('C'), el('O'), co);
    expect(s).toMatch(/formal charges, C⁻ and O⁺/);
    expect(s).not.toMatch(/δ−\) at/);
    expect(explain('polar', el('H'), el('O'), null)).toMatch(/δ−\) at the oxygen end/);
  });

  it('says something for every kind', () => {
    const pairs: [string, string][] = [['Na', 'Cl'], ['H', 'O'], ['C', 'H'], ['Fe', 'Cu'], ['Ne', 'F'], ['Og', 'H'], ['Pm', 'O'], ['C', 'C'], ['Na', 'Na']];
    for (const [a, b] of pairs) {
      const [l, r] = ordered(el(a), el(b));
      expect(explain(bondKind(l, r), l, r, on(a, b)[0] ?? null).length, `${a}-${b}`).toBeGreaterThan(40);
    }
  });

  it('writes formulas and charges', () => {
    expect(subscript('Al2O3')).toBe('Al₂O₃');
    expect(atomsIn('Al2O3')).toEqual({ Al: 2, O: 3 });
    expect(atomsIn('NaCl')).toEqual({ Na: 1, Cl: 1 });
    expect(chargeMark(1)).toBe('⁺');
    expect(chargeMark(-2)).toBe('²⁻');
    expect(chargeMark(3)).toBe('³⁺');
  });
});

describe('BOND: the compounds on record (PubChem)', () => {
  it('has the textbook compounds, written the textbook way', () => {
    for (const [a, b, f] of [['Na', 'Cl', 'NaCl'], ['H', 'O', 'H2O'], ['C', 'H', 'CH4'], ['N', 'H', 'NH3'], ['C', 'O', 'CO2'], ['H', 'Cl', 'HCl'], ['Mg', 'O', 'MgO']]) {
      expect(find(a, b, f), f).toBeTruthy();
    }
  });

  it("takes bond orders and ions from PubChem's structures", () => {
    expect(find('C', 'O', 'CO')!.o).toBe(3);
    expect(find('C', 'O', 'CO2')!.o).toBe(2);
    expect(find('C', 'H', 'CH4')!.o).toBe(1);
    expect(find('N', 'N', 'N2')!.o).toBe(3);
    expect(find('O', 'O', 'O2')!.o).toBe(2);
    expect(find('H', 'H', 'H2')!.o).toBe(1);
    const nacl = find('Na', 'Cl', 'NaCl')!;
    expect(nacl.o).toBe(0);
    expect(nacl.q).toEqual([1, -1]);
  });

  it("an element with itself only as the X2 molecule filed under its name: H2 yes, carbon's C2 no", () => {
    expect(on('C', 'C')).toEqual([]);
    expect(on('S', 'S')).toEqual([]);
    expect(on('Cl', 'Cl').map((c) => c.f)).toEqual(['Cl2']);
  });

  it('passes over records that are not a neutral, named compound: an isotope label, an ion, a radical', () => {
    // PubChem's first hit for NaH is sodium deuteride
    expect(find('Na', 'H', 'NaH')!.name).toBe('Sodium hydride');
    // NH2 is azanide, an ion; NH is nitrene, a radical: only ammonia stays
    expect(on('N', 'H').map((c) => c.f)).toEqual(['NH3']);
  });

  it('every compound is of its pair alone, keyed lower Z first; no noble gas has one', () => {
    for (const [key, list] of Object.entries(DATA)) {
      const [a, b] = key.split('-').map(el);
      expect(a.z, key).toBeLessThanOrEqual(b.z);
      expect(a.block, key).not.toBe('Noble gas');
      for (const c of list) expect(Object.keys(atomsIn(c.f)).sort(), c.f).toEqual([...new Set([a.sym, b.sym])].sort());
    }
  });

  it('pairs each element with a usual partner first', () => {
    const has = (a: BondElement, b: BondElement) => on(a.sym, b.sym).length > 0;
    expect(defaultPartner(el('Na'), el, has).sym).toBe('Cl');
    expect(defaultPartner(el('C'), el, has).sym).toBe('H');
    expect(defaultPartner(el('H'), el, has).sym).toBe('O');
    // nothing on record: the element with itself
    expect(defaultPartner(el('Ne'), el, has).sym).toBe('Ne');
  });
});

describe('BOND: when PubChem and the rule of thumb disagree', async () => {
  const { disagreement } = await import('../src/elements/bond');
  it('says so, and stays quiet when they agree', () => {
    const nah: Compound = { f: 'NaH', name: 'Sodium Hydride', cid: 24758, o: 0, q: [1, -1] };
    expect(disagreement('polar', nah)).toMatch(/as ions all the same/);
    expect(disagreement('ionic', nah)).toBeNull();
    const alumina: Compound = { f: 'Al2O3', name: 'Aluminum Oxide', cid: 9989226, o: 2, q: [0, 0] };
    expect(disagreement('ionic', alumina)).toMatch(/with bonds all the same/);
    expect(disagreement('polar', alumina)).toBeNull();
    expect(disagreement('ionic', null)).toBeNull();
  });
});

describe('BOND: the labels over the atoms', async () => {
  const { tagsOf } = await import('../src/elements/bond');
  const text = (t: ReturnType<typeof tagsOf>) => [t.left.map((x) => x.text), t.right.map((x) => x.text), t.mid?.text ?? null];

  it("ionic: the symbols, then the ions' charges, positive and negative", () => {
    const nacl: Compound = { f: 'NaCl', name: 'Sodium Chloride', cid: 5234, o: 0, q: [1, -1] };
    const t = tagsOf('ionic', el('Na'), el('Cl'), nacl, { kind: 'ionic', moves: 1 });
    expect(text(t)).toEqual([['Na', 'Na⁺'], ['Cl', 'Cl⁻'], null]);
    expect([t.left[1].role, t.right[1].role]).toEqual(['pos', 'neg']);
  });

  it('polar: δ+ and δ−, and the shared pairs over the bond; none where PubChem gives formal charges', () => {
    const t = tagsOf('polar', el('H'), el('O'), null, { kind: 'covalent', order: 1 });
    expect(text(t)).toEqual([['H', 'H δ+'], ['O', 'O δ−'], 'shared pair']);
    const co: Compound = { f: 'CO', name: 'Carbon Monoxide', cid: 281, o: 3, q: [-1, 1] };
    expect(text(tagsOf('polar', el('C'), el('O'), co, { kind: 'covalent', order: 3 }))).toEqual([['C', 'C'], ['O', 'O'], '3 shared pairs']);
  });

  it('metallic: an electron sea; no bond: no label between', () => {
    expect(tagsOf('metallic', el('Fe'), el('Cu'), null, { kind: 'metallic' }).mid?.text).toBe('electron sea');
    expect(tagsOf('none', el('Ne'), el('F'), null, { kind: 'apart' }).mid).toBeNull();
  });
});

describe('BOND: a small molecule drawn whole', () => {
  const pic = (a: string, b: string, f: string) => {
    const [l, r] = ordered(el(a), el(b));
    const c = find(a, b, f)!;
    return { l, r, c, p: pictureOf(bondKind(l, r), l, r, c) };
  };
  // the outer electrons, as the 3D view's shells give them
  const VALENCE: Record<string, number> = { H: 1, B: 3, C: 4, N: 5, O: 6, F: 7, Mg: 2, S: 6, Cl: 7, P: 5 };
  const mol = (a: string, b: string, f: string) => {
    const { l, r, c, p } = pic(a, b, f);
    return moleculeOf(l, r, c, p, [VALENCE[l.sym], VALENCE[r.sym]]);
  };
  const angle = (u: number[], v: number[]) => (Math.acos(u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) * 180) / Math.PI;
  const angles = (dirs: number[][]) => dirs.flatMap((u, i) => dirs.slice(i + 1).map((v) => angle(u, v)));

  it('carbon dioxide is one carbon between two oxygens, in a straight line', () => {
    const m = mol('C', 'O', 'CO2')!;
    expect(m.side).toEqual([0, 1, 1]); // a carbon, the left of the pair, and two oxygens
    expect(m.shape).toBe('linear');
    expect(angles(m.at.slice(1))[0]).toBeCloseTo(180, 5);
  });

  it("water is bent by oxygen's two lone pairs; ammonia a pyramid; methane a tetrahedron", () => {
    const water = mol('H', 'O', 'H2O')!;
    expect(water.side).toEqual([1, 0, 0]); // an oxygen, the right of the pair, and two hydrogens
    expect(water.shape).toBe('bent');
    expect(angles(water.at.slice(1))[0]).toBeCloseTo(104.5, 5);
    const ammonia = mol('N', 'H', 'NH3')!;
    expect(ammonia.shape).toBe('trigonal pyramidal');
    for (const a of angles(ammonia.at.slice(1))) expect(a).toBeCloseTo(107, 5);
    const methane = mol('C', 'H', 'CH4')!;
    expect(methane.shape).toBe('tetrahedral');
    expect(angles(methane.at.slice(1))).toHaveLength(6);
    for (const a of angles(methane.at.slice(1))) expect(a).toBeCloseTo(109.47, 1);
  });

  it('no lone pair, flat: boron trifluoride and sulfur trioxide; one lone pair bends sulfur dioxide', () => {
    for (const [a, b, f] of [['B', 'F', 'BF3'], ['S', 'O', 'SO3']]) {
      const m = mol(a, b, f)!;
      expect(m.shape).toBe('trigonal planar');
      for (const x of angles(m.at.slice(1))) expect(x).toBeCloseTo(120, 5);
    }
    const so2 = mol('S', 'O', 'SO2')!;
    expect(so2.shape).toBe('bent');
    expect(angles(so2.at.slice(1))[0]).toBeCloseTo(119, 5);
  });

  it('ions round one ion: magnesium chloride is a magnesium between two chlorides', () => {
    const m = mol('Mg', 'Cl', 'MgCl2')!;
    expect(m.side).toEqual([0, 1, 1]);
    expect(m.shape).toBe('linear');
    // magnesium's two electrons, one to each chlorine
    expect(m.bonds).toEqual([[0, 1, 1], [0, 2, 1]]);
  });

  it('ions with no single middle one are a row: in Al2O3 each Al gives 3, each O takes 2', () => {
    const m = mol('Al', 'O', 'Al2O3')!;
    expect(m.shape).toBe('ions');
    expect(m.side).toEqual([1, 0, 1, 0, 1]); // O Al O Al O
    // neighbours a bond length apart
    for (let i = 1; i < m.at.length; i++) expect(Math.hypot(m.at[i][0] - m.at[i - 1][0], m.at[i][1] - m.at[i - 1][1])).toBeCloseTo(1, 5);
    // to the nearest oxygens
    expect(m.bonds).toEqual([[1, 0, 2], [1, 2, 1], [3, 2, 1], [3, 4, 2]]);
    const given = (i: number) => m.bonds.filter((b) => b[0] === i).reduce((s, b) => s + b[2], 0);
    const taken = (i: number) => m.bonds.filter((b) => b[1] === i).reduce((s, b) => s + b[2], 0);
    expect([given(1), given(3)]).toEqual([3, 3]);
    expect([taken(0), taken(2), taken(4)]).toEqual([2, 2, 2]);
  });

  it('a positive ion gives to its nearest neighbours, not the first that has room', () => {
    // the giver (2) has takers at 1 and 3 beside it and one at 0, further off
    expect(ionRoute([1, 1, 0, 1], 2, 1)).toEqual([[2, 1, 1], [2, 3, 1]]);
  });

  it('hands every electron over, however the ions fall: Mg3P2, Nb2O5', () => {
    for (const [side, give, take] of [
      [[0, 1, 0, 1, 0], 2, 3],
      [[1, 0, 1, 1, 1, 0, 1], 5, 2],
    ] as [(0 | 1)[], number, number][]) {
      const r = ionRoute(side, give, take);
      side.forEach((x, i) => {
        const moved = r.filter((b) => b[x === 0 ? 0 : 1] === i).reduce((s, b) => s + b[2], 0);
        expect(moved, `ion ${i}`).toBe(x === 0 ? give : take);
      });
    }
  });

  it('one of each, or no single middle atom: drawn as one atom of each', () => {
    expect(mol('Na', 'Cl', 'NaCl')).toBeNull();
    expect(mol('C', 'O', 'CO')).toBeNull();
    // five round one: more room than four ways round
    expect(mol('P', 'Cl', 'PCl5')).toBeNull();
    // too many ions to read in a row
    const many: Compound = { f: 'Tc2O7', name: 'Technetium Heptoxide', cid: 0, o: 0, q: [7, -2] };
    expect(moleculeOf(el('Tc'), el('O'), many, pictureOf('ionic', el('Tc'), el('O'), many), [7, 6])).toBeNull();
  });

  it('the account of an ionic bond stops saying the picture shows one atom of each once it shows the whole', () => {
    const { l, r, c } = pic('Mg', 'Cl', 'MgCl2');
    expect(explain('ionic', l, r, c)).toMatch(/the picture shows one atom of each/);
    const whole = explain('ionic', l, r, c, true);
    expect(whole).toMatch(/In MgCl₂, 1 Mg give 2 electrons to 2 Cl\.$/);
    expect(whole).not.toMatch(/the picture shows/);
  });
});
