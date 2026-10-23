/**
 * The title screen's navigation, as pure functions: which screen is open and
 * where the cursor is on each. No DOM, no clock - the view reads this and draws it.
 */

export type MenuScreen = 'start' | 'main' | 'challenges' | 'options';

export interface Nav {
  screen: MenuScreen;
  /** the cursor of each list, kept so BACK lands where you left */
  cursor: { main: number; challenges: number; options: number };
}

export function initialNav(firstVisit: boolean): Nav {
  return { screen: firstVisit ? 'start' : 'main', cursor: { main: 0, challenges: 0, options: 0 } };
}

/** Move `from` by `d` through a list of `n`, wrapping at both ends. */
export function wrap(from: number, d: number, n: number): number {
  return n <= 0 ? 0 : (((from + d) % n) + n) % n;
}

/** The cursor of a list screen moved by `d` (+1 down, -1 up). */
export function move(nav: Nav, n: number, d: number): Nav {
  if (nav.screen === 'start') return nav;
  return { ...nav, cursor: { ...nav.cursor, [nav.screen]: wrap(nav.cursor[nav.screen], d, n) } };
}

/** The cursor of the current list put on item `i` (the mouse hovering it). */
export function moveTo(nav: Nav, i: number): Nav {
  if (nav.screen === 'start') return nav;
  return { ...nav, cursor: { ...nav.cursor, [nav.screen]: i } };
}

/** PRESS START goes on to MAIN. */
export function start(nav: Nav): Nav {
  return nav.screen === 'start' ? { ...nav, screen: 'main' } : nav;
}

/** MAIN opens a submenu, its cursor on the first item. */
export function open(nav: Nav, to: 'challenges' | 'options'): Nav {
  return nav.screen === 'main' ? { screen: to, cursor: { ...nav.cursor, [to]: 0 } } : nav;
}

/** BACK: a submenu returns to MAIN with the cursor where it was; MAIN has nowhere to go (null). */
export function back(nav: Nav): Nav | null {
  return nav.screen === 'challenges' || nav.screen === 'options' ? { ...nav, screen: 'main' } : null;
}
