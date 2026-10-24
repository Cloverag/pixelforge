/**
 * What the pause menu does to the simulation, as a pure rule.
 *
 * Alone, opening it freezes the sim and RESUME puts back whatever the player
 * had (a world frozen with SPACE stays frozen). In a room it never freezes:
 * the world is shared and sequenced by the host, so one player's menu must not
 * stop anyone, and there is nothing to put back.
 */
export interface PauseRule {
  /** freeze the sim when the menu opens */
  freezeOnOpen: boolean;
  /** the pause state to restore when the menu closes */
  pausedOnResume: boolean;
}

export function pauseRule(pausedBefore: boolean, inRoom: boolean): PauseRule {
  return { freezeOnOpen: !inRoom, pausedOnResume: pausedBefore };
}
