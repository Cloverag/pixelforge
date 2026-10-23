import { describe, expect, it } from 'vitest';
import {
  STEPS_PER_BAR, TRACKS, XFADE_S, adaptTarget, chordTone, hash01, notesAt, playgroundCutoff, scaleNote,
  scalePitchClasses, smoothToward, xfadeGains, type TrackDef,
} from '../src/game/tracks';

/**
 * The soundtrack as data: nothing may sound off-key, the loops are repeatable,
 * and the crossfade and the adaptive smoothing behave.
 */

const ALL = Object.values(TRACKS);
const pc = (m: number) => ((m % 12) + 12) % 12;
/** every step of three full passes through the progression (the loops are all shorter) */
const steps = (t: TrackDef) => Array.from({ length: t.chords.length * STEPS_PER_BAR * 3 }, (_, i) => i);

describe('every track', () => {
  it('has 4-8 chords and 2-4 always-on voices', () => {
    for (const t of ALL) {
      expect([t.id, t.chords.length >= 4 && t.chords.length <= 8]).toEqual([t.id, true]);
      const base = t.voices.filter((v) => v.layer === 'base').length;
      expect([t.id, base >= 2 && base <= 4]).toEqual([t.id, true]);
    }
  });

  it('builds its chords from its own scale', () => {
    for (const t of ALL) {
      const sc = scalePitchClasses(t);
      for (const ch of t.chords) for (const m of [...ch.tones, ch.root]) expect([t.id, m, sc.has(pc(m))]).toEqual([t.id, m, true]);
    }
  });

  it('never plays an off-key note: chord notes are in the current chord, scale notes in the scale', () => {
    for (const t of ALL) {
      const sc = scalePitchClasses(t);
      for (const i of steps(t)) {
        const chord = t.chords[Math.floor(i / STEPS_PER_BAR) % t.chords.length];
        const cpc = new Set([...chord.tones, chord.root].map(pc));
        for (const n of notesAt(t, i)) {
          if (n.midi === null) {
            expect([t.id, i, n.voice, n.source]).toEqual([t.id, i, n.voice, 'drum']);
            continue;
          }
          const ok = n.source === 'chord' ? cpc.has(pc(n.midi)) : n.source === 'scale' ? sc.has(pc(n.midi)) : false;
          expect([t.id, i, n.voice, n.midi, ok]).toEqual([t.id, i, n.voice, n.midi, true]);
        }
      }
    }
  });

  it('keeps every pitch in a listenable range', () => {
    for (const t of ALL)
      for (const i of steps(t)) for (const n of notesAt(t, i)) if (n.midi !== null) expect([t.id, n.midi >= 28 && n.midi <= 96]).toEqual([t.id, true]);
  });

  it('plays the same notes every time (no Math.random)', () => {
    for (const t of ALL) for (const i of steps(t)) expect(notesAt(t, i)).toEqual(notesAt(t, i));
    // and one pass through the progression equals the next
    for (const t of ALL) {
      const n = t.chords.length * STEPS_PER_BAR;
      for (let i = 0; i < n; i++) expect(notesAt(t, i)).toEqual(notesAt(t, i + n));
    }
  });

  it('actually plays: every always-on voice sounds somewhere in the loop', () => {
    for (const t of ALL)
      for (const v of t.voices.filter((x) => x.layer === 'base')) {
        const heard = steps(t).some((i) => notesAt(t, i).some((n) => n.voice === v.name));
        expect([t.id, v.name, heard]).toEqual([t.id, v.name, true]);
      }
  });
});

describe('the four feels', () => {
  it('tempos: title 90, sandbox 84, playground 70, chem 100', () => {
    expect([TRACKS.title.bpm, TRACKS.sandbox.bpm, TRACKS.playground.bpm, TRACKS.chem.bpm]).toEqual([90, 84, 70, 100]);
  });
  it('the playground has no drums and sits in a delay; the others do not', () => {
    const drums = (t: TrackDef) => steps(t).some((i) => notesAt(t, i).some((n) => n.source === 'drum'));
    expect(drums(TRACKS.playground)).toBe(false);
    expect(TRACKS.playground.delay).toBe(true);
    expect(drums(TRACKS.sandbox)).toBe(true);
    expect(drums(TRACKS.chem)).toBe(true);
  });
  it('each track has the adaptive layer it should: a drone, the beat, nothing (the filter opens instead)', () => {
    const adapt = (t: TrackDef) => t.voices.filter((v) => v.layer === 'adapt').map((v) => v.name);
    expect(adapt(TRACKS.sandbox)).toEqual(['drone']);
    expect(adapt(TRACKS.chem)).toEqual(['kick', 'snare', 'hat']);
    expect(adapt(TRACKS.playground)).toEqual([]);
  });
  it('title is in A minor and ends its loop on C major (hopeful)', () => {
    expect(TRACKS.title.scaleRoot % 12).toBe(9);
    expect(TRACKS.title.chords.at(-1)!.tones.map(pc)).toEqual([7, 0, 4]);
  });
});

describe('notes from the chord and the scale', () => {
  it('chord tones wrap up an octave each time round, and down for negatives', () => {
    const c = { root: 40, tones: [64, 67, 71] };
    expect([0, 1, 2, 3, 4, 6].map((i) => chordTone(c, i))).toEqual([64, 67, 71, 76, 79, 88]);
    expect(chordTone(c, -1)).toBe(59);
  });
  it('scale degrees: 0 is the tonic, 7 the octave, negatives go down', () => {
    const t = TRACKS.sandbox; // C major from C4
    expect([0, 1, 2, 6, 7, 9].map((d) => scaleNote(t, d))).toEqual([60, 62, 64, 71, 72, 76]);
    expect(scaleNote(t, -1)).toBe(59);
  });
  it('the hash is repeatable, in [0, 1) and varied', () => {
    expect(hash01(3, 5)).toBe(hash01(3, 5));
    const v = Array.from({ length: 200 }, (_, i) => hash01(i, 7));
    expect(v.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(new Set(v).size).toBeGreaterThan(150);
    expect(Math.min(...v)).toBeLessThan(0.1);
    expect(Math.max(...v)).toBeGreaterThan(0.9);
  });
});

describe('the crossfade', () => {
  it('starts all old, ends all new, and is equal-power half way', () => {
    expect(xfadeGains(0)).toEqual([1, 0]);
    const [a, b] = xfadeGains(0.5);
    expect(a).toBeCloseTo(Math.SQRT1_2, 10);
    expect(b).toBeCloseTo(Math.SQRT1_2, 10);
    const [c, d] = xfadeGains(1);
    expect(c).toBeCloseTo(0, 10);
    expect(d).toBe(1);
  });
  it('keeps the power constant all the way (no dip, no bump)', () => {
    for (let k = 0; k <= 20; k++) {
      const [o, n] = xfadeGains(k / 20);
      expect(o * o + n * n).toBeCloseTo(1, 10);
    }
  });
  it('only goes one way, and clamps outside 0-1', () => {
    let last = xfadeGains(0);
    for (let k = 1; k <= 20; k++) {
      const g = xfadeGains(k / 20);
      expect(g[0]).toBeLessThan(last[0]);
      expect(g[1]).toBeGreaterThan(last[1]);
      last = g;
    }
    expect(xfadeGains(-3)).toEqual([1, 0]);
    expect(xfadeGains(9)[1]).toBe(1);
  });
  it('lasts 1.5 seconds', () => {
    expect(XFADE_S).toBe(1.5);
  });
});

describe('the adaptive parameter', () => {
  it('smooths toward its target over about 2 seconds without overshooting', () => {
    expect(smoothToward(0, 1, 2)).toBeCloseTo(1 - Math.exp(-1), 10); // one time constant: 63%
    expect(smoothToward(0.4, 0.4, 5)).toBe(0.4);
    expect(smoothToward(0.3, 0.9, 0)).toBe(0.3);
    let v = 0;
    for (let k = 0; k < 400; k++) {
      const nv = smoothToward(v, 1, 0.025);
      expect(nv).toBeGreaterThanOrEqual(v);
      expect(nv).toBeLessThanOrEqual(1);
      v = nv;
    }
    expect(v).toBeGreaterThan(0.99); // 10 s of ticks
  });
  it('it takes about 2 s to get most of the way (not instant, not a minute)', () => {
    let v = 0;
    for (let k = 0; k < 80; k++) v = smoothToward(v, 1, 0.025); // 2 s
    expect(v).toBeGreaterThan(0.55);
    expect(v).toBeLessThan(0.75);
  });
  it('turns what the screen reports into 0-1', () => {
    expect(adaptTarget('playground', 0)).toBe(0);
    expect(adaptTarget('playground', 1250)).toBe(0.5);
    expect(adaptTarget('playground', 1e6)).toBe(1);
    expect(adaptTarget('chem', 150)).toBe(0.5);
    expect(adaptTarget('sandbox', 400)).toBe(1);
    expect(adaptTarget('sandbox', -5)).toBe(0);
    expect(adaptTarget('title', 1e9)).toBe(0);
  });
  it('the playground cutoff runs from a dark 500 Hz to an open 6 kHz', () => {
    expect(playgroundCutoff(0)).toBeCloseTo(500, 6);
    expect(playgroundCutoff(1)).toBeCloseTo(6000, 6);
    expect(playgroundCutoff(0.5)).toBeGreaterThan(playgroundCutoff(0.25));
    expect(playgroundCutoff(3)).toBeCloseTo(6000, 6);
  });
});
