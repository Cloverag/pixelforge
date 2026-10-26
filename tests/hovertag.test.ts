import { describe, expect, it } from 'vitest';
import { matLabel } from '../src/ui/hovertag';
import { LAB_ELEMENTS } from '../src/modes/chem';
import { Mat } from '../src/sim/materials';

describe('the name beside the cursor', () => {
  it('says a material as a person would, an element with its symbol', () => {
    expect(matLabel(Mat.WATER)).toBe('Water');
    expect(matLabel(Mat.IODINE_GAS)).toBe('Iodine gas');
    expect(matLabel(Mat.NA, 'Na')).toBe('Sodium Na');
    // the dozen grey metals are told apart by name: every element the lab has is named, none the same
    const names = [...LAB_ELEMENTS].map(([sym, m]) => matLabel(m, sym));
    expect(new Set(names).size).toBe(LAB_ELEMENTS.size);
  });
});
