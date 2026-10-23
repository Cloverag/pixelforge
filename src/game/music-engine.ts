/**
 * The soundtrack player: one lookahead scheduler, one live track at a time
 * (src/game/tracks.ts is the data), a 1.5 s equal-power crossfade when the
 * screen changes, and one smoothed adaptive parameter that opens the track up.
 *
 * It takes any BaseAudioContext, so the same code plays live (through the
 * music bus) and renders offline for a recording. Loaded lazily after the first
 * gesture: it is not in the entry bundle.
 */
import {
  TRACKS, XFADE_S, adaptTarget, notesAt, playgroundCutoff, smoothToward, xfadeGains,
  type PlayedNote, type TrackDef, type TrackId,
} from './tracks';

const LOOKAHEAD_S = 0.14;
const FADE_POINTS = 50;
/** the voices are written quiet; this brings the mix to a background level before the bus */
const MAKEUP = 2.4;

const hz = (m: number): number => 440 * 2 ** ((m - 69) / 12);

interface Inst {
  track: TrackDef;
  /** base voices go in here ... */
  input: GainNode;
  /** ... adaptive voices through this, whose level is the adaptive parameter */
  layer: GainNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  /** the playground's bells also feed a long delay */
  send: GainNode | null;
  step: number;
  next: number;
  /** when its fade-out is over and it can go */
  endsAt: number;
}

export class MusicEngine {
  private cur: Inst | null = null;
  private old: Inst[] = [];
  private target = 0;
  private smooth = 0;
  /** the value last handed to the audio params: only a real change adds an automation event */
  private applied = -1;

  /** every track mixes into this: make-up gain, then a limiter so the drums never clip */
  private bus: GainNode;

  constructor(
    private ctx: BaseAudioContext,
    out: AudioNode,
    private noise: AudioBuffer,
  ) {
    this.bus = ctx.createGain();
    this.bus.gain.value = MAKEUP;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -18;
    limiter.knee.value = 10;
    limiter.ratio.value = 5;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.25;
    this.bus.connect(limiter).connect(out);
  }

  /** the track that is playing (or fading in) */
  get screen(): TrackId | null {
    return this.cur?.track.id ?? null;
  }

  /** current gains of the live track and the ones fading out, for checks */
  gains(): { cur: number | null; old: number[]; adapt: number } {
    return { cur: this.cur ? this.cur.gain.gain.value : null, old: this.old.map((i) => i.gain.gain.value), adapt: this.smooth };
  }

  // ------------------------------------------------------------ screens

  /** Crossfade to the track of a screen (no-op if it is already the one). */
  setScreen(id: TrackId, at = this.ctx.currentTime + 0.05, fade = true): void {
    if (this.cur?.track.id === id) return;
    const inst = this.make(TRACKS[id], at);
    if (this.cur) {
      this.ramp(this.cur.gain.gain, this.cur.gain.gain.value, 'out', at);
      this.cur.endsAt = at + XFADE_S;
      this.old.push(this.cur);
    }
    if (fade) this.ramp(inst.gain.gain, 1, 'in', at);
    else inst.gain.gain.setValueAtTime(1, at);
    this.cur = inst;
    this.target = 0;
    this.smooth = 0;
    this.applied = -1;
  }

  /** an equal-power fade of `param` from `from`, as short steps */
  private ramp(param: AudioParam, from: number, dir: 'in' | 'out', at: number): void {
    param.cancelScheduledValues(at);
    param.setValueAtTime(dir === 'in' ? 0 : from, at);
    for (let i = 1; i <= FADE_POINTS; i++) {
      const [o, n] = xfadeGains(i / FADE_POINTS);
      param.setValueAtTime(dir === 'in' ? from * n : from * o, at + (XFADE_S * i) / FADE_POINTS);
    }
  }

  private make(track: TrackDef, at: number): Inst {
    const c = this.ctx;
    const input = c.createGain();
    const layer = c.createGain();
    layer.gain.value = 0;
    layer.connect(input);
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = track.id === 'playground' ? playgroundCutoff(0) : 14000;
    filter.Q.value = 0.5;
    const gain = c.createGain();
    gain.gain.value = 0;
    input.connect(filter).connect(gain).connect(this.bus);
    let send: GainNode | null = null;
    if (track.delay) {
      // a long, dark feedback delay: the bells' "reverb"
      send = c.createGain();
      send.gain.value = 0.6;
      const d = c.createDelay(1.5);
      d.delayTime.value = 0.43;
      const fb = c.createGain();
      fb.gain.value = 0.5;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2200;
      send.connect(d);
      d.connect(fb).connect(d);
      d.connect(lp).connect(input);
    }
    return { track, input, layer, filter, gain, send, step: 0, next: at, endsAt: Infinity };
  }

  // ---------------------------------------------------------- adaptive

  /** What the screen reports (particles, reactions/s, fire cells): becomes the adaptive target. */
  setInput(v: number): void {
    if (this.cur) this.target = adaptTarget(this.cur.track.id, v);
  }

  /** Set the adaptive parameter p (0-1) on the live track, approached with time constant `tau` from time `at`. */
  applyAdapt(p: number, at = this.ctx.currentTime, tau = 0.05): void {
    const c = this.cur;
    if (!c) return;
    c.layer.gain.setTargetAtTime(p, at, tau);
    if (c.track.id === 'playground') c.filter.frequency.setTargetAtTime(playgroundCutoff(p), at, tau);
  }

  // --------------------------------------------------------- scheduling

  /** Called every ~25 ms: smooth the adaptive parameter (about 2 s), schedule what comes next. */
  tick(dtSec: number): void {
    this.smooth = smoothToward(this.smooth, this.target, dtSec);
    if (Math.abs(this.smooth - this.applied) > 0.002) {
      this.applied = this.smooth;
      this.applyAdapt(this.smooth);
    }
    this.scheduleUntil(this.ctx.currentTime + LOOKAHEAD_S);
  }

  /** Schedule every step of every live track that falls before time `t`. */
  scheduleUntil(t: number): void {
    for (const i of this.cur ? [this.cur, ...this.old] : this.old) {
      const stepDur = 60 / i.track.bpm / 4;
      // a track that is fading out keeps playing until its fade is done
      while (i.next < t && i.next < i.endsAt) {
        for (const n of notesAt(i.track, i.step)) this.voice(i, n, i.next, stepDur * 4);
        i.next += stepDur;
        i.step++;
      }
    }
    this.old = this.old.filter((i) => {
      const gone = i.endsAt + 0.1 < this.ctx.currentTime;
      if (gone) i.gain.disconnect();
      return !gone;
    });
  }

  // ------------------------------------------------------------- voices

  private voice(i: Inst, n: PlayedNote, t: number, beatSec: number): void {
    const dest = n.layer === 'adapt' ? i.layer : i.input;
    const len = n.beats * beatSec;
    n = { ...n, vel: n.vel * (i.track.trim ?? 1) };
    const f = n.midi === null ? 0 : hz(n.midi);
    switch (n.kind) {
      case 'pad':
        this.tone(dest, 'triangle', f, t, 0.9, len - 1.2, 1.3, n.vel * 0.05);
        this.tone(dest, 'sawtooth', f, t, 1.1, len - 1.2, 1.3, n.vel * 0.012, 7, 900);
        break;
      case 'arp':
        this.tone(dest, 'triangle', f, t, 0.01, 0, len * 1.5, n.vel * 0.085);
        break;
      case 'bass':
        this.tone(dest, 'sine', f, t, 0.012, len * 0.4, len * 0.7, n.vel * 0.17);
        this.tone(dest, 'triangle', f * 2, t, 0.012, 0, len * 0.4, n.vel * 0.03);
        break;
      case 'lead':
        this.tone(dest, 'triangle', f, t, 0.05, len * 0.5, 0.6, n.vel * 0.075, 0, 0, 5);
        break;
      case 'keys':
        this.tone(dest, 'sine', f, t, 0.008, 0, len * 0.9, n.vel * 0.07);
        this.tone(dest, 'sine', f * 2, t, 0.008, 0, len * 0.4, n.vel * 0.018, 4);
        this.tone(dest, 'triangle', f, t, 0.008, 0, len * 0.6, n.vel * 0.02, -5);
        break;
      case 'bell': {
        this.tone(dest, 'sine', f, t, 0.006, 0, 2.4, n.vel * 0.1, 0, 0, 0, i.send);
        this.tone(dest, 'sine', f * 3.99, t, 0.004, 0, 0.5, n.vel * 0.025, 0, 0, 0, i.send);
        this.tone(dest, 'sine', f * 2, t, 0.006, 0, 1.2, n.vel * 0.03, 0, 0, 0, i.send);
        break;
      }
      case 'air':
        this.tone(dest, 'sine', f, t, 1.6, len * 0.3, 2.6, n.vel * 0.07);
        break;
      case 'pluck':
        this.tone(dest, 'square', f, t, 0.004, 0, 0.2, n.vel * 0.06, 0, 3200, 0, null, 500);
        break;
      case 'drone':
        this.tone(dest, 'sawtooth', f, t, 1.2, len - 2, 1.6, n.vel * 0.12, 0, 320);
        break;
      case 'brush':
        this.hit(dest, t, 0.16, 3500, 0.7, 'bandpass', n.vel * 0.1);
        break;
      case 'tick':
        this.hit(dest, t, 0.04, 7500, 0.7, 'highpass', n.vel * 0.12);
        break;
      case 'snare':
        this.hit(dest, t, 0.15, 1900, 0.9, 'bandpass', n.vel * 0.14);
        this.tone(dest, 'sine', 190, t, 0.002, 0, 0.09, n.vel * 0.06);
        break;
      case 'kick':
        this.tone(dest, 'sine', 130, t, 0.002, 0, 0.22, n.vel * 0.42, 0, 0, 0, null, 45);
        break;
    }
  }

  /**
   * One oscillator with an envelope: attack `a`, hold, then a release of `r`
   * seconds that dies away (exponentially for plucks, so a short hold means a pluck).
   * `lp` low-passes it; `sweepTo` slides that cutoff (or, with no `lp`, the pitch);
   * `vibrato` is a depth in cents.
   */
  private tone(
    dest: AudioNode, type: OscillatorType, f: number, t: number, a: number, hold: number, r: number, peak: number,
    cents = 0, lp = 0, vibrato = 0, send: GainNode | null = null, sweepTo = 0,
  ): void {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (sweepTo && !lp) o.frequency.exponentialRampToValueAtTime(sweepTo, t + a + hold + r);
    if (cents) o.detune.value = cents;
    const g = c.createGain();
    const end = t + a + Math.max(0, hold) + r;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    if (hold > 0) g.gain.setValueAtTime(Math.max(0.0002, peak), t + a + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    let tail: AudioNode = o;
    if (lp) {
      const fl = c.createBiquadFilter();
      fl.type = 'lowpass';
      fl.frequency.setValueAtTime(lp, t);
      if (sweepTo) fl.frequency.exponentialRampToValueAtTime(sweepTo, t + a + hold + r);
      o.connect(fl);
      tail = fl;
    }
    if (vibrato) {
      const lfo = c.createOscillator();
      lfo.frequency.value = 5.2;
      const depth = c.createGain();
      depth.gain.value = vibrato;
      lfo.connect(depth).connect(o.detune);
      lfo.start(t);
      lfo.stop(end + 0.05);
    }
    tail.connect(g).connect(dest);
    if (send) g.connect(send);
    o.start(t);
    o.stop(end + 0.05);
  }

  /** a burst of filtered noise: brushes, ticks, snares */
  private hit(dest: AudioNode, t: number, dur: number, freq: number, q: number, type: BiquadFilterType, peak: number): void {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(Math.max(0.0002, peak), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(dest);
    // a different slice of the noise each hit; the noise buffer is 0.6 s
    s.start(t, (t * 7.7) % Math.max(0.05, this.noise.duration - dur - 0.02));
    s.stop(t + dur + 0.02);
  }
}

