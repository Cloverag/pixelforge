import { describe, expect, it } from 'vitest';
import ELEMENTS from '../src/data/elements.json';
import SPECTRA from '../src/data/spectra.json';
import {
  blockOf,
  HARMONICS,
  lastSubshell,
  occupiedOrbitals,
  periodGroup,
  prettyConfig,
  shellCounts,
  subshells,
  wavelengthRGB,
} from '../src/elements/atom';
import { FACTS } from '../src/elements/facts';
import { CATEGORIES, neighbour } from '../src/elements/screen';

const ALL = ELEMENTS as { z: number; sym: string; block: string; config: string | null }[];
const configOf = (sym: string) => ALL.find((e) => e.sym === sym)?.config ?? null;
const subsOf = (sym: string) => subshells(configOf(sym)!, configOf);

describe('ELEMENTS: electron configurations', () => {
  it('every element has a configuration that adds up to its atomic number', () => {
    for (const e of ALL) {
      expect(e.config, e.sym).toBeTruthy();
      const total = subshells(e.config!, configOf).reduce((s, x) => s + x.e, 0);
      expect(total, e.sym).toBe(e.z);
    }
  });

  it('shells come out as the textbook counts', () => {
    expect(shellCounts(subsOf('Ar'))).toEqual([2, 8, 8]);
    expect(shellCounts(subsOf('Fe'))).toEqual([2, 8, 14, 2]);
    expect(shellCounts(subsOf('Cu'))).toEqual([2, 8, 18, 1]);
    expect(shellCounts(subsOf('Au'))).toEqual([2, 8, 18, 32, 18, 1]);
    expect(shellCounts(subsOf('U'))).toEqual([2, 8, 18, 32, 21, 9, 2]);
  });

  it('the subshell filled last follows the Madelung order, whatever order the config is written in', () => {
    expect(lastSubshell(subsOf('Ar'))).toEqual({ n: 3, l: 1, e: 6 });
    // written "[Ar]4s1 3d10": 3d still comes after 4s
    expect(lastSubshell(subsOf('Cu'))).toEqual({ n: 3, l: 2, e: 10 });
    expect(lastSubshell(subsOf('H'))).toEqual({ n: 1, l: 0, e: 1 });
  });

  it("Hund's rule: carbon's 2p² has two occupied orbitals, nitrogen's 2p³ and argon's 3p⁶ three", () => {
    expect(occupiedOrbitals(lastSubshell(subsOf('C')))).toHaveLength(2);
    expect(occupiedOrbitals(lastSubshell(subsOf('N')))).toHaveLength(3);
    expect(occupiedOrbitals(lastSubshell(subsOf('Ar')))).toHaveLength(3);
    expect(occupiedOrbitals(lastSubshell(subsOf('Fe')))).toHaveLength(5);
  });

  it('writes configurations with superscripts and keeps any note', () => {
    expect(prettyConfig('[Ne]3s2 3p6')).toBe('[Ne] 3s² 3p⁶');
    expect(prettyConfig('[Rn]7s2 7p6 5f14 6d10 (predicted)')).toBe('[Rn] 7s² 7p⁶ 5f¹⁴ 6d¹⁰ (predicted)');
  });
});

describe('ELEMENTS: places in the table', () => {
  it('period, group and block', () => {
    expect(periodGroup(18)).toEqual({ period: 3, group: 18 });
    expect(periodGroup(26)).toEqual({ period: 4, group: 8 });
    expect(periodGroup(92)).toEqual({ period: 7, group: null });
    expect([1, 2, 6, 26, 58].map(blockOf)).toEqual(['s', 's', 'p', 'd', 'f']);
  });

  it('arrows walk the table: along the row, wrapping at the ends, and up and down the column past its gaps', () => {
    expect(neighbour(18, 'right')).toBe(19);
    expect(neighbour(118, 'right')).toBe(1);
    expect(neighbour(1, 'left')).toBe(118);
    expect(neighbour(18, 'up')).toBe(10);
    expect(neighbour(10, 'up')).toBe(2);
    // helium's column has nothing above
    expect(neighbour(2, 'up')).toBe(2);
    // from boron straight up is the gap over the middle of the table: stay
    expect(neighbour(5, 'up')).toBe(5);
  });

  it('every element is in one of the ten categories', () => {
    const blocks = new Set(CATEGORIES.map((c) => c.block));
    for (const e of ALL) expect(blocks.has(e.block), `${e.sym} ${e.block}`).toBe(true);
  });
});

describe('ELEMENTS: orbital shapes', () => {
  it('each real harmonic is normalised: the integral of |Y|² over the sphere is 1', () => {
    // midpoint rule in θ, φ
    const N = 200;
    for (const l of HARMONICS) {
      for (const { name, y } of l) {
        let sum = 0;
        for (let i = 0; i < N; i++) {
          const th = ((i + 0.5) / N) * Math.PI;
          for (let j = 0; j < 2 * N; j++) {
            const ph = ((j + 0.5) / (2 * N)) * 2 * Math.PI;
            const v = y(Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th));
            sum += v * v * Math.sin(th);
          }
        }
        sum *= (Math.PI / N) * (Math.PI / N);
        expect(sum, name).toBeCloseTo(1, 3);
      }
    }
  });

  it('orbitals of one subshell are orthogonal', () => {
    const N = 120;
    for (const l of HARMONICS) {
      for (let a = 0; a < l.length; a++) {
        for (let b = a + 1; b < l.length; b++) {
          let sum = 0;
          for (let i = 0; i < N; i++) {
            const th = ((i + 0.5) / N) * Math.PI;
            for (let j = 0; j < 2 * N; j++) {
              const ph = ((j + 0.5) / (2 * N)) * 2 * Math.PI;
              const p: [number, number, number] = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
              sum += l[a].y(...p) * l[b].y(...p) * Math.sin(th);
            }
          }
          expect(Math.abs(sum * (Math.PI / N) ** 2), `${l[a].name}·${l[b].name}`).toBeLessThan(1e-3);
        }
      }
    }
  });
});

describe('ELEMENTS: spectra (NIST) and words', () => {
  const lines = SPECTRA as unknown as Record<string, [number, number][] | null>;

  it('has an entry for every element, and the lines are visible, sorted and scaled to the strongest', () => {
    expect(Object.keys(lines).sort()).toEqual(ALL.map((e) => e.sym).sort());
    for (const [sym, ls] of Object.entries(lines)) {
      if (ls === null) continue;
      expect(ls.length, sym).toBeGreaterThan(0);
      expect(Math.max(...ls.map((l) => l[1])), sym).toBe(1);
      for (let i = 0; i < ls.length; i++) {
        const [nm, k] = ls[i];
        expect(nm, sym).toBeGreaterThanOrEqual(380);
        expect(nm, sym).toBeLessThanOrEqual(750);
        expect(k, sym).toBeGreaterThan(0);
        if (i > 0) expect(nm, sym).toBeGreaterThan(ls[i - 1][0]);
      }
    }
  });

  it("hydrogen's strongest visible line is H-alpha, sodium's the D line, as every textbook has them", () => {
    const strongest = (sym: string) => [...lines[sym]!].sort((a, b) => b[1] - a[1])[0][0];
    expect(strongest('H')).toBeCloseTo(656.28, 1);
    expect(strongest('Na')).toBeCloseTo(589.0, 1);
  });

  it('every element has a fact and at least one use', () => {
    for (const e of ALL) {
      expect(FACTS[e.sym]?.fact, e.sym).toBeTruthy();
      expect(FACTS[e.sym].uses.length, e.sym).toBeGreaterThan(0);
    }
  });

  it('colours light: red at 656 nm, blue at 450, dark past the ends', () => {
    const [r, g, b] = wavelengthRGB(656);
    expect(r).toBeGreaterThan(0.9);
    expect(g + b).toBeLessThan(0.1);
    const blue = wavelengthRGB(450);
    expect(blue[2]).toBe(1);
    expect(wavelengthRGB(800)).toEqual([0, 0, 0]);
  });
});

describe('ELEMENTS: trends, records, orbital boxes, find', async () => {
  const { stateAt, records, boxRows, ramp, domain, position, NUM_PROPS, yearOf } = await import('../src/elements/trends');
  const { findElement } = await import('../src/elements/screen');
  const DATA = ELEMENTS as unknown as Parameters<typeof records>[1];
  const bySym = (s: string) => DATA.find((e) => e.sym === s)!;

  it('at room temperature two elements are liquid (bromine, mercury) and eleven are gases', () => {
    const at = (state: string) => DATA.filter((e) => stateAt(e, 298) === state).map((e) => e.sym).sort();
    expect(at('liquid')).toEqual(['Br', 'Hg']);
    expect(at('gas')).toEqual(['Ar', 'Cl', 'F', 'H', 'He', 'Kr', 'N', 'Ne', 'O', 'Rn', 'Xe']);
  });

  it('states follow the melting and boiling points, and say unknown without them', () => {
    expect(stateAt({ melt: 100, boil: 200 }, 50)).toBe('solid');
    expect(stateAt({ melt: 100, boil: 200 }, 150)).toBe('liquid');
    expect(stateAt({ melt: 100, boil: 200 }, 250)).toBe('gas');
    expect(stateAt({ melt: null, boil: null }, 250)).toBe('unknown');
    expect(stateAt({ melt: 100, boil: null }, 150)).toBe('unknown');
  });

  it('records come from the data: fluorine the most electronegative, helium the highest ionization energy', () => {
    expect(records(bySym('F'), DATA).join(' ')).toMatch(/most electronegative of any element/);
    expect(records(bySym('He'), DATA).join(' ')).toMatch(/highest ionization energy of any element/);
    expect(records(bySym('H'), DATA).join(' ')).toMatch(/least dense of any element/);
    // argon has no electronegativity in the data: no record can be claimed for it
    expect(records(bySym('Ar'), DATA).join(' ')).not.toMatch(/electronegativ/);
  });

  it("orbital boxes: Hund's rule fills singly first, and iron shows 3d under 4s", () => {
    const ALLC = ELEMENTS as { sym: string; config: string | null }[];
    const cfg = (s: string) => ALLC.find((e) => e.sym === s)?.config ?? null;
    const rowsOf = (s: string) => boxRows(subshells(cfg(s)!, cfg));
    expect(rowsOf('C')).toEqual([{ label: '2s', boxes: [2] }, { label: '2p', boxes: [1, 1, 0] }]);
    expect(rowsOf('O')).toEqual([{ label: '2s', boxes: [2] }, { label: '2p', boxes: [2, 1, 1] }]);
    expect(rowsOf('Fe')).toEqual([{ label: '4s', boxes: [2] }, { label: '3d', boxes: [2, 1, 1, 1, 1] }]);
  });

  it('the colour ramp runs dark to light, and density sits on a log scale', () => {
    const lum = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
    expect(lum(ramp(0))).toBeLessThan(lum(ramp(1)));
    const dens = NUM_PROPS.find((p) => p.key === 'density')!;
    const d = domain(DATA, dens);
    // water-ish density lands far from either end on a log scale
    const t = position(1, d, true);
    expect(t).toBeGreaterThan(0.3);
    expect(t).toBeLessThan(0.9);
  });

  it('ancient elements count as known before any year', () => {
    expect(yearOf({ year: 'Ancient' })).toBe(-Infinity);
    expect(yearOf({ year: '1894' })).toBe(1894);
    expect(yearOf({ year: null })).toBeNull();
  });

  it('FIND takes a symbol in any case, a number, or the start of a name', () => {
    expect(findElement('au')?.name).toBe('Gold');
    expect(findElement('79')?.sym).toBe('Au');
    expect(findElement('oxy')?.sym).toBe('O');
    expect(findElement('Fe')?.sym).toBe('Fe');
    expect(findElement('zzz')).toBeNull();
    expect(findElement('200')).toBeNull();
  });

  it('every element has a name origin', async () => {
    const { NAMED } = await import('../src/elements/names');
    for (const e of DATA) expect(NAMED[e.sym], e.sym).toBeTruthy();
  });
});

describe('ELEMENTS: no record from a value with a caveat', async () => {
  const { records } = await import('../src/elements/trends');
  const DATA = ELEMENTS as unknown as Parameters<typeof records>[1];
  const bySym = (s: string) => DATA.find((e) => e.sym === s)!;

  it("helium's melting point is under pressure, carbon's is not at normal pressure: neither is a record", () => {
    expect(records(bySym('He'), DATA).join(' ')).not.toMatch(/melting/);
    expect(records(bySym('C'), DATA).join(' ')).not.toMatch(/melting/);
    // with carbon set aside, tungsten has the highest melting point
    expect(records(bySym('W'), DATA).join(' ')).toMatch(/highest melting point of any element/);
    // and hydrogen, with helium set aside, the lowest
    expect(records(bySym('H'), DATA).join(' ')).toMatch(/lowest melting point of any element/);
  });
});
