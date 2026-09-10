import { describe, expect, it } from 'vitest';
import { rleEncode, rleDecode, rlePack, rleUnpack } from '../src/game/rle';
import { decodeShare, encodeShare } from '../src/game/share';

const SIZE = 4096;

/** A world-ish pair of arrays: long empty runs plus a noisy patch. */
function fixture(seed = 1): { cells: Uint8Array; meta: Uint8Array } {
  const cells = new Uint8Array(SIZE);
  const meta = new Uint8Array(SIZE);
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) >>> 16) & 255;
  for (let i = 1000; i < 3000; i++) {
    cells[i] = rnd() % 26;
    meta[i] = rnd() % 8;
  }
  return { cells, meta };
}

describe('rle', () => {
  it('round-trips through base64', () => {
    const { cells, meta } = fixture();
    const d = rleDecode(rleEncode(cells, meta), SIZE);
    expect(d).not.toBeNull();
    expect(Array.from(d!.a)).toEqual(Array.from(cells));
    expect(Array.from(d!.b)).toEqual(Array.from(meta));
  });

  it('encodes a worst-case world without blowing the call stack', () => {
    // every cell its own run: the old String.fromCharCode(...out) spread threw
    // RangeError here, so SAVE failed with no toast on any busy world
    const big = 200_000;
    const cells = new Uint8Array(big);
    const meta = new Uint8Array(big);
    for (let i = 0; i < big; i++) cells[i] = i % 251;
    expect(() => rleEncode(cells, meta)).not.toThrow();
    const d = rleDecode(rleEncode(cells, meta), big);
    expect(d).not.toBeNull();
    expect(d!.a[199_999]).toBe(199_999 % 251);
  });

  it('rejects a stream that does not fill both arrays', () => {
    const short = rlePack(new Uint8Array(8), new Uint8Array(8));
    expect(rleUnpack(short, SIZE)).toBeNull();
  });

  it('rejects garbage', () => {
    expect(rleDecode('not base64 !!!', SIZE)).toBeNull();
  });
});

describe('share codes', () => {
  it('round-trips a world through a URL-safe code', async () => {
    const { cells, meta } = fixture(9);
    const code = await encodeShare(cells, meta);
    expect(code).toMatch(/^[zr][A-Za-z0-9\-_]+$/);
    const d = await decodeShare(code, SIZE);
    expect(d).not.toBeNull();
    expect(Array.from(d!.a)).toEqual(Array.from(cells));
    expect(Array.from(d!.b)).toEqual(Array.from(meta));
  });

  it('gzips, and beats raw base64 on a realistic world', async () => {
    const { cells, meta } = fixture(3);
    const code = await encodeShare(cells, meta);
    expect(code[0]).toBe('z');
    expect(code.length).toBeLessThan(rleEncode(cells, meta).length);
  });

  it('returns null for a corrupted code instead of throwing', async () => {
    await expect(decodeShare('z@@@not-base64@@@', SIZE)).resolves.toBeNull();
    await expect(decodeShare('', SIZE)).resolves.toBeNull();
    await expect(decodeShare('q' + 'AAAA', SIZE)).resolves.toBeNull();
  });
});
