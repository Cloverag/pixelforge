import { MODES, type Mode } from '../sim/protocol';

/**
 * Where a page load starts, from where the player last was (`where`, null if
 * never remembered) and whether a sandbox world is saved: back in the same
 * mode, in the sandbox (with its world), or on the title screen.
 */
export function bootPlace(where: string | null, hasSave: boolean): Mode | 'menu' {
  if (where && where !== 'menu' && (MODES as readonly string[]).includes(where)) return where as Mode;
  // a player from before the place was remembered still gets their saved sandbox
  if (where === null && hasSave) return 'sand';
  return 'menu';
}
