import { Cat, LIFE_MATS, MATS, NMATS } from '../sim/materials';
import type { PaintKind, Stats } from '../sim/protocol';
import { BrushCursor } from './cursor';
import { ELEMENT_NOTES } from './help';
import { h } from './widgets';

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

interface TopbarCallbacks {
  onPause(): void;
  onStep(): void;
  onMenu(): void;
  onSave(): void;
  onLoad(): void;
  onShare(): void;
  onToggleMute(): void;
  onToggleCrt(): void;
  onToggleBg(): void;
  onToggleMusic(): void;
  onHelp(): void;
  onToggle3d(): void;
  onToggleGrid(): void;
  onToggleSoft(): void;
  onToggleImmersive(): void;
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
  private muteBtn!: HTMLButtonElement;
  private saveBtn!: HTMLButtonElement;
  private loadBtn!: HTMLButtonElement;
  private modeEl!: HTMLElement;
  private fpsEl!: HTMLElement;
  private brushLabel!: HTMLElement;
  private brushDot!: HTMLElement;
  private swatchEls = new Map<string, HTMLElement>();
  private status!: {
    run: HTMLElement;
    chip: HTMLElement;
    name: HTMLElement;
    note: HTMLElement;
    tool: HTMLElement;
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
  private brushN = 6;
  private toolKind: PaintKind = 'brush';
  private budgetEls = new Map<number, HTMLElement>();

  constructor(
    private topbar: HTMLElement,
    private toolbar: HTMLElement,
  ) {}

  initTopbar(cbs: TopbarCallbacks): void {
    this.topbar.innerHTML = '';
    const brand = h('div', 'brand');
    const mark = h('span', 'brand-mark');
    mark.setAttribute('aria-hidden', 'true');
    brand.appendChild(mark);
    brand.appendChild(h('span', 'title', 'PIXELFORGE'));
    this.modeEl = h('span', 'mode-label', '');
    brand.appendChild(this.modeEl);
    this.topbar.appendChild(brand);
    this.topbar.appendChild(h('span', 'spacer'));

    this.pauseBtn = this.mkBtn('PAUSE', cbs.onPause, 'Pause / resume the simulation (SPACE)', true);
    const stepBtn = this.mkBtn('STEP', cbs.onStep, 'Advance one tick while paused (N)');
    this.saveBtn = this.mkBtn('SAVE', cbs.onSave, 'Save this world to browser storage');
    this.loadBtn = this.mkBtn('LOAD', cbs.onLoad, 'Load the saved world');
    this.shareBtn = this.mkBtn('SHARE', cbs.onShare, 'Copy a link that loads this world');
    this.softBtn = this.mkBtn('SOFT', cbs.onToggleSoft, 'Smooth particles with trails and glow (S)', true);
    const crtBtn = this.mkBtn('CRT', cbs.onToggleCrt, 'Toggle the CRT filter (C)', true);
    this.crtBtn = crtBtn;
    this.gridBtn = this.mkBtn('GRID', cbs.onToggleGrid, 'Chunky block view - cycles size (B)', true);
    this.view3dBtn = this.mkBtn('3D', cbs.onToggle3d, 'Toggle 3D voxel view (3)', true);
    this.immersiveBtn = this.mkBtn('IMMERSE', cbs.onToggleImmersive, 'Fill the window, hide the panels (I)', true);
    const bgBtn = this.mkBtn('BG', cbs.onToggleBg, 'Backdrop: the picture around the game screen');
    this.muteBtn = this.mkBtn('SFX', cbs.onToggleMute, 'Mute the sound effects (M mutes everything)', true);
    this.musicBtn = this.mkBtn('MUSIC', cbs.onToggleMusic, 'Mute the music', true);
    const helpBtn = this.mkBtn('?', cbs.onHelp, 'How to play');
    const menuBtn = this.mkBtn('MENU', cbs.onMenu, 'The pause menu (ESC)');
    menuBtn.classList.add('primary');

    // clusters by job, so fourteen controls read as five decisions
    const groups: [string, HTMLButtonElement[]][] = [
      ['Run', [this.pauseBtn, stepBtn]],
      ['File', [this.saveBtn, this.loadBtn, this.shareBtn]],
      ['View', [this.immersiveBtn, this.softBtn, crtBtn, this.gridBtn, this.view3dBtn, bgBtn]],
      ['Sound', [this.muteBtn, this.musicBtn]],
    ];
    // On a phone these fold into a drop-down behind the MORE button (CSS);
    // on a desktop the wrapper is display: contents and changes nothing.
    const fold = h('div', 'topbar-groups');
    fold.id = 'topbar-groups';
    for (const [name, btns] of groups) {
      const g = h('div', 'btn-group');
      g.setAttribute('role', 'group');
      g.setAttribute('aria-label', name);
      g.appendChild(h('span', 'grp-label', name));
      const row = h('div', 'grp-row');
      for (const b of btns) row.appendChild(b);
      g.appendChild(row);
      fold.appendChild(g);
    }
    this.topbar.appendChild(fold);
    const end = h('div', 'btn-group end');
    const more = this.mkBtn('MORE', () => {
      const open = this.topbar.classList.toggle('more-open');
      more.setAttribute('aria-expanded', String(open));
    }, 'Pause, save, view and sound settings');
    more.classList.add('more-btn');
    more.setAttribute('aria-controls', 'topbar-groups');
    more.setAttribute('aria-expanded', 'false');
    // picking anything in the drop-down closes it
    fold.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) {
        this.topbar.classList.remove('more-open');
        more.setAttribute('aria-expanded', 'false');
      }
    });
    end.appendChild(more);
    end.appendChild(helpBtn);
    end.appendChild(menuBtn);
    this.topbar.appendChild(end);

    crtBtn.classList.add('toggled');
    this.muteBtn.classList.add('toggled');
    document.body.classList.add('crt-on');
    this.buildStatusBar();
  }

  /**
   * The strip under the canvas: what is running, what you are holding, how
   * big the brush is, how much is in the world. Everything a player used to
   * have to infer from which button happened to be lit.
   */
  private buildStatusBar(): void {
    const bar = document.getElementById('statusbar');
    if (!bar) return;
    bar.innerHTML = '';
    const seg = (cls: string) => {
      const el = h('div', `sb-seg ${cls}`);
      bar.appendChild(el);
      return el;
    };
    const runSeg = seg('sb-run');
    const run = h('span', 'sb-val', 'RUNNING');
    runSeg.append(run);

    const matSeg = seg('sb-mat');
    const chip = h('span', 'sb-chip');
    const name = h('span', 'sb-val', '');
    const note = h('span', 'sb-note', '');
    matSeg.append(chip, name, note);

    // CHEM LAB only (setReadout): how much is reacting, and what mostly is
    const rxSeg = seg('sb-rx hidden');
    const rxVal = h('span', 'sb-val num', '0/s');
    rxSeg.append(h('span', 'sb-key', 'Reactions'), rxVal);
    const nowSeg = seg('sb-now hidden');
    const nowVal = h('span', 'sb-note', '');
    nowSeg.append(h('span', 'sb-key', 'Now'), nowVal);

    const tool = h('span', 'sb-val', '');
    seg('sb-tool').append(h('span', 'sb-key', 'Tool'), tool);
    const cells = h('span', 'sb-val num', '0');
    const cellsKey = h('span', 'sb-key', 'Cells');
    seg('sb-cells').append(cellsKey, cells);
    this.fpsEl = h('span', 'sb-val num', '');
    this.fpsEl.id = 'fps';
    seg('sb-fps').append(this.fpsEl);
    this.status = { run, chip, name, note, tool, cells, cellsKey, rxSeg, rxVal, nowSeg, nowVal };
  }

  private renderTool(): void {
    if (!this.status) return;
    const k = this.toolKind;
    this.status.tool.textContent =
      k === 'flood' ? 'BUCKET' : k === 'wind' ? `WIND ${this.brushN}` : `BRUSH ${this.brushN}`;
    this.cursor.setMode(k);
  }

  private showSelection(name: string, cat: string, note: string, chipBg: string): void {
    if (!this.status) return;
    this.status.name.textContent = name;
    this.status.note.textContent = [cat, note].filter(Boolean).join(' · ');
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

  /** Change a button's text without destroying its indicator lamp. */
  private setLabel(b: HTMLButtonElement, text: string): void {
    const l = b.querySelector('.lbl');
    if (l) l.textContent = text;
    else b.textContent = text;
  }

  setModeLabel(s: string): void {
    this.modeEl.textContent = s;
  }

  setFps(f: number): void {
    this.fpsEl.textContent = `${f} FPS`;
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
    this.setLabel(this.pauseBtn, p ? 'RESUME' : 'PAUSE');
    this.pauseBtn.classList.toggle('toggled', p);
    if (this.status) this.status.run.textContent = p ? 'PAUSED' : 'RUNNING';
  }

  /**
   * FILE stays on the bar in every mode, so the groups beside it sit at the
   * same x everywhere; outside the sandbox its keys are just disabled.
   * Sharing a challenge would hand someone a half-solved puzzle, so the link
   * button lives and dies with save/load.
   */
  setSaveEnabled(v: boolean): void {
    for (const b of [this.saveBtn, this.loadBtn, this.shareBtn]) {
      // the enabled title is whatever mkBtn gave it: remember it, put it back
      b.dataset.title ??= b.title;
      const t = v ? b.dataset.title : 'Saving is for the sandbox';
      b.disabled = !v;
      b.title = t;
      b.setAttribute('aria-label', t);
    }
  }

  /** The SFX toggle is lit when sound is on. */
  setMuted(m: boolean): void {
    this.muteBtn.classList.toggle('toggled', !m);
  }

  showBars(v: boolean): void {
    this.topbar.classList.toggle('hidden', !v);
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
            if (sw.dashed) {
              chip.style.background = sw.chip;
              chip.style.border = '1px dashed var(--danger)';
            } else {
              chip.style.backgroundImage = sw.chip;
            }
            el.appendChild(chip);
            el.appendChild(h('span', 'nm', sw.label));
          }
          el.title = sw.title;
          el.onclick = () => this.pick(sw.id);
          grid.appendChild(el);
          this.swatchEls.set(sw.id, el);
          this.swatchInfo.set(sw.id, sw.info);
        }
        group.appendChild(grid);
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
    this.buildBrushCol(brush, spec.bucket);
    this.pick(spec.initial);
    this.particleMode = spec.counts === 'particles';
    if (this.status) this.status.cellsKey.textContent = this.particleMode ? 'Particles' : 'Cells';
  }

  private bucketBtn: HTMLButtonElement | null = null;
  private windBtn: HTMLButtonElement | null = null;
  private musicBtn!: HTMLButtonElement;
  private view3dBtn!: HTMLButtonElement;
  private immersiveBtn!: HTMLButtonElement;
  private shareBtn!: HTMLButtonElement;
  private softBtn!: HTMLButtonElement;
  private crtBtn!: HTMLButtonElement;
  private gridBtn!: HTMLButtonElement;

  /** null = off; a number shows the active block edge, e.g. "GRID 8". */
  setGridSize(n: number | null): void {
    this.gridBtn.classList.toggle('toggled', n !== null);
    this.setLabel(this.gridBtn, n === null ? 'GRID' : `GRID ${n}`);
  }

  setImmersiveToggled(v: boolean): void {
    this.immersiveBtn.classList.toggle('toggled', v);
  }

  set3dToggled(v: boolean): void {
    this.view3dBtn.classList.toggle('toggled', v);
  }

  setCrt(on: boolean): void {
    this.crtBtn?.classList.toggle('toggled', on);
  }

  setSoftToggled(v: boolean): void {
    this.softBtn.classList.toggle('toggled', v);
  }

  setMusicToggled(v: boolean): void {
    this.musicBtn.classList.toggle('toggled', v);
  }

  /** BUCKET and WIND are the same one-of-three choice, so they light as one. */
  setToolKind(kind: PaintKind): void {
    this.toolKind = kind;
    this.bucketBtn?.classList.toggle('toggled', kind === 'flood');
    this.windBtn?.classList.toggle('toggled', kind === 'wind');
    this.renderTool();
  }

  private buildBrushCol(brush: number, withBucket = true): void {
    const col = h('div', 'toolcol');
    const row = h('div', 'brushrow');
    row.appendChild(h('span', '', 'BRUSH'));

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '2';
    slider.max = '24';
    slider.value = String(brush);
    slider.step = '1';
    slider.title = 'Brush size';
    slider.setAttribute('aria-label', 'Brush size');
    slider.oninput = () => {
      const n = Number(slider.value);
      this.setBrushDisplay(n);
      window.dispatchEvent(new CustomEvent('pf-brush', { detail: n }));
    };
    row.appendChild(slider);

    this.brushLabel = h('span', '', String(brush));
    row.appendChild(this.brushLabel);

    // a dot scaled to the real brush radius - cheaper to read than a number
    const preview = h('div', 'brush-preview');
    this.brushDot = h('div', 'brush-dot');
    preview.appendChild(this.brushDot);
    row.appendChild(preview);

    col.appendChild(row);
    col.appendChild(h('div', 'brushrow hint', 'Wheel or [ ] to resize'));

    this.bucketBtn = null;
    this.windBtn = null;
    if (withBucket) {
      const pick = (kind: PaintKind, btn: () => HTMLButtonElement) => () => {
        // clicking the lit button turns it off rather than doing nothing
        const next = btn().classList.contains('toggled') ? 'brush' : kind;
        this.setToolKind(next);
        window.dispatchEvent(new CustomEvent('pf-tool', { detail: next }));
      };
      const toolRow = h('div', 'toolbtns');
      this.bucketBtn = this.mkBtn('BUCKET', pick('flood', () => this.bucketBtn!), 'Flood fill (F)', true);
      this.windBtn = this.mkBtn('WIND', pick('wind', () => this.windBtn!), 'Drag to blow smoke, fire and light powders (W)', true);
      toolRow.appendChild(this.bucketBtn);
      toolRow.appendChild(this.windBtn);
      col.appendChild(toolRow);
    }

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
    this.brushN = n;
    this.cursor.setSize(n);
    this.renderTool();
    if (this.brushLabel) this.brushLabel.textContent = String(n);
    if (this.brushDot) {
      // 26px preview box; brush runs 2..24 so it always fits
      const px = Math.max(2, Math.min(26, n));
      this.brushDot.style.width = `${px}px`;
      this.brushDot.style.height = `${px}px`;
    }
  }
}
