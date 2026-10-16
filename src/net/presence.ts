/**
 * Who is who in a room: a name and a colour per player, and the cursor each
 * one broadcasts. Presence never touches the shared world - it travels
 * peer to peer on its own channel and is free to be lossy.
 */

export interface Identity {
  name: string;
  color: string;
}

/** a cursor as sent on the wire, in sim cells (a type, not an interface:
 *  Trystero's payload type needs it to be plain JSON) */
export type CursorMsg = {
  /** position; hidden when the pointer is off the canvas */
  x: number;
  y: number;
  hidden?: boolean;
  /** brush size and material, shown while painting */
  s: number;
  m: number;
  /** button held: painting */
  d: boolean;
  /** tool: brush, erase, wind or fill */
  k?: 'b' | 'e' | 'w' | 'f';
  /** who: sent every time, so a joiner learns names without a handshake */
  n: string;
  c: string;
};

export interface PeerInfo extends Identity {
  id: string;
  /** round trip in ms, or -1 until measured */
  ping: number;
}

const ADJ = ['SANDY', 'MOLTEN', 'FROSTY', 'SPARKY', 'MOSSY', 'SMOKY', 'SALTY', 'BLAZING', 'MISTY', 'RUSTY', 'GLASSY', 'STORMY'];
const ANIMALS = ['FOX', 'OTTER', 'OWL', 'NEWT', 'CROW', 'MOLE', 'LYNX', 'HARE', 'WREN', 'TOAD', 'BAT', 'YAK'];
/** distinct on a dark canvas, none close to a common material colour */
export const PLAYER_COLORS = ['#ff6b9d', '#4fd1ff', '#b48cff', '#ffd23f', '#6cf0a0', '#ff9a4f', '#f06bff', '#9dff4f'];

const KEY = 'pf-identity';

/** This device's name and colour, made up once and kept. */
export function myIdentity(): Identity {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (v && typeof v.name === 'string' && typeof v.color === 'string') return v;
  } catch {
    /* fall through and make one */
  }
  const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
  const id: Identity = { name: `${pick(ADJ)} ${pick(ANIMALS)}`, color: pick(PLAYER_COLORS) };
  try {
    localStorage.setItem(KEY, JSON.stringify(id));
  } catch {
    /* not kept, still used */
  }
  return id;
}

/** "SANDY FOX" -> "SF" */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2);
}

/** Names: capitals, digits and spaces, up to 14 characters. */
export function cleanName(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 14);
}

export function saveIdentity(id: Identity): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(id));
  } catch {
    /* not kept, still used this session */
  }
}

/** quick reactions; PING is a "look here" marker rather than an emoji */
export const EMOTES = ['👍', '🔥', '😂', '😮', '❤️'];
export const PING = -1;

/** a reaction on the wire: which one, where (sim cells), and who */
export type EmoteMsg = {
  e: number;
  x: number;
  y: number;
  n: string;
  c: string;
};

