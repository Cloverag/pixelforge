/** Run-length encode two byte arrays into a compact base64 blob. */
export function rleEncode(a: Uint8Array, b: Uint8Array): string {
  const out: number[] = [];
  const push = (val: number, count: number) => {
    while (count > 0) {
      const run = Math.min(count, 0xffff);
      out.push(run & 255, (run >> 8) & 255, val);
      count -= run;
    }
  };
  for (const arr of [a, b]) {
    let i = 0;
    while (i < arr.length) {
      const v = arr[i];
      let n = 1;
      while (n < 0xffff && i + n < arr.length && arr[i + n] === v) n++;
      push(v, n);
      i += n;
    }
  }
  return btoa(String.fromCharCode(...out));
}

export function rleDecode(blob: string, size: number): { a: Uint8Array; b: Uint8Array } | null {
  try {
    const bin = atob(blob);
    const a = new Uint8Array(size);
    const b = new Uint8Array(size);
    const targets = [a, b];
    let ti = 0;
    let pos = 0;
    let idx = 0;
    while (pos + 3 <= bin.length) {
      const run = bin.charCodeAt(pos) | (bin.charCodeAt(pos + 1) << 8);
      const val = bin.charCodeAt(pos + 2);
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
