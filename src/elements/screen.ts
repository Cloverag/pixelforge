import BONDS_JSON from '../data/bonds.json';
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
import { Atom3D, type AtomSpec, type Layers } from './atom3d';
import {
  bondKind,
  chargeMark,
  defaultPartner,
  deltaChi,
  disagreement,
  explain,
  ionCharges,
  IONIC_DX,
  KIND_LABEL,
  ordered,
  pairKey,
  pictureOf,
  POLAR_DX,
  subscript,
  type Compound,
} from './bond';
import { FACTS } from './facts';
import { NAMED } from './names';
import {
  boxRows,
  CAVEATS,
  COLOUR_BY,
  domain,
  NUM_PROPS,
  position,
  ramp,
  records,
  stateAt,
  yearOf,
  type ColourBy,
  type State,
  type TrendData,
} from './trends';

/**
 * The ELEMENTS screen: the atom in 3D on the left over a clickable periodic
 * table, and on the right the element's numbers, its spectrum and what it is
 * used for. Loaded with the mode (modes/elements.ts), so three.js and the
 * element data stay out of the entry bundle.
 *
 * The table's empty top middle holds its controls: what the table is
 * coloured by (a category, a property, the state at a temperature, what was
 * known by a year), a FIND box, the key, and a readout of the element under
 * the pointer.
 *
 * BOND (J): the selected element and a second one picked off the table,
 * side by side, and the bond between them played out (elements/bond.ts).
 *
 * Sources: numbers and electron configurations from PubChem
 * (data/elements.json), visible lines from the NIST Atomic Spectra Database
 * (data/spectra.json), two-element compounds from PubChem
 * (data/bonds.json); the facts, uses and name origins are written
 * (elements/facts.ts, elements/names.ts).
 */

export interface ElementData extends Element, TrendData {
  config: string | null;
  year: string | null;
  ox: string | null;
}
const ALL = ELEMENTS as ElementData[];
// JSON arrays type as number[][]; each line is [nm, intensity]
const LINES = SPECTRA as unknown as Record<string, [number, number][] | null>;
const BY_SYM = new Map(ALL.map((e) => [e.sym, e]));
const BONDS = BONDS_JSON as unknown as Record<string, Compound[]>;
/** the two-element compounds of a pair on record, most common oxidation state first */
export const compoundsOf = (a: ElementData, b: ElementData): Compound[] => BONDS[pairKey(a, b)] ?? [];

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
  { block: 'Lanthanide', label: 'LANTHA­NIDES', one: 'LANTHANIDE', tint: '#ff8ac0' },
  { block: 'Actinide', label: 'ACTI­NIDES', one: 'ACTINIDE', tint: '#ff6b8a' },
];
const TINT = new Map(CATEGORIES.map((c) => [c.block, c.tint]));
export const tintOf = (e: Element): string => TINT.get(e.block) ?? '#cfc8ef';

const BLOCK_TINT: Record<string, string> = { s: '#ff8a5c', p: '#5ad8ff', d: '#b99cff', f: '#ff8ac0' };
const STATE_TINT: Record<State, string> = { solid: '#9aa6c8', liquid: '#3d8bff', gas: '#ffc65c', unknown: '' };
/** room temperature, where the STATE view starts */
const ROOM_K = 298;
/** the year of Mendeleev's table, where the KNOWN view starts */
const MENDELEEV = 1869;

/** every element's subshells, its noble-gas core written out */
function subsOf(e: ElementData) {
  return subshells(e.config ?? '', (sym) => BY_SYM.get(sym)?.config ?? null);
}

/** What the 3D atom draws for an element, and what its caption needs. */
export function atomOf(e: ElementData) {
  const subs = subsOf(e);
  const shells = shellCounts(subs);
  const last = lastSubshell(subs);
  const orbitals = occupiedOrbitals(last);
  const spec: AtomSpec = { z: e.z, nucleons: Math.round(e.mass ?? e.z * 2.5), shells, orbitals, tint: tintOf(e) };
  return { spec, subs, shells, last, orbitals };
}

export const elementByZ = (z: number): ElementData => ALL[z - 1];

/** An element from what a player types: a symbol (any case), an atomic number, or the start of a name. */
export function findElement(q: string): ElementData | null {
  const t = q.trim().toLowerCase();
  if (!t) return null;
  if (/^\d+$/.test(t)) return ALL[Number(t) - 1] ?? null;
  return ALL.find((e) => e.sym.toLowerCase() === t) ?? ALL.find((e) => e.name.toLowerCase().startsWith(t)) ?? null;
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

const kelvin = (k: number) => `${Math.round(k)} K (${Math.round(k - 273.15)} °C)`;

/** dark or light text on a cell of this colour */
function inkOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum > 140 ? '#070816' : '#f2f3ff';
}

export class ElementsScreen {
  readonly root = h('div', 'el-root');
  private atom: Atom3D;
  private stage = h('div', 'el-atom');
  private head = h('div', 'el-head');
  private caption = h('div', 'el-caption');
  private panel = h('aside', 'el-panel');
  private table = h('div', 'el-table');
  private grid = h('div', 'el-grid');
  private cells = new Map<number, HTMLButtonElement>();
  private key = h('div', 'el-key');
  private readout = h('div', 'el-readout');
  private z = 18;
  private by: ColourBy = 'category';
  private temp = ROOM_K;
  private knownBy = MENDELEEV;
  private hovered: number | null = null;
  /** BOND: the second element, or null when the view shows one atom */
  private partner: number | null = null;
  /** BOND: which of the pair's compounds the picture follows */
  private pick = 0;
  layers: Layers = { orbitals: true, shells: true };

  constructor(
    private onPick: (e: ElementData) => void,
    private onBond: () => void = () => {},
  ) {
    const left = h('div', 'el-left');
    this.stage.append(this.head, this.caption);
    left.append(this.stage, this.table);
    this.root.append(left, this.panel);
    this.panel.setAttribute('aria-live', 'polite');
    this.buildTable();
    this.atom = new Atom3D(this.stage);
    // the canvas goes under the header and caption
    this.stage.prepend(this.stage.lastElementChild!);
    this.recolour();
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
    if (this.partner !== null) this.setPartner(neighbour(this.partner, dir));
    else this.select(neighbour(this.z, dir));
  }

  get bonding(): boolean {
    return this.partner !== null;
  }

  /** BOND on: pair the element with its usual partner (elements/bond.ts); off: back to the one atom */
  setBond(on: boolean): void {
    if (on === this.bonding) return;
    if (on) {
      this.grid.classList.add('bonding');
      this.setPartner(defaultPartner(this.current, (s) => BY_SYM.get(s)!, (a, b) => compoundsOf(a, b).length > 0).z);
    } else {
      this.partner = null;
      this.grid.classList.remove('bonding');
      this.select(this.z);
    }
  }

  /** BOND: the second element */
  setPartner(z: number): void {
    this.partner = z;
    this.pick = 0;
    this.showBond();
    this.onBond();
  }

  /** BOND: play the bond again */
  replay(): void {
    this.atom.replay();
  }

  /** a click, a FIND or an arrow: the second element while bonding, else the element */
  private choose(z: number): void {
    if (this.partner !== null) this.setPartner(z);
    else this.select(z);
  }

  /** the cells: the selected element, and while bonding its partner and every element it has a compound with */
  private markCells(): void {
    const a = this.current;
    for (const [k, cell] of this.cells) {
      cell.classList.toggle('sel', k === this.z);
      cell.classList.toggle('sel2', k === this.partner && k !== this.z);
      cell.classList.toggle('bondable', this.partner !== null && compoundsOf(a, ALL[k - 1]).length > 0);
      cell.setAttribute('aria-pressed', String(k === this.z || k === this.partner));
    }
  }

  select(z: number): void {
    this.z = z;
    const e = this.current;
    if (this.partner !== null) {
      this.showBond();
      this.onPick(e);
      return;
    }
    this.markCells();
    const { spec, subs, shells, last, orbitals } = atomOf(e);
    this.root.style.setProperty('--el-tint', tintOf(e));
    this.atom.show(spec);
    this.showHead(e);
    const sub = `${last.n}${L_LETTER[last.l]}`;
    // what the picture is, and what it is not: rings count electrons, they are not paths
    this.caption.textContent =
      `lobes: ${sub} (${orbitals.map((o) => o.name).join(' ')}) as |Y|² · ` +
      `rings: ${shells.length > 1 ? 'shells' : 'shell'} ${SHELL_LETTER[0]}${shells.length > 1 ? '–' + SHELL_LETTER[shells.length - 1] : ''}, not paths · ` +
      'nucleus not to scale';
    this.showPanel(e, shells, subs);
    this.showReadout();
    this.onPick(e);
  }

  // ---- BOND ----

  private showBond(): void {
    const a = this.current;
    const b = ALL[this.partner! - 1];
    const [left, right] = ordered(a, b);
    const list = compoundsOf(a, b);
    const c = list[this.pick] ?? null;
    const kind = bondKind(a, b);
    const pic = pictureOf(kind, left, right, c);
    this.markCells();
    this.root.style.setProperty('--el-tint', tintOf(a));
    this.atom.showPair(atomOf(left).spec, atomOf(right).spec, pic);
    const dx = deltaChi(a, b);
    this.head.replaceChildren(
      h('div', 'el-z', '● BOND'),
      h('div', 'el-sym', `${left.sym} + ${right.sym}`),
      h('div', 'el-name', c ? `${c.name.toUpperCase()} · ${subscript(c.f)}` : 'NO COMPOUND ON RECORD'),
      h('div', 'el-kind', KIND_LABEL[kind] + (dx !== null && kind !== 'metallic' && kind !== 'none' ? ` · Δχ ${dx.toFixed(2)}` : '')),
    );
    const notPaths = 'rings count electrons, not paths';
    if (pic.kind === 'ionic') {
      const q = ionCharges(left, right, c)!;
      this.caption.textContent = `one atom of each · ${pic.moves} e⁻ cross from ${left.sym} to ${right.sym}: ${left.sym}${chargeMark(q[0])} and ${right.sym}${chargeMark(q[1])} · ${notPaths}`;
    } else if (pic.kind === 'covalent') {
      this.caption.textContent = `${pic.order} shared ${pic.order === 1 ? 'pair' : 'pairs'}: one electron from each atom per pair, circling the bond · ${notPaths}`;
    } else if (pic.kind === 'metallic') {
      this.caption.textContent = `the outer electrons leave their shells and roam over both atoms · ${notPaths}`;
    } else {
      this.caption.textContent = `nothing passes between them · ${notPaths}`;
    }
    this.showBondPanel(kind, left, right, list, c);
    this.showReadout();
  }

  private showBondPanel(kind: ReturnType<typeof bondKind>, left: ElementData, right: ElementData, list: Compound[], c: Compound | null): void {
    const why = h('p', 'el-why', explain(kind, left, right, c));
    const replay = h('button', 'el-replay', '▶ PLAY AGAIN') as HTMLButtonElement;
    replay.type = 'button';
    replay.onclick = () => this.replay();

    const parts: HTMLElement[] = [section('BOND', 'Δχ RULE OF THUMB'), this.dxScale(deltaChi(left, right), kind), why, replay];

    if (kind !== 'metallic' && kind !== 'none') {
      parts.push(section('ON RECORD', list.length ? `${list.length} IN PUBCHEM` : 'PUBCHEM'));
      if (list.length) {
        const chips = h('div', 'el-compounds');
        list.forEach((x, i) => {
          const chip = h('button', i === this.pick ? 'el-compound on' : 'el-compound') as HTMLButtonElement;
          chip.type = 'button';
          chip.setAttribute('aria-pressed', String(i === this.pick));
          chip.append(h('b', '', subscript(x.f)), document.createTextNode(` ${x.name}`));
          chip.onclick = () => {
            this.pick = i;
            this.showBond();
            this.onBond();
          };
          chips.append(chip);
        });
        parts.push(chips);
        if (c) {
          const drawn =
            c.o > 0
              ? `with ${left.sym}–${right.sym} as a ${['', 'single', 'double', 'triple'][Math.min(3, c.o)]} bond`
              : `as ions, ${left.sym}${chargeMark(left.z <= right.z ? c.q[0] : c.q[1])} and ${right.sym}${chargeMark(left.z <= right.z ? c.q[1] : c.q[0])}`;
          const link = h('a', 'el-link', `PubChem CID ${c.cid} ↗`) as HTMLAnchorElement;
          link.href = `https://pubchem.ncbi.nlm.nih.gov/compound/${c.cid}`;
          link.target = '_blank';
          link.rel = 'noopener';
          const note = h('p', 'el-drawn', `PubChem draws ${subscript(c.f)} ${drawn}. `);
          note.append(link);
          parts.push(note);
          const odd = disagreement(kind, c);
          if (odd) parts.push(h('p', 'el-drawn', odd));
        }
      } else {
        parts.push(h('p', 'el-drawn', 'None of the formulas their common oxidation states predict is a compound in PubChem.'));
      }
    }

    const outer = (e: ElementData) => {
      const sh = atomOf(e).shells;
      return sh[sh.length - 1];
    };
    const both = (f: (e: ElementData) => string | number | null) =>
      left.z === right.z ? String(f(left) ?? 'no data') : `${left.sym} ${f(left) ?? 'no data'} · ${right.sym} ${f(right) ?? 'no data'}`;
    parts.push(
      section('THE TWO ATOMS', ''),
      rows([
        ['ELECTRONEGATIVITY (χ)', both((e) => e.en)],
        ['OUTER ELECTRONS', both(outer)],
        ['OXIDATION STATES', both((e) => e.ox)],
      ]),
      h('p', 'el-source', `Bond kind: the gap in electronegativity (Pauling, PubChem), ${IONIC_DX} and up ionic, ${POLAR_DX} and up polar: a rule of thumb. Compounds: formulas predicted from PubChem's oxidation states, kept only where PubChem has the compound.`),
    );
    this.panel.replaceChildren(...parts);
  }

  /**
   * Δχ on a bar of three equal zones, nonpolar, polar and ionic, the
   * boundaries marked: the 0.4-wide nonpolar zone would be a sliver on a
   * straight scale. The marker sits proportionally within its zone.
   */
  private dxScale(dx: number | null, kind: ReturnType<typeof bondKind>): HTMLElement {
    const MAX = 3.2;
    const zones = [[0, POLAR_DX, 'NONPOLAR'], [POLAR_DX, IONIC_DX, 'POLAR'], [IONIC_DX, MAX, 'IONIC']] as const;
    const wrap = h('div', 'el-dx');
    const bar = h('div', 'el-dx-bar');
    for (const [, , label] of zones) bar.append(h('span', 'el-dx-seg', label));
    const ticks = h('div', 'el-dx-ticks');
    for (const [v, at] of [[0, 0], [POLAR_DX, 1 / 3], [IONIC_DX, 2 / 3], [MAX, 1]] as const) {
      const t = h('span', '', String(v));
      t.style.left = `${at * 100}%`;
      ticks.append(t);
    }
    wrap.append(bar, ticks);
    if (dx !== null && kind !== 'metallic' && kind !== 'none') {
      const i = zones.findIndex(([, to]) => dx < to);
      const z = i < 0 ? 2 : i;
      const [from, to] = zones[z];
      const mark = h('span', 'el-dx-mark');
      mark.style.left = `${((z + Math.min(1, (dx - from) / (to - from))) / 3) * 100}%`;
      bar.append(mark);
      wrap.setAttribute('aria-label', `Electronegativity gap ${dx.toFixed(2)}`);
    }
    return wrap;
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

  // ---- the panel ----

  private showPanel(e: ElementData, shells: number[], subs: ReturnType<typeof subsOf>): void {
    const { period, group } = periodGroup(e.z);
    const block = blockOf(e.z);
    const outer = shells[shells.length - 1];
    const essentials = rows([
      ['PROTONS / ELECTRONS', `${e.z} p⁺ / ${e.z} e⁻`],
      ['OUTER SHELL', `${outer} e⁻ (shell ${SHELL_LETTER[shells.length - 1]})`],
      [`SHELLS (${SHELL_LETTER[0]}–${SHELL_LETTER[shells.length - 1]})`, shells.join(' · ')],
      ['CONFIGURATION', e.config ? prettyConfig(e.config) : null],
      ['ATOMIC WEIGHT', e.mass !== null ? `${e.mass} u` : null],
      ['PERIOD / GROUP', group === null ? `${period} · ${block}-block` : `${period} · ${group}`],
      ['DISCOVERED', e.year === 'Ancient' ? 'known since ancient times' : e.year],
    ]);
    const fmt = (k: (typeof NUM_PROPS)[number]['key']) => {
      const p = NUM_PROPS.find((x) => x.key === k)!;
      const v = e[k];
      const note = CAVEATS[e.sym]?.[k];
      return v === null ? null : note ? `${p.fmt(v)}, ${note}` : p.fmt(v);
    };
    const props = rows([
      ['STATE AT 25 °C', e.state?.toLowerCase() ?? null],
      ['MELTS', fmt('melt')],
      ['BOILS', fmt('boil')],
      ['DENSITY', fmt('density')],
      ['ELECTRONEGATIVITY', fmt('en')],
      ['IONIZATION ENERGY', fmt('ie')],
      ['ELECTRON AFFINITY', fmt('ea')],
      ['RADIUS (VAN DER WAALS)', fmt('radius')],
      ['OXIDATION STATES', e.ox],
    ]);

    const facts = FACTS[e.sym];
    const uses = h('ol', 'el-uses');
    for (const u of facts?.uses ?? []) uses.append(h('li', '', u));
    const more = h('ul', 'el-facts');
    if (facts?.fact) more.append(h('li', '', facts.fact));
    if (NAMED[e.sym]) {
      const li = h('li');
      li.append(h('span', 'el-facts-k', 'NAME '), document.createTextNode(NAMED[e.sym]));
      more.append(li);
    }
    for (const r of records(e, ALL)) {
      const li = h('li');
      li.append(h('span', 'el-facts-k', 'RECORD '), document.createTextNode(r));
      more.append(li);
    }

    this.panel.replaceChildren(
      section('ATOMIC ESSENTIALS', `${block.toUpperCase()}-BLOCK`),
      essentials,
      section('OUTER ORBITALS', "HUND'S RULE"),
      this.boxes(subs),
      section('PROPERTIES', ''),
      props,
      section('SPECTRAL FINGERPRINT', '380–750 NM'),
      this.spectrum(e),
      section('NOTABLE USES', ''),
      uses,
      section('FACTS', ''),
      more,
      h('p', 'el-source', 'Data: PubChem (NCBI); lines: NIST Atomic Spectra Database, neutral atom. Records are among the elements PubChem gives a value for.'),
    );
  }

  /** The outer subshells as boxes of arrows: one up arrow per box first, then pairs. */
  private boxes(subs: ReturnType<typeof subsOf>): HTMLElement {
    const wrap = h('div', 'el-boxes');
    for (const r of boxRows(subs)) {
      const row = h('div', 'el-boxrow');
      row.append(h('span', 'el-boxlabel', r.label));
      const boxes = h('span', 'el-boxset');
      for (const n of r.boxes) boxes.append(h('span', 'el-box', n === 2 ? '↑↓' : n === 1 ? '↑' : ''));
      row.append(boxes);
      row.setAttribute('aria-label', `${r.label}: ${r.boxes.reduce((s, n) => s + n, 0)} electrons in ${r.boxes.length} orbitals`);
      wrap.append(row);
    }
    return wrap;
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

  // ---- the table ----

  private buildTable(): void {
    const grid = this.grid;
    for (const e of ALL) {
      const [col, row] = placeOf(e.z);
      const cell = h('button', 'el-cell') as HTMLButtonElement;
      cell.type = 'button';
      cell.style.gridColumn = String(col);
      cell.style.gridRow = String(row);
      cell.textContent = e.sym;
      cell.setAttribute('aria-label', `${e.z}, ${e.name}`);
      cell.onclick = () => this.choose(e.z);
      cell.onmouseenter = () => {
        this.hovered = e.z;
        this.showReadout();
      };
      grid.append(cell);
      this.cells.set(e.z, cell);
    }
    grid.onmouseleave = () => {
      this.hovered = null;
      this.showReadout();
    };
    // where the f-block comes out of the main table
    for (const [row, text] of [[6, '57–71'], [7, '89–103']] as const) {
      const gap = h('div', 'el-fgap', '↓');
      gap.title = `${text}: the row below`;
      gap.setAttribute('aria-label', gap.title);
      gap.style.gridColumn = '3';
      gap.style.gridRow = String(row);
      grid.append(gap);
    }
    grid.append(this.buildCard());
    this.table.append(grid);
  }

  /** The controls in the table's empty top middle. */
  private buildCard(): HTMLElement {
    const card = h('div', 'el-card');
    // typing here must not reach the game's keys (arrows, O, K, R, SPACE...)
    const keep = (el: HTMLElement) =>
      el.addEventListener('keydown', (ev) => {
        ev.stopPropagation();
        if (ev.key === 'Escape') (el as HTMLInputElement).blur();
      });

    const by = document.createElement('select');
    by.className = 'el-select';
    by.setAttribute('aria-label', 'Colour the table by');
    for (const o of COLOUR_BY) {
      const opt = document.createElement('option');
      opt.value = o.id;
      opt.textContent = o.label;
      by.append(opt);
    }
    by.onchange = () => {
      this.by = by.value as ColourBy;
      this.recolour();
    };
    keep(by);

    const find = document.createElement('input');
    find.type = 'search';
    find.className = 'el-find';
    find.placeholder = 'FIND: gold, Au, 79';
    find.spellcheck = false;
    find.autocomplete = 'off';
    find.setAttribute('aria-label', 'Find an element by name, symbol or number');
    find.oninput = () => {
      const e = findElement(find.value);
      find.classList.toggle('miss', find.value.trim() !== '' && !e);
      if (e && e.z !== (this.partner ?? this.z)) this.choose(e.z);
    };
    find.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') find.blur();
    });
    keep(find);

    const top = h('div', 'el-card-top');
    top.append(by, find);
    card.append(top, this.key, this.readout);
    return card;
  }

  /** Colour the cells for the current view, and draw its key (not while its own slider is moving). */
  private recolour(withKey = true): void {
    this.grid.classList.toggle('heat', this.by !== 'category' && this.by !== 'known');
    const prop = NUM_PROPS.find((p) => p.key === this.by);
    const dom = prop ? domain(ALL, prop) : null;
    for (const e of ALL) {
      const cell = this.cells.get(e.z)!;
      let tint: string | null = tintOf(e);
      if (this.by === 'block') tint = BLOCK_TINT[blockOf(e.z)];
      else if (this.by === 'state') tint = STATE_TINT[stateAt(e, this.temp)] || null;
      else if (this.by === 'known') {
        const y = yearOf(e);
        if (y === null || y > this.knownBy) tint = null;
      } else if (prop && dom) {
        const v = e[prop.key];
        tint = v === null || (prop.log && v <= 0) ? null : ramp(position(v, dom, prop.log));
      }
      cell.classList.toggle('nodata', tint === null);
      if (tint) {
        cell.style.setProperty('--tint', tint);
        cell.style.setProperty('--ink', inkOn(tint));
      }
    }
    if (withKey) this.showKey(prop ?? null, dom);
    this.showReadout();
  }

  private showKey(prop: (typeof NUM_PROPS)[number] | null, dom: { min: number; max: number } | null): void {
    const k = this.key;
    k.replaceChildren();
    // a chip of the key; no colour: the hatching of "no data"
    const chip = (color: string | null, label: string) => {
      const c = h('span', color ? 'el-chip' : 'el-chip none');
      if (color) c.style.setProperty('--tint', color);
      c.append(h('span', 'el-chip-dot'), document.createTextNode(label));
      return c;
    };
    if (this.by === 'category') {
      k.append(h('span', 'el-key-note', 'colours: the categories in the rail'));
    } else if (this.by === 'block') {
      for (const b of ['s', 'p', 'd', 'f']) k.append(chip(BLOCK_TINT[b], `${b}-block`));
    } else if (this.by === 'state' || this.by === 'known') {
      const state = this.by === 'state';
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.className = 'el-slider';
      // temperature on a square-root scale, so the cold end (where the gases condense) gets room
      const toT = (u: number) => Math.round(10 + (6000 - 10) * u * u);
      const fromT = (t: number) => Math.sqrt((t - 10) / (6000 - 10));
      slider.min = state ? '0' : '1650';
      slider.max = state ? '1' : '2010';
      slider.step = state ? '0.001' : '1';
      slider.value = state ? String(fromT(this.temp)) : String(this.knownBy);
      slider.setAttribute('aria-label', state ? 'Temperature' : 'Year');
      const label = h('span', 'el-key-val');
      const counts = h('span', 'el-key-note');
      // read the slider only when it moves: reading it back at once would round 298 K to 297
      const update = (moved: boolean) => {
        if (state) {
          if (moved) this.temp = toT(Number(slider.value));
          label.textContent = kelvin(this.temp);
          const n: Record<State, number> = { solid: 0, liquid: 0, gas: 0, unknown: 0 };
          for (const e of ALL) n[stateAt(e, this.temp)]++;
          counts.textContent = `${n.solid} solid · ${n.liquid} liquid · ${n.gas} gas · ${n.unknown} unknown`;
        } else {
          if (moved) this.knownBy = Number(slider.value);
          label.textContent = String(this.knownBy);
          const n = ALL.filter((e) => (yearOf(e) ?? Infinity) <= this.knownBy).length;
          counts.textContent = `${n} known${this.knownBy === MENDELEEV ? ': the year of Mendeleev’s table' : ''}`;
        }
      };
      slider.oninput = () => {
        update(true);
        this.recolour(false);
      };
      slider.addEventListener('keydown', (ev) => ev.stopPropagation());
      update(false);
      const row = h('div', 'el-key-row');
      row.append(slider, label);
      k.append(row, counts);
    } else if (prop && dom) {
      const bar = h('span', 'el-ramp');
      bar.style.background = `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map(ramp).join(', ')})`;
      k.append(h('span', 'el-key-val', prop.fmt(dom.min).replace(/ \(.*\)$/, '')), bar, h('span', 'el-key-val', prop.fmt(dom.max).replace(/ \(.*\)$/, '')), chip(null, 'no data'));
    }
  }

  /** Under the key: the element under the pointer (or the selected one) and its value in this view. */
  private showReadout(): void {
    if (this.partner !== null) {
      // while bonding: what the element under the pointer would make with the selected one
      const a = this.current;
      const e = ALL[(this.hovered ?? this.partner) - 1];
      const c = compoundsOf(a, e)[0];
      this.readout.textContent = `${a.sym} + ${e.sym} · ${KIND_LABEL[bondKind(a, e)].toLowerCase()}${c ? ` · ${subscript(c.f)} ${c.name}` : ''}`;
      return;
    }
    const e = ALL[(this.hovered ?? this.z) - 1];
    let v: string;
    if (this.by === 'category') v = e.block.toLowerCase();
    else if (this.by === 'block') v = `${blockOf(e.z)}-block`;
    else if (this.by === 'state') v = `${stateAt(e, this.temp)} at ${Math.round(this.temp)} K`;
    else if (this.by === 'known') v = e.year === 'Ancient' ? 'known since ancient times' : e.year ? `discovered ${e.year}` : 'unknown';
    else {
      const p = NUM_PROPS.find((x) => x.key === this.by)!;
      const x = e[p.key];
      v = x === null ? 'no data' : p.fmt(x);
    }
    this.readout.textContent = `${e.z} ${e.sym} ${e.name} · ${v}`;
  }
}

function section(title: string, right: string): HTMLElement {
  const s = h('div', 'el-section');
  s.append(h('span', '', title), h('span', '', right));
  return s;
}

/** label / value rows; a missing value says so, dimmed */
function rows(list: [string, string | null][]): HTMLElement {
  const dl = h('dl', 'el-rows');
  for (const [k, v] of list) {
    const dd = h('dd', v === null ? 'none' : '', v ?? 'no data');
    dl.append(h('dt', '', k), dd);
  }
  return dl;
}
