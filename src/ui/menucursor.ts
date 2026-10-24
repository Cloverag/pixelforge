/**
 * The title screen's and the pause menu's navigation, as pure functions: which
 * screen is open and where the cursor is on each. No DOM, no clock - the view
 * reads this and draws it.
 *
 * Both menus share the lists: the title's MAIN and the pause menu's PAUSE are
 * each a `home`, the one list BACK returns to; OPTIONS opens from either.
 */

export type MenuScreen = 'start' | 'main' | 'challenges' | 'options' | 'pause' | 'view';
export type MenuHome = 'main' | 'pause';
type ListScreen = Exclude<MenuScreen, 'start'>;

export interface Nav {
  screen: MenuScreen;
  /** the list at the root of this menu: BACK from a submenu lands here */
  home: MenuHome;
  /** the cursor of each list, kept so BACK lands where you left */
  cursor: Record<ListScreen, number>;
}

export function initialNav(firstVisit: boolean, home: MenuHome = 'main'): Nav {
  return {
    screen: home === 'pause' ? 'pause' : firstVisit ? 'start' : 'main',
    home,
    cursor: { main: 0, challenges: 0, options: 0, pause: 0, view: 0 },
  };
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

/** A home list opens a submenu, its cursor on the first item. */
export function open(nav: Nav, to: 'challenges' | 'options' | 'view'): Nav {
  return nav.screen === nav.home ? { ...nav, screen: to, cursor: { ...nav.cursor, [to]: 0 } } : nav;
}

/** BACK: a submenu returns to its home with the cursor where it was; a home list has nowhere to go (null). */
export function back(nav: Nav): Nav | null {
  return nav.screen === 'start' || nav.screen === nav.home ? null : { ...nav, screen: nav.home };
}
