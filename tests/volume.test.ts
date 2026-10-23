import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VOLUMES, busGain, clampVolume, cycleVolume, gainOf, parseVolumes, stepVolume, volumeBar, type Volumes,
} from '../src/game/volume';

/** Volumes: defaults 8/5/8, the (v/10)^2 curve, defensive parsing, steps. */

describe('gain curve', () => {
  it('is (v/10)^2 from silence to full', () => {
    expect(gainOf(0)).toBe(0);
    expect(gainOf(5)).toBeCloseTo(0.25, 10);
    expect(gainOf(10)).toBe(1);
    expect(gainOf(8)).toBeCloseTo(0.64, 10);
  });
  it('clamps out-of-range volumes', () => {
    expect(gainOf(-3)).toBe(0);
    expect(gainOf(99)).toBe(1);
    expect(clampVolume(4.6)).toBe(5);
  });
  it('a muted bus is silent and keeps its level', () => {
    const v: Volumes = { ...DEFAULT_VOLUMES, mute: { master: false, music: true, sfx: false } };
    expect(busGain(v, 'music')).toBe(0);
    expect(v.music).toBe(5);
    expect(busGain({ ...v, mute: { ...v.mute, music: false } }, 'music')).toBeCloseTo(0.25, 10);
  });
});

describe('parseVolumes', () => {
  it('defaults are master 8, music 5, sfx 8', () => {
    const d = parseVolumes(null);
    expect([d.master, d.music, d.sfx]).toEqual([8, 5, 8]);
  });
  it('reads a stored value back', () => {
    const v = parseVolumes(JSON.stringify({ master: 3, music: 0, sfx: 10, mute: { music: true } }));
    expect([v.master, v.music, v.sfx, v.mute.music, v.mute.sfx]).toEqual([3, 0, 10, true, false]);
  });
  it('falls back to the defaults on anything invalid', () => {
    for (const raw of ['', 'not json', '[]', '7', 'null', '"x"', '{', '{"master":"loud"}']) {
      const v = parseVolumes(raw);
      expect([raw, v.master, v.music, v.sfx]).toEqual([raw, 8, 5, 8]);
    }
  });
  it('takes a bad field alone: the others survive', () => {
    const v = parseVolumes('{"master":2,"music":"x","sfx":null}');
    expect([v.master, v.music, v.sfx]).toEqual([2, 5, 8]);
  });
  it('clamps stored numbers and rejects NaN and infinity', () => {
    const v = parseVolumes('{"master":50,"music":-4,"sfx":1e999}');
    expect([v.master, v.music, v.sfx]).toEqual([10, 0, 8]);
  });
  it('a mute flag is only true when it is exactly true', () => {
    expect(parseVolumes('{"mute":{"master":"yes","music":1}}').mute).toEqual({ master: false, music: false, sfx: false });
  });
  it('does not share the defaults object', () => {
    const a = parseVolumes(null);
    a.mute.music = true;
    expect(parseVolumes(null).mute.music).toBe(false);
  });
});

describe('steps and the bar', () => {
  it('Left/Right stop at the ends; Enter wraps 10 to 0', () => {
    expect(stepVolume(10, 1)).toBe(10);
    expect(stepVolume(0, -1)).toBe(0);
    expect(stepVolume(4, 1)).toBe(5);
    expect(cycleVolume(10)).toBe(0);
    expect(cycleVolume(3)).toBe(4);
  });
  it('the bar has ten cells, filled to the volume', () => {
    expect(volumeBar(5)).toBe('■■■■■□□□□□');
    expect(volumeBar(0)).toBe('□□□□□□□□□□');
    expect(volumeBar(10)).toBe('■■■■■■■■■■');
    expect(volumeBar(99)).toHaveLength(10);
  });
});
