import { SLOTS, allSampleFiles, pickNoRepeat, rateJitter, type Slot } from './sample-slots';

/** The parts of an AudioContext the loader uses (so tests can hand it a stand-in). */
export interface SampleCtx {
  currentTime: number;
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>;
  createBufferSource(): AudioBufferSourceNode;
  createGain(): GainNode;
}

export interface LoadResult {
  ok: number;
  failed: number;
}

/**
 * The recorded one-shots: fetched and decoded after the first gesture, played
 * through a bus. A file that fails to fetch or decode is simply absent, and a
 * slot with no file left reports it - so the caller falls back to its synth and
 * an old browser never goes silent.
 */
export class Samples {
  private buffers = new Map<string, AudioBuffer>();
  private last = new Map<Slot, number>();

  constructor(
    private ctx: SampleCtx,
    private base: string,
    private fetcher: (url: string) => Promise<{ ok: boolean; arrayBuffer(): Promise<ArrayBuffer> }> = (u) => fetch(u),
    private rnd: () => number = Math.random,
  ) {}

  /** Fetch and decode every file; resolves with how many worked. Never rejects. */
  async load(): Promise<LoadResult> {
    const res: LoadResult = { ok: 0, failed: 0 };
    await Promise.all(
      allSampleFiles().map(async (name) => {
        try {
          const r = await this.fetcher(`${this.base}${name}.ogg`);
          if (!r.ok) throw new Error('http');
          this.buffers.set(name, await this.ctx.decodeAudioData(await r.arrayBuffer()));
          res.ok++;
        } catch {
          res.failed++;
        }
      }),
    );
    return res;
  }

  /** Is anything of this slot decoded? */
  has(slot: Slot): boolean {
    return SLOTS[slot].files.some((f) => this.buffers.has(f));
  }

  /**
   * Play the slot into `dest`. Returns false when it has no decoded file (the caller
   * plays its synth). `gain` scales the slot's own level; `rate` multiplies the +-5% pitch variation.
   */
  play(slot: Slot, dest: AudioNode, opts: { gain?: number; rate?: number; delaySec?: number } = {}): boolean {
    const def = SLOTS[slot];
    const have = def.files.filter((f) => this.buffers.has(f));
    if (!have.length) return false;
    // no repeat of the last one, counted among the files that actually loaded
    const lastName = def.files[this.last.get(slot) ?? -1];
    const lastIdx = have.indexOf(lastName);
    const pick = have[pickNoRepeat(have.length, lastIdx, this.rnd())];
    this.last.set(slot, def.files.indexOf(pick));
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers.get(pick)!;
    src.playbackRate.value = rateJitter(this.rnd()) * (opts.rate ?? 1);
    const g = this.ctx.createGain();
    g.gain.value = def.gain * (opts.gain ?? 1);
    src.connect(g).connect(dest);
    src.start(this.ctx.currentTime + (opts.delaySec ?? 0));
    return true;
  }
}
