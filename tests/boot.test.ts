import { describe, expect, it } from 'vitest';
import { bootPlace } from '../src/game/boot';

describe('a reload comes back where the player was', () => {
  it('to the same lab, the sandbox (saved or not), or the title screen', () => {
    expect(bootPlace('math', true)).toBe('math');
    expect(bootPlace('garden', false)).toBe('garden');
    expect(bootPlace('sand', false)).toBe('sand');
    expect(bootPlace('menu', true)).toBe('menu');
  });

  it('a first visit opens the title screen; a player from before gets their saved sandbox', () => {
    expect(bootPlace(null, false)).toBe('menu');
    expect(bootPlace(null, true)).toBe('sand');
  });

  it('something unknown in storage opens the title screen', () => {
    expect(bootPlace('moon', true)).toBe('menu');
    expect(bootPlace('', true)).toBe('menu');
  });
});
