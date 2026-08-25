/** Procedural chiptune SFX - no audio assets required. */
export class Sfx {
  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private lastPlace = 0;
  private lastBoom = 0;
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

  private blip(
    freq: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    slideTo?: number,
    delayMs = 0,
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
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, f0: number, f1: number, vol: number): void {
    if (!this.ac || !this.master || !this.noiseBuf || this.muted) return;
    const t0 = this.ac.currentTime;
    const src = this.ac.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = this.ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(f0, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur);
    const gain = this.ac.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t0);
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

  ignite(): void {
    this.noise(0.28, 2600, 320, 0.1);
  }

  boom(): void {
    const now = performance.now();
    if (now - this.lastBoom < 150) return;
    this.lastBoom = now;
    this.noise(0.5, 900, 55, 0.38);
    this.blip(72, 0.35, 'sine', 0.32, 26);
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
