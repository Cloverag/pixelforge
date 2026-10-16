import type { NetInput } from '../sim/protocol';

/**
 * Co-op lockstep, host-sequenced.
 *
 * Every peer runs the same deterministic sandbox and only inputs travel.
 * The host owns the frame clock: it collects inputs (its own and the
 * guests'), stamps each batch with a frame `delay` steps ahead, and
 * broadcasts one `frame` message per step - empty frames included, since a
 * guest may only step a frame it has been told about. Guests step exactly
 * the frames they hold, so they trail the host by their latency but never
 * disagree with it.
 *
 * A joiner gets a snapshot taken at some frame S, plus every frame message
 * from S on that it may have missed. Frame messages are keyed by number, so
 * duplicates and reordering are harmless.
 *
 * Nothing in here touches the network or the simulation: send() is
 * injected, and the caller applies the inputs it is handed. That keeps the
 * protocol testable against an in-memory network (tests/netsim.test.ts).
 */

export type Wire =
  /** host -> guests: apply these inputs before stepping frame f */
  | { t: 'frame'; f: number; i?: NetInput[] }
  /** guest -> host: my inputs, please schedule them */
  | { t: 'input'; i: NetInput[] }
  /** guest -> host: I am here and have no world yet */
  | { t: 'hello' }
  /** guest -> host: my world no longer matches yours, send it again */
  | { t: 'resync' };

export type Send = (msg: Wire, to?: string) => void;

/** frames of history the host keeps for joiners (5 s at 60 fps) */
const HISTORY = 300;
/** frames a guest keeps behind its position, so a repair can rewind */
const KEEP_BEHIND = 600;

export class HostCore {
  /** next frame the host will step */
  f = 0;
  private pending: NetInput[] = [];
  private history = new Map<number, NetInput[]>();

  constructor(
    private send: Send,
    readonly delay = 3,
  ) {}

  /** Begin at world frame f0 (the host's current frame). */
  start(f0: number): void {
    this.f = f0;
    this.history.clear();
    for (let k = 0; k < this.delay; k++) this.history.set(f0 + k, []);
  }

  /** The host's own actions. */
  local(inputs: NetInput[]): void {
    this.pending.push(...inputs);
  }

  receive(msg: Wire): void {
    if (msg.t === 'input') this.pending.push(...msg.i);
  }

  /**
   * Call once per host step, before stepping. Schedules everything pending
   * `delay` frames ahead, tells the guests, and returns this frame's inputs.
   */
  advance(): NetInput[] {
    const target = this.f + this.delay;
    const batch = this.pending;
    this.pending = [];
    this.history.set(target, batch);
    this.send({ t: 'frame', f: target, i: batch.length ? batch : undefined });
    const now = this.history.get(this.f) ?? [];
    this.f++;
    this.history.delete(this.f - HISTORY);
    return now;
  }

  /** Every frame message from frame `from` on, for a joiner. */
  framesFrom(from: number): Wire[] {
    const out: Wire[] = [];
    for (const [f, i] of this.history) if (f >= from) out.push({ t: 'frame', f, i: i.length ? i : undefined });
    return out.sort((a, b) => (a as { f: number }).f - (b as { f: number }).f);
  }

  /** Can a snapshot taken at frame s still be followed up? */
  canFollow(s: number): boolean {
    for (let f = s; f < this.f + this.delay; f++) if (!this.history.has(f)) return false;
    return true;
  }
}

export class GuestCore {
  /** next frame to step; -1 until a snapshot arrives */
  f = -1;
  private frames = new Map<number, NetInput[]>();

  constructor(private send: Send) {}

  /** My actions: they take effect when the host schedules them. */
  local(inputs: NetInput[]): void {
    if (inputs.length) this.send({ t: 'input', i: inputs });
  }

  receive(msg: Wire): void {
    if (msg.t !== 'frame') return;
    // Frames a little behind are kept, not dropped: a repair rewinds to the
    // snapshot's frame, and the host re-sends the frames from there - often
    // before the (larger) snapshot itself arrives.
    if (this.f >= 0 && msg.f < this.f - KEEP_BEHIND) return;
    this.frames.set(msg.f, msg.i ?? []);
  }

  /**
   * Forget every frame: they belong to a host that is gone. A host that
   * reloads comes back with a new timeline, and its frame numbers may
   * overlap the old one's.
   */
  reset(): void {
    this.f = -1;
    this.frames.clear();
  }

  /** The world was just restored to frame f. */
  synced(f: number): void {
    this.f = f;
    for (const k of this.frames.keys()) if (k < f) this.frames.delete(k);
  }

  ready(): boolean {
    return this.f >= 0 && this.frames.has(this.f);
  }

  /** How many frames could be stepped right now, without waiting. */
  backlog(): number {
    if (this.f < 0) return 0;
    let n = 0;
    while (this.frames.has(this.f + n)) n++;
    return n;
  }

  /** Inputs for the next frame; only after ready(). */
  take(): NetInput[] {
    const i = this.frames.get(this.f) ?? [];
    this.frames.delete(this.f - KEEP_BEHIND);
    this.f++;
    return i;
  }
}
