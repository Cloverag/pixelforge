import { CHALLENGES } from '../sim/challenges';
import { isUnlocked, loadProgress, Progress } from '../game/progress';
import { isDialogOpen } from './dialog';
import { isHelpOpen } from './help';
import { back, initialNav, move, moveTo, open, start, type Nav } from './menucursor';
import { h } from './widgets';

/** An item of the title screen's MAIN list; main.ts owns the list and its hotkeys. */
export interface MenuEntry {
  name: string;
  /** the one description line shown under the list while this item is selected */
  sub: string | (() => string);
  /** the key as Input reports it ('p', 'l'); works on MAIN */
  hotkey?: string;
  /** moving the cursor here previews this on the background */
  preview?: 'pg' | 'chem';
  /** opens a submenu instead of running */
  opens?: 'challenges' | 'options';
  run?(): void;
}

export type MenuSound = 'move' | 'select' | 'back' | 'deny';

export interface MenuCallbacks {
  entries: MenuEntry[];
  /** a fresh visit: show PRESS START first */
  firstVisit: boolean;
  /** PRESS START was pressed: the user gesture that unlocks audio */
  onStart(): void;
  onChallenge(id: string): void;
  sound(s: MenuSound): void;
  onPreview(kind: 'pg' | 'chem'): void;
  // OPTIONS: a toggle acts, and the view reads the new value back
  onToggleMute(): void;
  onToggleMusic(): void;
  isMusicOn(): boolean;
  /** cycle the theme */
  onCycleTheme(): void;
  theme(): string;
  /** cycle the backdrop */
  onToggleBg(): void;
  backdrop(): string;
  onToggleCrt(): void;
  onHelp(): void;
}

const STARS_PER_LEVEL = 3;
const MODIFIERS = new Set(['shift', 'control', 'alt', 'meta', 'capslock', 'tab']);

/** One row of a list. */
interface Row {
  /** the text, or [number, name, stars] laid out as a grid (challenges) */
  label: string | [string, string, string];
  desc: string;
  locked?: boolean;
  /** Left/Right change the value (OPTIONS) */
  adjusts?: boolean;
  go(): void;
}

let cbs: MenuCallbacks | null = null;
let nav: Nav = initialNav(false);
let root: HTMLElement | null = null;
let rows: Row[] = [];
let itemEls: HTMLElement[] = [];
let descEl: HTMLElement | null = null;
let listening = false;

const coarse = (): boolean => matchMedia('(pointer: coarse)').matches;

/** "LIVE: <scene>" while the game runs behind the menu; null hides it. */
export function setMenuLive(name: string | null): void {
  const el = document.getElementById('menu-live');
  if (!el) return;
  el.textContent = name ? `LIVE: ${name}` : '';
  el.classList.toggle('hidden', !name);
}

function stars(n: number): string {
  return '★'.repeat(n) + '☆'.repeat(STARS_PER_LEVEL - n);
}

const onOff = (b: boolean): string => (b ? 'ON' : 'OFF');

/** The rows of the list screen now showing. */
function buildRows(c: MenuCallbacks): Row[] {
  if (nav.screen === 'main') {
    return c.entries.map((e) => ({
      label: e.opens ? `${e.name} >` : e.name,
      desc: typeof e.sub === 'function' ? e.sub() : e.sub,
      go: () => {
        c.sound('select');
        if (e.opens) setNav(open(nav, e.opens));
        else e.run?.();
      },
    }));
  }
  if (nav.screen === 'challenges') {
    const prog: Progress = loadProgress();
    const order = CHALLENGES.map((x) => x.id);
    const out: Row[] = CHALLENGES.map((ch, i) => {
      const unlocked = isUnlocked(i, order, prog);
      return {
        label: [String(i + 1).padStart(2, '0'), ch.name, unlocked ? stars(prog[ch.id] ?? 0) : 'LOCKED'],
        desc: unlocked ? ch.desc : 'Clear the level above to unlock.',
        locked: !unlocked,
        go: () => {
          if (!unlocked) {
            c.sound('deny');
            return;
          }
          c.sound('select');
          c.onChallenge(ch.id);
        },
      };
    });
    // touch has no ESC: BACK is an item too
    out.push({ label: 'BACK', desc: 'Back to the main list.', go: () => goBack(c) });
    return out;
  }
  // OPTIONS: the value is part of the label, redrawn after each change
  const change = (fn: () => void) => () => {
    fn();
    c.sound('select');
    repaintLabels();
  };
  return [
    { label: `SOUND EFFECTS: ${onOff(!document.body.classList.contains('muted'))}`, desc: 'Clicks, blasts and fizzes.', adjusts: true, go: change(c.onToggleMute) },
    { label: `MUSIC: ${onOff(c.isMusicOn())}`, desc: 'The chiptune loop.', adjusts: true, go: change(c.onToggleMusic) },
    { label: `THEME: ${c.theme().toUpperCase()}`, desc: 'Light, dark or follow your system - for the game screens.', adjusts: true, go: change(c.onCycleTheme) },
    { label: `BACKDROP: ${c.backdrop()}`, desc: 'The picture around the game screen.', adjusts: true, go: change(c.onToggleBg) },
    { label: `CRT FILTER: ${onOff(document.body.classList.contains('crt-on'))}`, desc: 'Scanlines and a soft vignette over the game.', adjusts: true, go: change(c.onToggleCrt) },
    { label: 'CONTROLS', desc: 'Keys, brushes and how to play.', go: () => { c.sound('select'); c.onHelp(); } },
    { label: 'BACK', desc: 'Back to the main list.', go: () => goBack(c) },
  ];
}

function goBack(c: MenuCallbacks): void {
  const b = back(nav);
  if (!b) return;
  c.sound('back');
  setNav(b);
}

function setNav(n: Nav): void {
  const screenChanged = n.screen !== nav.screen;
  nav = n;
  if (screenChanged) render();
  else paint();
}

/** Redraw the labels of the current list in place (an OPTIONS value changed). */
function repaintLabels(): void {
  if (!cbs) return;
  rows = buildRows(cbs);
  rows.forEach((r, i) => {
    const lbl = itemEls[i]?.querySelector('.ts-label');
    if (lbl && typeof r.label === 'string') lbl.firstChild!.textContent = r.label;
  });
}

/** The cursor: its classes, its focus, the description, and the preview. */
function paint(): void {
  if (nav.screen === 'start' || !cbs) return;
  const cur = nav.cursor[nav.screen];
  itemEls.forEach((el, i) => {
    const on = i === cur;
    el.classList.toggle('sel', on);
    el.setAttribute('aria-selected', String(on));
    el.tabIndex = on ? 0 : -1;
  });
  itemEls[cur]?.focus({ preventScroll: true });
  if (descEl) descEl.textContent = rows[cur]?.desc ?? '';
  if (nav.screen === 'main') {
    const kind = cbs.entries[cur]?.preview;
    if (kind) cbs.onPreview(kind);
  }
}

function moveCursor(d: number): void {
  if (!cbs || nav.screen === 'start') return;
  const next = move(nav, rows.length, d);
  if (next === nav) return;
  cbs.sound('move');
  setNav(next);
}

function pressStart(): void {
  if (!cbs || nav.screen !== 'start') return;
  cbs.onStart(); // the gesture that unlocks audio
  cbs.sound('select');
  setNav(start(nav));
}

function confirm(): void {
  if (nav.screen === 'start') pressStart();
  else rows[nav.cursor[nav.screen]]?.go();
}

const HINTS = {
  start: '',
  main: '↑↓ SELECT · ENTER OK',
  challenges: '↑↓ SELECT · ENTER OK · ESC BACK',
  options: '↑↓ SELECT · ENTER / ←→ CHANGE · ESC BACK',
};

/** Build the screen for the current state into the overlay. */
function render(): void {
  if (!root || !cbs) return;
  const c = cbs;
  root.dataset.screen = nav.screen;
  root.querySelector('.ts-body')?.remove();
  root.querySelector('.ts-desc')?.remove();
  const foot = root.querySelector('.ts-foot')!;
  const body = h('div', 'ts-body');
  itemEls = [];
  rows = [];
  descEl = null;

  if (nav.screen === 'start') {
    body.appendChild(h('p', 'ts-press', coarse() ? 'TAP TO START' : 'PRESS ENTER'));
    root.insertBefore(body, foot);
  } else {
    rows = buildRows(c);
    const name = nav.screen;
    if (name !== 'main') body.appendChild(h('h2', 'ts-heading', name === 'challenges' ? 'CHALLENGES' : 'OPTIONS'));
    const list = h('div', `ts-list ts-${name}`);
    list.setAttribute('role', 'menu');
    list.setAttribute('aria-label', name === 'main' ? 'Main menu' : name === 'challenges' ? 'Challenges' : 'Options');
    rows.forEach((r, i) => {
      const el = h('div', 'ts-item' + (r.locked ? ' locked' : ''));
      el.setAttribute('role', 'menuitem');
      if (r.locked) el.setAttribute('aria-disabled', 'true');
      const lbl = h('span', 'ts-label');
      if (typeof r.label === 'string') lbl.append(document.createTextNode(r.label));
      else {
        lbl.classList.add('ts-grid');
        lbl.append(h('span', 'ts-num', r.label[0]), h('span', 'ts-name', r.label[1]), h('span', 'ts-stars', r.label[2]));
      }
      const arrows = [h('span', 'ts-arrow l', '▶'), h('span', 'ts-arrow r', '◀')];
      for (const a of arrows) a.setAttribute('aria-hidden', 'true');
      lbl.append(...arrows);
      el.appendChild(lbl);
      // the mouse moves the cursor; a click or a tap confirms
      el.addEventListener('pointerenter', (e) => {
        if (e.pointerType === 'mouse' && nav.screen !== 'start' && nav.cursor[nav.screen] !== i) {
          c.sound('move');
          setNav(moveTo(nav, i));
        }
      });
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        setNav(moveTo(nav, i));
        confirm();
      });
      itemEls.push(el);
      list.appendChild(el);
    });
    body.appendChild(list);
    root.insertBefore(body, foot);
    descEl = h('p', 'ts-desc');
    descEl.setAttribute('aria-live', 'polite');
    root.insertBefore(descEl, foot);
  }
  foot.textContent = coarse() ? '' : HINTS[nav.screen];
  paint();
}

/** Keys while the title screen is up: what it handles it stops, the rest (M, T, C) passes on. */
function onKey(e: KeyboardEvent): void {
  if (!cbs || !root?.isConnected || root.closest('#overlay')?.classList.contains('hidden')) return;
  if (isDialogOpen() || isHelpOpen()) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (MODIFIERS.has(k)) return;
  const used = (): void => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  if (nav.screen === 'start') {
    used();
    if (!e.repeat) pressStart();
    return;
  }
  const repeatable = k === 'arrowup' || k === 'arrowdown' || k === 'w' || k === 's';
  if (e.repeat && !repeatable) return;
  const row = rows[nav.cursor[nav.screen]];
  switch (k) {
    case 'arrowup':
    case 'w':
      used();
      moveCursor(-1);
      return;
    case 'arrowdown':
    case 's':
      used();
      moveCursor(1);
      return;
    case 'enter':
    case ' ':
      used();
      confirm();
      return;
    case 'escape':
    case 'backspace':
      used();
      goBack(cbs);
      return;
    case 'arrowleft':
    case 'arrowright':
      if (row?.adjusts) {
        used();
        row.go();
      }
      return;
  }
  if (nav.screen === 'main') {
    const i = cbs.entries.findIndex((en) => en.hotkey === k);
    if (i >= 0) {
      used();
      setNav(moveTo(nav, i));
      confirm();
    }
  }
}

export function showMenu(callbacks: MenuCallbacks): void {
  cbs = callbacks;
  nav = initialNav(callbacks.firstVisit);
  const overlay = document.getElementById('overlay')!;
  overlay.innerHTML = '';
  overlay.classList.remove('hidden');

  root = h('div', 'title-screen');
  root.appendChild(h('h1', 'ts-logo', 'PIXELFORGE'));
  root.appendChild(h('div', 'ts-foot'));
  // PRESS START: any click or tap goes on
  root.addEventListener('click', pressStart);
  overlay.appendChild(root);
  const live = h('div', 'menu-live hidden');
  live.id = 'menu-live';
  overlay.appendChild(live);

  if (!listening) {
    listening = true;
    window.addEventListener('keydown', onKey, true);
  }
  render();
}
