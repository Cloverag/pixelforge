import { MATS, Mat } from '../sim/materials';
import { SIM_H, SIM_W } from '../sim/protocol';

/** The colour the worker fills empty cells with (see World.renderInto). */
const EMPTY = MATS[Mat.EMPTY].ramp[0];
/** Grout between tiles in block mode. ABGR for #050509. */
const GAP = 0xff090505;

/** Block sizes the GRID button cycles through, in simulation cells. */
export const BLOCK_SIZES = [4, 8, 16] as const;

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

/** Sum of a box's horizontal / vertical padding + border, in CSS pixels. */
function chrome(el: HTMLElement): { w: number; h: number } {
  const cs = getComputedStyle(el);
  const n = (v: string) => parseFloat(v) || 0;
  return {
    w: n(cs.paddingLeft) + n(cs.paddingRight) + n(cs.borderLeftWidth) + n(cs.borderRightWidth),
    h: n(cs.paddingTop) + n(cs.paddingBottom) + n(cs.borderTopWidth) + n(cs.borderBottomWidth),
  };
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private stage: HTMLElement;
  /** cabinet bezel around the screen; null if the shell markup is absent */
  private bezel: HTMLElement | null;
  /** what the screen-shake translates -- the whole cabinet if we have one */
  private shakeTarget: HTMLElement;

  /** block size in sim cells, or null for the normal 1:1 pixel view */
  private block: number | null = null;
  /** scratch frame reused across block-mode frames, so we allocate once */
  private blockImg: ImageData | null = null;
  private blockPix: Uint32Array | null = null;
  /** one band of tiles, built once per block row then copied down its rows */
  private rowTpl: Uint32Array | null = null;

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
    // back as the empty string; without the check the glow pass would draw
    // an unblurred copy and just wash the picture out
    this.ctx.filter = 'blur(1px)';
    this.canBlur = this.ctx.filter === 'blur(1px)';
    this.ctx.filter = 'none';
    this.stage = document.getElementById('stage')!;
    this.bezel = document.getElementById('bezel');
    this.shakeTarget = this.bezel ?? canvas;
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  /** Trails, glow and a smooth upscale, versus the hard arcade pixel look. */
  setSoft(on: boolean): void {
    this.soft = on;
    this.canvas.classList.toggle('hard-pixels', !on);
    // a mode switch would otherwise leave the last composite ghosting under
    // the new one
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.globalAlpha = 1;
    this.ctx.fillStyle = '#0b0b14';
    this.ctx.fillRect(0, 0, SIM_W, SIM_H);
  }

  isSoft(): boolean {
    return this.soft;
  }

  /** null restores the 1:1 pixel view; a number is the block edge in cells. */
  setBlockSize(n: number | null): void {
    this.block = n;
  }

  getBlockSize(): number | null {
    return this.block;
  }

  resize(): void {
    const rect = this.stage.getBoundingClientRect();
    // the canvas has to fit inside the bezel, which sits inside the stage
    const pad = this.bezel ? chrome(this.bezel) : { w: 0, h: 0 };
    const availW = rect.width - 16 - pad.w;
    const availH = rect.height - 16 - pad.h;
    const fit = Math.min(availW / SIM_W, availH / SIM_H);
    // fill as much space as possible; snap to integer scale only when it
    // costs less than ~12% of the available area (keeps pixels even)
    let scale = fit;
    if (fit >= 2) {
      const snapped = Math.floor(fit);
      scale = fit - snapped < fit * 0.12 ? snapped : fit;
    }
    scale = Math.max(0.5, scale);
    this.canvas.style.width = `${Math.floor(SIM_W * scale)}px`;
    this.canvas.style.height = `${Math.floor(SIM_H * scale)}px`;
  }

  /**
   * Lays the frame over the last one with two passes.
   *
   * putImageData cannot blend - it overwrites - so the frame goes to a
   * scratch canvas first and comes back through drawImage, which can. The
   * first pass at alpha TRAIL leaves a fading tail behind anything moving;
   * the second is an additive blurred copy, so bright cells bleed into their
   * neighbours and the near-black background contributes almost nothing.
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

  /**
   * Redraws the frame as chunky tiles with grout between them. The simulation
   * still runs at full 640x360; only the presentation is coarsened, so nothing
   * about the physics changes when this is on.
   *
   * A tile takes the colour of the first non-empty cell it covers rather than
   * a majority vote, so a one-cell-wide water stream still lights its tile
   * instead of disappearing into the background.
   */
  private toBlocks(buf: ArrayBuffer, b: number): ImageData {
    if (!this.blockImg) {
      this.blockImg = new ImageData(SIM_W, SIM_H);
      this.blockPix = new Uint32Array(this.blockImg.data.buffer);
      this.rowTpl = new Uint32Array(SIM_W);
    }
    const src = new Uint32Array(buf);
    const out = this.blockPix!;
    const tpl = this.rowTpl!;
    const gap = b >= 16 ? 2 : 1;

    for (let by = 0; by < SIM_H; by += b) {
      const yEnd = Math.min(by + b, SIM_H);

      for (let bx = 0; bx < SIM_W; bx += b) {
        const xEnd = Math.min(bx + b, SIM_W);
        let color = EMPTY;
        scan: for (let y = by; y < yEnd; y++) {
          const row = y * SIM_W;
          for (let x = bx; x < xEnd; x++) {
            const c = src[row + x];
            if (c !== EMPTY) {
              color = c;
              break scan;
            }
          }
        }
        // right edge of the tile becomes grout
        const solidX = Math.max(bx, xEnd - gap);
        tpl.fill(color, bx, solidX);
        tpl.fill(GAP, solidX, xEnd);
      }

      // every row in the band is identical except the grout rows at its foot
      const solidY = Math.max(by, yEnd - gap);
      for (let y = by; y < solidY; y++) out.set(tpl, y * SIM_W);
      for (let y = solidY; y < yEnd; y++) out.fill(GAP, y * SIM_W, y * SIM_W + SIM_W);
    }
    return this.blockImg!;
  }

  present(buf: ArrayBuffer, shake: number): void {
    const img = this.block
      ? this.toBlocks(buf, this.block)
      : new ImageData(new Uint8ClampedArray(buf), SIM_W, SIM_H);
    if (this.soft) this.composite(img);
    else this.ctx.putImageData(img, 0, 0);
    if (shake > 0) {
      const mag = Math.min(8, shake / 3);
      const dx = (Math.random() * 2 - 1) * mag;
      const dy = (Math.random() * 2 - 1) * mag;
      this.shakeTarget.style.translate = `${dx.toFixed(1)}px ${dy.toFixed(1)}px`;
    } else {
      this.shakeTarget.style.translate = '0px 0px';
    }
  }
}
