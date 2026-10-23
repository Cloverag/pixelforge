import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SLOTS, allSampleFiles, boomSlot, pickNoRepeat, rateJitter, type Slot } from '../src/game/sample-slots';
import { Samples, type SampleCtx } from '../src/game/samples';

/** The recorded one-shots: the files, the picking, and the fall back to the synth. */

const DIR = join(__dirname, '..', 'public', 'sfx');

describe('the sample files', () => {
  it('every file a slot names exists, and nothing else is shipped', () => {
    const named = allSampleFiles().sort();
    const onDisk = readdirSync(DIR).filter((f) => f.endsWith('.ogg')).map((f) => f.slice(0, -4)).sort();
    expect(named.filter((n) => !existsSync(join(DIR, `${n}.ogg`)))).toEqual([]);
    expect(onDisk).toEqual(named);
  });

  it('together they fit the 600 KB budget', () => {
    const total = readdirSync(DIR).reduce((s, f) => s + statSync(join(DIR, f)).size, 0);
    expect(total).toBeLessThanOrEqual(600 * 1024);
  });

  it('LICENSE.md lists every file as CC0', () => {
    const text = readFileSync(join(DIR, 'LICENSE.md'), 'utf8');
    for (const n of allSampleFiles()) expect([n, text.includes(`\`${n}.ogg\``)]).toEqual([n, true]);
    expect(text).toContain('CC0');
  });

  it('every slot has a file and a sane level', () => {
    for (const [slot, def] of Object.entries(SLOTS)) {
      expect([slot, def.files.length > 0]).toEqual([slot, true]);
      expect(def.gain).toBeGreaterThan(0);
      expect(def.gain).toBeLessThanOrEqual(2);
    }
  });
});

describe('picking', () => {
  it('never repeats the last file when there is a choice', () => {
    for (const n of [2, 3, 5])
      for (let last = 0; last < n; last++)
        for (let k = 0; k < 100; k++) {
          const i = pickNoRepeat(n, last, k / 100);
          expect([n, last, k, i !== last && i >= 0 && i < n]).toEqual([n, last, k, true]);
        }
  });
  it('reaches every file, including the last one, when nothing is to be avoided', () => {
    const seen = new Set<number>();
    for (let k = 0; k < 100; k++) seen.add(pickNoRepeat(3, -1, k / 100));
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });
  it('reaches every other file when avoiding one', () => {
    const seen = new Set<number>();
    for (let k = 0; k < 100; k++) seen.add(pickNoRepeat(4, 1, k / 100));
    expect([...seen].sort()).toEqual([0, 2, 3]);
  });
  it('one file is always that file', () => {
    expect(pickNoRepeat(1, 0, 0.9)).toBe(0);
  });
  it('the pitch stays within 5%, and reaches both ends', () => {
    expect(rateJitter(0)).toBeCloseTo(0.95, 10);
    expect(rateJitter(0.5)).toBeCloseTo(1, 10);
    expect(rateJitter(0.999999)).toBeCloseTo(1.05, 4);
    for (let k = 0; k < 100; k++) {
      const r = rateJitter(k / 100);
      expect(r).toBeGreaterThanOrEqual(0.95);
      expect(r).toBeLessThanOrEqual(1.05);
    }
  });
  it('an explosion takes its size from the radius', () => {
    expect([2, 3, 4, 5, 8, 9, 12].map(boomSlot)).toEqual(['boomS', 'boomS', 'boomM', 'boomM', 'boomM', 'boomL', 'boomL']);
  });
});

/** A stand-in for the audio context: it records what was played and can fail on chosen files. */
function fake(failing: (name: string) => boolean = () => false) {
  const started: { name: string; rate: number; gain: number; when: number }[] = [];
  const names = new Map<ArrayBuffer, string>();
  const ctx: SampleCtx = {
    currentTime: 10,
    decodeAudioData: async (data) => {
      const name = names.get(data)!;
      if (failing(name)) throw new Error('decode');
      return { name } as unknown as AudioBuffer;
    },
    createBufferSource: () => {
      const src = { buffer: null as unknown, playbackRate: { value: 1 }, connect: (g: unknown) => g, start: (when: number) => started.push({ name: (src.buffer as { name: string }).name, rate: src.playbackRate.value, gain: gainNode.gain.value, when }) };
      return src as unknown as AudioBufferSourceNode;
    },
    createGain: () => gainNode as unknown as GainNode,
  };
  const gainNode: { gain: { value: number }; connect: (d: unknown) => unknown } = { gain: { value: 1 }, connect: (d) => d };
  const fetcher = async (url: string) => {
    const name = url.split('/').pop()!.replace('.ogg', '');
    const buf = new ArrayBuffer(8);
    names.set(buf, name);
    return { ok: !failing('http:' + name), arrayBuffer: async () => buf };
  };
  return { ctx, fetcher, started };
}

describe('Samples', () => {
  it('decodes every file and counts them', async () => {
    const f = fake();
    const s = new Samples(f.ctx, 'sfx/', f.fetcher);
    expect(await s.load()).toEqual({ ok: allSampleFiles().length, failed: 0 });
  });

  it('a slot whose files all failed to decode plays nothing, so the synth takes over', async () => {
    const f = fake((n) => SLOTS.zap.files.includes(n));
    const s = new Samples(f.ctx, 'sfx/', f.fetcher);
    const r = await s.load();
    expect(r.failed).toBe(SLOTS.zap.files.length);
    expect(s.play('zap', {} as AudioNode)).toBe(false);
    expect(s.has('zap')).toBe(false);
    expect(s.play('move', {} as AudioNode)).toBe(true); // others are fine
    expect(f.started).toHaveLength(1);
  });

  it('a failed fetch counts as a failure too, and nothing throws', async () => {
    const f = fake((n) => n === 'http:' + SLOTS.win.files[0]);
    const s = new Samples(f.ctx, 'sfx/', f.fetcher);
    const r = await s.load();
    expect(r.failed).toBe(1);
    expect(s.has('win')).toBe(true); // its other file loaded
  });

  it('before anything has loaded every slot reports false', () => {
    const f = fake();
    const s = new Samples(f.ctx, 'sfx/', f.fetcher);
    for (const slot of Object.keys(SLOTS) as Slot[]) expect(s.play(slot, {} as AudioNode)).toBe(false);
  });

  it('a slot with files never plays the same one twice running, and varies the pitch within 5%', async () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const f = fake();
    const s = new Samples(f.ctx, 'sfx/', f.fetcher, rnd);
    await s.load();
    for (let k = 0; k < 60; k++) s.play('click', {} as AudioNode);
    for (let k = 1; k < f.started.length; k++) expect(f.started[k].name).not.toBe(f.started[k - 1].name);
    for (const p of f.started) {
      expect(p.rate).toBeGreaterThanOrEqual(0.95);
      expect(p.rate).toBeLessThanOrEqual(1.05);
    }
    expect(new Set(f.started.map((p) => p.name)).size).toBe(SLOTS.click.files.length);
    // ...and it really varies: 60 plays span most of the +-5% range
    const rates = f.started.map((p) => p.rate);
    expect(Math.max(...rates) - Math.min(...rates)).toBeGreaterThan(0.07);
  });

  it('with only one file left it still plays (a repeat beats silence)', async () => {
    const f = fake((n) => SLOTS.move.files.slice(1).includes(n));
    const s = new Samples(f.ctx, 'sfx/', f.fetcher);
    await s.load();
    s.play('move', {} as AudioNode);
    s.play('move', {} as AudioNode);
    expect(f.started.map((p) => p.name)).toEqual([SLOTS.move.files[0], SLOTS.move.files[0]]);
  });

  it('uses the slot gain times the caller gain, and delays a start', async () => {
    const f = fake();
    const s = new Samples(f.ctx, 'sfx/', f.fetcher, () => 0.5);
    await s.load();
    s.play('star', {} as AudioNode, { gain: 0.5, rate: 1.24, delaySec: 0.48 });
    const p = f.started[0];
    expect(p.gain).toBeCloseTo(SLOTS.star.gain * 0.5, 10);
    expect(p.rate).toBeCloseTo(1.24, 10); // rateJitter(0.5) = 1
    expect(p.when).toBeCloseTo(10.48, 10);
  });
});
