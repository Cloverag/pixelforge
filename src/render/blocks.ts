import { MATS, Mat } from '../sim/materials';
import { SIM_H, SIM_W } from '../sim/protocol';

/** The colour the worker fills empty cells with (see World.renderInto). */
const EMPTY = MATS[Mat.EMPTY].ramp[0];
/** Grout between tiles in block mode. ABGR for #050509. */
const GAP = 0xff090505;

/** Block sizes the GRID button cycles through, in simulation cells. */
export const BLOCK_SIZES = [4, 8, 16] as const;

/**
 * Coarsens a frame into chunky tiles with grout between them.
 *
 * The simulation still runs at full 640x360; only the presentation changes, so
 * nothing about the physics differs when this is on. A tile takes the colour
 * of the first non-empty cell it covers rather than a majority vote, so a
 * one-cell-wide water stream still lights its tile instead of disappearing
 * into the background.
 *
 * Lives in its own module because both the 2D and the WebGL renderer need it
 * and neither owns it.
 */
export class Blockifier {
  private img: ImageData | null = null;
  private pix: Uint32Array | null = null;
  /** one band of tiles, built once per block row then copied down its rows */
  private rowTpl: Uint32Array | null = null;

  apply(buf: ArrayBuffer, b: number): ImageData {
    if (!this.img) {
      this.img = new ImageData(SIM_W, SIM_H);
      this.pix = new Uint32Array(this.img.data.buffer);
      this.rowTpl = new Uint32Array(SIM_W);
    }
    const src = new Uint32Array(buf);
    const out = this.pix!;
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
    return this.img!;
  }
}

/** Sum of a box's horizontal / vertical padding + border, in CSS pixels. */
export function chrome(el: HTMLElement): { w: number; h: number } {
  const cs = getComputedStyle(el);
  const n = (v: string) => parseFloat(v) || 0;
  return {
    w: n(cs.paddingLeft) + n(cs.paddingRight) + n(cs.borderLeftWidth) + n(cs.borderRightWidth),
    h: n(cs.paddingTop) + n(cs.paddingBottom) + n(cs.borderTopWidth) + n(cs.borderBottomWidth),
  };
}

/**
 * CSS size the canvas should take to fill the stage.
 *
 * Snaps to an integer scale only when that costs less than ~12% of the
 * available area, which keeps pixels even without leaving a wide letterbox.
 */
export function fitSize(stage: HTMLElement, bezel: HTMLElement | null): { w: number; h: number } {
  const rect = stage.getBoundingClientRect();
  const pad = bezel ? chrome(bezel) : { w: 0, h: 0 };
  // immersive mode fills the window edge to edge, so no margin and no
  // snapping to a whole scale (snapping left 1440x900 at 2x with wide bars)
  const immersive = document.body.classList.contains('immersive');
  const margin = immersive ? 0 : 16;
  const availW = rect.width - margin - pad.w;
  const availH = rect.height - margin - pad.h;
  const fit = Math.min(availW / SIM_W, availH / SIM_H);
  let scale = fit;
  if (fit >= 2 && !immersive) {
    const snapped = Math.floor(fit);
    scale = fit - snapped < fit * 0.12 ? snapped : fit;
  }
  scale = Math.max(0.5, scale);
  return { w: Math.floor(SIM_W * scale), h: Math.floor(SIM_H * scale) };
}
