import { describe, expect, it } from 'vitest';
import { BRUSH_SIZES, nearestBrush, titleCase } from '../src/ui/hud';

/** The rail's two small pure pieces: which brush dot is lit, and how names are shown. */

describe('the brush dots', () => {
  it('there are five, growing, inside the brush range 2..24', () => {
    expect(BRUSH_SIZES).toHaveLength(5);
    expect([...BRUSH_SIZES].sort((a, b) => a - b)).toEqual([...BRUSH_SIZES]);
    expect(BRUSH_SIZES[0]).toBe(2);
    expect(BRUSH_SIZES[4]).toBe(24);
  });

  it('each preset lights its own dot', () => {
    BRUSH_SIZES.forEach((n, i) => expect(nearestBrush(n)).toBe(i));
  });

  it('the wheel and [ ] reach every size: the lit dot is the nearest one, and never skips backwards', () => {
    let last = 0;
    for (let n = 2; n <= 24; n++) {
      const i = nearestBrush(n);
      expect(i).toBeGreaterThanOrEqual(last);
      last = i;
    }
    expect(nearestBrush(2)).toBe(0);
    expect(nearestBrush(8)).toBe(1); // 6 is nearer than 12
    expect(nearestBrush(10)).toBe(2); // 12 is nearer than 6
    expect(nearestBrush(24)).toBe(4);
  });
});

describe('names in the rail', () => {
  it('are sentence type, one capital per word', () => {
    expect(titleCase('SAND')).toBe('Sand');
    expect(titleCase('BLACK HOLE')).toBe('Black Hole');
    expect(titleCase('SLOW-MO')).toBe('Slow-mo');
  });
});
