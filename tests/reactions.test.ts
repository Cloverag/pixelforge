import { describe, expect, it } from 'vitest';
import BONDS from '../src/data/bonds.json';
import ELEMENTS from '../src/data/elements.json';
import { pairKey, type Compound } from '../src/elements/bond';
import {
  balanced,
  equationText,
  FAMOUS,
  formations,
  nextOf,
  parseFormula,
  searchReactions,
  type StepElement,
} from '../src/elements/reactions';

const ALL = ELEMENTS as unknown as StepElement[];
const el = (s: string) => ALL.find((e) => e.sym === s)!;
const DATA = BONDS as unknown as Record<string, Compound[]>;
const FORMED = formations(DATA, el);
const EVERY = [...FAMOUS, ...FORMED];
const formed = (f: string) => FORMED.find((r) => r.right[0].f === f)!;
const famous = (id: string) => FAMOUS.find((r) => r.id === id)!;

describe('REACTIONS: equations', () => {
  it('reads formulas with brackets', () => {
    expect(parseFormula('Ca(OH)2')).toEqual({ Ca: 1, O: 2, H: 2 });
    expect(parseFormula('CH3COOH')).toEqual({ C: 2, H: 4, O: 2 });
    expect(parseFormula('Cu(NO3)2')).toEqual({ Cu: 1, N: 2, O: 6 });
  });

  it('every famous reaction balances, and every id is its own', () => {
    for (const r of FAMOUS) expect(balanced(r), r.id).toBe(true);
    expect(new Set(EVERY.map((r) => r.id)).size).toBe(EVERY.length);
  });

  it('every formation on record balances, with the elements as they come', () => {
    expect(FORMED.length).toBeGreaterThan(1000);
    for (const r of FORMED) expect(balanced(r), r.name).toBe(true);
    expect(equationText(formed('NaCl'))).toBe('2 Na + Cl₂ → 2 NaCl');
    expect(equationText(formed('H2O'))).toBe('2 H₂ + O₂ → 2 H₂O');
    expect(equationText(formed('Fe2O3'))).toBe('4 Fe + 3 O₂ → 2 Fe₂O₃');
    expect(equationText(formed('CH4'))).toBe('C + 2 H₂ → CH₄');
    expect(equationText(formed('MgO'))).toBe('2 Mg + O₂ → 2 MgO');
  });

  it('a famous reaction shows a bond PubChem has', () => {
    for (const r of FAMOUS) {
      const [a, b, f] = r.show;
      if (f === null) continue;
      const list = DATA[pairKey(el(a), el(b))] ?? [];
      expect(list.map((c) => c.f), r.id).toContain(f);
    }
  });
});

describe('REACTIONS: the steps', () => {
  it("salt: chlorine splits, sodium's ionization energy and chlorine's electron affinity from PubChem", () => {
    const text = formed('NaCl').steps.map((s) => s.text).join(' ');
    expect(text).toMatch(/Cl₂ splits into atoms/);
    expect(text).toMatch(new RegExp(`takes ${el('Na').ie} eV`));
    expect(text).toMatch(new RegExp(`gives out ${el('Cl').ea} eV`));
    expect(text).toMatch(/Na⁺ to 1 Cl⁻/);
  });

  it("an oxide's second electron costs energy; a covalent bond gives PubChem's bond order", () => {
    expect(formed('MgO').steps.map((s) => s.text).join(' ')).toMatch(/the next costs energy/);
    expect(formed('CO2').steps.map((s) => s.text).join(' ')).toMatch(/a double bond, 2 pairs/);
  });

  it('every reaction says how it happens', () => {
    for (const r of EVERY) expect(r.steps.length, r.id).toBeGreaterThan(0);
  });
});

describe('REACTIONS: search and next', () => {
  it('finds by name, element, formula and kind', () => {
    expect(searchReactions('rust', FAMOUS).map((r) => r.id)).toEqual(['rust']);
    const na = searchReactions('Na', EVERY).map((r) => r.id);
    expect(na).toContain('na-water');
    expect(na).toContain(formed('NaCl').id);
    expect(searchReactions('h2o', FAMOUS).map((r) => r.id)).toContain('photosynthesis');
    expect(searchReactions('combustion', FAMOUS).every((r) => r.kind === 'COMBUSTION')).toBe(true);
    // a one-letter word is a symbol: C is carbon, not chlorine or calcium
    expect(searchReactions('c', FAMOUS).map((r) => r.id)).not.toContain('na-cl2');
    // every word must match
    expect(searchReactions('Na water', FAMOUS).map((r) => r.id)).toEqual(['na-water']);
  });

  it('salt goes on to be split by electricity or to meet silver nitrate', () => {
    const next = nextOf(famous('na-cl2'), EVERY).map((r) => r.id);
    expect(next).toContain('electrolysis-salt');
    expect(next).toContain('silver-chloride');
  });
});
