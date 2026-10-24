/**
 * The soundtrack as data: one track per screen, each a tempo, a chord per bar,
 * a scale, and a few voices. Pure (no audio, no clock, no Math.random), so the
 * engine plays it and the tests can check every note of every step.
 *
 * Off-key protection is structural: a voice can only ask for a *chord tone*
 * (chordTone) or a *scale degree* (scaleNote). There is no way to name a free
 * pitch, and tests/tracks.test.ts walks every step to prove the rest.
 */

export type TrackId = 'title' | 'sandbox' | 'playground' | 'chem';

export type VoiceKind =
  | 'pad' | 'arp' | 'bass' | 'lead' | 'keys' | 'bell' | 'air' | 'pluck' | 'drone' // pitched
  | 'brush' | 'tick' | 'kick' | 'snare'; // unpitched

export interface Chord {
  /** the bass note */
  root: number;
  /** midi pitches that sound together (the chord's own tones) */
  tones: number[];
}

/** One note asked of a voice on one step. `midi` is null for a drum. */
export interface Note {
  voice: string;
  kind: VoiceKind;
  midi: number | null;
  /** length in beats */
  beats: number;
  vel: number;
  source: 'chord' | 'scale' | 'drum';
}

export interface StepCtx {
  track: TrackDef;
  /** which bar of the progression, 0-based and wrapping */
  bar: number;
  /** 16th note within the bar, 0-15 */
  step: number;
  chord: Chord;
}

export interface VoiceDef {
  name: string;
  kind: VoiceKind;
  /** 'adapt' voices come in with the track's adaptive parameter */
  layer: 'base' | 'adapt';
  notes(c: StepCtx): Note[];
}

export interface TrackDef {
  id: TrackId;
  bpm: number;
  /** the tonic (midi) and the scale's seven semitone offsets from it */
  scaleRoot: number;
  scale: number[];
  /** one chord per bar; the track loops after these */
  chords: Chord[];
  voices: VoiceDef[];
  /** the playground's bells sit in a long feedback delay */
  delay?: boolean;
  /** a level multiplier for a track whose voices are sparse */
  trim?: number;
}

export const STEPS_PER_BAR = 16;

/** The i-th tone of a chord, wrapping up an octave each time round. */
export function chordTone(chord: Chord, i: number): number {
  const n = chord.tones.length;
  return chord.tones[((i % n) + n) % n] + 12 * Math.floor(i / n);
}

/** The pitch of scale degree d (0 = tonic, 7 = the tonic an octave up, negative goes down). */
export function scaleNote(track: TrackDef, d: number): number {
  const n = track.scale.length;
  return track.scaleRoot + track.scale[((d % n) + n) % n] + 12 * Math.floor(d / n);
}

/** A repeatable number in [0, 1) from two integers - the tracks' only "randomness". */
export function hash01(a: number, b: number): number {
  let h = Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 7, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  return ((h >>> 0) % 10000) / 10000;
}

const chordNote = (name: string, kind: VoiceKind, midi: number, beats: number, vel: number): Note =>
  ({ voice: name, kind, midi, beats, vel, source: 'chord' });
const scaleVoice = (name: string, kind: VoiceKind, midi: number, beats: number, vel: number): Note =>
  ({ voice: name, kind, midi, beats, vel, source: 'scale' });
const drum = (name: string, kind: VoiceKind, beats: number, vel: number): Note =>
  ({ voice: name, kind, midi: null, beats, vel, source: 'drum' });

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

// ---------------------------------------------------------------- title
// slow arpeggio over a pad, hopeful: A minor, ending each loop on C major
const TITLE_LEAD: Record<number, [number, number][]> = {
  4: [[0, 9], [6, 8], [8, 7]],
  5: [[0, 10], [8, 9]],
  6: [[0, 11], [6, 10], [8, 8]],
  7: [[0, 9], [8, 11], [12, 9]],
};
const TITLE_ARP = [0, 1, 2, 1, 2, 1, 0, 1];

const title: TrackDef = {
  id: 'title',
  bpm: 90,
  scaleRoot: 57, // A3
  scale: MINOR,
  chords: [
    { root: 45, tones: [57, 60, 64] }, // Am
    { root: 41, tones: [53, 57, 60] }, // F
    { root: 48, tones: [55, 60, 64] }, // C
    { root: 43, tones: [55, 59, 62] }, // G
    { root: 45, tones: [57, 60, 64] }, // Am
    { root: 41, tones: [53, 57, 60] }, // F
    { root: 43, tones: [55, 59, 62] }, // G
    { root: 48, tones: [55, 60, 64] }, // C
  ],
  voices: [
    { name: 'pad', kind: 'pad', layer: 'base', notes: (c) => (c.step === 0 ? c.chord.tones.map((m) => chordNote('pad', 'pad', m, 4, 0.5)) : []) },
    {
      name: 'arp', kind: 'arp', layer: 'base',
      notes: (c) => (c.step % 2 === 0 ? [chordNote('arp', 'arp', chordTone(c.chord, TITLE_ARP[(c.step / 2) % 8] + 3), 0.5, 0.6)] : []),
    },
    { name: 'bass', kind: 'bass', layer: 'base', notes: (c) => (c.step === 0 || c.step === 10 ? [chordNote('bass', 'bass', c.chord.root, 2, 0.7)] : []) },
    {
      name: 'lead', kind: 'lead', layer: 'base',
      notes: (c) => (TITLE_LEAD[c.bar] ?? []).filter(([s]) => s === c.step).map(([, d]) => scaleVoice('lead', 'lead', scaleNote(c.track, d), 1.5, 0.5)),
    },
  ],
};

// -------------------------------------------------------------- sandbox
// calm, warm keys over a soft brushed beat: C major, seventh chords
const SANDBOX_MELODY: Record<number, [number, number][]> = {
  1: [[4, 9], [12, 8]],
  3: [[4, 11], [8, 9], [12, 8]],
};
const sandbox: TrackDef = {
  id: 'sandbox',
  bpm: 84,
  scaleRoot: 60, // C4
  scale: MAJOR,
  chords: [
    { root: 48, tones: [52, 55, 59, 64] }, // Cmaj7
    { root: 45, tones: [57, 60, 64, 67] }, // Am7
    { root: 41, tones: [53, 57, 60, 64] }, // Fmaj7
    { root: 43, tones: [55, 59, 62, 65] }, // G7
  ],
  voices: [
    {
      name: 'keys', kind: 'keys', layer: 'base',
      notes: (c) => (c.step === 0 || c.step === 6 || c.step === 10 ? c.chord.tones.map((m, i) => chordNote('keys', 'keys', m + (c.step === 0 ? 0 : 12 * (i % 2)), c.step === 0 ? 2 : 1, 0.4)) : []),
    },
    {
      name: 'melody', kind: 'keys', layer: 'base',
      notes: (c) => (SANDBOX_MELODY[c.bar] ?? []).filter(([s]) => s === c.step).map(([, d]) => scaleVoice('melody', 'keys', scaleNote(c.track, d), 1, 0.45)),
    },
    {
      name: 'bass', kind: 'bass', layer: 'base',
      notes: (c) => (c.step === 0 ? [chordNote('bass', 'bass', c.chord.root, 2, 0.8)] : c.step === 8 ? [chordNote('bass', 'bass', c.chord.root + 7, 1.5, 0.6)] : []),
    },
    {
      name: 'brush', kind: 'brush', layer: 'base',
      notes: (c) => (c.step === 4 || c.step === 12 ? [drum('brush', 'brush', 0.5, 0.5)] : c.step % 4 === 2 ? [drum('hat', 'tick', 0.1, 0.25)] : []),
    },
    // low drone under the chord, brought in by fire and explosions
    {
      name: 'drone', kind: 'drone', layer: 'adapt',
      notes: (c) => (c.step === 0 ? [chordNote('drone', 'drone', c.chord.root - 12, 4, 0.8), chordNote('drone', 'drone', c.chord.root - 5, 4, 0.5)] : []),
    },
  ],
};

// ----------------------------------------------------------- playground
// spacey: a soft low bell about once a bar in a slow echo, over a continuous airy bed, no drums.
// A major, the key of the playground's own ambient pad.
const playground: TrackDef = {
  id: 'playground',
  bpm: 70,
  scaleRoot: 57, // A3
  scale: MAJOR,
  delay: true,
  trim: 1.3,
  chords: [
    { root: 45, tones: [69, 73, 76, 71] }, // A add9
    { root: 42, tones: [66, 69, 73, 76] }, // F#m7
    { root: 50, tones: [62, 66, 69, 73] }, // Dmaj7
    { root: 40, tones: [64, 68, 71, 66] }, // E add9
  ],
  voices: [
    {
      name: 'bell', kind: 'bell', layer: 'base',
      notes: (c) => {
        if (![0, 8].includes(c.step) || hash01(c.bar, c.step) > 0.5) return [];
        const i = Math.floor(hash01(c.step, c.bar + 11) * c.chord.tones.length);
        return [chordNote('bell', 'bell', chordTone(c.chord, i) - 12, 3, 0.35)];
      },
    },
    {
      name: 'air', kind: 'air', layer: 'base',
      notes: (c) => (c.step === 0 ? [scaleVoice('air', 'air', scaleNote(c.track, [4, 5, 2, 1][c.bar % 4]), 6, 0.2)] : []),
    },
  ],
};

// ------------------------------------------------------------- chem lab
// bubbly plucks over light ticks: G major / E minor. Reactions per second bring in a real beat.
const chem: TrackDef = {
  id: 'chem',
  bpm: 100,
  scaleRoot: 55, // G3
  scale: MAJOR,
  chords: [
    { root: 40, tones: [64, 67, 71] }, // Em
    { root: 48, tones: [60, 64, 67] }, // C
    { root: 43, tones: [62, 67, 71] }, // G
    { root: 50, tones: [62, 66, 69] }, // D
  ],
  voices: [
    {
      name: 'pluck', kind: 'pluck', layer: 'base',
      notes: (c) => {
        if (c.step % 2 !== 0 || hash01(c.bar, c.step + 31) < 0.18) return [];
        const pat = [0, 2, 1, 3, 2, 1, 3, 2][(c.step / 2) % 8];
        // now and then a scale note passes between the chord tones
        if (hash01(c.step + 5, c.bar) > 0.88) return [scaleVoice('pluck', 'pluck', scaleNote(c.track, 7 + ((c.step / 2) % 5)), 0.5, 0.5)];
        return [chordNote('pluck', 'pluck', chordTone(c.chord, pat), 0.5, 0.55)];
      },
    },
    { name: 'bass', kind: 'bass', layer: 'base', notes: (c) => (c.step === 0 || c.step === 6 || c.step === 10 ? [chordNote('bass', 'bass', c.chord.root, 1, 0.7)] : []) },
    { name: 'tick', kind: 'tick', layer: 'base', notes: (c) => (c.step % 4 === 2 ? [drum('tick', 'tick', 0.1, 0.3)] : []) },
    // the beat, brought in by reactions per second
    {
      name: 'kick', kind: 'kick', layer: 'adapt',
      notes: (c) => (c.step === 0 || c.step === 8 || c.step === 10 ? [drum('kick', 'kick', 0.4, 0.8)] : []),
    },
    { name: 'snare', kind: 'snare', layer: 'adapt', notes: (c) => (c.step === 4 || c.step === 12 ? [drum('snare', 'snare', 0.3, 0.55)] : []) },
    { name: 'hat', kind: 'tick', layer: 'adapt', notes: (c) => (c.step % 2 === 1 ? [drum('hat16', 'tick', 0.08, 0.2)] : []) },
  ],
};

export const TRACKS: Record<TrackId, TrackDef> = { title, sandbox, playground, chem };

/** A note together with the layer of the voice that plays it. */
export type PlayedNote = Note & { layer: 'base' | 'adapt' };

/** Every note a track asks for on one step of its loop (bar counts up forever, chords wrap). */
export function notesAt(track: TrackDef, stepIndex: number): PlayedNote[] {
  const bar = Math.floor(stepIndex / STEPS_PER_BAR);
  const ctx: StepCtx = {
    track,
    bar: bar % track.chords.length,
    step: stepIndex % STEPS_PER_BAR,
    chord: track.chords[bar % track.chords.length],
  };
  return track.voices.flatMap((v) => v.notes(ctx).map((n) => ({ ...n, layer: v.layer })));
}

/** The pitch classes a track's scale allows. */
export function scalePitchClasses(track: TrackDef): Set<number> {
  return new Set(track.scale.map((s) => (track.scaleRoot + s) % 12));
}

// ------------------------------------------------------------ crossfade

export const XFADE_S = 1.5;

/** Equal-power crossfade at progress p (0 to 1): [the leaving track's gain, the arriving track's gain]. */
export function xfadeGains(p: number): [number, number] {
  const x = Math.max(0, Math.min(1, p)) * (Math.PI / 2);
  return [Math.cos(x), Math.sin(x)];
}

// ------------------------------------------------------------- adaptive

/** One step of exponential smoothing: `value` moves toward `target` with time constant `tau` seconds. */
export function smoothToward(value: number, target: number, dtSec: number, tau = 2): number {
  return value + (target - value) * (1 - Math.exp(-dtSec / tau));
}

/**
 * The adaptive parameter, 0 to 1, from what the screen reports: the playground's
 * particle count, the chem lab's reactions per second, the sandbox's fire + ember cells.
 */
export function adaptTarget(id: TrackId, input: number): number {
  const scale = id === 'playground' ? 2500 : id === 'chem' ? 300 : id === 'sandbox' ? 400 : Infinity;
  return Math.max(0, Math.min(1, input / scale));
}

/** The playground's low-pass cutoff in Hz for p in 0..1: dark and quiet when empty, open when busy. */
export function playgroundCutoff(p: number): number {
  return 500 * 12 ** Math.max(0, Math.min(1, p));
}
