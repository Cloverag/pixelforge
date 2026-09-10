/**
 * Run-length encoding for world snapshots.
 *
 * The packed form is a flat byte stream of `[countLo, countHi, value]`
 * triples, array `a` followed by array `b`. `rleEncode`/`rleDecode` wrap it in
 * base64 for localStorage; `rlePack`/`rleUnpack` hand out the raw bytes so the
 * share codes can gzip them first.
 */

/** Run-length encode two byte arrays into a flat byte stream. */
export function rlePack(a: Uint8Array, b: Uint8Array): Uint8Array {
  // worst case is one run per cell; grow-and-trim beats counting runs twice
  let out = new Uint8Array(4096);
  let n = 0;
  const put = (val: number, count: number) => {
    while (count > 0) {
      const run = Math.min(count, 0xffff);
      if (n + 3 > out.length) {
        const bigger = new Uint8Array(Math.max(out.length * 2, n + 3));
        bigger.set(out.subarray(0, n));
        out = bigger;
      }
      out[n++] = run & 255;
      out[n++] = (run >> 8) & 255;
      out[n++] = val;
      count -= run;
    }
  };
  for (const arr of [a, b]) {
    let i = 0;
    while (i < arr.length) {
      const v = arr[i];
      let k = 1;
      while (k < 0xffff && i + k < arr.length && arr[i + k] === v) k++;
      put(v, k);
      i += k;
    }
  }
  return out.subarray(0, n);
}

/** Inverse of `rlePack`. Returns null if the stream does not fill both arrays. */
export function rleUnpack(bin: Uint8Array, size: number): { a: Uint8Array; b: Uint8Array } | null {
  const a = new Uint8Array(size);
  const b = new Uint8Array(size);
  const targets = [a, b];
  let ti = 0;
  let pos = 0;
  let idx = 0;
  while (pos + 3 <= bin.length) {
    const run = bin[pos] | (bin[pos + 1] << 8);
    const val = bin[pos + 2];
    pos += 3;
    const target = targets[ti];
    if (idx + run > size) return null;
    target.fill(val, idx, idx + run);
    idx += run;
    if (idx >= size) {
      ti++;
      idx = 0;
      if (ti > 1) break;
    }
  }
  if (ti < 1 || (ti === 1 && idx !== 0)) return null;
  return { a, b };
}

/**
 * base64 for a byte array.
 *
 * `String.fromCharCode(...bytes)` spreads every byte into an argument list, so
 * it threw RangeError on any world with more than ~40k runs - which is most
 * of them once sand has actually piled up. Saving then failed with an uncaught
 * error and no toast at all. Chunked so the argument list stays small.
 */
export function bytesToB64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let s = '';
  for (let i = 0; i < bytes.length; i += CHUNK)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  return btoa(s);
}

export function b64ToBytes(blob: string): Uint8Array<ArrayBuffer> {
  const bin = atob(blob);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Run-length encode two byte arrays into a compact base64 blob. */
export function rleEncode(a: Uint8Array, b: Uint8Array): string {
  return bytesToB64(rlePack(a, b));
}

export function rleDecode(blob: string, size: number): { a: Uint8Array; b: Uint8Array } | null {
  try {
    return rleUnpack(b64ToBytes(blob), size);
  } catch {
    return null;
  }
}

const SAVE_KEY = 'pixelforge.save';

export function storeSave(blob: string): boolean {
  try {
    localStorage.setItem(SAVE_KEY, blob);
    return true;
  } catch {
    return false;
  }
}

export function readSave(): string | null {
  try {
    return localStorage.getItem(SAVE_KEY);
  } catch {
    return null;
  }
}
