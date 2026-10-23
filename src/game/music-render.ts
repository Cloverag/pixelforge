/**
 * Dev only (imported behind import.meta.env.DEV, so it is not in the build):
 * render a track offline with the real engine, to measure it and to record it.
 */
import { MusicEngine } from './music-engine';
import type { TrackId } from './tracks';

/** `seconds` of a track as 16-bit stereo WAV bytes. Adaptive tracks sit at their quietest for the first half, then open up fully - or, with `adapt`, stay at that value throughout. */
export async function renderTrackWav(id: TrackId, seconds: number, adapt?: number): Promise<Uint8Array> {
  const rate = 44100;
  const off = new OfflineAudioContext(2, rate * seconds, rate);
  const noise = off.createBuffer(1, Math.floor(rate * 0.6), rate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const engine = new MusicEngine(off, off.destination, noise);
  engine.setScreen(id, 0, false);
  engine.applyAdapt(adapt ?? 0, 0, 0.001);
  if (adapt === undefined) engine.applyAdapt(1, seconds / 2, 1.2);
  engine.scheduleUntil(seconds + 0.1);
  const buf = await off.startRendering();
  const l = buf.getChannelData(0);
  const r = buf.getChannelData(1);
  const out = new DataView(new ArrayBuffer(44 + l.length * 4));
  const str = (o: number, s: string) => [...s].forEach((c, k) => out.setUint8(o + k, c.charCodeAt(0)));
  str(0, 'RIFF'); out.setUint32(4, 36 + l.length * 4, true); str(8, 'WAVE'); str(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true);
  out.setUint32(24, rate, true); out.setUint32(28, rate * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true);
  str(36, 'data'); out.setUint32(40, l.length * 4, true);
  for (let i = 0; i < l.length; i++) {
    out.setInt16(44 + i * 4, Math.max(-1, Math.min(1, l[i])) * 32767, true);
    out.setInt16(46 + i * 4, Math.max(-1, Math.min(1, r[i])) * 32767, true);
  }
  return new Uint8Array(out.buffer);
}
