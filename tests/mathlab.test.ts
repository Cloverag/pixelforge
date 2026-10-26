import { describe, expect, it } from 'vitest';
import katex from 'katex';
import { defaults, DRAWINGS as BASE, MATH_FLOWERS, YOURS } from '../src/mathlab/drawings';
import { decodeDesign, encodeDesign } from '../src/mathlab/link';

/** every stroke drawing, YOUR CURVE with its starting formula */
const DRAWINGS = [...BASE, ...MATH_FLOWERS, YOURS];
const F = (d: (typeof DRAWINGS)[number]) => d.formula?.value;
import { SURFACES } from '../src/mathlab/surface';

/** each drawing at its sliders' lowest, starting and highest values */
function settings(d: (typeof DRAWINGS)[number]): Record<string, number>[] {
  const at = (pick: (q: (typeof d.params)[number]) => number) => Object.fromEntries(d.params.map((q) => [q.key, pick(q)]));
  return [at((q) => q.min), defaults(d), at((q) => q.max)];
}

describe('MATH LAB drawings', () => {
  it('every stroke lights a real line of its code, at any slider setting', () => {
    for (const d of DRAWINGS)
      for (const p of settings(d)) {
        const code = d.code(p, F(d));
        const st = d.strokes(p, F(d));
        expect(st.length, d.id).toBeGreaterThan(0);
        // the lit lines are ones that draw, not a blank or a bare `return`
        for (const l of new Set(st.map((s) => s.line))) expect(code[l] ?? '', `${d.id} line ${l}`).toMatch(/line|circle|ellipse|forward/);
        expect(st.every((s) => [s.x1, s.y1, s.x2, s.y2, s.w].every(Number.isFinite)), d.id).toBe(true);
      }
  });

  it('a drawing is the same every time, and none is too big to draw', () => {
    for (const d of DRAWINGS)
      for (const p of settings(d)) {
        expect(d.strokes(p, F(d))).toEqual(d.strokes(p, F(d)));
        expect(d.strokes(p, F(d)).length, d.id).toBeLessThan(120_000);
      }
  });

  it('the code shows the slider values: moving any slider changes it', () => {
    for (const d of DRAWINGS) {
      const p = defaults(d);
      const text = d.code(p, F(d)).join('\n');
      for (const q of d.params) {
        const moved = d.code({ ...p, [q.key]: p[q.key] === q.max ? q.min : q.max }, F(d)).join('\n');
        expect(moved, `${d.id}.${q.key}`).not.toBe(text);
      }
    }
  });
});

describe('MATH LAB formulas (KaTeX)', () => {
  const ok = (tex: string | null, what: string) => {
    expect(tex, what).toBeTypeOf('string');
    expect(() => katex.renderToString(tex!, { displayMode: true, throwOnError: true }), what).not.toThrow();
  };

  it('every drawing and 3D graph typesets its maths at any slider setting', () => {
    for (const d of DRAWINGS) for (const p of settings(d)) ok(d.tex(p, F(d)), d.id);
    const ends = (s: (typeof SURFACES)[number]) => [Object.fromEntries(s.params.map((q) => [q.key, q.min])), defaults(s), Object.fromEntries(s.params.map((q) => [q.key, q.max]))];
    for (const s of SURFACES) for (const p of ends(s)) ok(s.tex(p), s.id);
  });

  it("YOUR CURVE shows the player's own formula, and nothing for one it cannot read", () => {
    expect(YOURS.tex(defaults(YOURS), 't / 6')).toBe('r(t) = \\frac{t}{6}');
    expect(YOURS.tex(defaults(YOURS), '1 +')).toBeNull();
  });

  it('a slider that is in the maths changes the typeset formula', () => {
    const p = { ...defaults(SURFACES.find((s) => s.id === 'saddle')!) };
    const saddle = SURFACES.find((s) => s.id === 'saddle')!;
    expect(saddle.tex({ ...p, k: 1 })).toBe('z =  \\left(x^2 - y^2\\right)');
    expect(saddle.tex({ ...p, k: -1.5 })).toBe('z = -1.5\\, \\left(x^2 - y^2\\right)');
  });
});

describe('MATH LAB 3D graphs', () => {
  const at = (s: (typeof SURFACES)[number], pick: (q: (typeof s.params)[number]) => number) => Object.fromEntries(s.params.map((q) => [q.key, pick(q)]));

  it('every surface is a full grid of real points at any slider setting', () => {
    for (const s of SURFACES)
      for (const p of [at(s, (q) => q.min), defaults(s), at(s, (q) => q.max)]) {
        const m = s.mesh(p);
        expect(m.pts.length, s.id).toBe(m.nu * m.nv);
        expect(m.pts.every((v) => v.every(Number.isFinite)), s.id).toBe(true);
      }
  });

  it('the line lit while it builds is the one that makes the surface, and every slider shows in the code', () => {
    for (const s of SURFACES) {
      const p = defaults(s);
      expect(s.code(p)[s.plotLine], s.id).toMatch(/surface\(/);
      const text = s.code(p).join('\n');
      for (const q of s.params) expect(s.code({ ...p, [q.key]: p[q.key] === q.max ? q.min : q.max }).join('\n'), `${s.id}.${q.key}`).not.toBe(text);
    }
  });
});

describe('MATH LAB design links', () => {
  it('bring back the drawing, its numbers and the formula', () => {
    const got = decodeDesign(encodeDesign('yours', { turns: 7 }, 'cos(4t) + sin(t)'), DRAWINGS)!;
    expect(got.item).toBe(YOURS);
    expect(got.params).toEqual({ turns: 7 });
    expect(got.formula).toBe('cos(4t) + sin(t)');
    const sun = decodeDesign(encodeDesign('sunflower', { n: 300, angle: 137.6, size: 2 }), DRAWINGS)!;
    expect([sun.item.id, sun.params.angle, sun.formula]).toEqual(['sunflower', 137.6, undefined]);
  });

  it('trust nothing: unknown drawings and junk are refused, numbers kept to their sliders', () => {
    expect(decodeDesign('!!!', DRAWINGS)).toBeNull();
    expect(decodeDesign(encodeDesign('nope', {}), DRAWINGS)).toBeNull();
    const wild = decodeDesign(encodeDesign('sunflower', { n: 1e9, angle: -5 }), DRAWINGS)!;
    expect(wild.params).toEqual({ n: 2000, angle: 130, size: 2.5 }); // clamped, and the missing one at its start
    expect(decodeDesign(encodeDesign('yours', {}, 'x'.repeat(9000)), DRAWINGS)!.formula!.length).toBe(4000);
  });
});
