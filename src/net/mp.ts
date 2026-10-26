import type { NetInput, Snapshot } from '../sim/protocol';
import { GuestCore, HostCore, type Wire } from './lockstep';
import { HASH_STRIDE } from '../sim/protocol';
import { gunzip, gzip, packSnapshot, unpackSnapshot } from './pack';
import type { CursorMsg, EmoteMsg, Identity, PeerInfo } from './presence';

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
/**
 * The most people in one room, the host included. Every browser connects to
 * every other and the host sends each frame to every guest, so a room stays
 * small; a class splits into several rooms instead.
 */
export const ROOM_MAX = 9;
/** host: whether one more can join, with `guests` already in */
export const roomHasSpace = (guests: number): boolean => guests + 1 < ROOM_MAX;

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
  /** the other players, with names, colours and ping, changed */
  onRoster(peers: PeerInfo[]): void;
  /** another player's cursor moved; null when they left */
  onCursor(id: string, c: CursorMsg | null): void;
  /** guest: the host dropped out and we are waiting for it to come back */
  onWaiting(waiting: boolean): void;
  /** someone reacted (an emoji, or a ping); from is their peer id, null for mine */
  onEmote(e: EmoteMsg, from: string | null): void;
}

/** a guest waits this long for a host that dropped (reloaded, lost signal) */
const HOST_GRACE_MS = 60_000;
/** at most one repair request in this long, so a persistent fault cannot flood */
const RESYNC_GAP_MS = 5000;

/** how often each peer's round trip is re-measured */
const PING_MS = 3000;

/** host -> guests: my world's fingerprint at frame f */
type HashMsg = { t: 'hash'; f: number; h: number; p?: number[] };
const PART_NAMES = ['cells', 'meta', 'clock', 'wake', 'wind', 'rng', 'frame', 'debris'];
type HostMsg = Wire | { t: 'host' } | HashMsg | { t: 'closing' } | { t: 'full' };

/** result of comparing fingerprints with the host */
export interface SyncStats {
  checked: number;
  mismatches: number;
  /** first frame that did not match, or -1 */
  firstBad: number;
  /** which parts of the state differed at firstBad */
  badParts: string[];
  /** times a fresh copy of the host's world was fetched to repair a desync */
  repairs: number;
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
  /** host: joiners turned away because the room was full, until they leave */
  private turnedAway = new Set<string>();
  private room: { leave(): Promise<void> } | null = null;
  private sendWire!: (m: HostMsg, to?: string) => void;
  private sendSnap!: (data: Uint8Array, to: string, f: number) => void;
  private ended = false;
  private sendCursor!: (c: CursorMsg, to?: string) => void;
  private sendEmote!: (e: EmoteMsg) => void;
  private lastEmote = 0;
  private roster = new Map<string, PeerInfo>();
  private lastCursor: CursorMsg | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  /** set by the game: this device's name and colour */
  me: Identity = { name: 'PLAYER', color: '#ffffff' };
  /** guest: fingerprints seen so far, mine and the host's, by frame */
  private mine = new Map<number, number[]>();
  private theirs = new Map<number, number[]>();
  sync: SyncStats = { checked: 0, mismatches: 0, firstBad: -1, badParts: [], repairs: 0 };
  /** guest: the host whose frame timeline we are following */
  private timeline: string | null = null;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastResync = 0;
  private resyncing = false;
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
  static async host(code: string, hooks: MpHooks, me: Identity): Promise<MpSession> {
    const s = new MpSession(code, hooks);
    s.me = me;
    const first = await hooks.snapshot();
    s.host = new HostCore((m, to) => s.sendWire(m, to));
    s.host.start(first.f);
    await s.connect();
    return s;
  }

  /** Join someone else's room. Steps nothing until the host's world arrives. */
  static async join(code: string, hooks: MpHooks, me: Identity): Promise<MpSession> {
    const s = new MpSession(code, hooks);
    s.me = me;
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
    const emo = room.makeAction<EmoteMsg>('e');
    this.sendEmote = (e) => void emo.send(e);
    emo.onMessage = (e, { peerId }) => {
      if (!this.ended) this.hooks.onEmote(e, peerId);
    };
    const cur = room.makeAction<CursorMsg>('c');
    this.sendCursor = (c, to) => void cur.send(c, to ? { target: to } : undefined);
    cur.onMessage = (c, { peerId }) => {
      if (this.ended) return;
      const known = this.roster.get(peerId);
      if (!known || known.name !== c.n || known.color !== c.c) {
        this.roster.set(peerId, { id: peerId, name: c.n, color: c.c, ping: known?.ping ?? -1 });
        this.emitRoster();
      }
      this.hooks.onCursor(peerId, c);
    };
    this.sendWire = (m, to) => void wire.send(m, to ? { target: to } : undefined);
    this.sendSnap = (data, to, f) => void snap.send(data, { target: to, metadata: { f } });

    wire.onMessage = (m, { peerId }) => {
      if (this.host) {
        // the host listens to guests' inputs and repair requests only
        if (m.t === 'input') this.host.receive(m);
        else if (m.t === 'resync') void this.welcome(peerId, true);
        return;
      }
      if (m.t === 'full') {
        // the host turned us away; only believed before we have joined
        if (!this.hostId) this.end(`ROOM ${this.code} IS FULL - ${ROOM_MAX} PEOPLE AT MOST. ASK FOR ANOTHER ROOM`);
        return;
      }
      if (m.t === 'closing') {
        // the host left on purpose: no point waiting for it
        if (peerId === this.hostId) this.end('THE HOST CLOSED THE ROOM - THE WORLD IS YOURS NOW');
        return;
      }
      if (m.t === 'host') {
        // A host announcing itself. A different peer than before means the
        // host came back with a new connection (a reload): follow it, and
        // drop the old timeline now - this message arrives on the same
        // ordered channel as the new host's frames, ahead of all of them.
        // (Resetting when the snapshot arrived threw away frames that had
        // overtaken it, and the guest froze.)
        if (peerId !== this.timeline) {
          this.guest!.reset();
          this.timeline = peerId;
          this.mine.clear();
          this.theirs.clear();
        }
        if (peerId !== this.hostId) {
          this.hostId = peerId;
          if (this.graceTimer) {
            clearTimeout(this.graceTimer);
            this.graceTimer = null;
            this.hooks.onWaiting(false);
            this.hooks.onNotice('THE HOST IS BACK');
          }
        }
        return;
      }
      // a guest takes frames from its host and nobody else
      if (peerId !== this.hostId) return;
      if (m.t === 'frame') this.guest!.receive(m);
      else if (m.t === 'hash') this.compare(m.f, undefined, [m.h, ...(m.p ?? [])]);
    };

    snap.onMessage = async (data, { peerId, metadata }) => {
      if (!this.guest || this.ended) return;
      // only the host we follow (it announced itself first, on the frames' channel)
      if (peerId !== this.timeline) return;
      try {
        const s = unpackSnapshot(await gunzip(new Uint8Array(data as unknown as ArrayBuffer)));
        const f = (metadata as { f: number } | undefined)?.f ?? s.f;
        this.hooks.restore(s);
        this.guest.synced(f);
        // fingerprints from before this copy compare against the wrong world
        this.mine.clear();
        this.theirs.clear();
        const first = this.snapCount === 0;
        this.snapCount++;
        if (this.joinTimer) clearTimeout(this.joinTimer);
        if (first) this.hooks.onNotice(`JOINED ROOM ${this.code}`);
        else if (this.resyncing) this.hooks.onNotice('RE-SYNCED WITH THE HOST');
        this.resyncing = false;
      } catch {
        this.end('COULD NOT READ THE HOST\'S WORLD');
      }
    };

    room.onPeerJoin = (id) => {
      // host: a full room turns the newcomer away, and never counts or announces them
      if (this.host && !roomHasSpace(this.peers.size)) {
        this.turnedAway.add(id);
        this.sendWire({ t: 'full' }, id);
        this.hooks.onNotice(`SOMEONE TRIED TO JOIN - THE ROOM IS FULL (${ROOM_MAX})`);
        return;
      }
      this.peers.add(id);
      this.hooks.onPeople(this.peers.size + 1);
      if (this.host) void this.welcome(id);
      // tell the newcomer who I am straight away, even if I am not moving
      this.sendCursor(this.lastCursor ?? this.idle(), id);
    };
    room.onPeerLeave = (id) => {
      if (this.turnedAway.delete(id)) return;
      this.peers.delete(id);
      this.roster.delete(id);
      this.emitRoster();
      this.hooks.onCursor(id, null);
      this.hooks.onPeople(this.peers.size + 1);
      if (this.guest && id === this.hostId) this.hostDropped();
      else if (this.host) this.hooks.onNotice('A PLAYER LEFT');
    };
    this.hooks.onPeople(1);
    // round trips, and a slow heartbeat so names stay known while idle
    const r = room as unknown as { ping(id: string): Promise<number> };
    this.pingTimer = setInterval(() => {
      for (const id of this.peers)
        void r.ping(id).then((ms) => {
          const p = this.roster.get(id);
          if (!p || this.ended) return;
          p.ping = Math.round(ms);
          this.emitRoster();
        }, () => {});
    }, PING_MS);
    this.heartbeat = setInterval(() => this.sendCursor(this.lastCursor ?? this.idle()), 2000);
  }

  /**
   * The host went away - usually a reload. Freeze (no frames, no stepping)
   * and wait a while for it to come back, instead of ending the room.
   */
  private hostDropped(): void {
    this.hostId = null;
    this.guest!.reset();
    this.timeline = null;
    this.hooks.onWaiting(true);
    this.hooks.onNotice('THE HOST DISCONNECTED - WAITING FOR THEM...', true);
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = setTimeout(() => this.end('THE HOST DID NOT COME BACK - THE WORLD IS YOURS NOW'), HOST_GRACE_MS);
  }

  private idle(): CursorMsg {
    return { x: 0, y: 0, hidden: true, s: 0, m: 0, d: false, n: this.me.name, c: this.me.color };
  }

  private emitRoster(): void {
    this.hooks.onRoster([...this.roster.values()]);
  }

  /**
   * React: an emoji or a ping at (x, y). Shown here at once and sent to
   * everyone; at most one every 300 ms so nobody can flood a room.
   */
  emote(e: number, x: number, y: number): boolean {
    const now = performance.now();
    if (this.ended || now - this.lastEmote < 300) return false;
    this.lastEmote = now;
    const msg: EmoteMsg = { e, x, y, n: this.me.name, c: this.me.color };
    this.hooks.onEmote(msg, null);
    this.sendEmote(msg);
    return true;
  }

  /** Tell everyone who I am now (after a rename), without waiting. */
  announce(): void {
    if (this.ended) return;
    if (this.lastCursor) this.lastCursor = { ...this.lastCursor, n: this.me.name, c: this.me.color };
    this.sendCursor(this.lastCursor ?? this.idle());
  }

  /** My cursor, for everyone else to see. The game throttles the calls. */
  cursor(c: Omit<CursorMsg, 'n' | 'c'>): void {
    if (this.ended) return;
    this.lastCursor = { ...c, n: this.me.name, c: this.me.color };
    this.sendCursor(this.lastCursor);
  }

  /** host: send a joiner who's boss, then the world, then every frame since. */
  private async welcome(id: string, repair = false): Promise<void> {
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
    if (!repair) this.hooks.onNotice('A PLAYER JOINED');
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
      this.requestRepair();
    }
    // drop anything old that never found its pair (sent before we joined)
    for (const m of [this.mine, this.theirs]) for (const k of m.keys()) if (k < f - 600) m.delete(k);
  }

  /** Ask the host for a fresh copy of its world (rate-limited). */
  private requestRepair(): void {
    const now = performance.now();
    if (!this.hostId || this.resyncing || now - this.lastResync < RESYNC_GAP_MS) return;
    this.lastResync = now;
    this.resyncing = true;
    this.sync.repairs++;
    this.sendWire({ t: 'resync' }, this.hostId);
  }

  /** My own world-changing actions. */
  local(inputs: NetInput[]): void {
    if (this.host) this.host.local(inputs);
    else this.guest!.local(inputs);
  }

  leave(): void {
    if (this.ended) return;
    // a host leaving on purpose says so, so guests do not wait for a reload
    if (this.host) {
      this.sendWire({ t: 'closing' });
      const room = this.room;
      this.room = null;
      setTimeout(() => void room?.leave(), 250);
    }
    this.ended = true;
    if (this.joinTimer) clearTimeout(this.joinTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.graceTimer) clearTimeout(this.graceTimer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    void this.room?.leave();
  }

  private end(reason: string): void {
    if (this.ended) return;
    this.leave();
    this.hooks.onEnd(reason);
  }
}
