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
  onCycleTheme(): void;
}

interface SandPaletteCallbacks {
  onSelect(mat: number): void;
}

interface PgPaletteCallbacks {
  onTool(tool: PgTool): void;
  onGravity?(): void;
  onSlowmo?(): void;
  onClear?(): void;
  /** demo scenes: [id, label, tooltip] */
  presets?: [string, string, string][];
  onPreset?(id: string): void;
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
  private swatchEls = new Map<number, HTMLElement>();
  private status!: {
    lamp: HTMLElement;
    run: HTMLElement;
    chip: HTMLElement;
    name: HTMLElement;
    note: HTMLElement;
    tool: HTMLElement;
    cells: HTMLElement;
    cellsKey: HTMLElement;
  };
  /** the playground counts particles, not cells */
  private particleMode = false;
  private gravityBtn: HTMLButtonElement | null = null;
  private slowBtn: HTMLButtonElement | null = null;

  setGravityLamp(on: boolean): void {
    this.gravityBtn?.classList.toggle('toggled', on);
  }

  setSlowmoLamp(on: boolean): void {
    this.slowBtn?.classList.toggle('toggled', on);
  }

  setParticles(n: number): void {
    if (!this.status) return;
    this.status.cells.textContent = n.toLocaleString('en-US');
  }
  private cursor = new BrushCursor();
  private brushN = 6;
  private toolKind: PaintKind = 'brush';
  private budgetEls = new Map<number, HTMLElement>();
  private pgToolEls = new Map<PgTool, HTMLElement>();
  private selTool: PgTool | null = null;

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
    const bgBtn = this.mkBtn('BG', cbs.onToggleBg, 'Cycle wallpaper');
    this.themeBtn = this.mkBtn('THEME', cbs.onCycleTheme, 'Light / dark / follow system (T)');
    this.muteBtn = this.mkBtn('SFX', cbs.onToggleMute, 'Mute sound effects (M)', true);
    this.musicBtn = this.mkBtn('MUSIC', cbs.onToggleMusic, 'Toggle chiptune loop', true);
    const helpBtn = this.mkBtn('?', cbs.onHelp, 'How to play');
    const menuBtn = this.mkBtn('MENU', cbs.onMenu, 'Back to the main menu (ESC)');
    menuBtn.classList.add('primary');

    // clusters by job, so fourteen controls read as five decisions
    const groups: [string, HTMLButtonElement[]][] = [
      ['Run', [this.pauseBtn, stepBtn]],
      ['File', [this.saveBtn, this.loadBtn, this.shareBtn]],
      ['View', [this.softBtn, crtBtn, this.gridBtn, this.view3dBtn, bgBtn, this.themeBtn]],
      ['Sound', [this.muteBtn, this.musicBtn]],
    ];
    for (const [name, btns] of groups) {
      const g = h('div', 'btn-group');
      g.setAttribute('role', 'group');
      g.setAttribute('aria-label', name);
      g.appendChild(h('span', 'grp-label', name));
      const row = h('div', 'grp-row');
      for (const b of btns) row.appendChild(b);
      g.appendChild(row);
      this.topbar.appendChild(g);
    }
    const end = h('div', 'btn-group end');
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
    const lamp = h('span', 'sb-lamp');
    const run = h('span', 'sb-val', 'RUNNING');
    runSeg.append(lamp, run);

    const matSeg = seg('sb-mat');
    const chip = h('span', 'sb-chip');
    const name = h('span', 'sb-val', '');
    const note = h('span', 'sb-note', '');
    matSeg.append(chip, name, note);

    const tool = h('span', 'sb-val', '');
    seg('sb-tool').append(h('span', 'sb-key', 'Tool'), tool);
    const cells = h('span', 'sb-val num', '0');
    const cellsKey = h('span', 'sb-key', 'Cells');
    seg('sb-cells').append(cellsKey, cells);
    this.fpsEl = h('span', 'sb-val num', '');
    this.fpsEl.id = 'fps';
    seg('sb-fps').append(this.fpsEl);
    this.status = { lamp, run, chip, name, note, tool, cells, cellsKey };
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
    // an indicator lamp instead of a recoloured key: one accent, and state
    // reads the same for every toggle
    if (toggle) {
      b.classList.add('has-led');
      const led = h('span', 'led');
      led.setAttribute('aria-hidden', 'true');
      b.appendChild(led);
    }
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

  setPaused(p: boolean): void {
    this.setLabel(this.pauseBtn, p ? 'RESUME' : 'PAUSE');
    this.pauseBtn.classList.toggle('toggled', p);
    if (this.status) this.status.run.textContent = p ? 'PAUSED' : 'RUNNING';
    // drives the amber cabinet lamp
    document.body.classList.toggle('sim-paused', p);
  }

  setSaveVisible(v: boolean): void {
    this.saveBtn.classList.toggle('hidden', !v);
    this.loadBtn.classList.toggle('hidden', !v);
    // sharing a challenge would hand someone a half-solved puzzle, so the
    // link button lives and dies with save/load
    this.shareBtn.classList.toggle('hidden', !v);
  }

  /** The SFX lamp means "sound on", like every other lamp. */
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

  buildSandPalette(
    allowed: number[] | null,
    initial: number,
    brush: number,
    cbs: SandPaletteCallbacks,
  ): void {
    this.toolbar.innerHTML = '';
    this.swatchEls.clear();
    this.budgetEls.clear();
    this.pgToolEls.clear();
    this.selTool = null;

    const pal = h('div');
    pal.id = 'palette';
    const list = allowed ?? MATS.filter((m) => m.placeable).map((m) => m.id);
    const usable = list.filter((id) => MATS[id]?.placeable);

    // living things get their own group, whatever their physics category
    const groups: [string, number[]][] = CAT_ORDER.map(([cat, label]) => [
      label,
      usable.filter((id) => MATS[id].cat === cat && !LIFE_MATS.has(id)),
    ]);
    groups.splice(1, 0, ['LIFE', usable.filter((id) => LIFE_MATS.has(id))]);
    for (const [label, inCat] of groups) {
      if (inCat.length === 0) continue; // challenges only allow a few materials
      const group = h('div', 'matgroup');
      group.appendChild(h('span', 'glabel', label));
      const grid = h('div', 'gswatches');
      for (const id of inCat) {
        const m = MATS[id];
        const el = h('div', 'swatch');
        const chip = h('div', 'chip');
        chip.style.backgroundImage = rampGradient(m.ramp);
        el.appendChild(chip);
        el.appendChild(h('span', 'nm', m.name));
        el.title = m.name;
        el.onclick = () => this.selectMat(id, cbs);
        grid.appendChild(el);
        this.swatchEls.set(id, el);
      }
      group.appendChild(grid);
      pal.appendChild(group);
    }

    // eraser lives in its own group so it is never mistaken for a material
    const tools = h('div', 'matgroup');
    tools.appendChild(h('span', 'glabel', 'TOOLS'));
    const toolGrid = h('div', 'gswatches');
    const erase = h('div', 'swatch');
    const chip = h('div', 'chip');
    chip.style.background = '#0b0b14';
    chip.style.border = '1px dashed var(--danger)';
    erase.appendChild(chip);
    erase.appendChild(h('span', 'nm', 'ERASE'));
    erase.title = 'Eraser (or hold right mouse button)';
    erase.onclick = () => this.selectMat(-1, cbs);
    toolGrid.appendChild(erase);
    tools.appendChild(toolGrid);
    pal.appendChild(tools);
    this.swatchEls.set(-1, erase);

    this.toolbar.appendChild(pal);
    this.buildBrushCol(brush);
    this.selectMat(initial, cbs);
    this.particleMode = false;
    if (this.status) this.status.cellsKey.textContent = 'Cells';
  }

  buildPgPalette(
    initial: PgTool,
    brush: number,
    cbs: PgPaletteCallbacks,
  ): void {
    this.toolbar.innerHTML = '';
    this.swatchEls.clear();
    this.budgetEls.clear();
    this.pgToolEls.clear();

    const pal = h('div');
    pal.id = 'palette';
    // [tool, label, chip gradient, group, tooltip]
    const tools: [PgTool, string, string, string, string][] = [
      ['fountain', 'FOUNTAIN', 'linear-gradient(135deg,#7fd8ff 0 50%,#2b7fd4 50% 100%)', 'EMITTERS', 'Streams particles upward from the cursor'],
      ['firework', 'FIREWORK', 'linear-gradient(135deg,#ffe97f 0 50%,#ff9a2b 50% 100%)', 'EMITTERS', 'Launches a rocket that bursts where you click'],
      ['sparkler', 'SPARKLER', 'linear-gradient(135deg,#fff3b0 0 50%,#ffb22b 50% 100%)', 'EMITTERS', 'Hold for a crackle of gold sparks'],
      ['hose', 'HOSE', 'linear-gradient(135deg,#9fe8ff 0 50%,#3b8cff 50% 100%)', 'EMITTERS', 'Drag to spray the way you are moving'],
      ['fireflies', 'FIREFLIES', 'linear-gradient(135deg,#f4ff9f 0 50%,#9fd43b 50% 100%)', 'EMITTERS', 'Release slow, blinking fireflies'],
      ['attract', 'ATTRACT', 'linear-gradient(135deg,#9ff7ea 0 50%,#2ea996 50% 100%)', 'FORCES', 'Pulls nearby particles in'],
      ['repel', 'REPULSE', 'linear-gradient(135deg,#ffa8c6 0 50%,#d43e77 50% 100%)', 'FORCES', 'Pushes nearby particles away'],
      ['vortex', 'VORTEX', 'linear-gradient(135deg,#e0f79f 0 50%,#8fc42b 50% 100%)', 'FORCES', 'Swirls particles around the cursor'],
      ['blackhole', 'BLACK HOLE', 'radial-gradient(circle,#000 0 35%,#ffb36b 40% 55%,#3a2410 60%)', 'FORCES', 'Pulls everything in and swallows it'],
      ['wall', 'WALL', 'linear-gradient(135deg,#a0a0bc 0 50%,#5c5c72 50% 100%)', 'TOOLS', 'Draw a solid barrier'],
      ['bumper', 'BUMPER', 'linear-gradient(135deg,#c8f4ff 0 50%,#5fb0d0 50% 100%)', 'TOOLS', 'A bouncy wall that plays a note when hit - higher up, higher pitch'],
      ['portal', 'PORTAL', 'linear-gradient(135deg,#ffb066 0 50%,#4cb4ff 50% 100%)', 'TOOLS', 'Click twice to open a linked pair - what goes in one comes out the other'],
      ['erase', 'ERASE', 'linear-gradient(135deg,#ff8a8a 0 50%,#a82c2c 50% 100%)', 'TOOLS', 'Clear walls and particles'],
    ];
    for (const groupName of ['EMITTERS', 'FORCES', 'TOOLS']) {
      const group = h('div', 'matgroup');
      group.appendChild(h('span', 'glabel', groupName));
      const grid = h('div', 'gswatches');
      for (const [tool, label, bg, g, tip] of tools) {
        if (g !== groupName) continue;
        const el = h('div', 'swatch');
        const chip = h('div', 'chip');
        chip.style.backgroundImage = bg;
        el.appendChild(chip);
        el.appendChild(h('span', 'nm', label));
        el.title = tip;
        el.onclick = () => this.selectTool(tool, cbs);
        grid.appendChild(el);
        this.pgToolEls.set(tool, el);
      }
      group.appendChild(grid);
      pal.appendChild(group);
    }
    // demo scenes, one click each
    if (cbs.presets?.length) {
      const scenes = h('div', 'matgroup');
      scenes.appendChild(h('span', 'glabel', 'SCENES'));
      const grid = h('div', 'scenebtns');
      for (const [id, label, tip] of cbs.presets) grid.appendChild(this.mkBtn(label, () => cbs.onPreset?.(id), tip));
      scenes.appendChild(grid);
      pal.appendChild(scenes);
    }

    // world-wide actions: things that are not a brush
    const actions = h('div', 'matgroup');
    actions.appendChild(h('span', 'glabel', 'ACTIONS'));
    const row = h('div', 'toolbtns');
    this.gravityBtn = this.mkBtn('GRAVITY', () => cbs.onGravity?.(), 'Particles fall (G)', true);
    this.gravityBtn.classList.add('toggled');
    this.slowBtn = this.mkBtn('SLOW-MO', () => cbs.onSlowmo?.(), 'Run the playground at a third of the speed (Q)', true);
    const clearBtn = this.mkBtn('CLEAR', () => cbs.onClear?.(), 'Remove everything: particles, forces, portals, walls and bumpers (X)');
    row.append(this.gravityBtn, this.slowBtn, clearBtn);
    actions.appendChild(row);
    pal.appendChild(actions);

    this.toolbar.appendChild(pal);
    this.buildBrushCol(brush, false);
    this.selectTool(initial, cbs);
    this.particleMode = true;
    if (this.status) this.status.cellsKey.textContent = 'Particles';
  }

  private bucketBtn: HTMLButtonElement | null = null;
  private windBtn: HTMLButtonElement | null = null;
  private musicBtn!: HTMLButtonElement;
  private view3dBtn!: HTMLButtonElement;
  private shareBtn!: HTMLButtonElement;
  private softBtn!: HTMLButtonElement;
  private crtBtn!: HTMLButtonElement;
  private themeBtn!: HTMLButtonElement;

  setThemeLabel(t: string): void {
    this.setLabel(this.themeBtn, t === 'auto' ? 'AUTO' : t.toUpperCase());
  }
  private gridBtn!: HTMLButtonElement;

  /** null = off; a number shows the active block edge, e.g. "GRID 8". */
  setGridSize(n: number | null): void {
    this.gridBtn.classList.toggle('toggled', n !== null);
    this.setLabel(this.gridBtn, n === null ? 'GRID' : `GRID ${n}`);
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

  private selectMat(id: number, cbs: SandPaletteCallbacks): void {
    for (const [mat, el] of this.swatchEls)
      el.classList.toggle('sel', mat === id);
    if (id === -1) {
      this.showSelection('ERASE', '', 'Clears whatever the brush covers. Right-drag erases too.', 'transparent');
    } else {
      const m = MATS[id];
      this.showSelection(m.name, CAT_WORD[m.cat], ELEMENT_NOTES[m.name] ?? '', rampGradient(m.ramp));
    }
    cbs.onSelect(id);
  }

  private selectTool(tool: PgTool, cbs: PgPaletteCallbacks): void {
    this.selTool = tool;
    for (const [t, el] of this.pgToolEls)
      el.classList.toggle('sel', t === tool);
    const el = this.pgToolEls.get(tool);
    const chip = el?.querySelector<HTMLElement>('.chip');
    this.showSelection(tool.toUpperCase(), '', el?.title ?? '', chip?.style.backgroundImage ?? '');
    cbs.onTool(tool);
  }

  getSelectedTool(): PgTool | null {
    return this.selTool;
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
        this.swatchEls.get(m)?.appendChild(badge);
        this.budgetEls.set(m, badge);
      }
      badge.textContent = String(remaining);
      this.swatchEls.get(m)?.classList.toggle('exhausted', remaining <= 0);
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
