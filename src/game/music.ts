/**
 * Procedural chiptune music loop - no audio assets required.
 *
 * Owned by MANAGER lane. Exposes:
 *   initMusic(): MusicController
 *     .start() / .stop() / .toggle() / .isOn()
 *
 * 16-step sequencer on a 25 ms lookahead scheduler, fully independent of
 * the SFX bus (own AudioContext + gain), so MUSIC mute never touches SFX.
 */

export interface MusicController {
  start(): void;
  stop(): void;
  toggle(): void;
  isOn(): boolean;
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

let ac: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let nextStepTime = 0;
let stepIdx = 0;
let on = false;

function ensureCtx(): void {
  if (!ac) {
    ac = new AudioContext();
    master = ac.createGain();
    master.gain.value = 0.55;
    master.connect(ac.destination);
    const len = Math.floor(ac.sampleRate * 0.12);
    noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ac.state === 'suspended') void ac.resume();
}

function tone(
  freq: number,
  t0: number,
  dur: number,
  type: OscillatorType,
  vol: number,
  slideTo?: number,
): void {
  if (!ac || !master) return;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo !== undefined)
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function hat(t0: number, vol: number): void {
  if (!ac || !master || !noiseBuf) return;
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 2;
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 6500;
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
  src.connect(hp).connect(g).connect(master);
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

export function initMusic(): MusicController {
  const controller: MusicController = {
    start(): void {
      ensureCtx();
      if (timer !== null) return;
      nextStepTime = ac!.currentTime + 0.08;
      stepIdx = 0;
      timer = setInterval(tick, TICK_MS);
      on = true;
    },
    stop(): void {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      on = false;
    },
    toggle(): void {
      if (on) controller.stop();
      else controller.start();
    },
    isOn(): boolean {
      return on;
    },
  };
  return controller;
}
