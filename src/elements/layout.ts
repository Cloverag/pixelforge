/**
 * The ELEMENTS screen's panes, made to fit a tablet or a phone: drag a
 * splitter (or focus it and press the arrow keys) to give the atom, the
 * table or the panel more room; double-click or double-tap one to put it
 * back. Each device remembers its own sizes.
 *
 * Landscape: the panel's width, and the table's height under the atom.
 * Portrait (a phone, a tablet held upright): the atom's height, with the
 * table and the panel scrolling under it.
 */

/** the CSS media query that turns the screen upright: the same as styles.css's */
export const PORTRAIT = '(max-width: 900px) and (orientation: portrait)';

/** px; null: the stylesheet's default */
export interface Sizes {
  /** landscape: the atom and table column's width */
  left: number | null;
  /** landscape: the table's height */
  table: number | null;
  /** portrait: the atom's height */
  tall: number | null;
}

const KEY = 'pf.el.sizes';
const NONE: Sizes = { left: null, table: null, tall: null };

export function loadSizes(): Sizes {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Sizes> | null;
    const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : null);
    return v ? { left: num(v.left), table: num(v.table), tall: num(v.tall) } : { ...NONE };
  } catch {
    return { ...NONE };
  }
}

export function saveSizes(s: Sizes): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode: the sizes last until the page closes */
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.round(Math.min(Math.max(v, lo), Math.max(lo, hi)));

/** the atom and table column: room for the atom, and the panel keeps its 280px */
export const clampLeft = (px: number, rootW: number): number => clamp(px, 320, rootW - 280);
/** the table: at least its rows at their smallest, and the atom keeps 140px */
export const clampTable = (px: number, columnH: number): number => clamp(px, 150, columnH - 140);
/** portrait, the atom: big enough to see, and 140px left for what scrolls under it */
export const clampTall = (px: number, rootH: number): number => clamp(px, 160, rootH - 140);

/**
 * A splitter: a bar to drag, with a wider invisible grip for a finger.
 * `drag` gets the pointer's position; `step` an arrow key's nudge (+ or -
 * 24px, along the bar's axis); `reset` a double-click; `done` when a drag
 * or a nudge ends, to save.
 */
export function splitter(o: {
  label: string;
  /** 'vertical': a bar between columns, dragged sideways */
  orient: 'vertical' | 'horizontal';
  drag(x: number, y: number): void;
  step(delta: number): void;
  reset(): void;
  done(): void;
}): HTMLElement {
  const el = document.createElement('div');
  el.className = `el-split ${o.orient === 'vertical' ? 'v' : 'h'}`;
  el.setAttribute('role', 'separator');
  el.setAttribute('aria-orientation', o.orient);
  el.setAttribute('aria-label', o.label);
  el.tabIndex = 0;
  el.append(document.createElement('span'));
  let held = false;
  // a drag must not select the text it passes over
  el.addEventListener('mousedown', (e) => e.preventDefault());
  el.addEventListener('pointerdown', (e) => {
    held = true;
    el.setPointerCapture(e.pointerId);
    el.classList.add('held');
    document.documentElement.classList.add('el-dragging');
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (held) o.drag(e.clientX, e.clientY);
  });
  const end = () => {
    if (!held) return;
    held = false;
    el.classList.remove('held');
    document.documentElement.classList.remove('el-dragging');
    o.done();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('dblclick', () => {
    o.reset();
    o.done();
  });
  el.addEventListener('keydown', (e) => {
    const back = o.orient === 'vertical' ? 'ArrowLeft' : 'ArrowUp';
    const fwd = o.orient === 'vertical' ? 'ArrowRight' : 'ArrowDown';
    if (e.key !== back && e.key !== fwd) return;
    // the game's own arrow keys walk the table: not while a splitter has focus
    e.stopPropagation();
    e.preventDefault();
    o.step(e.key === fwd ? 24 : -24);
    o.done();
  });
  return el;
}
