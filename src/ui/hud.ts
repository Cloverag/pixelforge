import { Cat, LIFE_MATS, MATS, NMATS } from '../sim/materials';
import type { PaintKind, Stats } from '../sim/protocol';
import { BrushCursor } from './cursor';
import { ELEMENT_NOTES } from './help';
import { h } from './widgets';

/** The five brush dots (the brush itself runs 2..24; the wheel and [ ] reach every even size). */
export const BRUSH_SIZES = [2, 6, 12, 18, 24] as const;

/** SAND -> Sand, BLACK HOLE -> Black Hole: the rail shows names in sentence type, not shouting. */
export function titleCase(name: string): string {
  return name.toLowerCase().replace(/(^|\s)(\S)/g, (_, sp: string, c: string) => sp + c.toUpperCase());
}

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
function rampGradient(ramp: readonly number[]): string {
  const [a, b, c, d] = ramp.map(cssHex);
  return (
    `linear-gradient(135deg, ${a} 0 25%, ${b} 25% 50%, ${c} 50% 75%, ${d} 75% 100%)`
  );
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

/** The bottom bar's two buttons. */
interface BarCallbacks {
  onPause(): void;
  onMenu(): void;
}

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
  /** what the status bar counts */
  counts: 'cells' | 'particles';
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
        chip: '#0b0b14',
        dashed: true,
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
  private brushDots: HTMLElement[] = [];
  private swatchEls = new Map<string, HTMLElement>();
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
  private onPick: (id: string) => void = () => {};

  /** Light or dim a rail toggle (GRAVITY, SLOW-MO...). */
  setLamp(name: string, on: boolean): void {
    this.lamps.get(name)?.classList.toggle('toggled', on);
  }

  setParticles(n: number): void {
    if (!this.status) return;
    this.status.cells.textContent = n.toLocaleString('en-US');
  }
  private cursor = new BrushCursor();
  private toolKind: PaintKind = 'brush';
  private budgetEls = new Map<number, HTMLElement>();

  constructor(private toolbar: HTMLElement) {}

  /** The bottom bar: what you hold, what is happening, PAUSE and MENU. */
  initBar(cbs: BarCallbacks): void {
    this.fpsEl = document.getElementById('fps');
    this.pausedBadge = document.getElementById('paused-badge');
    this.buildBar(cbs);
  }

  /**
   * The one-line bar under everything: the picked material (chip, name, its
   * note), then on the right the live count, the chem lab's readout, PAUSE and
   * MENU. Words that only repeat the screen are not here; keys live in CONTROLS.
   */
  private buildBar(cbs: BarCallbacks): void {
    const bar = document.getElementById('statusbar');
    if (!bar) return;
    bar.innerHTML = '';
    const seg = (cls: string) => {
      const el = h('div', `sb-seg ${cls}`);
      bar.appendChild(el);
      return el;
    };
    const matSeg = seg('sb-mat');
    const chip = h('span', 'sb-chip');
    const name = h('span', 'sb-name', '');
    const note = h('span', 'sb-note', '');
    matSeg.append(chip, name, note);

    // CHEM LAB only (setReadout): how much is reacting, and what mostly is
    const rxSeg = seg('sb-rx hidden');
    const rxVal = h('span', 'sb-val num', '0/s');
    rxSeg.append(h('span', 'sb-rxlbl', 'REACTIONS'), rxVal);
    const nowSeg = seg('sb-now hidden');
    const nowVal = h('span', 'sb-note', '');
    nowSeg.append(h('span', 'sb-rxlbl', 'NOW'), nowVal);

    const cells = h('span', 'sb-val num', '0');
    const cellsKey = h('span', 'sb-unit', 'cells');
    seg('sb-cells').append(cells, cellsKey);

    // PAUSE is a 44px square with a drawn glyph (no font has to carry it)
    const btns = seg('sb-btns');
    this.pauseBtn = this.mkBtn('', cbs.onPause, 'Pause (SPACE)', true);
    this.pauseBtn.classList.add('sq');
    const ico = h('span', 'ico');
    ico.setAttribute('aria-hidden', 'true');
    this.pauseBtn.appendChild(ico);
    const menuBtn = this.mkBtn('MENU', cbs.onMenu, 'Pause menu (ESC)');
    btns.append(this.pauseBtn, menuBtn);
    this.status = { chip, name, note, cells, cellsKey, rxSeg, rxVal, nowSeg, nowVal };
  }

  private renderTool(): void {
    this.cursor.setMode(this.toolKind);
  }

  private showSelection(name: string, cat: string, note: string, chipBg: string): void {
    if (!this.status) return;
    this.status.name.textContent = name;
    this.status.note.textContent = [cat, note].filter(Boolean).join(' - ');
    this.status.chip.style.background = chipBg;
  }

  private mkBtn(label: string, onClick: () => void, title?: string, toggle = false): HTMLButtonElement {
    const b = h('button', 'px') as HTMLButtonElement;
    b.type = 'button';
    // a toggle shows its state by fill (CSS): on = accent, off = clear
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
    if (rate !== null) s.rxVal.textContent = `${rate.toLocaleString('en-US')}/s`;
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
    document.getElementById('statusbar')?.classList.toggle('hidden', !v);
    document.body.classList.toggle('in-game', v);
    // the rail appearing changes the stage's width; refit the canvas
    window.dispatchEvent(new Event('resize'));
  }

  // ---------- palettes ----------

  /** Build the left rail from a mode's sections. */
  buildPalette(spec: PaletteSpec, brush: number): void {
    this.toolbar.innerHTML = '';
    this.swatchEls.clear();
    this.swatchInfo.clear();
    this.budgetEls.clear();
    this.lamps.clear();
    this.onPick = spec.onPick;
    // every mode builds its palette on the way in, so this is what hides the
    // CHEM LAB's readout when another mode (or a room switch) takes over
    this.setReadout(null, null);

    const pal = h('div');
    pal.id = 'palette';
    const grids = new Map<string, HTMLElement>();
    for (const sec of spec.sections) {
      const group = h('div', 'matgroup');
      group.appendChild(h('span', 'glabel', sec.label));
      if ('swatches' in sec) {
        const grid = h('div', sec.tiles ? 'gswatches tiles' : 'gswatches');
        for (const sw of sec.swatches) {
          const tile = sec.tiles && sw.sym !== undefined;
          const el = h('div', tile ? 'swatch tile' : 'swatch');
          if (tile) {
            el.appendChild(h('span', 'tz', String(sw.z ?? '')));
            el.appendChild(h('span', 'tsym', sw.sym));
            const stripe = h('div', 'tstripe');
            stripe.style.backgroundImage = sw.chip;
            el.appendChild(stripe);
            // the name stays in the DOM, unseen: the tooltips look the material up by it
            el.appendChild(h('span', 'nm', sw.label));
          } else {
            const chip = h('div', 'chip');
            if (sw.dashed) chip.classList.add('dashed');
            else chip.style.backgroundImage = sw.chip;
            el.appendChild(chip);
            el.appendChild(h('span', 'nm', titleCase(sw.label)));
          }
          el.title = sw.title;
          el.onclick = () => this.pick(sw.id);
          grid.appendChild(el);
          this.swatchEls.set(sw.id, el);
          this.swatchInfo.set(sw.id, sw.info);
        }
        group.appendChild(grid);
        grids.set(sec.label, grid);
      } else {
        const row = h('div', sec.cls);
        for (const b of sec.buttons) {
          const btn = this.mkBtn(b.label, b.onClick, b.title, b.lamp !== undefined);
          if (b.cls) btn.classList.add(b.cls);
          if (b.on) btn.classList.add('toggled');
          if (b.lamp) this.lamps.set(b.lamp, btn);
          row.appendChild(btn);
        }
        group.appendChild(row);
      }
      pal.appendChild(group);
    }

    this.toolbar.appendChild(pal);
    this.bucketBtn = null;
    this.windBtn = null;
    // BUCKET and WIND are tools, not brush options: two tiles beside ERASE
    const tools = grids.get('TOOLS');
    if (spec.bucket && tools) this.addToolTiles(tools);
    this.buildBrush(brush);
    this.pick(spec.initial);
    this.particleMode = spec.counts === 'particles';
    if (this.status) this.status.cellsKey.textContent = this.particleMode ? 'particles' : 'cells';
  }

  private bucketBtn: HTMLElement | null = null;
  private windBtn: HTMLElement | null = null;

  /** BUCKET and WIND are the same one-of-three choice, so they light as one. */
  setToolKind(kind: PaintKind): void {
    this.toolKind = kind;
    this.bucketBtn?.classList.toggle('toggled', kind === 'flood');
    this.windBtn?.classList.toggle('toggled', kind === 'wind');
    this.renderTool();
  }

  /** BUCKET and WIND as tiles in the TOOLS group: held like a tool, lit while on. */
  private addToolTiles(grid: HTMLElement): void {
    const make = (kind: PaintKind, name: string, title: string): HTMLElement => {
      const el = h('div', 'swatch tooltile');
      el.appendChild(h('div', `chip ico-${kind}`));
      el.appendChild(h('span', 'nm', titleCase(name)));
      el.title = title;
      el.onclick = () => {
        // clicking the lit tile turns it off rather than doing nothing
        const next = el.classList.contains('toggled') ? 'brush' : kind;
        this.setToolKind(next);
        window.dispatchEvent(new CustomEvent('pf-tool', { detail: next }));
      };
      grid.appendChild(el);
      return el;
    };
    this.bucketBtn = make('flood', 'BUCKET', 'Flood fill (F)');
    this.windBtn = make('wind', 'WIND', 'Drag to blow smoke, fire and light powders (W)');
    this.setToolKind(this.toolKind);
  }

  /** Five brush sizes as five dots of growing size; the wheel and [ ] move the lit one. */
  private buildBrush(brush: number): void {
    const col = h('div', 'toolcol');
    col.appendChild(h('span', 'glabel', 'BRUSH'));
    const row = h('div', 'brushdots');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Brush size');
    this.brushDots = BRUSH_SIZES.map((n, i) => {
      const b = h('button', 'bdot') as HTMLButtonElement;
      b.type = 'button';
      b.title = `Brush size ${n} (wheel or [ ])`;
      b.setAttribute('aria-label', `Brush size ${i + 1} of ${BRUSH_SIZES.length}`);
      // the dot's diameter grows with the brush, from 4px to 26px
      const d = h('span', 'd');
      const px = 4 + ((n - BRUSH_SIZES[0]) / (BRUSH_SIZES[BRUSH_SIZES.length - 1] - BRUSH_SIZES[0])) * 22;
      d.style.width = d.style.height = `${Math.round(px)}px`;
      b.appendChild(d);
      b.onclick = () => {
        this.setBrushDisplay(n);
        window.dispatchEvent(new CustomEvent('pf-brush', { detail: n }));
      };
      row.appendChild(b);
      return b;
    });
    col.appendChild(row);
    this.toolbar.appendChild(col);
    this.setBrushDisplay(brush);
  }

  /** Pick a swatch as if clicked (the periodic table picks this way). */
  select(id: string): void {
    if (this.swatchEls.has(id)) this.pick(id);
  }

  private pick(id: string): void {
    for (const [k, el] of this.swatchEls) el.classList.toggle('sel', k === id);
    const info = this.swatchInfo.get(id);
    if (info) this.showSelection(...info);
    this.onPick(id);
  }

  updateStats(st: Stats): void {
    if (this.status && !this.particleMode) {
      let n = 0;
      for (let m = 1; m < NMATS; m++) n += st.counts[m];
      this.status.cells.textContent = n.toLocaleString('en-US');
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
