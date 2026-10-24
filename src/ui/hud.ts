import { Cat, LIFE_MATS, MATS, NMATS } from '../sim/materials';
import type { Mode, PaintKind, Stats } from '../sim/protocol';
import { BrushCursor } from './cursor';
import { ELEMENT_NOTES } from './help';
import { h } from './widgets';

/** The five brush dots (the brush itself runs 2..24; the wheel and [ ] reach every even size). */
export const BRUSH_SIZES = [2, 6, 12, 18, 24] as const;

/** SAND -> Sand, BLACK HOLE -> Black Hole: the rail shows names in sentence type, not shouting. */
export function titleCase(name: string): string {
  if (ACRONYMS.has(name)) return name;
  return name.toLowerCase().replace(/(^|\s)(\S)/g, (_, sp: string, c: string) => sp + c.toUpperCase());
}
/** names that are spelled out letter by letter stay in capitals */
const ACRONYMS = new Set(['TNT']);

/** The dot that stands for brush size `n`: the nearest preset. */
export function nearestBrush(n: number): number {
  let best = 0;
  for (let i = 1; i < BRUSH_SIZES.length; i++) if (Math.abs(BRUSH_SIZES[i] - n) < Math.abs(BRUSH_SIZES[best] - n)) best = i;
  return best;
}

const CAT_WORD = ['', 'powder', 'liquid', 'gas', 'solid'];

function cssHex(u: number): string {
  const r = u & 255;
  const g = (u >>> 8) & 255;
  const b = (u >>> 16) & 255;
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/**
 * Paints a swatch chip with the material's real 4-colour ramp as hard-stop
 * diagonal bands, so the palette shows what the material looks like in the
 * simulation rather than one flat approximation of it.
 */
export function rampGradient(ramp: readonly number[]): string {
  const [a, b, c, d] = ramp.map(cssHex);
  return (
    `linear-gradient(135deg, ${a} 0 25%, ${b} 25% 50%, ${c} 50% 75%, ${d} 75% 100%)`
  );
}

/**
 * A button's fill: the colour a swatch is best known by. For a ramp or a
 * two-tone chip that is its second stop (the body colour, not the highlight).
 */
export function pillColor(chip: string): string | null {
  const hexes = chip.match(/#[0-9a-f]{6}/gi);
  if (!hexes) return null;
  return hexes[1] ?? hexes[0];
}

/** WCAG relative luminance of `#rrggbb`. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

const DARK_INK = '#15171d';

/** Dark or light text, whichever reads better on `hex`. */
export function inkFor(hex: string): string {
  // the crossover where black and white text have equal contrast
  return luminance(hex) > 0.179 ? DARK_INK : '#ffffff';
}

/**
 * A button's fill and text. A mid-tone (plant green) reads with neither dark
 * nor white text at 4.5:1, so it is darkened a step at a time until white does.
 */
export function pillPaint(hex: string): { fill: string; ink: string } {
  let n = parseInt(hex.slice(1), 16);
  for (let i = 0; i < 12; i++) {
    const fill = `#${n.toString(16).padStart(6, '0')}`;
    const ink = inkFor(fill);
    const [a, b] = [luminance(fill), luminance(ink)].sort((x, y) => y - x);
    if ((a + 0.05) / (b + 0.05) >= 4.5) return { fill, ink };
    const ch = (sh: number) => Math.round(((n >> sh) & 255) * 0.92);
    n = (ch(16) << 16) | (ch(8) << 8) | ch(0);
  }
  return { fill: `#${n.toString(16).padStart(6, '0')}`, ink: '#ffffff' };
}

/** Palette section headers, in the order they appear in the toolbar. */
const CAT_ORDER: [number, string][] = [
  [Cat.POWDER, 'POWDER'],
  [Cat.LIQUID, 'LIQUID'],
  [Cat.GAS, 'GAS'],
  [Cat.SOLID, 'SOLID'],
];

export type PgTool =
  | 'fountain'
  | 'firework'
  | 'sparkler'
  | 'hose'
  | 'fireflies'
  | 'attract'
  | 'repel'
  | 'vortex'
  | 'blackhole'
  | 'wall'
  | 'bumper'
  | 'portal'
  | 'erase';

/** The bar's buttons: the three modes, PAUSE and MENU. */
interface BarCallbacks {
  onPause(): void;
  onMenu(): void;
  onMode(m: Mode): void;
}

/** The mode tabs, in the order the title screen lists them. */
const MODE_TABS: [Mode, string][] = [
  ['sand', 'Sandbox'],
  ['playground', 'Playground'],
  ['chem', 'Chem lab'],
];

/** One pickable thing in the rail: a material, a tool, an element. */
export interface Swatch {
  id: string;
  label: string;
  /** CSS background for the chip */
  chip: string;
  /** a chip drawn as a dashed outline (the eraser) */
  dashed?: boolean;
  title: string;
  /** the status bar when picked: name, kind, note, chip */
  info: [string, string, string, string];
  /** symbol and atomic number: shown on a periodic-table tile (see `tiles`) */
  sym?: string;
  z?: number;
  /** pinned under the scrolling rail with the brush, so it never needs a scroll (ERASE) */
  pin?: boolean;
}

/** A button in the rail that acts at once rather than being held. */
export interface RailButton {
  label: string;
  title: string;
  onClick(): void;
  /** a toggle, addressed by setLamp(lamp, on) */
  lamp?: string;
  on?: boolean;
  cls?: string;
}

export type PaletteSection =
  // `tiles`: swatches with a `sym` draw as small periodic-table tiles, five
  // to a row, instead of a chip and a name
  | { label: string; swatches: Swatch[]; tiles?: boolean }
  | { label: string; buttons: RailButton[]; cls: string };

/** Everything a mode puts in the left rail. */
export interface PaletteSpec {
  sections: PaletteSection[];
  initial: string;
  onPick(id: string): void;
  /** BUCKET and WIND under the brush */
  bucket: boolean;
  /** what the bar counts */
  counts: 'cells' | 'particles';
  /** said on the canvas while the world is empty */
  hint?: string;
}

/**
 * The sandbox's materials as rail sections, grouped by kind so the rail
 * doubles as a legend, with the eraser in its own group. `allowed` narrows
 * it to a challenge's materials.
 */
export function materialSections(allowed: number[] | null): PaletteSection[] {
  const list = allowed ?? MATS.filter((m) => m.placeable).map((m) => m.id);
  const usable = list.filter((id) => MATS[id]?.placeable);
  const swatch = (id: number): Swatch => {
    const m = MATS[id];
    const chip = rampGradient(m.ramp);
    return { id: String(id), label: m.name, chip, title: m.name, info: [m.name, CAT_WORD[m.cat], ELEMENT_NOTES[m.name] ?? '', chip] };
  };
  // living things get their own group, whatever their physics category
  const groups: [string, number[]][] = CAT_ORDER.map(([cat, label]) => [
    label,
    usable.filter((id) => MATS[id].cat === cat && !LIFE_MATS.has(id)),
  ]);
  groups.splice(1, 0, ['LIFE', usable.filter((id) => LIFE_MATS.has(id))]);
  const sections: PaletteSection[] = groups
    .filter(([, ids]) => ids.length > 0) // challenges only allow a few materials
    .map(([label, ids]) => ({ label, swatches: ids.map(swatch) }));
  // eraser lives in its own group so it is never mistaken for a material
  sections.push({
    label: 'TOOLS',
    swatches: [
      {
        id: '-1',
        label: 'ERASE',
        chip: 'var(--world-bg)',
        dashed: true,
        pin: true,
        title: 'Eraser (or hold right mouse button)',
        info: ['ERASE', '', 'Clears whatever the brush covers. Right-drag erases too.', 'transparent'],
      },
    ],
  });
  return sections;
}

export class Hud {
  private pauseBtn!: HTMLButtonElement;
  private fpsEl: HTMLElement | null = null;
  private pausedBadge: HTMLElement | null = null;
  private emptyHint: HTMLElement | null = null;
  private hintText = '';
  private brushDots: HTMLElement[] = [];
  private swatchEls = new Map<string, HTMLElement>();
  private tabEls = new Map<Mode, HTMLButtonElement>();
  private tabsEl: HTMLElement | null = null;
  private challengeEl: HTMLElement | null = null;
  private status!: {
    chip: HTMLElement;
    name: HTMLElement;
    note: HTMLElement;
    cells: HTMLElement;
    cellsKey: HTMLElement;
    /** the CHEM LAB's live readout: rate and the busiest rule (hidden elsewhere) */
    rxSeg: HTMLElement;
    rxVal: HTMLElement;
    nowSeg: HTMLElement;
    nowVal: HTMLElement;
  };
  /** the playground counts particles, not cells */
  private particleMode = false;
  private lamps = new Map<string, HTMLButtonElement>();
  private swatchInfo = new Map<string, Swatch['info']>();
  private swatchColor = new Map<string, string>();
  private onPick: (id: string) => void = () => {};
  private cursor = new BrushCursor();
  private toolKind: PaintKind = 'brush';
  private budgetEls = new Map<number, HTMLElement>();
  private bucketBtn: HTMLElement | null = null;
  private windBtn: HTMLElement | null = null;

  constructor(private toolbar: HTMLElement) {}

  /** Light or dim a toggle in the dock (GRAVITY, SLOW-MO...). */
  setLamp(name: string, on: boolean): void {
    this.lamps.get(name)?.classList.toggle('toggled', on);
  }

  setParticles(n: number): void {
    if (!this.status) return;
    this.status.cells.textContent = n.toLocaleString('en-US');
    this.showEmpty(n === 0);
  }

  /** The bar along the top: the game's name, the three modes, what you hold, PAUSE and MENU. */
  initBar(cbs: BarCallbacks): void {
    this.fpsEl = document.getElementById('fps');
    this.pausedBadge = document.getElementById('paused-badge');
    this.emptyHint = document.getElementById('empty-hint');
    this.buildBar(cbs);
  }

  private buildBar(cbs: BarCallbacks): void {
    const bar = document.getElementById('hudbar');
    if (!bar) return;
    bar.innerHTML = '';
    const seg = (cls: string) => {
      const el = h('div', `sb-seg ${cls}`);
      bar.appendChild(el);
      return el;
    };

    seg('sb-logo').appendChild(h('span', 'logo', 'PIXELFORGE'));

    // the three modes, one click apart: the screen says what the game is
    const tabs = seg('sb-tabs modetabs');
    tabs.setAttribute('role', 'group');
    tabs.setAttribute('aria-label', 'Mode');
    for (const [m, label] of MODE_TABS) {
      const b = h('button', 'tab') as HTMLButtonElement;
      b.type = 'button';
      b.textContent = label;
      b.setAttribute('aria-pressed', 'false');
      b.onclick = () => cbs.onMode(m);
      tabs.appendChild(b);
      this.tabEls.set(m, b);
    }
    this.tabsEl = tabs;
    // a challenge shows its name where the tabs were
    this.challengeEl = seg('sb-challenge hidden');

    const matSeg = seg('sb-mat');
    const chip = h('span', 'sb-chip');
    const name = h('span', 'sb-name', '');
    const note = h('span', 'sb-note', '');
    matSeg.append(chip, name, note);

    // CHEM LAB only (setReadout): how much is reacting, and what mostly is
    const rxSeg = seg('sb-rx hidden');
    const rxVal = h('span', 'sb-val num', '0');
    rxSeg.append(rxVal, h('span', 'sb-unit', 'reactions/s'));
    const nowSeg = seg('sb-now hidden');
    const nowVal = h('span', 'sb-note', '');
    nowSeg.append(nowVal);

    const cells = h('span', 'sb-val num', '0');
    const cellsKey = h('span', 'sb-unit', 'cells');
    seg('sb-cells').append(cells, cellsKey);

    const btns = seg('sb-btns');
    this.pauseBtn = this.mkBtn('', cbs.onPause, 'Pause (SPACE)', true);
    this.pauseBtn.classList.add('sq');
    const ico = h('span', 'ico');
    ico.setAttribute('aria-hidden', 'true');
    this.pauseBtn.appendChild(ico);
    const menuBtn = this.mkBtn('Menu', cbs.onMenu, 'Pause menu (ESC)');
    btns.append(this.pauseBtn, menuBtn);
    this.status = { chip, name, note, cells, cellsKey, rxSeg, rxVal, nowSeg, nowVal };
  }

  /** Light the current mode's tab; a challenge (`challenge` set) shows its name instead. */
  setMode(m: Mode, challenge: string | null = null): void {
    for (const [id, b] of this.tabEls) {
      const on = id === m && !challenge;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
    this.tabsEl?.classList.toggle('hidden', !!challenge);
    if (this.challengeEl) {
      this.challengeEl.classList.toggle('hidden', !challenge);
      this.challengeEl.textContent = challenge ? `Challenge: ${titleCase(challenge)}` : '';
    }
  }

  private renderTool(): void {
    this.cursor.setMode(this.toolKind);
  }

  private showSelection(name: string, cat: string, note: string, chipBg: string): void {
    if (!this.status) return;
    this.status.name.textContent = titleCase(name);
    this.status.note.textContent = note || cat;
    this.status.chip.style.background = chipBg;
  }

  private mkBtn(label: string, onClick: () => void, title?: string, toggle = false): HTMLButtonElement {
    const b = h('button', 'px') as HTMLButtonElement;
    b.type = 'button';
    // a toggle shows its state by fill (CSS)
    if (toggle) b.classList.add('tog');
    b.appendChild(h('span', 'lbl', label));
    if (title) {
      b.title = title;
      b.setAttribute('aria-label', title);
    }
    b.onclick = onClick;
    return b;
  }

  /** The FPS readout in the canvas corner (shown by the D key). */
  setFps(f: number): void {
    if (this.fpsEl) this.fpsEl.textContent = `${f} FPS`;
  }

  /**
   * The CHEM LAB's readout: rules fired in the last second, and the note of
   * the busiest one. `null` hides it (every other mode); no note hides just
   * the NOW segment, so a stale line never lingers. Display only.
   */
  setReadout(rate: number | null, note: string | null): void {
    const s = this.status;
    if (!s) return;
    s.rxSeg.classList.toggle('hidden', rate === null);
    s.nowSeg.classList.toggle('hidden', rate === null || !note);
    if (rate !== null) s.rxVal.textContent = rate.toLocaleString('en-US');
    if (note) s.nowVal.textContent = note;
  }

  setPaused(p: boolean): void {
    // a paused world fires nothing, and no frames arrive to say so
    if (p && this.status && !this.status.rxSeg.classList.contains('hidden')) this.setReadout(0, null);
    this.pauseBtn.classList.toggle('toggled', p);
    this.pauseBtn.title = p ? 'Resume (SPACE)' : 'Pause (SPACE)';
    this.pauseBtn.setAttribute('aria-label', this.pauseBtn.title);
    this.pausedBadge?.classList.toggle('hidden', !p);
  }

  showBars(v: boolean): void {
    this.toolbar.classList.toggle('hidden', !v);
    document.getElementById('hudbar')?.classList.toggle('hidden', !v);
    document.body.classList.toggle('in-game', v);
    if (!v) this.showEmpty(false);
    // the bars appearing change the stage's size; refit the canvas
    window.dispatchEvent(new Event('resize'));
  }

  /** An empty world says what to do with it, until the first thing lands. */
  private showEmpty(empty: boolean): void {
    if (!this.emptyHint) return;
    this.emptyHint.textContent = this.hintText;
    this.emptyHint.classList.toggle('hidden', !empty || !this.hintText);
  }

  // ---------- the dock ----------

  /**
   * Build the dock under the canvas from a mode's sections: the brush and the
   * always-there tools (ERASE, BUCKET, WIND) on the left, then every material
   * as a button in its own colour, a small gap between groups, and the mode's
   * own buttons (scenes, experiments...) after them.
   */
  buildPalette(spec: PaletteSpec, brush: number): void {
    this.toolbar.innerHTML = '';
    this.swatchEls.clear();
    this.swatchInfo.clear();
    this.swatchColor.clear();
    this.budgetEls.clear();
    this.lamps.clear();
    this.onPick = spec.onPick;
    this.hintText = spec.hint ?? '';
    // every mode builds its palette on the way in, so this is what hides the
    // CHEM LAB's readout when another mode (or a room switch) takes over
    this.setReadout(null, null);

    const tools = h('div', 'dock-tools');
    const pinned = h('div', 'pinrow');
    const pal = h('div');
    pal.id = 'palette';
    for (const sec of spec.sections) {
      if ('swatches' in sec) {
        for (const sw of sec.swatches.filter((x) => x.pin)) pinned.appendChild(this.makeSwatch(sw, false));
        const rest = sec.swatches.filter((sw) => !sw.pin);
        // a group left with nothing (the sandbox's TOOLS was only ERASE) goes with it
        if (rest.length === 0) continue;
        const group = h('div', 'pgroup');
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', titleCase(sec.label));
        for (const sw of rest) group.appendChild(this.makeSwatch(sw, !!sec.tiles && sw.sym !== undefined));
        pal.appendChild(group);
      } else {
        const group = h('div', 'pgroup acts');
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', titleCase(sec.label));
        for (const b of sec.buttons) {
          const btn = this.mkBtn(titleCase(b.label), b.onClick, b.title, b.lamp !== undefined);
          if (b.cls) btn.classList.add(b.cls);
          if (b.on) btn.classList.add('toggled');
          if (b.lamp) this.lamps.set(b.lamp, btn);
          group.appendChild(btn);
        }
        pal.appendChild(group);
      }
    }

    this.bucketBtn = null;
    this.windBtn = null;
    // BUCKET and WIND are tools, not brush options: beside ERASE
    if (spec.bucket) this.addToolTiles(pinned);
    this.buildBrush(brush, tools);
    tools.appendChild(pinned);
    this.toolbar.append(tools, pal);
    this.pick(spec.initial);
    this.particleMode = spec.counts === 'particles';
    if (this.status) this.status.cellsKey.textContent = this.particleMode ? 'particles' : 'cells';
  }

  /** BUCKET and WIND are the same one-of-three choice, so they light as one. */
  setToolKind(kind: PaintKind): void {
    this.toolKind = kind;
    this.bucketBtn?.classList.toggle('toggled', kind === 'flood');
    this.windBtn?.classList.toggle('toggled', kind === 'wind');
    this.renderTool();
  }

  /** One button of the dock: a material in its own colour, or an element's symbol. */
  private makeSwatch(sw: Swatch, tile: boolean): HTMLElement {
    const el = h('button', tile ? 'swatch tile' : 'swatch') as HTMLButtonElement;
    el.type = 'button';
    const color = sw.dashed ? null : pillColor(sw.chip);
    if (color) {
      const { fill, ink } = pillPaint(color);
      el.style.setProperty('--c', fill);
      el.style.setProperty('--ci', ink);
      // the brush ring keeps the material's true colour
      this.swatchColor.set(sw.id, color);
    }
    if (sw.dashed) el.classList.add('dashed');
    if (tile) el.appendChild(h('span', 'tsym', sw.sym));
    // a tile's name is for the tooltips and screen readers; everywhere else it is the label
    el.appendChild(h('span', 'nm', titleCase(sw.label)));
    el.title = sw.title;
    el.onclick = () => this.pick(sw.id);
    this.swatchEls.set(sw.id, el);
    this.swatchInfo.set(sw.id, sw.info);
    return el;
  }

  /** BUCKET and WIND beside ERASE: held like a tool, lit while on. */
  private addToolTiles(row: HTMLElement): void {
    const make = (kind: PaintKind, name: string, title: string): HTMLElement => {
      const el = h('button', 'swatch tooltile') as HTMLButtonElement;
      el.type = 'button';
      el.appendChild(h('span', `ico ico-${kind}`));
      el.appendChild(h('span', 'nm', titleCase(name)));
      el.title = title;
      el.onclick = () => {
        // clicking the lit tool turns it off rather than doing nothing
        const next = el.classList.contains('toggled') ? 'brush' : kind;
        this.setToolKind(next);
        window.dispatchEvent(new CustomEvent('pf-tool', { detail: next }));
      };
      row.appendChild(el);
      return el;
    };
    this.bucketBtn = make('flood', 'BUCKET', 'Flood fill (F)');
    this.windBtn = make('wind', 'WIND', 'Drag to blow smoke, fire and light powders (W)');
    this.setToolKind(this.toolKind);
  }

  /** Five brush sizes as five dots of growing size; the wheel and [ ] move the lit one. */
  private buildBrush(brush: number, into: HTMLElement): void {
    const row = h('div', 'brushdots');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Brush size');
    this.brushDots = BRUSH_SIZES.map((n, i) => {
      const b = h('button', 'bdot') as HTMLButtonElement;
      b.type = 'button';
      b.title = `Brush size ${n} (wheel or [ ])`;
      b.setAttribute('aria-label', `Brush size ${i + 1} of ${BRUSH_SIZES.length}`);
      // the dot's diameter grows with the brush, from 4px to 22px
      const d = h('span', 'd');
      const px = 4 + ((n - BRUSH_SIZES[0]) / (BRUSH_SIZES[BRUSH_SIZES.length - 1] - BRUSH_SIZES[0])) * 18;
      d.style.width = d.style.height = `${Math.round(px)}px`;
      b.appendChild(d);
      b.onclick = () => {
        this.setBrushDisplay(n);
        window.dispatchEvent(new CustomEvent('pf-brush', { detail: n }));
      };
      row.appendChild(b);
      return b;
    });
    into.appendChild(row);
    this.setBrushDisplay(brush);
  }

  /** Pick a swatch as if clicked (the periodic table picks this way). */
  select(id: string): void {
    if (this.swatchEls.has(id)) this.pick(id);
  }

  private pick(id: string): void {
    for (const [k, el] of this.swatchEls) {
      el.classList.toggle('sel', k === id);
      el.setAttribute('aria-pressed', String(k === id));
    }
    const info = this.swatchInfo.get(id);
    if (info) this.showSelection(...info);
    // the screen takes on the colour of what you hold: the brush ring, the bar's chip
    const c = this.swatchColor.get(id);
    const root = document.documentElement.style;
    if (c) {
      root.setProperty('--pick', c);
      root.setProperty('--pick-ink', inkFor(c));
    } else {
      root.removeProperty('--pick');
      root.removeProperty('--pick-ink');
    }
    this.onPick(id);
  }

  updateStats(st: Stats): void {
    if (this.status && !this.particleMode) {
      let n = 0;
      for (let m = 1; m < NMATS; m++) n += st.counts[m];
      this.status.cells.textContent = n.toLocaleString('en-US');
      this.showEmpty(n === 0);
    }
    for (let m = 0; m < NMATS; m++) {
      const b = st.budget[m];
      const el = this.budgetEls.get(m);
      if (b === null) {
        if (el) el.remove();
        this.budgetEls.delete(m);
        continue;
      }
      const remaining = Math.max(0, b - st.used[m]);
      let badge = this.budgetEls.get(m);
      if (!badge) {
        badge = h('span', 'budget', '');
        this.swatchEls.get(String(m))?.appendChild(badge);
        this.budgetEls.set(m, badge);
      }
      badge.textContent = String(remaining);
      this.swatchEls.get(String(m))?.classList.toggle('exhausted', remaining <= 0);
    }
  }

  setBrushDisplay(n: number): void {
    this.cursor.setSize(n);
    this.renderTool();
    const lit = nearestBrush(n);
    this.brushDots.forEach((el, i) => el.classList.toggle('sel', i === lit));
  }
}
