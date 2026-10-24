import { describe, expect, it } from 'vitest';
import { defaults, DRAWINGS } from '../src/mathlab/drawings';
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
        const code = d.code(p);
        const st = d.strokes(p);
        expect(st.length, d.id).toBeGreaterThan(0);
        // the lit lines are ones that draw, not a blank or a bare `return`
        for (const l of new Set(st.map((s) => s.line))) expect(code[l] ?? '', `${d.id} line ${l}`).toMatch(/line|circle|ellipse|forward/);
        expect(st.every((s) => [s.x1, s.y1, s.x2, s.y2, s.w].every(Number.isFinite)), d.id).toBe(true);
      }
  });

  it('a drawing is the same every time, and none is too big to draw', () => {
    for (const d of DRAWINGS)
      for (const p of settings(d)) {
        expect(d.strokes(p)).toEqual(d.strokes(p));
        expect(d.strokes(p).length, d.id).toBeLessThan(120_000);
      }
  });

  it('the code shows the slider values: moving any slider changes it', () => {
    for (const d of DRAWINGS) {
      const p = defaults(d);
      const text = d.code(p).join('\n');
      for (const q of d.params) {
        const moved = d.code({ ...p, [q.key]: p[q.key] === q.max ? q.min : q.max }).join('\n');
        expect(moved, `${d.id}.${q.key}`).not.toBe(text);
      }
    }
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
