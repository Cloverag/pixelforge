import { describe, expect, it } from 'vitest';
import { MATS } from '../src/sim/materials';
import { BRUSH_SIZES, nearestBrush, titleCase, inkFor, materialSections, pillColor, pillPaint, rampGradient } from '../src/ui/hud';

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

describe('dock buttons in their own colour', () => {
  it('fill with the body colour: the second stop of a ramp or a two-tone chip', () => {
    expect(pillColor('linear-gradient(135deg, #aaaaaa 0 25%, #c8a040 25% 50%, #000000 50% 75%, #ffffff 75% 100%)')).toBe('#c8a040');
    expect(pillColor('linear-gradient(135deg,#7fd8ff 0 50%,#2b7fd4 50% 100%)')).toBe('#2b7fd4');
    expect(pillColor('#123456')).toBe('#123456');
    expect(pillColor('var(--world-bg)')).toBeNull();
  });

  it('every sandbox material gets a fill, and its text reads on it (contrast 4.5:1 or more)', () => {
    // the test has its own contrast maths, so it checks pillPaint rather than repeating it
    const lum = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      const lin = (c: number) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
      return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    };
    const contrast = (a: string, b: string) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    for (const sec of materialSections(null)) {
      if (!('swatches' in sec)) continue;
      for (const sw of sec.swatches.filter((s) => !s.dashed)) {
        const c = pillColor(sw.chip);
        expect(c, sw.label).not.toBeNull();
        const { fill, ink } = pillPaint(c!);
        expect(contrast(fill, ink), sw.label).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('so does every material and element in the game (the chem lab uses the same ramps)', () => {
    for (const m of MATS) {
      if (!m || m.id === 0) continue;
      const { fill, ink } = pillPaint(pillColor(rampGradient(m.ramp))!);
      const [a, b] = [fill, ink].map((h) => {
        const n = parseInt(h.slice(1), 16);
        const lin = (c: number) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
        return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
      }).sort((p, q) => q - p);
      expect((a + 0.05) / (b + 0.05), m.name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('takes dark text on a light fill and white on a dark one', () => {
    expect(inkFor('#f0f0f0')).toBe('#15171d');
    expect(inkFor('#202020')).toBe('#ffffff');
    // a mid-light grey reads far better with dark text (7:1) than white (2.6:1)
    expect(inkFor('#a0a0a0')).toBe('#15171d');
  });
});
