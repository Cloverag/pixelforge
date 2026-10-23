/**
 * Procedural chiptune music loop - no audio assets required.
 *
 * 16-step sequencer on a 25 ms lookahead scheduler. It plays through the music
 * bus of the one shared audio graph (game/audio.ts), so MUSIC volume and mute
 * never touch the effects and a hidden tab silences both together.
 */
import type { Sfx } from './audio';


export interface MusicController {
  /** begin the loop (after a gesture has created the audio context); idempotent */
  start(): void;
}

const BPM = 112;
const STEPS = 16;
const LOOKAHEAD_S = 0.12;
const TICK_MS = 25;

/** midi note to Hz */
function hz(n: number): number {
  return 440 * Math.pow(2, (n - 69) / 12);
}

const R = null; // rest
// A minor pentatonic lead, one 16-step bar
const LEAD: (number | null)[] = [
  69, R, 72, R, 76, R, 74, 72,
  69, R, 67, 69, R, R, 64, R,
];
// bass root every beat: Am - F - C - G
const BASS_ROOTS = [45, 41, 48, 43];

// the shared context and music bus, from Sfx (one audio graph)
let sfx: Sfx | null = null;
let ac: AudioContext | null = null;
let out: AudioNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let nextStepTime = 0;
let stepIdx = 0;

function tone(
  freq: number,
  t0: number,
  dur: number,
  type: OscillatorType,
  vol: number,
  slideTo?: number,
): void {
  if (!ac || !out) return;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo !== undefined)
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(out);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function hat(t0: number, vol: number): void {
  if (!ac || !out || !noiseBuf) return;
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 2;
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 6500;
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
  src.connect(hp).connect(g).connect(out);
  src.start(t0);
  src.stop(t0 + 0.06);
}

function scheduleStep(s: number, t: number): void {
  const stepDur = 60 / BPM / 4;

  // kick pulse every half bar
  if (s % 8 === 0) tone(120, t, 0.09, 'sine', 0.16, 42);

  // hats on the off-beats
  if (s % 4 === 2) hat(t, s % 8 === 6 ? 0.05 : 0.03);

  // bass: root on each beat, octave pop on the "and" of beat 4
  const root = BASS_ROOTS[(s / 4) | 0];
  if (s % 4 === 0) tone(hz(root), t, stepDur * 3.2, 'triangle', 0.11);
  if (s === 14) tone(hz(root + 12), t, stepDur * 1.5, 'triangle', 0.08);

  // lead square with slight decay
  const n = LEAD[s];
  if (n !== null) tone(hz(n), t, stepDur * 1.7, 'square', 0.055);
}

function tick(): void {
  if (!ac) return;
  const stepDur = 60 / BPM / 4;
  while (nextStepTime < ac.currentTime + LOOKAHEAD_S) {
    scheduleStep(stepIdx % STEPS, nextStepTime);
    nextStepTime += stepDur;
    stepIdx++;
  }
}

export function initMusic(shared: Sfx): MusicController {
  sfx = shared;
  return {
    start(): void {
      if (timer !== null || !sfx) return;
      ac = sfx.context();
      out = sfx.musicOut();
      noiseBuf = sfx.noiseBuffer();
      if (!ac || !out) return;
      nextStepTime = ac.currentTime + 0.08;
      stepIdx = 0;
      timer = setInterval(tick, TICK_MS);
    },
  };
}
