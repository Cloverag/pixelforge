import type { Snapshot } from '../sim/protocol';

/**
 * A snapshot as one byte buffer, for sending to a joiner, and gzip around
 * it: a sandbox is mostly empty cells, so ~1 MB of state shrinks to a few
 * tens of KB.
 *
 * Layout: magic, version, f, rng, shadeSeed (u32 each), then each array as
 * u32 length + bytes, in a fixed order.
 */

const MAGIC = 0x50465331; // "PFS1"
const FIELDS = ['cells', 'meta', 'clock', 'shade', 'wake'] as const;

export function packSnapshot(s: Snapshot): Uint8Array {
  const wind = new Uint8Array(s.wind.buffer, s.wind.byteOffset, s.wind.byteLength);
  // Grain colours are random bytes, which do not compress - a near-empty
  // world still gzipped to 235 KB. An empty cell's colour is never drawn
  // (a grain carries its own colour when it moves, and a new grain rolls a
  // fresh one), so zero those.
  const shade = s.shade.slice();
  for (let i = 0; i < shade.length; i++) if (s.cells[i] === 0) shade[i] = 0;
  const parts: Uint8Array[] = [...FIELDS.map((k) => (k === 'shade' ? shade : s[k])), wind];
  const size = 5 * 4 + parts.reduce((a, p) => a + 4 + p.byteLength, 0);
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  let o = 0;
  for (const v of [MAGIC, 1, s.f, s.rng, s.shadeSeed]) {
    dv.setUint32(o, v >>> 0, true);
    o += 4;
  }
  for (const p of parts) {
    dv.setUint32(o, p.byteLength, true);
    o += 4;
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}

export function unpackSnapshot(buf: Uint8Array): Snapshot {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('not a PIXELFORGE snapshot');
  let o = 8;
  const f = dv.getUint32(o, true);
  const rng = dv.getUint32(o + 4, true);
  const shadeSeed = dv.getUint32(o + 8, true);
  o += 12;
  const take = (): Uint8Array => {
    const n = dv.getUint32(o, true);
    o += 4;
    const a = buf.slice(o, o + n);
    o += n;
    return a;
  };
  const [cells, meta, clock, shade, wake] = FIELDS.map(take);
  const w = take();
  return { f, rng, shadeSeed, cells, meta, clock, shade, wake, wind: new Float32Array(w.buffer, w.byteOffset, w.byteLength / 4) };
}

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export const gzip = (d: Uint8Array) => pipe(d, new CompressionStream('gzip'));
export const gunzip = (d: Uint8Array) => pipe(d, new DecompressionStream('gzip'));
