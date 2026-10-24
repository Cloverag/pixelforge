import type { PointerEvt } from '../core/input';
import { AsciiFilter } from '../garden/ascii';
import { drawGarden } from '../garden/draw';
import { bouquet, plantAt, type Flower, type FlowerKind } from '../garden/flowers';
import type { PaletteSection, Swatch } from '../ui/hud';
import type { CursorLook, ModeController, ModeCtx } from './types';

/** The panel's flowers: id, name, chip colours, tooltip. */
const KINDS: [FlowerKind, string, string, string][] = [
  ['lily', 'LILY', 'linear-gradient(135deg,#ff6a5a 0 50%,#d61f2c 50% 100%)', 'Six pointed petals, freckles and long stamens'],
  ['tulip', 'TULIP', 'linear-gradient(135deg,#ffe08a 0 50%,#f2a33c 50% 100%)', 'A cup of three petals'],
  ['daisy', 'DAISY', 'linear-gradient(135deg,#f2c230 0 50%,#f4f2ea 50% 100%)', 'White rays around a yellow heart'],
  ['rose', 'ROSE', 'linear-gradient(135deg,#ff4a5a 0 50%,#b0122a 50% 100%)', 'Petals wound in a spiral'],
  ['sunflower', 'SUNFLOWER', 'linear-gradient(135deg,#5a3416 0 50%,#f2b81c 50% 100%)', 'A big gold head with a dark disc'],
];

/** ASCII cell sizes the GLYPH button cycles through, in screen pixels. */
const CELLS = [6, 8, 11, 15];

/**
 * The ASCII garden: vector flowers (lilies, tulips, daisies, roses,
 * sunflowers) drawn as coloured text. Click to plant one; BOUQUET makes a
 * whole florist's bouquet. Flowers open, then sway.
 *
 * It draws on its own canvas over the world's, on the main thread: the
 * worker's world sits empty underneath. Solo only for now - a room cannot
 * switch to it, and flowers are not shared.
 */
export class GardenMode implements ModeController {
  readonly id = 'garden';
  readonly roomName = 'ASCII GARDEN';
  readonly cinematic = false;
  readonly saveable = false;
  readonly view3d = 'voxel';
  readonly challengeId = null;
  readonly keys: Record<string, () => void> = {
    b: () => this.makeBouquet(),
    x: () => this.clear(),
    a: () => this.toggleAscii(),
  };
  private kind: FlowerKind = 'lily';
  private flowers: Flower[] = [];
  private canvas: HTMLCanvasElement | null = null;
  private pic = document.createElement('canvas');
  private filter: AsciiFilter | null = null;
  private raf = 0;
  private t0 = performance.now();
  private cellIdx = 1;
  private seed = 1;

  constructor(private ctx: ModeCtx) {}

  private now(): number {
    return (performance.now() - this.t0) / 1000;
  }

  start(): void {
    this.ctx.post({ t: 'input', inp: { k: 'mode', m: 'garden' } });
    if (this.flowers.length === 0) this.makeBouquet(true);
  }

  buildUI(): void {
    const swatches: Swatch[] = KINDS.map(([id, label, chip, title]) => ({ id, label, chip, title, info: [label, '', title, chip] }));
    const sections: PaletteSection[] = [
      { label: 'FLOWERS', swatches },
      {
        label: 'GARDEN',
        cls: 'scenebtns',
        buttons: [
          { label: 'BOUQUET', title: 'A whole new bouquet (B)', onClick: () => this.makeBouquet(), cls: 'surprise' },
          { label: 'ASCII', title: 'Flowers as text, or as drawings (A)', onClick: () => this.toggleAscii(), lamp: 'ascii', on: true },
          { label: 'GLYPH SIZE', title: 'Bigger or smaller characters', onClick: () => this.cycleCell() },
          { label: 'CLEAR', title: 'Pick every flower (X)', onClick: () => this.clear() },
        ],
      },
    ];
    this.ctx.hud.buildPalette(
      {
        sections,
        initial: this.kind,
        onPick: (id) => {
          this.kind = id as FlowerKind;
          this.ctx.sfx.ui();
        },
        bucket: false,
        counts: 'particles',
        hint: 'Click to plant a flower, or press BOUQUET',
      },
      this.ctx.brush(),
    );
    this.mount();
    this.count();
  }

  /** Our canvas over the world's, same place and size; the loop that draws it. */
  private mount(): void {
    const wrap = document.getElementById('screen-wrap');
    if (!wrap || this.canvas) return;
    const c = document.createElement('canvas');
    c.id = 'garden';
    wrap.appendChild(c);
    this.canvas = c;
    try {
      this.filter = new AsciiFilter(c);
    } catch {
      // no WebGL2: the drawings without the text filter, on a 2D canvas
      this.filter = null;
    }
    document.body.classList.add('garden-on');
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.draw();
    };
    this.raf = requestAnimationFrame(loop);
  }

  private draw(): void {
    const c = this.canvas;
    const screen = document.getElementById('screen');
    if (!c || !screen) return;
    // match the world canvas's size on screen, at the screen's resolution
    const w = screen.clientWidth;
    const h = screen.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.max(2, Math.round(w * dpr));
    const bh = Math.max(2, Math.round(h * dpr));
    if (c.width !== bw || c.height !== bh) {
      c.width = bw;
      c.height = bh;
    }
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    const target = this.filter ? this.pic : c;
    if (target.width !== bw || target.height !== bh) {
      target.width = bw;
      target.height = bh;
    }
    const g = target.getContext('2d');
    if (!g) return;
    drawGarden(g, this.flowers, this.now(), bw / 640, true);
    if (this.filter) {
      this.filter.cell = CELLS[this.cellIdx] * dpr;
      this.filter.render(this.pic);
    }
  }

  onPointer(e: PointerEvt): void {
    if (e.phase !== 'down') return;
    // right click picks the nearest flower
    if (e.button === 2) {
      let best = -1;
      let bd = 40 * 40;
      this.flowers.forEach((f, i) => {
        const d = (f.x - e.x) ** 2 + (f.y - e.y) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      if (best >= 0) this.flowers.splice(best, 1);
      this.count();
      return;
    }
    const size = this.kind === 'lily' ? 26 + this.ctx.brush() : 16 + this.ctx.brush() * 0.6;
    this.flowers.push(plantAt(this.kind, e.x, e.y, size, this.now(), this.seed++ * 7919));
    this.ctx.sfx.place();
    this.count();
  }

  private count(): void {
    this.ctx.hud.setParticles(this.flowers.length);
  }

  makeBouquet(quiet = false): void {
    this.flowers = bouquet(this.seed++ * 104729, this.now());
    this.count();
    if (quiet) return;
    this.ctx.sfx.ui();
    this.ctx.toast('A NEW BOUQUET');
  }

  private clear(): void {
    this.flowers = [];
    this.count();
    this.ctx.sfx.ui();
  }

  private toggleAscii(): void {
    if (!this.filter) {
      this.ctx.toast('THE TEXT FILTER NEEDS WEBGL2', true);
      return;
    }
    this.filter.ascii = !this.filter.ascii;
    this.ctx.hud.setLamp('ascii', this.filter.ascii);
    this.ctx.sfx.ui();
  }

  private cycleCell(): void {
    this.cellIdx = (this.cellIdx + 1) % CELLS.length;
    this.ctx.sfx.ui();
    this.ctx.toast(`GLYPHS ${CELLS[this.cellIdx]} PX`);
  }

  leave(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.filter?.dispose();
    this.filter = null;
    this.canvas?.remove();
    this.canvas = null;
    document.body.classList.remove('garden-on');
  }

  cursor(): CursorLook {
    return { m: 0, k: 'b' };
  }
}

