import type { PgStats } from '../sim/particles';
import { SIM_W } from '../sim/protocol';

/** bumper notes: C major pentatonic, three octaves up from middle C */
const NOTE_FREQS: number[] = [];
for (let oct = 0; oct < 3; oct++)
  for (const semi of [0, 2, 4, 7, 9]) NOTE_FREQS.push(261.63 * 2 ** ((semi + oct * 12) / 12));

/** pentatonic notes the fireflies chime on (C major pentatonic, octave 5) */
const CHIME = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];

/** Procedural chiptune SFX - no audio assets required. */
export class Sfx {
  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private lastPlace = 0;
  private lastBoom = 0;
  private lastSizzle = 0;
  private lastZap = 0;
  private lastIgnite = 0;
  private lastFuse = 0;
  /** last time each bumper note played, so a hose plays a rhythm, not a buzz */
  private noteAt = new Float64Array(16);
  private lastSwallow = 0;
  /** the playground's continuous voices, built on first use */
  private pg: {
    jetGain: GainNode;
    jetFilter: BiquadFilterNode;
    humGain: GainNode;
    rumbleGain: GainNode;
    padGain: GainNode;
    padFilter: BiquadFilterNode;
    oscs: OscillatorNode[];
  } | null = null;
  private slow = false;
  muted = false;

  /** call from a user gesture */
  ensure(): void {
    if (!this.ac) {
      this.ac = new AudioContext();
      this.master = this.ac.createGain();
      this.master.gain.value = 0.85;
      this.master.connect(this.ac.destination);
      const len = this.ac.sampleRate * 0.6;
      this.noiseBuf = this.ac.createBuffer(1, len, this.ac.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ac.state === 'suspended') void this.ac.resume();
  }

  /**
   * Where a voice connects: straight to master, or through a stereo panner
   * when the sound has a position (-1 left .. 1 right).
   */
  private out(pan: number): AudioNode {
    if (!this.ac || !this.master) throw new Error('audio not started');
    if (pan === 0) return this.master;
    const p = this.ac.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(this.master);
    return p;
  }

  private blip(
    freq: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    slideTo?: number,
    delayMs = 0,
    pan = 0,
  ): void {
    if (!this.ac || !this.master || this.muted) return;
    const t0 = this.ac.currentTime + delayMs / 1000;
    const osc = this.ac.createOscillator();
    const gain = this.ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo !== undefined)
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(this.out(pan));
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(
    dur: number,
    f0: number,
    f1: number,
    vol: number,
    pan = 0,
    type: BiquadFilterType = 'lowpass',
    delayMs = 0,
  ): void {
    if (!this.ac || !this.master || !this.noiseBuf || this.muted) return;
    const t0 = this.ac.currentTime + delayMs / 1000;
    const src = this.ac.createBufferSource();
    src.buffer = this.noiseBuf;
    // start somewhere random in the buffer so repeats do not sound looped
    const offset = Math.random() * Math.max(0, this.noiseBuf.duration - dur - 0.05);
    const filter = this.ac.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(f0, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur);
    const gain = this.ac.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(gain).connect(this.out(pan));
    src.start(t0, offset);
    src.stop(t0 + dur + 0.02);
  }

  place(): void {
    const now = performance.now();
    if (now - this.lastPlace < 50) return;
    this.lastPlace = now;
    this.blip(280 + Math.random() * 160, 0.03, 'square', 0.04);
  }

  // ---------- playground sound design ----------

  /** A looping noise source, for voices that hold for as long as they play. */
  private loopNoise(): AudioBufferSourceNode {
    const ac = this.ac!;
    const len = ac.sampleRate * 2;
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.start();
    return src;
  }

  private buildPg(): void {
    if (this.pg || !this.ac || !this.master) return;
    const ac = this.ac;
    const out = this.master;
    // water jet: hiss through a band-pass, brighter for the hose
    const jetFilter = ac.createBiquadFilter();
    jetFilter.type = 'bandpass';
    jetFilter.frequency.value = 1600;
    jetFilter.Q.value = 0.8;
    const jetGain = ac.createGain();
    jetGain.gain.value = 0;
    this.loopNoise().connect(jetFilter).connect(jetGain).connect(out);

    // force hum: two low sines a fifth apart, pulsing slowly
    const humGain = ac.createGain();
    humGain.gain.value = 0;
    const humLfo = ac.createOscillator();
    const humLfoAmt = ac.createGain();
    humLfo.frequency.value = 0.7;
    humLfoAmt.gain.value = 0.3;
    const humPulse = ac.createGain();
    humPulse.gain.value = 0.7;
    humLfo.connect(humLfoAmt).connect(humPulse.gain);
    const oscs: OscillatorNode[] = [];
    for (const f of [55, 82.4]) {
      const o = ac.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.connect(humPulse);
      oscs.push(o);
    }
    humPulse.connect(humGain).connect(out);

    // black hole: a sub sine under low-passed rumble
    const rumbleGain = ac.createGain();
    rumbleGain.gain.value = 0;
    const rumbleFilter = ac.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = 140;
    this.loopNoise().connect(rumbleFilter).connect(rumbleGain);
    const sub = ac.createOscillator();
    sub.frequency.value = 36;
    sub.connect(rumbleGain);
    oscs.push(sub);
    rumbleGain.connect(out);

    // ambient pad: a soft A-major chord whose filter breathes
    const padFilter = ac.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 700;
    padFilter.Q.value = 0.6;
    const padLfo = ac.createOscillator();
    const padLfoAmt = ac.createGain();
    padLfo.frequency.value = 0.06;
    padLfoAmt.gain.value = 380;
    padLfo.connect(padLfoAmt).connect(padFilter.frequency);
    const padGain = ac.createGain();
    padGain.gain.value = 0;
    for (const f of [110, 164.8, 277.2, 329.6]) {
      const o = ac.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 10;
      o.connect(padFilter);
      oscs.push(o);
    }
    padFilter.connect(padGain).connect(out);

    for (const o of [humLfo, padLfo, ...oscs]) o.start();
    if (this.slow) for (const o of oscs) o.detune.value = -700; // slow-mo already on
    this.pg = { jetGain, jetFilter, humGain, rumbleGain, padGain, padFilter, oscs };
  }

  /**
   * Called every frame in the playground with what the sim did; null when
   * leaving it. Continuous voices glide toward their new levels; one-shots
   * (bumps, swallows, sparkler crackle, firefly chimes) fire from counts.
   */
  playground(st: PgStats | null): void {
    if (!this.ac) return;
    if (st) this.buildPg();
    const pg = this.pg;
    if (!pg) return;
    const t = this.ac.currentTime;
    const on = st !== null && !this.muted;
    const glide = (g: AudioParam, v: number) => g.setTargetAtTime(on ? v : 0, t, 0.09);
    if (!st) {
      for (const g of [pg.jetGain.gain, pg.humGain.gain, pg.rumbleGain.gain, pg.padGain.gain]) glide(g, 0);
      return;
    }
    const jet = Math.min(1, (st.fountain + st.hose) / 8);
    glide(pg.jetGain.gain, jet * 0.07);
    pg.jetFilter.frequency.setTargetAtTime(st.hose > st.fountain ? 2600 : 1500, t, 0.1);
    glide(pg.humGain.gain, Math.min(0.06, (st.pulls + st.vortices) * 0.018));
    glide(pg.rumbleGain.gain, Math.min(0.16, st.holes * 0.09));
    glide(pg.padGain.gain, Math.min(0.04, Math.log2(1 + st.particles) * 0.0032));
    pg.padFilter.Q.setTargetAtTime(0.6 + Math.min(4, st.vortices), t, 0.3);

    if (this.muted) return;
    if (st.sparkler > 0) this.crackle(st.sparks * 4 + 300);
    if (st.notes.length) this.bumperNotes(st.notes);
    if (st.swallowed > 0) this.swallow(st.swallowed);
    if (st.fireflies > 0 && Math.random() < Math.min(0.08, st.fireflies / 900)) this.chime();
  }

  /**
   * Bumper notes: a marimba-like voice - a sine with a fast-dying partial
   * near 4x (where a marimba bar's first overtone sits) and a soft octave.
   * Each note has a short cooldown and at most four play per frame.
   */
  private bumperNotes(notes: number[]): void {
    const now = performance.now();
    let played = 0;
    for (let k = 0; k < notes.length && played < 4; k += 2) {
      const n = notes[k];
      if (now - this.noteAt[n] < 85) continue;
      this.noteAt[n] = now;
      played++;
      const f = NOTE_FREQS[n];
      const pan = (notes[k + 1] / SIM_W) * 1.6 - 0.8;
      this.blip(f, 0.9, 'sine', 0.05, undefined, 0, pan);
      this.blip(f * 3.99, 0.13, 'sine', 0.013, undefined, 0, pan);
      this.blip(f * 2, 0.35, 'triangle', 0.007, undefined, 0, pan);
    }
  }

  /** the black hole eating: a short sucking sweep down */
  private swallow(n: number): void {
    const now = performance.now();
    if (now - this.lastSwallow < 180) return;
    this.lastSwallow = now;
    this.noise(0.32, 1400, 70, Math.min(0.09, 0.03 + n * 0.006));
  }

  /** a firefly: one soft pentatonic bell, somewhere in the stereo field */
  private chime(): void {
    const f = CHIME[Math.floor(Math.random() * CHIME.length)];
    const pan = Math.random() * 1.6 - 0.8;
    this.blip(f, 0.9, 'sine', 0.025, undefined, 0, pan);
    this.blip(f * 2, 0.5, 'sine', 0.008, undefined, 0, pan);
  }

  /** after a burst: a scatter of tiny pops as the sparks burn out */
  crackleTail(pan = 0): void {
    if (!this.ac || this.muted) return;
    const n = 16 + Math.floor(Math.random() * 14);
    for (let k = 0; k < n; k++) {
      const delay = 180 + Math.random() * 1300;
      const p = Math.max(-1, Math.min(1, pan + (Math.random() - 0.5) * 0.8));
      this.noise(0.015 + Math.random() * 0.02, 5000, 2000, 0.015 + Math.random() * 0.03, p, 'bandpass', delay);
    }
  }

  /** slow-mo: a tape-stop whoosh, and the drones drop a fifth while it lasts */
  slowmo(on: boolean): void {
    this.slow = on;
    if (this.pg && this.ac) {
      const t = this.ac.currentTime;
      for (const o of this.pg.oscs) o.detune.setTargetAtTime(on ? -700 : 0, t, 0.25);
    }
    if (on) this.noise(0.7, 3200, 160, 0.09);
    else this.noise(0.5, 300, 3000, 0.07, 0, 'lowpass');
  }

  ui(): void {
    this.blip(640, 0.05, 'square', 0.05);
  }

  /** a rocket going up: a rising whistle over a little hiss */
  fireworkLaunch(): void {
    this.blip(700, 0.85, 'sine', 0.045, 2300);
    this.blip(1400, 0.85, 'sine', 0.012, 4600);
    this.noise(0.6, 4500, 1500, 0.025, 0, 'highpass');
  }

  /** Something caught fire: a soft whoosh, louder for a bigger flare-up. */
  ignite(n = 1): void {
    const now = performance.now();
    if (now - this.lastIgnite < 180) return;
    this.lastIgnite = now;
    const v = Math.min(0.14, 0.05 + Math.log2(1 + n) * 0.018);
    this.noise(0.3, 2600, 320, v);
  }

  /**
   * An explosion of radius r (sim cells) at horizontal position pan.
   *
   * Three layers: a pitched-down sine thump you feel more than hear, a
   * low-passed noise body, and a short bright crack on top. Big blasts add a
   * rumbling tail. Chains are rate-limited so twenty blasts in a frame do
   * not clip - the later ones fold into the rumble instead.
   */
  boom(r = 9, pan = 0): void {
    const now = performance.now();
    const big = Math.min(1, r / 9);
    if (now - this.lastBoom < 70) {
      // fold into the existing rumble rather than stacking another thump
      this.noise(0.35, 400, 60, 0.08 * big, pan);
      return;
    }
    this.lastBoom = now;
    this.blip(90 - big * 30, 0.4 + big * 0.25, 'sine', 0.28 + big * 0.14, 24, 0, pan * 0.5);
    this.noise(0.45 + big * 0.35, 1100, 50, 0.26 + big * 0.16, pan);
    this.noise(0.06, 5200, 1800, 0.12 + big * 0.08, pan, 'highpass');
    if (big >= 0.9) this.noise(1.1, 260, 40, 0.14, pan * 0.6, 'lowpass', 90);
  }

  /** TNT just got lit: a hissing spit and a tick, so the fuse is audible. */
  fuse(pan = 0): void {
    const now = performance.now();
    if (now - this.lastFuse < 120) return;
    this.lastFuse = now;
    this.noise(0.5, 7000, 3000, 0.05, pan, 'highpass');
    this.blip(1500, 0.03, 'square', 0.04, undefined, 0, pan);
  }

  /** Water meeting fire or lava: a "tsss", scaled by how much just happened. */
  sizzle(n: number): void {
    const now = performance.now();
    if (now - this.lastSizzle < 140) return;
    this.lastSizzle = now;
    const v = Math.min(0.09, 0.025 + Math.log2(1 + n) * 0.012);
    this.noise(0.22, 6000, 2400, v, 0, 'highpass');
  }

  /** A pulse leaving a torch along a wire. */
  zap(): void {
    const now = performance.now();
    if (now - this.lastZap < 90) return;
    this.lastZap = now;
    this.blip(1800, 0.05, 'square', 0.035, 600);
    this.noise(0.03, 8000, 4000, 0.04, 0, 'highpass');
  }

  /**
   * Ambient fire: random dry clicks, denser the more is burning. Called every
   * frame with the current fire cell count; costs nothing when nothing burns.
   */
  crackle(fire: number): void {
    if (fire <= 0 || !this.ac || this.muted) return;
    const chance = Math.min(0.55, fire / 900);
    if (Math.random() > chance) return;
    const v = 0.02 + Math.random() * 0.035;
    this.noise(0.02 + Math.random() * 0.03, 3200, 1400, v, Math.random() * 1.2 - 0.6, 'bandpass');
  }

  win(): void {
    [523, 659, 784, 1046].forEach((f, i) =>
      this.blip(f, 0.13, 'triangle', 0.12, undefined, i * 110),
    );
  }

  lose(): void {
    [392, 311, 233].forEach((f, i) =>
      this.blip(f, 0.2, 'sawtooth', 0.08, undefined, i * 170),
    );
  }

  star(i: number): void {
    this.blip(880 + i * 240, 0.16, 'triangle', 0.13, undefined, i * 240);
  }
}
