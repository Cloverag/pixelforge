import type { NetInput, Snapshot } from '../sim/protocol';
import { GuestCore, HostCore, type Wire } from './lockstep';
import { HASH_STRIDE } from '../sim/protocol';
import { gunzip, gzip, packSnapshot, unpackSnapshot } from './pack';

/**
 * Co-op sandbox rooms over WebRTC, peer to peer.
 *
 * Trystero finds peers through public Nostr relays (no server of ours) and
 * then connects browsers directly. The room creator hosts: it sequences
 * everyone's inputs (HostCore) and hands each joiner a snapshot. Guests
 * step what the host sends (GuestCore). Loaded on demand, so single-player
 * never downloads the networking code.
 */

/** keeps PIXELFORGE rooms apart from every other Trystero app */
const APP_ID = 'pixelforge.cloverag.github.io/v1';
/** a guest that hears no host in this long gives up */
const JOIN_TIMEOUT_MS = 20_000;

/** what the session needs from the game */
export interface MpHooks {
  /** host: a snapshot of the world as it is now */
  snapshot(): Promise<Snapshot>;
  /** guest: become this world */
  restore(s: Snapshot): void;
  /** the number of people in the room changed (including me) */
  onPeople(n: number): void;
  /** something worth telling the player */
  onNotice(text: string, bad?: boolean): void;
  /** the session is over (host left, room not found); single-player resumes */
  onEnd(reason: string): void;
}

/** host -> guests: my world's fingerprint at frame f */
type HashMsg = { t: 'hash'; f: number; h: number; p?: number[] };
const PART_NAMES = ['cells', 'meta', 'clock', 'wake', 'wind', 'rng', 'frame'];
type HostMsg = Wire | { t: 'host' } | HashMsg;

/** result of comparing fingerprints with the host */
export interface SyncStats {
  checked: number;
  mismatches: number;
  /** first frame that did not match, or -1 */
  firstBad: number;
  /** which parts of the state differed at firstBad */
  badParts: string[];
}

/** six characters, no 0/O/1/I/L to misread off a screen */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function newRoomCode(): string {
  let s = '';
  for (let k = 0; k < 6; k++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export function roomUrl(code: string): string {
  return `${location.origin}${location.pathname}?room=${code}`;
}

/** Room code from the address bar, if this page was opened from a room link. */
export function roomFromUrl(): string | null {
  const c = new URLSearchParams(location.search).get('room');
  return c && /^[A-Z0-9]{4,12}$/i.test(c) ? c.toUpperCase() : null;
}

export class MpSession {
  host: HostCore | null = null;
  guest: GuestCore | null = null;
  /** guests: the peer that sent us our world */
  private hostId: string | null = null;
  private peers = new Set<string>();
  private room: { leave(): Promise<void> } | null = null;
  private sendWire!: (m: HostMsg, to?: string) => void;
  private sendSnap!: (data: Uint8Array, to: string, f: number) => void;
  private ended = false;
  /** guest: fingerprints seen so far, mine and the host's, by frame */
  private mine = new Map<number, number[]>();
  private theirs = new Map<number, number[]>();
  sync: SyncStats = { checked: 0, mismatches: 0, firstBad: -1, badParts: [] };
  /** snapshots sent (host) or received (guest) - more than one is a re-join */
  snapCount = 0;
  private joinTimer: ReturnType<typeof setTimeout> | null = null;

  private constructor(
    readonly code: string,
    private hooks: MpHooks,
  ) {}

  get role(): 'host' | 'guest' {
    return this.host ? 'host' : 'guest';
  }

  /** Create a room from the current world, as its host. */
  static async host(code: string, hooks: MpHooks): Promise<MpSession> {
    const s = new MpSession(code, hooks);
    const first = await hooks.snapshot();
    s.host = new HostCore((m, to) => s.sendWire(m, to));
    s.host.start(first.f);
    await s.connect();
    return s;
  }

  /** Join someone else's room. Steps nothing until the host's world arrives. */
  static async join(code: string, hooks: MpHooks): Promise<MpSession> {
    const s = new MpSession(code, hooks);
    s.guest = new GuestCore((m) => {
      if (s.hostId) s.sendWire(m, s.hostId);
    });
    await s.connect();
    s.joinTimer = setTimeout(() => {
      if (!s.hostId) s.end(`ROOM ${code} NOT FOUND - IS THE HOST STILL THERE?`);
    }, JOIN_TIMEOUT_MS);
    return s;
  }

  private async connect(): Promise<void> {
    const { joinRoom } = await import('trystero');
    const room = joinRoom({ appId: APP_ID }, this.code);
    this.room = room;
    const wire = room.makeAction<HostMsg>('w');
    const snap = room.makeAction<Uint8Array>('s');
    this.sendWire = (m, to) => void wire.send(m, to ? { target: to } : undefined);
    this.sendSnap = (data, to, f) => void snap.send(data, { target: to, metadata: { f } });

    wire.onMessage = (m, { peerId }) => {
      if (this.host) {
        // the host listens to guests' inputs only
        if (m.t === 'input') this.host.receive(m);
        return;
      }
      if (m.t === 'host') {
        if (!this.hostId) this.hostId = peerId;
        return;
      }
      // a guest takes frames from its host and nobody else
      if (peerId !== this.hostId) return;
      if (m.t === 'frame') this.guest!.receive(m);
      else if (m.t === 'hash') this.compare(m.f, undefined, [m.h, ...(m.p ?? [])]);
    };

    snap.onMessage = async (data, { peerId, metadata }) => {
      if (!this.guest || this.ended) return;
      if (this.hostId && peerId !== this.hostId) return;
      this.hostId = peerId;
      try {
        const s = unpackSnapshot(await gunzip(new Uint8Array(data as unknown as ArrayBuffer)));
        const f = (metadata as { f: number } | undefined)?.f ?? s.f;
        this.hooks.restore(s);
        this.guest.synced(f);
        this.snapCount++;
        if (this.joinTimer) clearTimeout(this.joinTimer);
        this.hooks.onNotice(`JOINED ROOM ${this.code}`);
      } catch {
        this.end('COULD NOT READ THE HOST\'S WORLD');
      }
    };

    room.onPeerJoin = (id) => {
      this.peers.add(id);
      this.hooks.onPeople(this.peers.size + 1);
      if (this.host) void this.welcome(id);
    };
    room.onPeerLeave = (id) => {
      this.peers.delete(id);
      this.hooks.onPeople(this.peers.size + 1);
      if (this.guest && id === this.hostId) this.end('THE HOST LEFT - THE WORLD IS YOURS NOW');
      else if (this.host) this.hooks.onNotice('A PLAYER LEFT');
    };
    this.hooks.onPeople(1);
  }

  /** host: send a joiner who's boss, then the world, then every frame since. */
  private async welcome(id: string): Promise<void> {
    const host = this.host!;
    this.sendWire({ t: 'host' }, id);
    const s = await this.hooks.snapshot();
    if (!host.canFollow(s.f)) {
      this.hooks.onNotice('A PLAYER COULD NOT JOIN - TRY AGAIN', true);
      return;
    }
    this.sendSnap(await gzip(packSnapshot(s)), id, s.f);
    this.snapCount++;
    for (const m of host.framesFrom(s.f)) this.sendWire(m, id);
    this.hooks.onNotice('A PLAYER JOINED');
  }

  /**
   * The worker's fingerprints, as [frame, hash] pairs. The host broadcasts
   * its own; a guest compares them with the host's for the same frame.
   */
  hashes(groups: number[]): void {
    for (let k = 0; k < groups.length; k += HASH_STRIDE) {
      const f = groups[k];
      const h = groups[k + 1];
      const p = groups.slice(k + 2, k + HASH_STRIDE);
      if (this.host) this.sendWire({ t: 'hash', f, h, p });
      else this.compare(f, [h, ...p], undefined);
    }
  }

  private compare(f: number, mine?: number[], theirs?: number[]): void {
    if (mine !== undefined) this.mine.set(f, mine);
    if (theirs !== undefined) this.theirs.set(f, theirs);
    const a = this.mine.get(f);
    const b = this.theirs.get(f);
    if (a === undefined || b === undefined) return;
    this.mine.delete(f);
    this.theirs.delete(f);
    this.sync.checked++;
    if (a[0] !== b[0]) {
      this.sync.mismatches++;
      if (this.sync.firstBad < 0) {
        this.sync.firstBad = f;
        this.sync.badParts = PART_NAMES.filter((_, i) => a[i + 1] !== b[i + 1]);
      }
    }
    // drop anything old that never found its pair (sent before we joined)
    for (const m of [this.mine, this.theirs]) for (const k of m.keys()) if (k < f - 600) m.delete(k);
  }

  /** My own world-changing actions. */
  local(inputs: NetInput[]): void {
    if (this.host) this.host.local(inputs);
    else this.guest!.local(inputs);
  }

  leave(): void {
    if (this.ended) return;
    this.ended = true;
    if (this.joinTimer) clearTimeout(this.joinTimer);
    void this.room?.leave();
  }

  private end(reason: string): void {
    if (this.ended) return;
    this.leave();
    this.hooks.onEnd(reason);
  }
}
