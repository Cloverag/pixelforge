import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { MODES } from '../src/sim/protocol';
import { packSnapshot, unpackSnapshot } from '../src/net/pack';

/**
 * The mode travels in a joiner's snapshot as one byte. Every mode must come
 * back as itself, and a byte this build does not know must be refused - the
 * old decoder turned anything but the playground into a sandbox, so a third
 * mode would have restored as the wrong world without a word.
 */

/** offset of the mode byte: 20-byte header, then 6 length-prefixed arrays */
function modeByteAt(buf: Uint8Array): number {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let o = 20;
  for (let i = 0; i < 6; i++) o += 4 + dv.getUint32(o, true);
  expect(dv.getUint32(o, true)).toBe(1);
  return o + 4;
}

describe('snapshot mode byte', () => {
  for (const m of MODES) {
    it(`a ${m} world restores as ${m}`, () => {
      const w = new World(3);
      w.setMode(m);
      const snap = unpackSnapshot(packSnapshot(w.snapshot()));
      expect(snap.mode).toBe(m);
    });
  }

  it('keeps the bytes older builds wrote: sand 0, playground 1', () => {
    for (const [m, byte] of [['sand', 0], ['playground', 1]] as const) {
      const w = new World(3);
      w.setMode(m);
      const buf = packSnapshot(w.snapshot());
      expect(buf[modeByteAt(buf)]).toBe(byte);
    }
  });

  it('refuses a mode it does not know instead of restoring a sandbox', () => {
    const buf = packSnapshot(new World(3).snapshot());
    buf[modeByteAt(buf)] = 200;
    expect(() => unpackSnapshot(buf)).toThrow(/mode/);
  });
});
