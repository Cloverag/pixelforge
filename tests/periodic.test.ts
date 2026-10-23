import { describe, expect, it } from 'vitest';
import ELEMENTS from '../src/data/elements.json';
import { placeOf } from '../src/ui/periodic';
import { LAB_ELEMENTS, LAB_Z } from '../src/modes/chem';
import { MATS } from '../src/sim/materials';
import { CHEM } from '../src/sim/reactions';

describe('periodic table', () => {
  it('puts all 118 elements in distinct cells of the usual layout', () => {
    const seen = new Set<string>();
    for (let z = 1; z <= 118; z++) {
      const [c, r] = placeOf(z);
      expect(c).toBeGreaterThanOrEqual(1);
      expect(c).toBeLessThanOrEqual(18);
      expect(r).not.toBe(8); // the gap above the f-block rows
      seen.add(`${c},${r}`);
    }
    expect(seen.size).toBe(118);
    // landmarks: helium top right, sodium under lithium, iron in group 8,
    // the lanthanides from column 3 of row 9, oganesson bottom right
    expect(placeOf(2)).toEqual([18, 1]);
    expect(placeOf(11)).toEqual([1, 3]);
    expect(placeOf(26)).toEqual([8, 4]);
    expect(placeOf(57)).toEqual([3, 9]);
    expect(placeOf(72)).toEqual([4, 6]);
    expect(placeOf(103)).toEqual([17, 10]);
    expect(placeOf(118)).toEqual([18, 7]);
  });

  it('every lab element is a real element and a chem material', () => {
    const symbols = new Set((ELEMENTS as { sym: string }[]).map((e) => e.sym));
    expect(LAB_ELEMENTS.size).toBe(30);
    for (const [sym, m] of LAB_ELEMENTS) {
      expect(symbols.has(sym)).toBe(true);
      expect([sym, CHEM[m]]).toEqual([sym, 1]);
      expect(MATS[m]).toBeDefined();
    }
  });

  it('the rail tiles carry the right atomic number for every lab element', () => {
    // chem.ts writes the numbers out (it must not import the JSON), so check them here
    const z = new Map((ELEMENTS as { sym: string; z: number }[]).map((e) => [e.sym, e.z]));
    expect(LAB_Z.size).toBe(LAB_ELEMENTS.size);
    for (const [sym, m] of LAB_ELEMENTS) expect([sym, LAB_Z.get(m)]).toEqual([sym, z.get(sym)]);
  });
});
