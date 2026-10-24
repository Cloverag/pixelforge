import { GardenView } from '../garden/view';
import { defaults, DRAWINGS, MATH_FLOWERS, YOURS, type Drawing } from '../mathlab/drawings';
import { MathRun } from '../mathlab/run';
import { decodeDesign, encodeDesign } from '../mathlab/link';
import { copyText, shareUrl } from '../game/share';
import { SURFACES, SurfaceRun, type Surface } from '../mathlab/surface';
import type { PointerEvt } from '../core/input';
import type { PaletteSection, Swatch } from '../ui/hud';
import { h } from '../ui/widgets';
import type { CursorLook, ModeController, ModeCtx } from './types';

/** The drawings' chips on the rail. */
const CHIPS: Record<string, string> = {
  heart: 'linear-gradient(135deg,#ff9fd0 0 50%,#e8417e 50% 100%)',
  butterfly: 'linear-gradient(135deg,#52f2ff 0 50%,#e033ff 50% 100%)',
  rosette: 'linear-gradient(135deg,#ffffff 0 50%,#9aa6c8 50% 100%)',
  sphere: 'linear-gradient(135deg,#e9d5ff 0 50%,#7c3aed 50% 100%)',
  tree: 'linear-gradient(135deg,#ffc0d8 0 50%,#7a2a1a 50% 100%)',
  rose: 'linear-gradient(135deg,#ff6a8a 0 50%,#d0103a 50% 100%)',
  ripple: 'linear-gradient(135deg,#fde725 0 50%,#3b528b 50% 100%)',
  saddle: 'linear-gradient(135deg,#5ec962 0 50%,#440154 50% 100%)',
  waves: 'linear-gradient(135deg,#21918c 0 50%,#fde725 50% 100%)',
  sunflower: 'linear-gradient(135deg,#f2b81c 0 50%,#5a3416 50% 100%)',
  maurer: 'linear-gradient(135deg,#ff4a6a 0 50%,#52c8ff 50% 100%)',
  spiro: 'linear-gradient(135deg,#7ad8ff 0 50%,#ff7ad8 50% 100%)',
  yours: 'linear-gradient(135deg,#ffd23f 0 50%,#ff4fa3 50% 100%)',
};

/** Everything on the rail: drawings drawn stroke by stroke, and 3D graphs. */
type Item = Drawing | Surface;
const ITEMS: Item[] = [...DRAWINGS, ...MATH_FLOWERS, YOURS, ...SURFACES];

/**
 * MATH LAB: maths you can watch. Pick a drawing - a parametric heart, a
 * spiral rosette, a sphere of ellipses, a recursive tree - and it is drawn
 * stroke by stroke while its code, beside it, lights the line doing the
 * drawing. Sliders change the numbers in the code and the drawing starts
 * again, so you see what each number does.
 *
 * Drawn on the garden's canvas (garden/view.ts), so the ASCII filter works
 * here too. Solo, like the garden.
 */
export class MathMode implements ModeController {
  readonly id = 'math';
  readonly roomName = 'MATH LAB';
  readonly cinematic = false;
  readonly saveable = false;
  readonly view3d = 'voxel';
  readonly challengeId = null;
  readonly keys: Record<string, () => void> = {
    r: () => this.redraw(),
    a: () => this.toggleAscii(),
    f: () => this.view.math?.finish(),
    '3': () => this.toggle3d(),
    x: () => this.clear(),
  };
  /** drawings lifted into 3D (the 3D graphs always are) */
  private lift3d = false;
  private view = new GardenView('math-on');
  private drawing: Item = DRAWINGS[0];
  /** a drag on a 3D graph turns it */
  private drag: { x: number; y: number } | null = null;
  private params: Record<string, number> = defaults(DRAWINGS[0]);
  private panel: HTMLElement | null = null;
  /** what the player has typed for YOUR CURVE (kept while they look at other drawings) */
  private formula = YOURS.formula!.value;
  private formulaError: HTMLElement | null = null;
  private lines: HTMLElement[] = [];

  constructor(private ctx: ModeCtx) {}

  start(): void {
    this.ctx.post({ t: 'input', inp: { k: 'mode', m: 'math' } });
  }

  buildUI(): void {
    const swatch = (d: Item): Swatch => ({ id: d.id, label: d.name, chip: CHIPS[d.id], title: d.idea, info: [d.name, '', d.idea, CHIPS[d.id]] });
    const sections: PaletteSection[] = [
      { label: 'YOUR OWN', swatches: [swatch(YOURS)] },
      { label: 'MATH FLOWERS', swatches: MATH_FLOWERS.map(swatch) },
      { label: 'DRAWINGS', swatches: DRAWINGS.map(swatch) },
      { label: '3D GRAPHS', swatches: SURFACES.map(swatch) },
      {
        label: 'DRAW',
        cls: 'toolbtns',
        buttons: [
          { label: 'AGAIN', title: 'Draw it again from the start (R)', onClick: () => this.redraw() },
          { label: 'FINISH', title: 'Skip to the finished drawing (F)', onClick: () => this.view.math?.finish() },
          { label: 'ASCII', title: 'As coloured text (A)', onClick: () => this.toggleAscii(), lamp: 'ascii', on: false },
          { label: '3D', title: 'Lift the drawing into 3D, each stroke as high as it is late - drag to turn it (3)', onClick: () => this.toggle3d(), lamp: 'm3d', on: this.lift3d },
          { label: 'RESET', title: "Put this drawing's numbers back", onClick: () => this.pick(this.drawing, true) },
          { label: 'COPY LINK', title: 'A link that opens this design: the drawing, its numbers and your formula', onClick: () => void this.share() },
        ],
      },
    ];
    this.ctx.hud.buildPalette(
      {
        sections,
        initial: this.drawing.id,
        onPick: (id) => this.pick(ITEMS.find((d) => d.id === id) ?? DRAWINGS[0], false),
        bucket: false,
        counts: 'strokes',
        hint: '',
      },
      this.ctx.brush(),
    );
    if (!this.view.mounted()) {
      this.view.mount();
      this.view.ascii = false;
      // the code panel covers the right of the screen: the drawing keeps to the left
      this.view.mathWidth = 0.56;
      this.view.onLine = (l) => this.light(l);
    }
    this.ctx.hud.setLamp('ascii', this.view.ascii);
    this.ctx.hud.setHint('');
    if (!this.panel) this.panel = h('div', 'math-code');
    document.getElementById('screen-wrap')?.appendChild(this.panel);
    this.pick(this.drawing, false);
  }

  /** Show a drawing: its code and sliders, and start drawing it. */
  private pick(d: Item, reset: boolean): void {
    if (d !== this.drawing || reset) this.params = defaults(d);
    this.drawing = d;
    this.ctx.sfx.ui();
    this.buildPanel();
    this.redraw();
  }

  private buildPanel(): void {
    const p = this.panel;
    if (!p) return;
    const d = this.drawing;
    p.replaceChildren(h('div', 'math-title', d.name), h('p', 'math-idea', d.idea));
    this.formulaError = null;
    if ('formula' in d && d.formula) p.append(this.formulaBox(d.formula));
    const code = h('ol', 'math-lines');
    this.lines = this.codeText().map((t) => {
      const li = h('li');
      li.append(h('code', '', t));
      code.append(li);
      return li;
    });
    p.append(code);
    const sliders = h('div', 'math-sliders');
    for (const q of d.params) {
      const row = h('label', 'math-slider');
      const val = h('span', 'math-val', String(this.params[q.key]));
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(q.min);
      input.max = String(q.max);
      input.step = String(q.step);
      input.value = String(this.params[q.key]);
      input.addEventListener('input', () => {
        this.params[q.key] = Number(input.value);
        val.textContent = input.value;
        // the code shows the new number at once; the drawing starts again
        this.showCode();
        this.redraw();
      });
      row.append(h('span', 'math-key', q.label), input, val);
      sliders.append(row);
    }
    p.append(sliders);
  }

  /** The formula box: what the player types, what is wrong with it, ideas to try. */
  private formulaBox(f: NonNullable<Drawing['formula']>): HTMLElement {
    const box = h('div', 'math-formula');
    const row = h('label', 'math-formula-row');
    const input = document.createElement('input');
    input.type = 'text';
    input.value = this.formula;
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.setAttribute('aria-label', `Your formula, ${f.label}`);
    // typing here must not reach the game's keys (A, R, F, SPACE...); ESC still leaves the box
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') input.blur();
      else e.stopPropagation();
    });
    input.addEventListener('input', () => {
      this.formula = input.value;
      this.showCode();
      this.redraw();
    });
    row.append(h('span', 'math-key', f.label), input);
    const err = h('div', 'math-error');
    this.formulaError = err;
    const ideas = h('div', 'math-ideas');
    for (const ex of f.examples) {
      const b = h('button', 'math-idea-btn', ex) as HTMLButtonElement;
      b.type = 'button';
      b.addEventListener('click', () => {
        input.value = this.formula = ex;
        this.showCode();
        this.redraw();
      });
      ideas.append(b);
    }
    box.append(row, err, ideas);
    return box;
  }

  /** A design from a link: shown when the mode starts. False if the code is not one. */
  adopt(code: string): boolean {
    const got = decodeDesign(code, ITEMS);
    if (!got) return false;
    this.drawing = got.item;
    this.params = got.params;
    if (got.formula !== undefined) this.formula = got.formula;
    return true;
  }

  private async share(): Promise<void> {
    const d = this.drawing;
    const code = encodeDesign(d.id, this.params, d === YOURS ? this.formula : undefined);
    const ok = await copyText(shareUrl(code, 'm'));
    this.ctx.sfx.ui();
    this.ctx.toast(ok ? 'DESIGN LINK COPIED' : 'COPY FAILED - THE BROWSER BLOCKED THE CLIPBOARD', !ok);
  }

  private codeText(): string[] {
    const d = this.drawing;
    return 'strokes' in d ? d.code(this.params, this.formula) : d.code(this.params);
  }

  private showCode(): void {
    this.codeText().forEach((t, i) => (this.lines[i].firstChild!.textContent = t));
  }

  private redraw(): void {
    const d = this.drawing;
    if ('strokes' in d) {
      let strokes;
      try {
        strokes = d.strokes(this.params, this.formula);
      } catch (e) {
        // a formula it cannot read: say why, and keep the last drawing
        if (this.formulaError) this.formulaError.textContent = (e as Error).message;
        return;
      }
      if (this.formulaError) this.formulaError.textContent = '';
      // your own curve redraws as you type: quick, so you can try things
      const run = new MathRun(strokes, d === YOURS ? 2.5 : 8);
      run.view3d = this.lift3d;
      this.view.math = run;
      this.ctx.hud.setParticles(run.strokes.length);
    } else {
      this.view.math = new SurfaceRun(d, this.params);
      this.ctx.hud.setParticles(0);
    }
    this.view.setScene('math');
  }

  /** Light the code line being drawn; none once the drawing is finished. */
  private light(line: number): void {
    this.lines.forEach((li, i) => li.classList.toggle('on', i === line));
  }

  private toggleAscii(): void {
    if (!this.view.hasFilter) {
      this.ctx.toast('THE TEXT FILTER NEEDS WEBGL2', true);
      return;
    }
    this.view.ascii = !this.view.ascii;
    this.ctx.hud.setLamp('ascii', this.view.ascii);
    this.ctx.sfx.ui();
  }

  private toggle3d(): void {
    this.lift3d = !this.lift3d;
    if (this.view.math instanceof MathRun) this.view.math.view3d = this.lift3d;
    this.ctx.hud.setLamp('m3d', this.lift3d);
    this.ctx.sfx.ui();
    if (this.lift3d && !(this.view.math instanceof MathRun)) this.ctx.toast('3D GRAPHS ARE ALWAYS 3D - DRAG TO TURN THEM');
  }

  /** Drag a 3D graph, or a drawing in 3D, to turn it round and over. */
  onPointer(e: PointerEvt): void {
    const run = this.view.math;
    if (!(run instanceof SurfaceRun || (run instanceof MathRun && run.view3d))) return;
    if (e.phase === 'down') this.drag = { x: e.x, y: e.y };
    else if (e.phase === 'up') this.drag = null;
    else if (this.drag) {
      run.turn((e.x - this.drag.x) * 0.012, (e.y - this.drag.y) * 0.012);
      this.drag = { x: e.x, y: e.y };
    }
  }

  /** CLEAR: a blank canvas (AGAIN draws the drawing back). */
  clear(): void {
    this.view.math = new MathRun([]);
    this.view.setScene('math');
    this.ctx.hud.setParticles(0);
    this.ctx.sfx.ui();
  }

  onPause(p: boolean): void {
    this.view.setPaused(p);
  }

  leave(): void {
    this.view.unmount();
    this.panel?.remove();
  }

  cursor(): CursorLook {
    return { m: 0, k: 'b' };
  }
}
