import type { Snapshot } from './protocol';
import type { World } from './world';

/** sim ticks a replay shows (two seconds of play), and how many display frames each is held */
export const REPLAY_FRAMES = 120;
export const REPLAY_SLOW = 3;

/**
 * The sandbox's instant replay. The big red button snapshots the world just
 * before it fires. Asked to replay, the live world is put aside, the
 * snapshot comes back with the button pressed again and runs at a third of
 * the speed - the same blast, since the simulation is deterministic - and
 * then the live world returns exactly as it was left.
 *
 * Single player only: a room's worlds run in lockstep and cannot step aside.
 */
export class Replay {
  private before: Snapshot | null = null;
  private live: Snapshot | null = null;
  private frames = 0;
  private steps = 0;

  /** The button is about to fire: remember the world as it is. */
  arm(w: World): void {
    this.before = w.snapshot();
  }

  get ready(): boolean {
    return this.before !== null && this.live === null;
  }

  get playing(): boolean {
    return this.live !== null;
  }

  start(w: World): boolean {
    if (!this.before || this.live) return false;
    this.live = w.snapshot();
    w.restore(this.before);
    w.applyInput({ k: 'detonate' });
    this.frames = 0;
    this.steps = 0;
    return true;
  }

  /** The live world back, now. */
  stop(w: World): void {
    if (!this.live) return;
    w.restore(this.live);
    this.live = null;
  }

  /** A new world (cleared, loaded, another mode): the old blast is gone. */
  forget(w: World): void {
    this.stop(w);
    this.before = null;
  }

  /** One display frame: whether the world steps. While replaying, one frame in REPLAY_SLOW; at the end, the live world returns. */
  tick(w: World): boolean {
    if (!this.live) return true;
    if (this.steps >= REPLAY_FRAMES) {
      this.stop(w);
      return false;
    }
    if (this.frames++ % REPLAY_SLOW !== 0) return false;
    this.steps++;
    return true;
  }
}
