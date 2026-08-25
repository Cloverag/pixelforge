import { Cat, MATS, NMATS } from '../sim/materials';
import type { Stats } from '../sim/protocol';
import { h } from './widgets';

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
  | 'attract'
  | 'repel'
  | 'vortex'
  | 'wall'
  | 'erase';

interface TopbarCallbacks {
  onPause(): void;
  onStep(): void;
  onMenu(): void;
  onSave(): void;
  onLoad(): void;
  onToggleMute(): void;
  onToggleCrt(): void;
  onToggleBg(): void;
  onToggleMusic(): void;
  onHelp(): void;
}

interface SandPaletteCallbacks {
  onSelect(mat: number): void;
}

interface PgPaletteCallbacks {
  onTool(tool: PgTool): void;
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
  private budgetEls = new Map<number, HTMLElement>();
  private pgToolEls = new Map<PgTool, HTMLElement>();
  private selTool: PgTool | null = null;

  constructor(
    private topbar: HTMLElement,
    private toolbar: HTMLElement,
  ) {}

  initTopbar(cbs: TopbarCallbacks): void {
    this.topbar.innerHTML = '';
    const mark = h('span', 'brand-mark');
    mark.setAttribute('aria-hidden', 'true');
    this.topbar.appendChild(mark);
    this.topbar.appendChild(h('span', 'title', 'PIXELFORGE'));
    this.modeEl = h('span', 'mode-label', '');
    this.topbar.appendChild(this.modeEl);
    this.topbar.appendChild(h('span', 'spacer'));

    this.saveBtn = this.mkBtn('SAVE', cbs.onSave, 'Save this world to browser storage');
    this.loadBtn = this.mkBtn('LOAD', cbs.onLoad, 'Load the saved world');
    this.pauseBtn = this.mkBtn('PAUSE', cbs.onPause, 'Pause / resume the simulation (SPACE)');
    const stepBtn = this.mkBtn('STEP', cbs.onStep, 'Advance one tick while paused (N)');
    this.muteBtn = this.mkBtn('SFX', cbs.onToggleMute, 'Mute sound effects (M)');
    this.musicBtn = this.mkBtn('MUSIC', cbs.onToggleMusic, 'Toggle chiptune loop');
    const crtBtn = this.mkBtn('CRT', cbs.onToggleCrt, 'Toggle the CRT filter (C)');
    crtBtn.classList.add('toggled');
    const bgBtn = this.mkBtn('BG', cbs.onToggleBg, 'Cycle wallpaper');
    const helpBtn = this.mkBtn('?', cbs.onHelp, 'How to play');
    const menuBtn = this.mkBtn('MENU', cbs.onMenu, 'Back to the main menu (ESC)');
    menuBtn.classList.add('primary');

    this.fpsEl = h('span', '', '');
    this.fpsEl.id = 'fps';
    for (const b of [this.saveBtn, this.loadBtn, this.pauseBtn, stepBtn, this.muteBtn, this.musicBtn, crtBtn, bgBtn, helpBtn, menuBtn])
      this.topbar.appendChild(b);
    this.topbar.appendChild(this.fpsEl);

    document.body.classList.add('crt-on');
  }

  private mkBtn(label: string, onClick: () => void, title?: string): HTMLButtonElement {
    const b = h('button', 'px', label) as HTMLButtonElement;
    b.type = 'button';
    if (title) {
      b.title = title;
      b.setAttribute('aria-label', title);
    }
    b.onclick = onClick;
    return b;
  }

  setModeLabel(s: string): void {
    this.modeEl.textContent = s;
  }

  setFps(f: number): void {
    this.fpsEl.textContent = `${f} FPS`;
  }

  setPaused(p: boolean): void {
    this.pauseBtn.textContent = p ? 'RESUME' : 'PAUSE';
    this.pauseBtn.classList.toggle('toggled', p);
    // drives the amber cabinet lamp
    document.body.classList.toggle('sim-paused', p);
  }

  setSaveVisible(v: boolean): void {
    this.saveBtn.classList.toggle('hidden', !v);
    this.loadBtn.classList.toggle('hidden', !v);
  }

  setMuted(m: boolean): void {
    this.muteBtn.classList.toggle('toggled', m);
  }

  showBars(v: boolean): void {
    this.topbar.classList.toggle('hidden', !v);
    this.toolbar.classList.toggle('hidden', !v);
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

    for (const [cat, label] of CAT_ORDER) {
      const inCat = usable.filter((id) => MATS[id].cat === cat);
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
      ['firework', 'FIREWORK', 'linear-gradient(135deg,#ffe97f 0 50%,#ff9a2b 50% 100%)', 'EMITTERS', 'Bursts particles in a ring'],
      ['attract', 'ATTRACT', 'linear-gradient(135deg,#9ff7ea 0 50%,#2ea996 50% 100%)', 'FORCES', 'Pulls nearby particles in'],
      ['repel', 'REPULSE', 'linear-gradient(135deg,#ffa8c6 0 50%,#d43e77 50% 100%)', 'FORCES', 'Pushes nearby particles away'],
      ['vortex', 'VORTEX', 'linear-gradient(135deg,#e0f79f 0 50%,#8fc42b 50% 100%)', 'FORCES', 'Swirls particles around the cursor'],
      ['wall', 'WALL', 'linear-gradient(135deg,#a0a0bc 0 50%,#5c5c72 50% 100%)', 'TOOLS', 'Draw a solid barrier'],
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
    this.toolbar.appendChild(pal);
    this.buildBrushCol(brush, false);
    this.selectTool(initial, cbs);
  }

  private bucketBtn: HTMLButtonElement | null = null;
  private musicBtn!: HTMLButtonElement;

  setMusicToggled(v: boolean): void {
    this.musicBtn.classList.toggle('toggled', v);
  }

  setBucketToggled(v: boolean): void {
    if (this.bucketBtn) {
      this.bucketBtn.classList.toggle('toggled', v);
      this.bucketBtn.textContent = v ? 'BUCKET: ON' : 'BUCKET';
    }
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
    col.appendChild(h('div', 'brushrow hint', 'WHEEL OR [ ] TO RESIZE'));

    this.bucketBtn = null;
    if (withBucket) {
      this.bucketBtn = this.mkBtn('BUCKET', () => {
        const on = !this.bucketBtn!.classList.contains('toggled');
        this.setBucketToggled(on);
        window.dispatchEvent(new CustomEvent('pf-bucket', { detail: on }));
      }, 'Flood fill (F)');
      col.appendChild(this.bucketBtn);
    }

    this.toolbar.appendChild(col);
    this.setBrushDisplay(brush);
  }

  private selectMat(id: number, cbs: SandPaletteCallbacks): void {
    for (const [mat, el] of this.swatchEls)
      el.classList.toggle('sel', mat === id);
    cbs.onSelect(id);
  }

  private selectTool(tool: PgTool, cbs: PgPaletteCallbacks): void {
    this.selTool = tool;
    for (const [t, el] of this.pgToolEls)
      el.classList.toggle('sel', t === tool);
    cbs.onTool(tool);
  }

  getSelectedTool(): PgTool | null {
    return this.selTool;
  }

  updateStats(st: Stats): void {
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
    if (this.brushLabel) this.brushLabel.textContent = String(n);
    if (this.brushDot) {
      // 26px preview box; brush runs 2..24 so it always fits
      const px = Math.max(2, Math.min(26, n));
      this.brushDot.style.width = `${px}px`;
      this.brushDot.style.height = `${px}px`;
    }
  }
}
