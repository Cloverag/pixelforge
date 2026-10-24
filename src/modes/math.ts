import { GardenView } from '../garden/view';
import { defaults, DRAWINGS, type Drawing } from '../mathlab/drawings';
import { MathRun } from '../mathlab/run';
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
};

/** Everything on the rail: drawings drawn stroke by stroke, and 3D graphs. */
type Item = Drawing | Surface;
const ITEMS: Item[] = [...DRAWINGS, ...SURFACES];

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
  };
  private view = new GardenView('math-on');
  private drawing: Item = DRAWINGS[0];
  /** a drag on a 3D graph turns it */
  private drag: { x: number; y: number } | null = null;
  private params: Record<string, number> = defaults(DRAWINGS[0]);
  private panel: HTMLElement | null = null;
  private lines: HTMLElement[] = [];

  constructor(private ctx: ModeCtx) {}

  start(): void {
    this.ctx.post({ t: 'input', inp: { k: 'mode', m: 'math' } });
  }

  buildUI(): void {
    const swatch = (d: Item): Swatch => ({ id: d.id, label: d.name, chip: CHIPS[d.id], title: d.idea, info: [d.name, '', d.idea, CHIPS[d.id]] });
    const sections: PaletteSection[] = [
      { label: 'DRAWINGS', swatches: DRAWINGS.map(swatch) },
      { label: '3D GRAPHS', swatches: SURFACES.map(swatch) },
      {
        label: 'DRAW',
        cls: 'toolbtns',
        buttons: [
          { label: 'AGAIN', title: 'Draw it again from the start (R)', onClick: () => this.redraw() },
          { label: 'FINISH', title: 'Skip to the finished drawing (F)', onClick: () => this.view.math?.finish() },
          { label: 'ASCII', title: 'As coloured text (A)', onClick: () => this.toggleAscii(), lamp: 'ascii', on: false },
          { label: 'RESET', title: "Put this drawing's numbers back", onClick: () => this.pick(this.drawing, true) },
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
    const code = h('ol', 'math-lines');
    this.lines = d.code(this.params).map((t) => {
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
        d.code(this.params).forEach((t, i) => (this.lines[i].firstChild!.textContent = t));
        this.redraw();
      });
      row.append(h('span', 'math-key', q.label), input, val);
      sliders.append(row);
    }
    p.append(sliders);
  }

  private redraw(): void {
    const d = this.drawing;
    if ('strokes' in d) {
      const run = new MathRun(d.strokes(this.params));
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

  /** Drag a 3D graph to turn it round and tip it. */
  onPointer(e: PointerEvt): void {
    const run = this.view.math;
    if (!(run instanceof SurfaceRun)) return;
    if (e.phase === 'down') this.drag = { x: e.x, y: e.y };
    else if (e.phase === 'up') this.drag = null;
    else if (this.drag) {
      run.turn((e.x - this.drag.x) * 0.012, (e.y - this.drag.y) * 0.012);
      this.drag = { x: e.x, y: e.y };
    }
  }

  leave(): void {
    this.view.unmount();
    this.panel?.remove();
  }

  cursor(): CursorLook {
    return { m: 0, k: 'b' };
  }
}
