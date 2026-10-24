import { describe, expect, it } from 'vitest';
import { pauseRule } from '../src/game/pause';

/** The pause menu's effect on the sim: freezes alone, never in a room, and gives back what it found. */

describe('the pause menu rule', () => {
  it('alone: opening freezes, and RESUME restores a running world', () => {
    expect(pauseRule(false, false)).toEqual({ freezeOnOpen: true, pausedOnResume: false });
  });

  it('alone: a world the player had frozen with SPACE stays frozen after RESUME', () => {
    expect(pauseRule(true, false)).toEqual({ freezeOnOpen: true, pausedOnResume: true });
  });

  it('in a room: the menu never freezes, whatever was paused before', () => {
    expect(pauseRule(false, true).freezeOnOpen).toBe(false);
    expect(pauseRule(true, true).freezeOnOpen).toBe(false);
  });

  it('in a room: RESUME leaves the pause state as it was', () => {
    expect(pauseRule(false, true).pausedOnResume).toBe(false);
    expect(pauseRule(true, true).pausedOnResume).toBe(true);
  });
});
