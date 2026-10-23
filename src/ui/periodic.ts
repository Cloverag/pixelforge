import ELEMENTS from '../data/elements.json';
import { h } from './widgets';

/**
 * The CHEM LAB's periodic table: all 118 elements in their usual places,
 * the ones the lab can simulate lit and clickable, the rest dim. Hovering
 * shows what an element is and what it does here. Loaded on first open, so
 * the element data stays out of the entry bundle.
 */

export interface Element {
  z: number;
  sym: string;
  name: string;
  mass: number | null;
  cpk: string | null;
  state: string | null;
  melt: number | null;
  boil: number | null;
  block: string;
}

export interface TableOptions {
  /** symbol -> material id, for the elements the lab simulates */
  live: Map<string, number>;
  selected: number;
  onPick(mat: number): void;
  /** what this material does in the lab, one line per reaction */
  reactions(mat: number): string[];
}

/** Column (1-18) and row (1-7, then 9-10 for the f-block rows) of element z. */
export function placeOf(z: number): [number, number] {
  if (z === 1) return [1, 1];
  if (z === 2) return [18, 1];
  const rowOf: [number, number, number][] = [
    // [first z, last z, period]
    [3, 10, 2],
    [11, 18, 3],
    [19, 36, 4],
    [37, 54, 5],
    [55, 86, 6],
    [87, 118, 7],
  ];
  for (const [first, last, period] of rowOf) {
    if (z < first || z > last) continue;
    const k = z - first;
    if (period <= 3) return k < 2 ? [k + 1, period] : [k + 11, period];
    if (period <= 5) return [k + 1, period];
    // periods 6 and 7: the f-block (57-71, 89-103) sits in two rows below
    if (k < 2) return [k + 1, period];
    if (k < 17) return [k + 1, period + 3];
    return [k - 13, period];
  }
  throw new Error(`no place for element ${z}`);
}

const BLOCK_CLASS: Record<string, string> = {
  'Alkali metal': 'alkali',
  'Alkaline earth metal': 'alkaline',
  'Transition metal': 'transition',
  'Post-transition metal': 'post',
  Metalloid: 'metalloid',
  Nonmetal: 'nonmetal',
  Halogen: 'halogen',
  'Noble gas': 'noble',
  Lanthanide: 'lanthanide',
  Actinide: 'actinide',
};

let root: HTMLElement | null = null;

export function isTableOpen(): boolean {
  return root !== null;
}

export function closeTable(): boolean {
  if (!root) return false;
  root.remove();
  root = null;
  return true;
}

export function openTable(opts: TableOptions): void {
  closeTable();
  root = h('div', 'pt-root');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Periodic table');
  // a click on the backdrop closes it; one inside the panel does not
  root.onclick = (e) => {
    if (e.target === root) closeTable();
  };

  const panel = h('div', 'pt-panel panel');
  const head = h('div', 'pt-head');
  head.appendChild(h('h2', '', 'PERIODIC TABLE'));
  head.appendChild(h('span', 'pt-hint', `${opts.live.size} of 118 in the lab - more coming. E or ESC closes.`));
  const close = h('button', 'px', 'CLOSE') as HTMLButtonElement;
  close.type = 'button';
  close.onclick = () => closeTable();
  head.appendChild(close);
  panel.appendChild(head);

  const grid = h('div', 'pt-grid');
  const card = h('div', 'pt-card');
  const show = (e: Element) => {
    const mat = opts.live.get(e.sym);
    card.innerHTML = '';
    const title = h('div', 'pt-card-title');
    title.append(h('span', 'pt-card-sym', e.sym), h('span', '', `${e.z} · ${e.name.toUpperCase()}`));
    card.appendChild(title);
    const facts = [
      e.block.toLowerCase(),
      e.state?.toLowerCase(),
      e.mass !== null ? `${e.mass} u` : null,
      e.melt !== null ? `melts ${Math.round(e.melt)} K` : null,
      e.boil !== null ? `boils ${Math.round(e.boil)} K` : null,
    ].filter(Boolean);
    card.appendChild(h('div', 'pt-card-facts', facts.join(' · ')));
    if (mat === undefined) {
      card.appendChild(h('div', 'pt-card-off', 'Not in the lab yet.'));
      return;
    }
    const lines = opts.reactions(mat);
    const list = h('ul', 'pt-card-rx');
    for (const line of lines.length ? lines : ['Inert here - it just sits, falls or floats.']) list.appendChild(h('li', '', line));
    card.appendChild(list);
  };

  for (const e of ELEMENTS as Element[]) {
    const [col, row] = placeOf(e.z);
    const mat = opts.live.get(e.sym);
    const cell = h('button', `pt-cell ${BLOCK_CLASS[e.block] ?? ''}${mat === undefined ? ' off' : ''}${mat === opts.selected ? ' sel' : ''}`) as HTMLButtonElement;
    cell.type = 'button';
    cell.style.gridColumn = String(col);
    cell.style.gridRow = String(row);
    cell.append(h('span', 'pt-z', String(e.z)), h('span', 'pt-sym', e.sym));
    cell.title = mat === undefined ? `${e.name} - not in the lab yet` : e.name;
    cell.setAttribute('aria-label', cell.title);
    cell.onmouseenter = () => show(e);
    cell.onfocus = () => show(e);
    if (mat !== undefined) {
      cell.onclick = () => {
        opts.onPick(mat);
        closeTable();
      };
    } else {
      cell.disabled = true;
    }
    grid.appendChild(cell);
  }
  // the card sits in the empty top middle of the table, where it always has
  // room and never covers an element
  card.style.gridColumn = '3 / 13';
  card.style.gridRow = '1 / 4';
  grid.appendChild(card);
  const selected = (ELEMENTS as Element[]).find((e) => opts.live.get(e.sym) === opts.selected);
  show(selected ?? (ELEMENTS as Element[])[0]);

  panel.appendChild(grid);
  root.appendChild(panel);
  document.body.appendChild(root);
  (grid.querySelector('.pt-cell.sel') as HTMLElement | null ?? close).focus();
}
