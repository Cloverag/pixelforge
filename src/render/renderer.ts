import { SIM_H, SIM_W } from '../sim/protocol';

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

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.stage = document.getElementById('stage')!;
    this.bezel = document.getElementById('bezel');
    this.shakeTarget = this.bezel ?? canvas;
    window.addEventListener('resize', () => this.resize());
    this.resize();
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

  present(buf: ArrayBuffer, shake: number): void {
    const u8 = new Uint8ClampedArray(buf);
    const img = new ImageData(u8, SIM_W, SIM_H);
    this.ctx.putImageData(img, 0, 0);
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
