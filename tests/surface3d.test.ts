import { describe, expect, it } from 'vitest';
import { gridIndex } from '../src/mathlab/surface3d';

const NU = 5;
const NV = 4;
const g = gridIndex(NU, NV);
const row = (k: number) => Math.floor(k / NU);
const edges = (seg: number[]) => {
  const out = new Set<string>();
  for (let k = 0; k < seg.length; k += 2) out.add([seg[k], seg[k + 1]].sort((a, b) => a - b).join('-'));
  return out;
};

describe('gridIndex: a 3D graph built a row at a time', () => {
  it('covers every quad and every mesh line once, finished', () => {
    expect(g.tri.length).toBe(g.triCount(NV - 1));
    expect(g.tri.length).toBe((NU - 1) * (NV - 1) * 6);
    expect(g.seg.length).toBe(g.segCount(NV - 1));
    const all = edges(g.seg);
    expect(all.size).toBe(g.seg.length / 2);
    expect(all.size).toBe((NU - 1) * NV + NU * (NV - 1));
  });

  it('draws, part built, only rows that are built and every line among them', () => {
    for (let r = 1; r < NV; r++) {
      const tri = g.tri.slice(0, g.triCount(r));
      expect(Math.max(...tri.map(row))).toBe(r);
      const seg = g.seg.slice(0, g.segCount(r));
      expect(Math.max(...seg.map(row))).toBe(r);
      // the lines of rows 0..r: across each of r + 1 rows, up between r pairs
      expect(edges(seg).size).toBe((NU - 1) * (r + 1) + NU * r);
    }
    expect(g.segCount(0)).toBe(0);
  });
});
