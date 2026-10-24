import { describe, expect, it } from 'vitest';
import { compile } from '../src/mathlab/expr';

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
