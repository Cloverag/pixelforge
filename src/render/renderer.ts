import { SIM_H, SIM_W } from '../sim/protocol';
import { Blockifier, fitSize } from './blocks';

export { BLOCK_SIZES } from './blocks';

/**
 * What main.ts talks to. Two implementations: this 2D canvas one, and the
 * WebGL2 one in glrenderer.ts which adds the GPU fluid. The GL one is picked
 * at boot when the context and float render targets are available, because a
 * canvas only ever gets one context type and the choice cannot be revisited.
 */
export interface SimRenderer {
  present(buf: ArrayBuffer): void;
  resize(): void;
  setBlockSize(n: number | null): void;
  getBlockSize(): number | null;
  setSoft(on: boolean): void;
  isSoft(): boolean;
  /** Feeds the fluid. The 2D renderer has no fluid and ignores it. */
  setFluidInputs(
    mat: Uint8Array | null,
    matW: number,
    matH: number,
    wind: Float32Array | null,
  ): void;
  /** Clears accumulated visual state, e.g. on world clear or a level load. */
  reset(): void;
  /** Film look for the playground; only the WebGL renderer has one. */
  setCinematic?(on: boolean): void;
}

/**
 * SOFT mode: how much of the new frame is laid over the last one. Below 1 the
 * previous frame shows through, so anything moving leaves a short fading tail
 * and the whole picture stops looking like a flip-book of stills.
 */
const TRAIL = 0.55;
/** Strength of the additive blurred pass that makes bright cells bleed. */
const GLOW = 0.24;
/** Blur radius of that pass, in canvas pixels. */
const GLOW_BLUR = 2.2;

export class Renderer implements SimRenderer {
  private ctx: CanvasRenderingContext2D;
  private stage: HTMLElement;
  /** the framed box around the screen; null if the shell markup is absent */
  private frame: HTMLElement | null;

  /** block size in sim cells, or null for the normal 1:1 pixel view */
  private block: number | null = null;
  private blocks = new Blockifier();

  /** scratch canvas holding the raw sim frame, so it can be composited */
  private off: HTMLCanvasElement;
  private offCtx: CanvasRenderingContext2D;
  /** trails + glow + smooth upscale; off restores the hard pixel look */
  private soft = true;
  /** whether this browser honours ctx.filter (Safari < 17 does not) */
  private canBlur: boolean;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.off = document.createElement('canvas');
    this.off.width = SIM_W;
    this.off.height = SIM_H;
    this.offCtx = this.off.getContext('2d', { alpha: false })!;
    // ctx.filter is unimplemented on older Safari, where it silently reads
    // back as the empty string; without the check the glow pass would draw an
    // unblurred copy and just wash the picture out
    this.ctx.filter = 'blur(1px)';
    this.canBlur = this.ctx.filter === 'blur(1px)';
    this.ctx.filter = 'none';
    this.stage = document.getElementById('stage')!;
    this.frame = document.getElementById('viewport');
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  /** Trails, glow and a smooth upscale, versus the hard arcade pixel look. */
  setSoft(on: boolean): void {
    this.soft = on;
    this.canvas.classList.toggle('hard-pixels', !on);
    this.reset();
  }

  isSoft(): boolean {
    return this.soft;
  }

  /** No fluid on this path; the method exists so main.ts stays uniform. */
  setFluidInputs(): void {
    /* nothing to feed */
  }

  reset(): void {
    // a mode switch would otherwise leave the last composite ghosting under
    // the new one
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.globalAlpha = 1;
    this.ctx.filter = 'none';
    this.ctx.fillStyle = '#0b0b14';
    this.ctx.fillRect(0, 0, SIM_W, SIM_H);
  }

  /** null restores the 1:1 pixel view; a number is the block edge in cells. */
  setBlockSize(n: number | null): void {
    this.block = n;
  }

  getBlockSize(): number | null {
    return this.block;
  }

  resize(): void {
    const { w, h } = fitSize(this.stage, this.frame);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  /**
   * Lays the frame over the last one with two passes.
   *
   * putImageData cannot blend - it overwrites - so the frame goes to a scratch
   * canvas first and comes back through drawImage, which can. The first pass
   * at alpha TRAIL leaves a fading tail behind anything moving; the second is
   * an additive blurred copy, so bright cells bleed into their neighbours and
   * the near-black background contributes almost nothing.
   */
  private composite(img: ImageData): void {
    this.offCtx.putImageData(img, 0, 0);
    const c = this.ctx;
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = TRAIL;
    c.drawImage(this.off, 0, 0);
    c.globalAlpha = GLOW;
    c.globalCompositeOperation = 'lighter';
    if (this.canBlur) c.filter = `blur(${GLOW_BLUR}px)`;
    c.drawImage(this.off, 0, 0);
    if (this.canBlur) c.filter = 'none';
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }

  present(buf: ArrayBuffer): void {
    const img = this.block
      ? this.blocks.apply(buf, this.block)
      : new ImageData(new Uint8ClampedArray(buf), SIM_W, SIM_H);
    if (this.soft) this.composite(img);
    else this.ctx.putImageData(img, 0, 0);
  }
}
