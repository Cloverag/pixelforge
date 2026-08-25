import { SIM_H, SIM_W } from '../sim/protocol';

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private stage: HTMLElement;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.stage = document.getElementById('stage')!;
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize(): void {
    const rect = this.stage.getBoundingClientRect();
    const availW = rect.width - 16;
    const availH = rect.height - 16;
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
      this.canvas.style.translate = `${dx.toFixed(1)}px ${dy.toFixed(1)}px`;
    } else {
      this.canvas.style.translate = '0px 0px';
    }
  }
}
