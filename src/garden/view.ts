import { AsciiFilter } from './ascii';
import { buildBloom, drawBloom, type BloomScene } from './bloom';
import { drawGarden } from './draw';
import { drawEye, EYE_PALETTES, eyeTextMask } from './eye';
import { bouquet, type Flower } from './flowers';
import { buildLilies, drawLilies, type LilyScene } from './lily3d';
import type { MathRun } from '../mathlab/run';

export type GardenScene = 'flowers' | 'eye' | 'lily3d' | 'bloom' | 'math';

/**
 * The garden's picture: its own canvas laid over the world's, sized to it,
 * drawing one of three scenes - flowers you plant, the eye of words, the 3D
 * lilies - through the ASCII filter (or not). The garden mode drives it in
 * game; the title screen mounts one too, as the preview behind its list.
 */
export class GardenView {
  scene: GardenScene = 'flowers';
  flowers: Flower[] = [];
  /** where the eye looks, -1..1 */
  gaze = { x: 0, y: 0 };
  palette = 0;
  cellPx = 8;
  /** MATH LAB's drawing, and the share of the width it gets (the code panel has the rest) */
  math: MathRun | null = null;
  mathWidth = 1;
  /** told the code line being drawn whenever it changes (-1: finished) */
  onLine: ((line: number) => void) | null = null;
  private line = -2;
  private canvas: HTMLCanvasElement | null = null;
  private pic = document.createElement('canvas');
  private filter: AsciiFilter | null = null;
  private raf = 0;
  private t0 = performance.now();
  /** when the current scene began (the 3D lilies build from it) */
  private sceneT0 = 0;
  private mask: HTMLCanvasElement | null = null;
  private lilies: LilyScene | null = null;
  private bloom: BloomScene | null = null;

  constructor(private bodyClass: string) {}

  now(): number {
    return (performance.now() - this.t0) / 1000;
  }

  get ascii(): boolean {
    return this.filter?.ascii ?? false;
  }
  set ascii(on: boolean) {
    if (this.filter) this.filter.ascii = on;
  }
  get hasFilter(): boolean {
    return this.filter !== null;
  }

  setScene(s: GardenScene, seed = 1): void {
    this.scene = s;
    this.sceneT0 = this.now();
    if (s === 'lily3d') this.lilies = buildLilies(seed);
    if (s === 'bloom') this.bloom = buildBloom(seed);
    if (s === 'flowers' && this.flowers.length === 0) this.flowers = bouquet(seed, this.now());
  }

  mounted(): boolean {
    return this.canvas !== null;
  }

  mount(): void {
    const wrap = document.getElementById('screen-wrap');
    if (!wrap || this.canvas) return;
    const c = document.createElement('canvas');
    c.className = 'garden-canvas';
    wrap.appendChild(c);
    this.canvas = c;
    try {
      this.filter = new AsciiFilter(c);
    } catch {
      this.filter = null; // no WebGL2: the drawings, without the text
    }
    document.body.classList.add(this.bodyClass);
    window.addEventListener('pointermove', this.onMove);
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.draw();
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** The eye follows the pointer wherever it is, held or not. */
  private onMove = (e: PointerEvent): void => {
    const r = document.getElementById('screen')?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    this.gaze = { x: clamp(((e.clientX - r.left) / r.width) * 2 - 1), y: clamp(((e.clientY - r.top) / r.height) * 2 - 1) };
  };

  unmount(): void {
    window.removeEventListener('pointermove', this.onMove);
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.filter?.dispose();
    this.filter = null;
    this.canvas?.remove();
    this.canvas = null;
    document.body.classList.remove(this.bodyClass);
  }

  private draw(): void {
    const c = this.canvas;
    const screen = document.getElementById('screen');
    if (!c || !screen) return;
    // match the world canvas on screen, at the screen's resolution
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
      this.mask = null;
    }
    const g = target.getContext('2d');
    if (!g) return;
    const now = this.now();
    if (this.scene === 'eye') {
      // with the text filter on, the eye's own words would be lost in the
      // glyphs: draw it in fewer, bigger letters there
      const size = Math.round(bh / (this.filter?.ascii ? 34 : 60));
      if (!this.mask || this.mask.dataset.size !== String(size)) {
        this.mask = eyeTextMask(bw, bh, size);
        this.mask.dataset.size = String(size);
      }
      drawEye(g, this.mask, bw, bh, now - this.sceneT0, this.gaze.x, this.gaze.y, EYE_PALETTES[this.palette % EYE_PALETTES.length]);
    } else if (this.scene === 'math' && this.math) {
      const line = this.math.draw(g, bw, bh, bw * this.mathWidth);
      if (line !== this.line) this.onLine?.((this.line = line));
    } else if (this.scene === 'bloom' && this.bloom) {
      drawBloom(g, this.bloom, bw, bh, now - this.sceneT0);
    } else if (this.scene === 'lily3d' && this.lilies) {
      drawLilies(g, this.lilies, bw, bh, now - this.sceneT0);
    } else {
      drawGarden(g, this.flowers, now, bw / 640, true);
    }
    if (this.filter) {
      this.filter.cell = this.cellPx * dpr;
      this.filter.render(this.pic);
    }
  }
}
