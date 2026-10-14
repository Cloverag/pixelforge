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

  ui(): void {
    this.blip(640, 0.05, 'square', 0.05);
  }

  fireworkLaunch(): void {
    this.blip(200, 0.25, 'square', 0.06, 700);
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
