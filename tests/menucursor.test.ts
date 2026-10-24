import { describe, expect, it } from 'vitest';
import { back, initialNav, move, moveTo, open, start, wrap } from '../src/ui/menucursor';

/** The title screen's navigation: wrap, the back stack, where the cursor lands. */

describe('wrap', () => {
  it('wraps at both ends', () => {
    expect(wrap(6, 1, 7)).toBe(0);
    expect(wrap(0, -1, 7)).toBe(6);
    expect(wrap(3, 1, 7)).toBe(4);
    expect(wrap(3, -1, 7)).toBe(2);
  });
  it('an empty list keeps the cursor at 0', () => {
    expect(wrap(0, 1, 0)).toBe(0);
  });
});

describe('title navigation', () => {
  it('a fresh visit starts on PRESS START, a return lands on MAIN', () => {
    expect(initialNav(true).screen).toBe('start');
    expect(initialNav(false).screen).toBe('main');
  });

  it('PRESS START goes on to MAIN and only from there', () => {
    expect(start(initialNav(true)).screen).toBe('main');
    const m = initialNav(false);
    expect(start(m)).toBe(m);
  });

  it('the cursor does not move on PRESS START', () => {
    const s = initialNav(true);
    expect(move(s, 7, 1)).toBe(s);
    expect(moveTo(s, 3)).toBe(s);
  });

  it('moves down and up, wrapping, one list at a time', () => {
    let n = initialNav(false);
    for (let i = 0; i < 7; i++) n = move(n, 7, 1);
    expect(n.cursor.main).toBe(0); // 7 steps down through 7 items: full circle
    expect(move(n, 7, -1).cursor.main).toBe(6);
    expect(moveTo(n, 4).cursor.main).toBe(4);
  });

  it('a submenu opens at its first item and BACK lands on the item that opened it', () => {
    let n = initialNav(false);
    n = moveTo(n, 4); // CHALLENGES
    n = open(n, 'challenges');
    expect(n.screen).toBe('challenges');
    expect(n.cursor.challenges).toBe(0);
    n = move(n, 7, 3);
    n = back(n)!;
    expect(n.screen).toBe('main');
    expect(n.cursor.main).toBe(4);
    // reopening starts again at the top
    expect(open(n, 'challenges').cursor.challenges).toBe(0);
  });

  it('BACK from MAIN (or PRESS START) is nothing', () => {
    expect(back(initialNav(false))).toBeNull();
    expect(back(initialNav(true))).toBeNull();
  });

  it('a submenu opens only from MAIN', () => {
    const s = initialNav(true);
    expect(open(s, 'options')).toBe(s);
  });
});

describe('pause menu navigation', () => {
  it('opens on PAUSE, not PRESS START, and its home is PAUSE', () => {
    const n = initialNav(true, 'pause'); // a first visit does not apply: there is no title here
    expect(n.screen).toBe('pause');
    expect(n.home).toBe('pause');
    expect(start(n)).toBe(n);
  });

  it('VIEW and OPTIONS open from PAUSE and BACK lands on the item that opened them', () => {
    let n = initialNav(false, 'pause');
    n = moveTo(n, 4); // VIEW
    n = open(n, 'view');
    expect(n.screen).toBe('view');
    expect(n.cursor.view).toBe(0);
    n = back(n)!;
    expect(n.screen).toBe('pause');
    expect(n.cursor.pause).toBe(4);
    n = open(moveTo(n, 5), 'options');
    expect(back(n)!.screen).toBe('pause'); // not MAIN: OPTIONS is the same screen under both menus
  });

  it('BACK from PAUSE itself is nothing: the view turns that into RESUME', () => {
    expect(back(initialNav(false, 'pause'))).toBeNull();
  });

  it('the title menu still returns OPTIONS to MAIN', () => {
    const n = open(initialNav(false), 'options');
    expect(back(n)!.screen).toBe('main');
  });
});
