/**
 * The soundtrack's controller: what main.ts talks to. The player itself
 * (music-engine.ts, with the tracks) is loaded after the first gesture, so none
 * of it is in the entry bundle; until then this only remembers which screen is up.
 */
import type { Sfx } from './audio';
import type { MusicEngine } from './music-engine';
import type { TrackId } from './tracks';

export interface MusicController {
  /** begin (after a gesture has created the audio context); idempotent */
  start(): void;
  /** the screen changed: crossfade to its track */
  setScreen(id: TrackId): void;
  /** what the current screen reports (particles, reactions/s, fire cells): opens the track up */
  adapt(v: number): void;
  /** gains of the live and the fading tracks, for checks */
  gains(): { screen: TrackId | null; cur: number | null; old: number[]; adapt: number } | null;
}

const TICK_MS = 25;

/** Which track plays for a mode (a challenge is a sandbox). */
export function trackForMode(modeId: string): TrackId {
  return modeId === 'playground' || modeId === 'garden' ? 'playground' : modeId === 'chem' ? 'chem' : 'sandbox';
}

export function initMusic(sfx: Sfx): MusicController {
  let engine: MusicEngine | null = null;
  let started = false;
  let want: TrackId = 'title';
  let pending = 0;

  return {
    start(): void {
      if (started) return;
      started = true;
      void import('./music-engine').then(({ MusicEngine: Engine }) => {
        const ac = sfx.context();
        const out = sfx.musicOut();
        const noise = sfx.noiseBuffer();
        if (!ac || !out || !noise) return;
        engine = new Engine(ac, out, noise);
        engine.setScreen(want);
        engine.setInput(pending);
        let last = performance.now();
        setInterval(() => {
          const now = performance.now();
          engine!.tick(Math.min(1, (now - last) / 1000));
          last = now;
        }, TICK_MS);
      });
    },
    setScreen(id): void {
      want = id;
      pending = 0;
      engine?.setScreen(id);
    },
    adapt(v): void {
      pending = v;
      engine?.setInput(v);
    },
    gains() {
      return engine ? { screen: engine.screen, ...engine.gains() } : null;
    },
  };
}
