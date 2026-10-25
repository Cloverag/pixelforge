import ELEMENTS from '../data/elements.json';
import SPECTRA from '../data/spectra.json';
import { placeOf, type Element } from '../ui/periodic';
import { h } from '../ui/widgets';
import {
  blockOf,
  lastSubshell,
  L_LETTER,
  occupiedOrbitals,
  periodGroup,
  prettyConfig,
  SHELL_LETTER,
  shellCounts,
  subshells,
  wavelengthRGB,
} from './atom';
import { Atom3D, type Layers } from './atom3d';
import { FACTS } from './facts';

/**
 * The ELEMENTS screen: the atom in 3D on the left over a clickable periodic
 * table, and on the right the element's numbers, its spectrum and what it is
 * used for. Loaded with the mode (modes/elements.ts), so three.js and the
 * element data stay out of the entry bundle.
 *
 * Sources: numbers and electron configurations from PubChem
 * (data/elements.json), visible lines from the NIST Atomic Spectra Database
 * (data/spectra.json); the facts and uses are written (elements/facts.ts).
 */

export interface ElementData extends Element {
  config: string | null;
  year: string | null;
}
const ALL = ELEMENTS as ElementData[];
// JSON arrays type as number[][]; each line is [nm, intensity]
const LINES = SPECTRA as unknown as Record<string, [number, number][] | null>;
const BY_SYM = new Map(ALL.map((e) => [e.sym, e]));

/** The ten categories, in the rail's order: PubChem's name, our word, colour. */
// the rail's labels carry soft hyphens, so the long ones break inside its narrow tiles
export const CATEGORIES: { block: string; label: string; one: string; tint: string }[] = [
  { block: 'Alkali metal', label: 'ALKALI METALS', one: 'ALKALI METAL', tint: '#ff8a5c' },
  { block: 'Alkaline earth metal', label: 'ALKALINE EARTH', one: 'ALKALINE EARTH METAL', tint: '#ffc65c' },
  { block: 'Transition metal', label: 'TRANSITION METALS', one: 'TRANSITION METAL', tint: '#b99cff' },
  { block: 'Post-transition metal', label: 'POST-TRANSITION', one: 'POST-TRANSITION METAL', tint: '#6fc3e8' },
  { block: 'Metalloid', label: 'METALLOIDS', one: 'METALLOID', tint: '#7fe0b0' },
  { block: 'Nonmetal', label: 'NONMETALS', one: 'NONMETAL', tint: '#8cf06a' },
  { block: 'Halogen', label: 'HALOGENS', one: 'HALOGEN', tint: '#f2e85a' },
  { block: 'Noble gas', label: 'NOBLE GASES', one: 'NOBLE GAS', tint: '#5ad8ff' },
  { block: 'Lanthanide', label: 'LANTHA\u00adNIDES', one: 'LANTHANIDE', tint: '#ff8ac0' },
  { block: 'Actinide', label: 'ACTI\u00adNIDES', one: 'ACTINIDE', tint: '#ff6b8a' },
];
const TINT = new Map(CATEGORIES.map((c) => [c.block, c.tint]));
export const tintOf = (e: Element): string => TINT.get(e.block) ?? '#cfc8ef';

/** every element's subshells, its noble-gas core written out */
function subsOf(e: ElementData) {
  return subshells(e.config ?? '', (sym) => BY_SYM.get(sym)?.config ?? null);
}

/** Where to go from element z with the arrow keys: along the row, or up and down the column. */
const GRID = new Map(ALL.map((e) => [placeOf(e.z).join(','), e.z]));
export function neighbour(z: number, dir: 'left' | 'right' | 'up' | 'down'): number {
  if (dir === 'left') return z > 1 ? z - 1 : 118;
  if (dir === 'right') return z < 118 ? z + 1 : 1;
  let [col, row] = placeOf(z);
  const step = dir === 'up' ? -1 : 1;
  // walk the column, skipping its gaps (the empty top of the table, the gap above the f-block)
  for (let i = 0; i < 10; i++) {
    row += step;
    if (row < 1 || row > 10) return z;
    const at = GRID.get(`${col},${row}`);
    if (at !== undefined) return at;
  }
  return z;
}

export class ElementsScreen {
  readonly root = h('div', 'el-root');
  private atom: Atom3D;
  private stage = h('div', 'el-atom');
  private head = h('div', 'el-head');
  private caption = h('div', 'el-caption');
  private panel = h('aside', 'el-panel');
  private table = h('div', 'el-table');
  private cells = new Map<number, HTMLButtonElement>();
  private z = 18;
  layers: Layers = { orbitals: true, shells: true };

  constructor(private onPick: (e: ElementData) => void) {
    const left = h('div', 'el-left');
    this.stage.append(this.head, this.caption);
    left.append(this.stage, this.table);
    this.root.append(left, this.panel);
    this.panel.setAttribute('aria-live', 'polite');
    this.buildTable();
    this.atom = new Atom3D(this.stage);
    // the canvas goes under the header and caption
    this.stage.prepend(this.stage.lastElementChild!);
  }

  get current(): ElementData {
    return ALL[this.z - 1];
  }

  get spinning(): boolean {
    return this.atom.spinning;
  }

  setSpin(on: boolean): void {
    this.atom.setSpin(on);
  }

  setLayers(l: Layers): void {
    this.layers = l;
    this.atom.setLayers(l);
  }

  setPaused(p: boolean): void {
    this.atom.setPaused(p);
  }

  dispose(): void {
    this.atom.dispose();
    this.root.remove();
  }

  /** Dim every category but one (null: show them all). */
  setFilter(block: string | null): void {
    for (const [z, cell] of this.cells) cell.classList.toggle('dim', block !== null && ALL[z - 1].block !== block);
  }

  move(dir: 'left' | 'right' | 'up' | 'down'): void {
    this.select(neighbour(this.z, dir));
  }

  select(z: number): void {
    this.z = z;
    const e = this.current;
    for (const [k, cell] of this.cells) {
      cell.classList.toggle('sel', k === z);
      cell.setAttribute('aria-pressed', String(k === z));
    }
    const subs = subsOf(e);
    const shells = shellCounts(subs);
    const last = lastSubshell(subs);
    const orbitals = occupiedOrbitals(last);
    this.root.style.setProperty('--el-tint', tintOf(e));
    this.atom.show({
      z: e.z,
      nucleons: Math.round(e.mass ?? e.z * 2.5),
      shells,
      orbitals,
      tint: tintOf(e),
    });
    this.showHead(e);
    const sub = `${last.n}${L_LETTER[last.l]}`;
    // what the picture is, and what it is not: rings count electrons, they are not paths
    this.caption.textContent =
      `lobes: ${sub} (${orbitals.map((o) => o.name).join(' ')}) as |Y|² · ` +
      `rings: ${shells.length > 1 ? 'shells' : 'shell'} ${SHELL_LETTER[0]}${shells.length > 1 ? '–' + SHELL_LETTER[shells.length - 1] : ''}, not paths · ` +
      'nucleus not to scale';
    this.showPanel(e, shells);
    this.onPick(e);
  }

  private showHead(e: ElementData): void {
    const cat = CATEGORIES.find((c) => c.block === e.block);
    this.head.replaceChildren(
      h('div', 'el-z', `● ${e.z}`),
      h('div', 'el-sym', e.sym),
      h('div', 'el-name', e.name.toUpperCase()),
      h('div', 'el-kind', [cat?.one ?? e.block.toUpperCase(), e.state?.toUpperCase()].filter(Boolean).join(' · ')),
    );
  }

  private showPanel(e: ElementData, shells: number[]): void {
    const p = this.panel;
    const { period, group } = periodGroup(e.z);
    const block = blockOf(e.z);
    const outer = shells[shells.length - 1];
    const kelvin = (k: number | null) => (k === null ? '?' : `${Math.round(k)} K`);
    const rows: [string, string][] = [
      ['PROTONS / ELECTRONS', `${e.z} p⁺ / ${e.z} e⁻`],
      ['OUTER SHELL', `${outer} e⁻ (shell ${SHELL_LETTER[shells.length - 1]})`],
      [`SHELLS (${SHELL_LETTER[0]}–${SHELL_LETTER[shells.length - 1]})`, shells.join(' · ')],
      ['CONFIGURATION', e.config ? prettyConfig(e.config) : 'unknown'],
      ['ATOMIC WEIGHT', e.mass !== null ? `${e.mass} u` : 'unknown'],
      ['PERIOD / GROUP', group === null ? `${period} · ${block}-block` : `${period} · ${group}`],
      ['MELTS / BOILS', e.melt === null && e.boil === null ? 'unknown' : `${kelvin(e.melt)} / ${kelvin(e.boil)}`],
      ['DISCOVERED', e.year === 'Ancient' ? 'known since ancient times' : (e.year ?? 'unknown')],
    ];
    const ess = h('dl', 'el-rows');
    for (const [k, v] of rows) ess.append(h('dt', '', k), h('dd', '', v));

    const facts = FACTS[e.sym];
    const uses = h('ol', 'el-uses');
    for (const u of facts?.uses ?? []) uses.append(h('li', '', u));

    p.replaceChildren(
      section('ATOMIC ESSENTIALS', `${block.toUpperCase()}-BLOCK`),
      ess,
      section('SPECTRAL FINGERPRINT', '380–750 NM'),
      this.spectrum(e),
      section('NOTABLE USES', ''),
      uses,
      h('p', 'el-fact', facts?.fact ?? ''),
      h('p', 'el-source', 'Data: PubChem (NCBI); lines: NIST Atomic Spectra Database, neutral atom.'),
    );
  }

  /** The element's visible lines, bright on a faint rainbow, and the strongest few named. */
  private spectrum(e: ElementData): HTMLElement {
    const wrap = h('div', 'el-spectrum');
    const lines = LINES[e.sym];
    const canvas = document.createElement('canvas');
    const W = 600;
    const H = 64;
    canvas.width = W;
    canvas.height = H;
    canvas.setAttribute('role', 'img');
    const ctx = canvas.getContext('2d');
    const x = (nm: number) => ((nm - 380) / 370) * W;
    if (ctx) {
      for (let px = 0; px < W; px++) {
        const [r, g, b] = wavelengthRGB(380 + (px / W) * 370);
        ctx.fillStyle = `rgb(${r * 40},${g * 40},${b * 40})`;
        ctx.fillRect(px, 0, 1, H);
      }
      ctx.globalCompositeOperation = 'lighter';
      for (const [nm, i] of lines ?? []) {
        const [r, g, b] = wavelengthRGB(nm);
        // NIST's intensities span orders of magnitude: a square root keeps the weaker
        // lines visible without letting sodium's hundredth-strength lines rival its D lines
        const k = Math.max(0.1, Math.sqrt(i));
        ctx.fillStyle = `rgba(${r * 255},${g * 255},${b * 255},${k})`;
        ctx.fillRect(Math.round(x(nm)) - 1, 0, 3, H);
      }
    }
    const axis = h('div', 'el-axis');
    for (const nm of [400, 500, 600, 700]) {
      const t = h('span', '', `${nm}`);
      t.style.left = `${(x(nm) / W) * 100}%`;
      axis.append(t);
    }
    wrap.append(canvas, axis);
    if (!lines) {
      canvas.setAttribute('aria-label', `No measured visible lines for ${e.name}`);
      wrap.append(h('div', 'el-lines', `NIST lists no measured visible lines for neutral ${e.name.toLowerCase()}.`));
      return wrap;
    }
    const strongest = [...lines].sort((a, b) => b[1] - a[1]).slice(0, 5).sort((a, b) => a[0] - b[0]);
    const names = strongest.map(([nm]) => nm.toFixed(1)).join(' · ');
    canvas.setAttribute('aria-label', `${e.name}'s visible spectrum: ${lines.length} lines, the strongest at ${names} nanometres`);
    wrap.append(h('div', 'el-lines', `λ ${names} nm`));
    return wrap;
  }

  private buildTable(): void {
    const grid = h('div', 'el-grid');
    for (const e of ALL) {
      const [col, row] = placeOf(e.z);
      const cell = h('button', 'el-cell') as HTMLButtonElement;
      cell.type = 'button';
      cell.style.gridColumn = String(col);
      cell.style.gridRow = String(row);
      cell.style.setProperty('--tint', tintOf(e));
      cell.textContent = e.sym;
      cell.title = `${e.z} ${e.name}`;
      cell.setAttribute('aria-label', `${e.z}, ${e.name}`);
      cell.onclick = () => this.select(e.z);
      grid.append(cell);
      this.cells.set(e.z, cell);
    }
    // where the f-block comes out of the main table
    for (const [row, text] of [[6, '57–71'], [7, '89–103']] as const) {
      const gap = h('div', 'el-fgap', '↓');
      gap.title = `${text}: the row below`;
      gap.setAttribute('aria-label', gap.title);
      gap.style.gridColumn = '3';
      gap.style.gridRow = String(row);
      grid.append(gap);
    }
    this.table.append(grid);
  }
}

function section(title: string, right: string): HTMLElement {
  const s = h('div', 'el-section');
  s.append(h('span', '', title), h('span', '', right));
  return s;
}
