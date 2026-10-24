import { CHALLENGES } from '../sim/challenges';
import { isUnlocked, loadProgress, Progress } from '../game/progress';
import { isDialogOpen } from './dialog';
import { isHelpOpen } from './help';
import { cycleVolume, stepVolume, volumeBar, type Bus } from '../game/volume';
import { back, initialNav, move, moveTo, open, start, type MenuHome, type Nav } from './menucursor';
import { h } from './widgets';

/** An item of the title screen's MAIN list; main.ts owns the list and its hotkeys. */
export interface MenuEntry {
  name: string;
  /** the one description line shown under the list while this item is selected */
  sub: string | (() => string);
  /** the key as Input reports it ('p', 'l'); works on MAIN */
  hotkey?: string;
  /** moving the cursor here previews this on the background */
  preview?: 'pg' | 'chem' | 'garden';
  /** opens a submenu instead of running */
  opens?: 'challenges' | 'options';
  run?(): void;
}

export type MenuSound = 'move' | 'select' | 'back' | 'deny';

/** What the title screen and the pause menu share: the sounds and the OPTIONS screen. */
export interface CommonCallbacks {
  sound(s: MenuSound): void;
  // OPTIONS: a setting acts, and the view reads the new value back
  volume(bus: Bus): number;
  setVolume(bus: Bus, v: number): void;
  /** cycle the backdrop */
  onToggleBg(): void;
  backdrop(): string;
  onToggleCrt(): void;
  onHelp(): void;
  /** the empty world's colour (a preset's name) and a step along the presets (+1 next, -1 previous) */
  backgroundName(): string;
  stepBackground(d: number): void;
}

export interface MenuCallbacks extends CommonCallbacks {
  entries: MenuEntry[];
  /** a fresh visit: show PRESS START first */
  firstVisit: boolean;
  /** PRESS START was pressed: the user gesture that unlocks audio */
  onStart(): void;
  onChallenge(id: string): void;
  onPreview(kind: 'pg' | 'chem' | 'garden'): void;
}

/** The view toggles of the pause menu's VIEW screen: each acts, and `state` reads them back. */
export interface ViewOps {
  immerse(): void;
  soft(): void;
  crt(): void;
  grid(): void;
  fps(): void;
  /** loads the 3D view the first time, so it resolves later */
  view3d(): Promise<void>;
  backdrop(): void;
  state(): { immerse: boolean; soft: boolean; crt: boolean; grid: number | null; fps: boolean; view3d: boolean; backdrop: string };
}

export interface PauseOps extends CommonCallbacks {
  /** the header: PAUSED alone, MENU in a room (the game keeps running there) */
  title: string;
  resume(): void;
  /** SAVE / LOAD / SHARE exist only in the sandbox; elsewhere they are dim */
  canSave: boolean;
  save(): void;
  load(): void;
  share(): void;
  view: ViewOps;
  /** back to the title screen (asks first in a room) */
  quit(): void;
}

const STARS_PER_LEVEL = 3;
const MODIFIERS = new Set(['shift', 'control', 'alt', 'meta', 'capslock', 'tab']);

/** One row of a list. */
interface Row {
  /** the text, or [number, name, stars] laid out as a grid (challenges) */
  label: string | [string, string, string];
  desc: string;
  locked?: boolean;
  /** the value as a bar of cells, shown after the label (a volume) */
  bar?: string;
  /** Left/Right change the value (OPTIONS): -1 or +1 */
  adjust?: (d: number) => void;
  go(): void;
}

/** one menu is up at a time: the title screen (menu) or the pause menu (pause) */
let cbs: CommonCallbacks | null = null;
let title: MenuCallbacks | null = null;
let pause: PauseOps | null = null;
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

/** The pause menu is on screen (a result or the share panel replaces it, so this is read, not stored). */
export function isPauseOpen(): boolean {
  return !!pause && !!root?.isConnected && !root.closest('#overlay')?.classList.contains('hidden');
}

/** The rows of the list screen now showing. */
function buildRows(c: CommonCallbacks): Row[] {
  if (nav.screen === 'pause' && pause) return pauseRows(c, pause);
  if (nav.screen === 'view' && pause) return viewRows(pause);
  if (nav.screen === 'main' && title) {
    const t = title;
    return t.entries.map((e) => ({
      label: e.opens ? `${e.name} >` : e.name,
      desc: typeof e.sub === 'function' ? e.sub() : e.sub,
      go: () => {
        c.sound('select');
        if (e.opens) setNav(open(nav, e.opens));
        else e.run?.();
      },
    }));
  }
  if (nav.screen === 'challenges' && title) {
    const t = title;
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
          t.onChallenge(ch.id);
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
  const toggleRow = (label: string, desc: string, fn: () => void): Row => {
    const go = change(fn);
    return { label, desc, adjust: go, go };
  };
  // Left/Right step the level, Enter steps up and wraps; each is heard at the new level
  const volumeRow = (label: string, bus: Bus, desc: string): Row => {
    const set = (v: number) => () => {
      c.setVolume(bus, v);
      c.sound('move');
      repaintLabels();
    };
    return {
      label,
      bar: volumeBar(c.volume(bus)),
      desc,
      adjust: (d) => set(stepVolume(c.volume(bus), d))(),
      go: () => set(cycleVolume(c.volume(bus)))(),
    };
  };
  return [
    volumeRow('MASTER VOLUME', 'master', 'Everything at once. M mutes it.'),
    volumeRow('MUSIC VOLUME', 'music', 'The soundtrack.'),
    volumeRow('EFFECTS VOLUME', 'sfx', 'Clicks, blasts and fizzes.'),
    toggleRow(`BACKDROP: ${c.backdrop()}`, 'The picture around the game screen.', c.onToggleBg),
    backgroundRow(c),
    toggleRow(`CRT FILTER: ${onOff(document.body.classList.contains('crt-on'))}`, 'Scanlines and a soft vignette over the game.', c.onToggleCrt),
    { label: 'CONTROLS', desc: 'Keys, brushes and how to play.', go: () => { c.sound('select'); c.onHelp(); } },
    { label: 'BACK', desc: 'Back to the main list.', go: () => goBack(c) },
  ];
}

/** BACKGROUND: the colour of the empty world; Left/Right step either way, Enter goes on */
function backgroundRow(c: CommonCallbacks): Row {
  const step = (d: number): void => {
    c.stepBackground(d);
    c.sound('select');
    repaintLabels();
  };
  return {
    label: `BACKGROUND: ${c.backgroundName()}`,
    desc: 'The colour of the empty world. Only you see it.',
    adjust: step,
    go: () => step(1),
  };
}

/** the pause menu's list: RESUME, the file keys (dim outside the sandbox), the submenus, QUIT */
function pauseRows(c: CommonCallbacks, p: PauseOps): Row[] {
  // a file key closes the menu so the toast, or the share panel, is what you see
  const file = (label: string, desc: string, fn: () => void): Row => ({
    label,
    desc: p.canSave ? desc : 'Saving is for the sandbox.',
    locked: !p.canSave,
    go: () => {
      if (!p.canSave) return c.sound('deny');
      c.sound('select');
      fn();
      p.resume();
    },
  });
  const sub = (name: string, to: 'view' | 'options', desc: string): Row => ({
    label: `${name} >`,
    desc,
    go: () => {
      c.sound('select');
      setNav(open(nav, to));
    },
  });
  return [
    { label: 'RESUME', desc: 'Back to the game.', go: () => { c.sound('back'); p.resume(); } },
    file('SAVE', 'Keep this world in this browser.', p.save),
    file('LOAD', 'Bring back the saved world.', p.load),
    file('SHARE', 'Copy a link that opens this world.', p.share),
    sub('VIEW', 'view', 'Soft glow, CRT, grid, 3D, immersive, backdrop.'),
    sub('OPTIONS', 'options', 'Sound, music, backdrop, controls.'),
    { label: 'CONTROLS', desc: 'Keys, brushes and how to play.', go: () => { c.sound('select'); c.onHelp(); } },
    { label: 'QUIT TO TITLE', desc: p.title === 'MENU' ? 'Leave the room and go to the title screen.' : 'Leave this game for the title screen.', go: () => { c.sound('select'); p.quit(); } },
  ];
}

/** VIEW: each a value item like OPTIONS', changed with Enter or Left/Right */
function viewRows(p: PauseOps): Row[] {
  const v = p.view;
  const st = v.state();
  const row = (label: string, value: string, desc: string, fn: () => void | Promise<void>): Row => {
    const go = (): void => {
      p.sound('select');
      void Promise.resolve(fn()).then(repaintLabels);
    };
    return { label: `${label}: ${value}`, desc, adjust: go, go };
  };
  return [
    row('IMMERSE', onOff(st.immerse), 'Fill the window; panels slide in at the edges.', v.immerse),
    row('SOFT', onOff(st.soft), 'Smooth particles with trails and glow.', v.soft),
    row('CRT', onOff(st.crt), 'Scanlines and a soft vignette over the game.', v.crt),
    row('GRID', st.grid === null ? 'OFF' : `${st.grid}PX`, 'Chunky blocks: cycles the size.', v.grid),
    row('FPS', onOff(st.fps), 'A frames-per-second readout in the corner of the screen.', v.fps),
    row('3D', onOff(st.view3d), 'Look at the world as a 3D diorama.', v.view3d),
    row('BACKDROP', st.backdrop, 'The picture around the game screen.', v.backdrop),
    backgroundRow(p),
    { label: 'BACK', desc: 'Back to the pause menu.', go: () => goBack(p) },
  ];
}

function goBack(c: CommonCallbacks): void {
  const b = back(nav);
  if (!b) {
    // BACK on the pause menu's own list is RESUME
    if (nav.screen === 'pause' && pause) {
      c.sound('back');
      pause.resume();
    }
    return;
  }
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
    const bar = itemEls[i]?.querySelector('.ts-bar');
    if (bar && r.bar !== undefined) bar.textContent = r.bar;
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
  if (nav.screen === 'main' && title) {
    const kind = title.entries[cur]?.preview;
    if (kind) title.onPreview(kind);
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
  if (!cbs || !title || nav.screen !== 'start') return;
  title.onStart(); // the gesture that unlocks audio
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
  pause: '↑↓ SELECT · ENTER OK · ESC RESUME',
  view: '↑↓ SELECT · ENTER / ←→ CHANGE · ESC BACK',
};

const HEADINGS = { challenges: 'CHALLENGES', options: 'OPTIONS', view: 'VIEW' };
const LIST_NAMES = { main: 'Main menu', challenges: 'Challenges', options: 'Options', pause: 'Pause menu', view: 'View' };

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
    if (name === 'pause') body.appendChild(h('h2', 'ts-heading', pause?.title ?? 'PAUSED'));
    else if (name !== 'main') body.appendChild(h('h2', 'ts-heading', HEADINGS[name]));
    const list = h('div', `ts-list ts-${name}`);
    list.setAttribute('role', 'menu');
    list.setAttribute('aria-label', LIST_NAMES[name]);
    rows.forEach((r, i) => {
      const el = h('div', 'ts-item' + (r.locked ? ' locked' : ''));
      el.setAttribute('role', 'menuitem');
      if (r.locked) el.setAttribute('aria-disabled', 'true');
      const lbl = h('span', 'ts-label');
      if (typeof r.label === 'string') {
        lbl.append(document.createTextNode(r.label));
        if (r.bar !== undefined) lbl.append(h('span', 'ts-bar', r.bar));
      } else {
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
      if (row?.adjust) {
        used();
        row.adjust(k === 'arrowleft' ? -1 : 1);
      }
      return;
  }
  if (nav.screen === 'main' && title) {
    const i = title.entries.findIndex((en) => en.hotkey === k);
    if (i >= 0) {
      used();
      setNav(moveTo(nav, i));
      confirm();
    }
  }
}

/** Put a menu's screen into the overlay and start listening for keys. */
function mount(home: MenuHome, firstVisit: boolean): HTMLElement {
  nav = initialNav(firstVisit, home);
  const overlay = document.getElementById('overlay')!;
  overlay.innerHTML = '';
  overlay.classList.remove('hidden');
  root = h('div', 'title-screen');
  root.dataset.kind = home === 'pause' ? 'pause' : 'title';
  if (!listening) {
    listening = true;
    window.addEventListener('keydown', onKey, true);
  }
  return overlay;
}

export function showMenu(callbacks: MenuCallbacks): void {
  cbs = title = callbacks;
  pause = null;
  const overlay = mount('main', callbacks.firstVisit);
  root!.appendChild(h('h1', 'ts-logo', 'PIXELFORGE'));
  root!.appendChild(h('div', 'ts-foot'));
  // PRESS START: any click or tap goes on
  root!.addEventListener('click', pressStart);
  overlay.appendChild(root!);
  const live = h('div', 'menu-live hidden');
  live.id = 'menu-live';
  overlay.appendChild(live);
  render();
}

/** The pause menu, over the game behind it (ESC, or the MENU button). */
export function showPause(ops: PauseOps): void {
  cbs = pause = ops;
  title = null;
  const overlay = mount('pause', false);
  root!.appendChild(h('div', 'ts-foot'));
  overlay.appendChild(root!);
  render();
}
