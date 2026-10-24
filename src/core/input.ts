import { SIM_H, SIM_W } from '../sim/protocol';
export interface PointerEvt {
  x: number;
  y: number;
  sx: number;
  sy: number;
  button: number;
  phase: 'down' | 'move' | 'up';
}

export class Input {
  private dragging = false;
  private activeBtn = 0;
  private lastX = -1;
  private lastY = -1;

  constructor(
    private canvas: HTMLCanvasElement,
    private onPointer: (e: PointerEvt) => void,
    private onKey: (k: string) => void,
    private onWheel: (dy: number) => void,
  ) {
    canvas.addEventListener('pointerdown', this.pd);
    window.addEventListener('pointermove', this.pm);
    window.addEventListener('pointerup', this.pu);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.onWheel(Math.sign(e.deltaY));
    }, { passive: false });
    window.addEventListener('keydown', this.kd);
  }

  private toSim(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    // in cells: the canvas may draw at the screen's resolution, the world is SIM_W x SIM_H
    const x = ((e.clientX - r.left) / r.width) * SIM_W;
    const y = ((e.clientY - r.top) / r.height) * SIM_H;
    return { x: Math.floor(x), y: Math.floor(y) };
  }

  private pd = (e: PointerEvent) => {
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    this.dragging = true;
    this.activeBtn = e.button;
    const p = this.toSim(e);
    this.lastX = p.x;
    this.lastY = p.y;
    this.onPointer({ ...p, sx: e.clientX, sy: e.clientY, button: e.button, phase: 'down' });
  };

  private pm = (e: PointerEvent) => {
    if (!this.dragging) return;
    const p = this.toSim(e);
    if (p.x === this.lastX && p.y === this.lastY) return;
    this.lastX = p.x;
    this.lastY = p.y;
    this.onPointer({ ...p, sx: e.clientX, sy: e.clientY, button: this.activeBtn, phase: 'move' });
  };

  private pu = (e: PointerEvent) => {
    if (!this.dragging) return;
    this.dragging = false;
    const p = this.toSim(e);
    this.onPointer({ ...p, sx: e.clientX, sy: e.clientY, button: this.activeBtn, phase: 'up' });
  };

  private kd = (e: KeyboardEvent) => {
    if (e.repeat) return;
    this.onKey(e.key.toLowerCase());
  };
}
