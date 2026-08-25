import { MATS, NMATS } from '../sim/materials';
import type { Stats } from '../sim/protocol';
import { h } from './widgets';

function cssHex(u: number): string {
  const r = u & 255;
  const g = (u >>> 8) & 255;
  const b = (u >>> 16) & 255;
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

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
    this.topbar.appendChild(h('span', 'title', 'PIXELFORGE'));
    this.modeEl = h('span', 'mode-label', '');
    this.topbar.appendChild(this.modeEl);
    this.topbar.appendChild(h('span', 'spacer'));

    this.saveBtn = h('button', 'px', 'SAVE') as HTMLButtonElement;
    this.saveBtn.onclick = cbs.onSave;
    this.loadBtn = h('button', 'px', 'LOAD') as HTMLButtonElement;
    this.loadBtn.onclick = cbs.onLoad;

    this.pauseBtn = h('button', 'px', 'PAUSE') as HTMLButtonElement;
    this.pauseBtn.onclick = cbs.onPause;
    const stepBtn = h('button', 'px', 'STEP') as HTMLButtonElement;
    stepBtn.onclick = cbs.onStep;
    this.muteBtn = h('button', 'px', 'SFX') as HTMLButtonElement;
    this.muteBtn.onclick = cbs.onToggleMute;
    const crtBtn = h('button', 'px toggled', 'CRT') as HTMLButtonElement;
    crtBtn.onclick = cbs.onToggleCrt;
    const bgBtn = h('button', 'px', 'BG') as HTMLButtonElement;
    bgBtn.title = 'Cycle wallpaper';
    bgBtn.onclick = cbs.onToggleBg;
    this.musicBtn = h('button', 'px', 'MUSIC') as HTMLButtonElement;
    this.musicBtn.title = 'Toggle chiptune loop';
    this.musicBtn.onclick = cbs.onToggleMusic;
    const helpBtn = h('button', 'px', '?') as HTMLButtonElement;
    helpBtn.title = 'Help';
    helpBtn.onclick = cbs.onHelp;
    const menuBtn = h('button', 'px primary', 'MENU') as HTMLButtonElement;
    menuBtn.onclick = cbs.onMenu;

    this.fpsEl = h('span', '', '');
    this.fpsEl.id = 'fps';
    for (const b of [this.saveBtn, this.loadBtn, this.pauseBtn, stepBtn, this.muteBtn, this.musicBtn, crtBtn, bgBtn, helpBtn, menuBtn])
      this.topbar.appendChild(b);
    this.topbar.appendChild(this.fpsEl);

    document.body.classList.add('crt-on');
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
    for (const id of list) {
      const m = MATS[id];
      if (!m || !m.placeable) continue;
      const el = h('div', 'swatch');
      const chip = h('div', 'chip');
      chip.style.background = cssHex(m.ramp[0]);
      el.appendChild(chip);
      el.appendChild(h('span', 'nm', m.name));
      const tip = `${m.name}`;
      el.title = tip;
      el.onclick = () => this.selectMat(id, cbs);
      pal.appendChild(el);
      this.swatchEls.set(id, el);
    }
    // eraser
    const erase = h('div', 'swatch');
    const chip = h('div', 'chip');
    chip.style.background = '#0b0b14';
    chip.style.border = '1px dashed var(--danger)';
    erase.appendChild(chip);
    erase.appendChild(h('span', 'nm', 'ERASE'));
    erase.title = 'Eraser';
    erase.onclick = () => this.selectMat(-1, cbs);
    pal.appendChild(erase);
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
    const tools: [PgTool, string, string][] = [
      ['fountain', 'FOUNTAIN', '#3fb4ff'],
      ['firework', 'FIREWORK', '#ffd93f'],
      ['attract', 'ATTRACT', '#6ef0e0'],
      ['repel', 'REPULSE', '#f06e9e'],
      ['vortex', 'VORTEX', '#c9f06e'],
      ['wall', 'WALL', '#80809a'],
      ['erase', 'ERASE', '#e05252'],
    ];
    for (const [tool, label, col] of tools) {
      const el = h('div', 'swatch');
      const chip = h('div', 'chip');
      chip.style.background = col;
      el.appendChild(chip);
      el.appendChild(h('span', 'nm', label));
      el.onclick = () => this.selectTool(tool, cbs);
      pal.appendChild(el);
      this.pgToolEls.set(tool, el);
    }
    this.toolbar.appendChild(pal);
    this.buildBrushCol(brush);
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

  private buildBrushCol(brush: number): void {
    const col = h('div', 'toolcol');
    const row = h('div', 'brushrow');
    row.appendChild(h('span', '', 'BRUSH'));
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '2';
    slider.max = '24';
    slider.value = String(brush);
    slider.step = '1';
    slider.oninput = () => {
      this.brushLabel.textContent = slider.value;
      window.dispatchEvent(new CustomEvent('pf-brush', { detail: Number(slider.value) }));
    };
    row.appendChild(slider);
    this.brushLabel = h('span', '', String(brush));
    row.appendChild(this.brushLabel);
    col.appendChild(row);
    col.appendChild(h('div', 'brushrow', 'WHEEL / [ ] SIZE / F BUCKET'));
    this.bucketBtn = h('button', 'px', 'BUCKET') as HTMLButtonElement;
    this.bucketBtn.title = 'Flood fill (F)';
    this.bucketBtn.onclick = () => {
      const on = !this.bucketBtn!.classList.contains('toggled');
      this.setBucketToggled(on);
      window.dispatchEvent(new CustomEvent('pf-bucket', { detail: on }));
    };
    col.appendChild(this.bucketBtn);
    this.toolbar.appendChild(col);
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
  }
}
