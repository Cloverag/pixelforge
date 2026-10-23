import { describe, expect, it } from 'vitest';
import { Mat } from '../src/sim/materials';
import { RULES } from '../src/sim/reactions';
import { RxWindow, readoutNote } from '../src/modes/rxwindow';

/**
 * The reactions readout's window: a rolling second, the busiest rule in it,
 * and a note for that rule. All with injected times - no clock.
 */

describe('RxWindow', () => {
  it('an empty window reads 0 and no top rule', () => {
    expect(new RxWindow().read(5000)).toEqual({ rate: 0, top: null });
  });

  it('adds up counts across samples inside the window', () => {
    const w = new RxWindow();
    w.add(100, [2, 5, 7, 1]);
    w.add(400, [2, 3]);
    expect(w.read(500).rate).toBe(9);
  });

  it('drops samples a full second old, and reads 0 once they are all gone', () => {
    const w = new RxWindow();
    w.add(0, [4, 10]);
    expect(w.read(999).rate).toBe(10); // 999 ms old: still in
    expect(w.read(1000)).toEqual({ rate: 0, top: null }); // exactly 1000 ms: out
    w.add(2000, [4, 6]);
    expect(w.read(2500).rate).toBe(6);
    expect(w.read(60_000)).toEqual({ rate: 0, top: null }); // a stale line never lingers
  });

  it('the top rule is the one fired most in the window, summed across samples', () => {
    const w = new RxWindow();
    w.add(100, [2, 5, 7, 3]);
    w.add(200, [7, 4]); // rule 7: 3 + 4 = 7, rule 2: 5
    expect(w.read(300).top).toBe(7);
  });

  it('a rule that dominated earlier but has left the window is not the top', () => {
    const w = new RxWindow();
    w.add(0, [9, 100]);
    w.add(900, [3, 2]);
    expect(w.read(1000).top).toBe(3); // rule 9's burst is 1000 ms old
  });

  it('a tie goes to the lowest rule index', () => {
    const w = new RxWindow();
    w.add(0, [8, 4, 3, 4, 5, 4]);
    expect(w.read(10).top).toBe(3);
  });

  it('an empty report adds nothing', () => {
    const w = new RxWindow();
    w.add(0, []);
    expect(w.read(1)).toEqual({ rate: 0, top: null });
  });
});

describe('readoutNote', () => {
  it("is the rule's A side and its note, lowercase element first", () => {
    const i = RULES.findIndex((r) => r.a === Mat.NA && r.b === Mat.WATER);
    expect(readoutNote(i)).toBe('sodium: fizzes in water, sometimes catches fire');
    const j = RULES.findIndex((r) => r.a === Mat.CS && r.b === Mat.WATER);
    expect(readoutNote(j)).toBe('caesium: explodes in water');
  });
});
