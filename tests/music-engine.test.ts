import { describe, expect, it } from 'vitest';
import { MusicEngine } from '../src/game/music-engine';
import { TRACKS, XFADE_S, notesAt } from '../src/game/tracks';
import { trackForMode } from '../src/game/music';

/**
 * The engine against a stand-in audio context that only records: when notes
 * start, what the crossfade ramps do, and that the old track goes away.
 */

interface Ev { t: number; v: number }
function fakeCtx() {
  const starts: { t: number; kind: string; f: number }[] = [];
  const gains: { gain: { events: Ev[]; value: number; setValueAtTime(v: number, t: number): void } }[] = [];
  const param = () => {
    const p = {
      events: [] as Ev[], value: 0,
      setValueAtTime(v: number, t: number) { p.events.push({ t, v }); if (t <= 0) p.value = v; },
      exponentialRampToValueAtTime() {}, setTargetAtTime(v: number, t: number) { p.events.push({ t, v }); },
      cancelScheduledValues(t: number) { p.events = p.events.filter((e) => e.t < t); },
    };
    return p;
  };
  const node = (): Record<string, unknown> => {
    const n: Record<string, unknown> = {};
    n.connect = (x: unknown) => x;
    n.disconnect = () => {};
    return n;
  };
  const ctx = {
    currentTime: 0,
    createGain: () => { const n = node(); n.gain = param(); gains.push(n as never); return n; },
    createOscillator: () => { const n = node(); n.frequency = param(); n.detune = param(); n.start = (t: number) => starts.push({ t, kind: 'osc', f: (n.frequency as { events: Ev[] }).events[0]?.v ?? 0 }); n.stop = () => {}; return n; },
    createBufferSource: () => { const n = node(); n.start = (t: number) => starts.push({ t, kind: 'noise', f: 0 }); n.stop = () => {}; return n; },
    createBiquadFilter: () => { const n = node(); n.frequency = param(); n.Q = param(); return n; },
    createDelay: () => { const n = node(); n.delayTime = param(); return n; },
    createDynamicsCompressor: () => { const n = node(); for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = param(); return n; },
  };
  return { ctx: ctx as unknown as BaseAudioContext, starts, gains };
}
const noise = { duration: 0.6 } as AudioBuffer;

describe('MusicEngine', () => {
  it('plays a step every sixteenth note of the track tempo, starting at the first step', () => {
    const f = fakeCtx();
    const e = new MusicEngine(f.ctx, {} as AudioNode, noise);
    e.setScreen('chem', 0, false);
    e.scheduleUntil(4);
    const stepDur = 60 / TRACKS.chem.bpm / 4;
    const times = [...new Set(f.starts.map((s) => +s.t.toFixed(6)))].sort((a, b) => a - b);
    expect(times[0]).toBe(0);
    for (const t of times) expect(Math.abs(t / stepDur - Math.round(t / stepDur))).toBeLessThan(1e-6); // every note on a step
    expect(times.at(-1)!).toBeLessThan(4);
    expect(times.length).toBeGreaterThan(20);
  });

  it('keeps the adaptive layer closed: with it shut, a note still sounds for each voice (the gain does the rest)', () => {
    // adaptive voices are scheduled either way; their level is the layer gain, 0 until the parameter rises
    const f = fakeCtx();
    const e = new MusicEngine(f.ctx, {} as AudioNode, noise);
    e.setScreen('chem', 0, false);
    e.scheduleUntil(1);
    const layer = f.gains.find((g) => g.gain.value === 0 && g.gain.events.length === 0);
    expect(layer).toBeDefined(); // the layer gain: starts at 0, no automation yet
    e.applyAdapt(0.8, 1, 0.05);
    expect(f.gains.some((g) => g.gain.events.some((ev) => ev.v === 0.8))).toBe(true);
  });

  it('fades the new track in and the old one out, equal-power, over 1.5 s', () => {
    const f = fakeCtx();
    const e = new MusicEngine(f.ctx, {} as AudioNode, noise);
    e.setScreen('title', 0, false);
    e.scheduleUntil(0.5);
    e.setScreen('sandbox', 10);
    const ramps = f.gains.filter((g) => g.gain.events.length >= 40).map((g) => g.gain.events.filter((x) => x.t >= 10));
    expect(ramps).toHaveLength(2); // the new track's fade-in and the old one's fade-out
    const inn = ramps.find((r) => r[0].v === 0)!;
    const out = ramps.find((r) => r[0].v === 1)!;
    for (const r of [inn, out]) {
      expect(r[0].t).toBe(10);
      expect(r.at(-1)!.t).toBeCloseTo(10 + XFADE_S, 6);
      expect(r.find((x) => Math.abs(x.t - (10 + XFADE_S / 2)) < 1e-9)!.v).toBeCloseTo(Math.SQRT1_2, 6);
    }
    expect(inn.at(-1)!.v).toBeCloseTo(1, 6);
    expect(out.at(-1)!.v).toBeCloseTo(0, 6);
    for (let k = 1; k < inn.length; k++) expect(inn[k].v).toBeGreaterThanOrEqual(inn[k - 1].v);
    for (let k = 1; k < out.length; k++) expect(out[k].v).toBeLessThanOrEqual(out[k - 1].v);
  });

  it('switching to the track that is already playing does nothing', () => {
    const f = fakeCtx();
    const e = new MusicEngine(f.ctx, {} as AudioNode, noise);
    e.setScreen('chem', 0, false);
    const n = f.gains.length;
    e.setScreen('chem', 5);
    expect(f.gains).toHaveLength(n);
  });

  it('the old track keeps playing until its fade is over, then stops scheduling', () => {
    /** the start times of every note a lone track plays between from and to */
    const alone = (id: 'title' | 'chem', startAt: number, from: number, to: number) => {
      const g = fakeCtx();
      const x = new MusicEngine(g.ctx, {} as AudioNode, noise);
      x.setScreen(id, startAt, false);
      x.scheduleUntil(to);
      return g.starts.filter((s) => s.t >= from && s.t < to).map((s) => +s.t.toFixed(6)).sort((p, q) => p - q);
    };
    const f = fakeCtx();
    const e = new MusicEngine(f.ctx, {} as AudioNode, noise);
    e.setScreen('title', 0, false);
    e.scheduleUntil(10);
    e.setScreen('chem', 10);
    e.scheduleUntil(30);
    const window = (from: number, to: number) => f.starts.filter((s) => s.t >= from && s.t < to).map((s) => +s.t.toFixed(6)).sort((p, q) => p - q);
    // during the fade both tracks play: exactly the two of them alone, added
    const both = [...alone('title', 0, 10, 10 + XFADE_S), ...alone('chem', 10, 10, 10 + XFADE_S)].sort((p, q) => p - q);
    expect(window(10, 10 + XFADE_S)).toEqual(both);
    expect(both.length).toBeGreaterThan(alone('chem', 10, 10, 10 + XFADE_S).length); // and the old one really was in there
    // after it only the new track plays
    expect(window(10 + XFADE_S, 30)).toEqual(alone('chem', 10, 10 + XFADE_S, 30));
  });

  it('plays every pitched note at the frequency of its midi number', () => {
    const f = fakeCtx();
    const e = new MusicEngine(f.ctx, {} as AudioNode, noise);
    e.setScreen('title', 0, false);
    e.scheduleUntil(0.0001); // step 0 only
    const want = notesAt(TRACKS.title, 0).filter((n) => n.midi !== null).map((n) => 440 * 2 ** ((n.midi! - 69) / 12));
    const got = f.starts.filter((s) => s.kind === 'osc').map((s) => s.f);
    for (const hz of want) expect(got.some((g) => Math.abs(g - hz) < 1e-6)).toBe(true);
  });
});

describe('which track plays', () => {
  it('a challenge plays the sandbox track', () => {
    expect([trackForMode('sand'), trackForMode('playground'), trackForMode('chem'), trackForMode('anything')]).toEqual(['sandbox', 'playground', 'chem', 'sandbox']);
  });
});
