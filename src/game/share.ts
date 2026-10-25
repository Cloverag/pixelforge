import { b64ToBytes, bytesToB64, rlePack, rleUnpack } from './rle';

/**
 * Shareable world codes.
 *
 * A code is `<tag><base64url>`, where the tag says how the RLE stream was
 * packed: `z` for gzip (every browser with CompressionStream), `r` for raw
 * (everything else). Keeping the tag in the string means a code made on a
 * modern browser still decodes on an old one and vice versa, instead of
 * turning into an unreadable blob.
 */

const GZIP = 'z';
const RAW = 'r';

/** Past this the URL stops being pasteable in most places. */
export const CODE_WARN_LEN = 8000;

function toUrlSafe(b64: string): string {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromUrlSafe(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return b64 + '='.repeat((4 - (b64.length % 4)) % 4);
}

function hasCompression(): boolean {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

async function gzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  void writer.write(bytes);
  void writer.close();
  return drain(cs.readable);
}

async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  void writer.write(bytes);
  void writer.close();
  return drain(ds.readable);
}

/** Packs a world snapshot into a URL-safe code. */
export async function encodeShare(cells: Uint8Array, meta: Uint8Array): Promise<string> {
  // subarray view -> own buffer, because CompressionStream takes the whole
  // underlying ArrayBuffer of a view, not the view's window into it
  const packed = new Uint8Array(rlePack(cells, meta));
  if (!hasCompression()) return RAW + toUrlSafe(bytesToB64(packed));
  try {
    return GZIP + toUrlSafe(bytesToB64(await gzip(packed)));
  } catch {
    return RAW + toUrlSafe(bytesToB64(packed));
  }
}

/** Inverse of `encodeShare`. Returns null for anything malformed. */
export async function decodeShare(
  code: string,
  size: number,
): Promise<{ a: Uint8Array; b: Uint8Array } | null> {
  try {
    const tag = code[0];
    const body = b64ToBytes(fromUrlSafe(code.slice(1)));
    if (tag === RAW) return rleUnpack(body, size);
    if (tag !== GZIP || !hasCompression()) return null;
    return rleUnpack(await gunzip(body), size);
  } catch {
    return null;
  }
}

/** The full link a player pastes to someone else. */
export function shareUrl(code: string, key: 'w' | 'g' | 'm' | 'e' = 'w'): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#${key}=${code}`;
}

/** Reads a code out of the current URL (`#w=` a world, `#g=` a garden, `#m=` a math design, `#e=` an element), and clears it so reloads start fresh. */
export function takeUrlCode(key: 'w' | 'g' | 'm' | 'e' = 'w'): string | null {
  const m = new RegExp(`[#&]${key}=([A-Za-z0-9\\-_]+)`).exec(window.location.hash);
  if (!m) return null;
  history.replaceState(null, '', window.location.pathname + window.location.search);
  return m[1];
}

/** Clipboard write, with the reason it failed rather than a bare false. */
export async function copyText(text: string): Promise<boolean> {
  try {
    // navigator.clipboard is undefined outside secure contexts (plain http)
    if (!navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
