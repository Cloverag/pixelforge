import { describe, expect, it } from 'vitest';
import katex from 'katex';
import { compile, toTex } from '../src/mathlab/expr';
import { YOURS } from '../src/mathlab/drawings';

const at = (src: string, t: number) => compile(src, ['t'])({ t });

describe('YOUR CURVE formula reader', () => {
  it('reads the usual order of operations', () => {
    expect(at('1 + 2 * 3', 0)).toBe(7);
    expect(at('(1 + 2) * 3', 0)).toBe(9);
    expect(at('2^3^2', 0)).toBe(512); // right to left
    expect(at('-2^2', 0)).toBe(-4);
    expect(at('8 / 4 / 2', 0)).toBe(1); // left to right
    expect(at('10 - 4 - 3', 0)).toBe(3);
  });

  it('knows t, pi, e and functions, and reads 2t and sint the way people write them', () => {
    expect(at('2t', 3)).toBe(6);
    expect(at('3sin(t)', Math.PI / 2)).toBeCloseTo(3);
    expect(at('sint', Math.PI / 2)).toBeCloseTo(1);
    expect(at('sin t', Math.PI / 2)).toBeCloseTo(1);
    expect(at('2sin(t)^2', Math.PI / 2)).toBeCloseTo(2);
    expect(at('1 + 2cos(5t)', 0)).toBe(3);
    expect(at('exp(sin(t)) - 2cos(4t)', 0)).toBeCloseTo(-1);
    expect(at('pi', 0)).toBeCloseTo(Math.PI);
    expect(at('(t)(t)', 4)).toBe(16);
  });

  it('refuses what it cannot read, with a message that says why', () => {
    expect(() => compile('1 +', ['t'])).toThrow(/too soon/);
    expect(() => compile('sin', ['t'])).toThrow(/too soon/);
    expect(() => compile('(t + 1', ['t'])).toThrow(/missing '\)'/);
    expect(() => compile('x + 1', ['t'])).toThrow(/unknown name 'x'/);
    expect(() => compile('alert(1)', ['t'])).toThrow(/unknown name/);
    expect(() => compile('t ; 1', ['t'])).toThrow(/unexpected ';'/);
  });
});

describe('YOUR CURVE typeset', () => {
  const tex = (src: string) => toTex(src, ['t']);

  it('prints the formula the way a book does', () => {
    expect(tex('t / 6')).toBe('\\frac{t}{6}');
    expect(tex('1 + 2cos(5t)')).toBe('1 + 2 \\cos\\left(5 t\\right)');
    expect(tex('sin(t)^2')).toBe('\\sin^{2} t');
    expect(tex('exp(sin t)')).toBe('e^{\\sin t}');
    expect(tex('sqrt(abs(t))')).toBe('\\sqrt{\\left|t\\right|}');
    expect(tex('pi t')).toBe('\\pi t');
    expect(tex('.5t')).toBe('0.5 t');
  });

  it('keeps the brackets that change the meaning, and only those', () => {
    expect(tex('1 - (t + 2)')).toBe('1 - \\left(t + 2\\right)');
    expect(tex('1 - t + 2')).toBe('1 - t + 2');
    expect(tex('(1 + t)^2')).toBe('{\\left(1 + t\\right)}^{2}');
    expect(tex('-2^2')).toBe('-{2}^{2}');
    // sin t 2 would read as sin(2t): a function followed by a factor keeps its brackets
    expect(tex('sin(t) * 2')).toBe('\\sin\\left(t\\right) \\cdot 2');
    expect(tex('t sin(t) * 2')).toBe('t \\sin\\left(t\\right) \\cdot 2');
    expect(tex('t sin t')).toBe('t \\sin t');
  });

  it('refuses what compile refuses, with the same message', () => {
    for (const bad of ['1 +', '(t + 1', 'x + 1', 'alert(1)']) expect(() => tex(bad)).toThrow(/too soon|missing|unknown name/);
  });

  it('every idea offered under the box typesets without a KaTeX error', () => {
    for (const ex of YOURS.formula!.examples) expect(() => katex.renderToString(tex(ex), { throwOnError: true }), ex).not.toThrow();
  });
});
