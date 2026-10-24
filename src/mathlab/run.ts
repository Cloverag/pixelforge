import type { Stroke } from './drawings';

/**
 * One drawing being drawn: a batch of strokes each frame onto a canvas that
 * keeps them, so even 50 000 strokes cost only the new ones. The strokes are
 * fitted to the area they are given, whatever their own size.
 */
export class MathRun {
  /** how many strokes are on the canvas */
  done = 0;
  /**
   * 3D: the drawing lifted into space, each stroke as high as it is late
   * in the drawing, seen from a camera that turns (drag to turn it).
   */
  view3d = false;
  private yaw = 0.6;
  private pitch = 0.9;
  private pic = document.createElement('canvas');
  private box: { x0: number; y0: number; x1: number; y1: number };

  constructor(
    readonly strokes: Stroke[],
    /** about how long the whole drawing takes, in seconds */
    private seconds = 8,
  ) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of strokes) {
      x0 = Math.min(x0, s.x1, s.x2);
      x1 = Math.max(x1, s.x1, s.x2);
      y0 = Math.min(y0, s.y1, s.y2);
      y1 = Math.max(y1, s.y1, s.y2);
    }
    this.box = strokes.length ? { x0, y0, x1, y1 } : { x0: -1, y0: -1, x1: 1, y1: 1 };
  }

  get finished(): boolean {
    return this.done >= this.strokes.length;
  }

  turn(dyaw: number, dpitch: number): void {
    this.yaw += dyaw;
    this.pitch += dpitch;
  }

  /** Straight to the end. */
  finish(): void {
    this.seconds = 0;
  }

  /**
   * Draw the next batch and show the picture on `g` (w x h), fitted into the
   * left `aw` pixels. Returns the code line of the last stroke drawn, or -1
   * once it is finished.
   */
  draw(g: CanvasRenderingContext2D, w: number, h: number, aw: number): number {
    const per = this.seconds > 0 ? Math.ceil(this.strokes.length / (60 * this.seconds)) : this.strokes.length;
    const from = this.done;
    this.done = Math.min(this.strokes.length, this.done + per);
    const line = this.finished || this.done === 0 ? -1 : this.strokes[this.done - 1].line;
    const p = this.pic;
    if (this.view3d) {
      // the kept picture is flat; in 3D every stroke is redrawn each frame
      this.draw3d(g, w, h, aw);
      p.width = 0; // drop the flat picture: it is rebuilt when 3D goes off
      return line;
    }
    const pg = p.getContext('2d')!;
    if (p.width !== w || p.height !== h) {
      // a new size (or back from 3D): the picture again, at once up to where it is
      p.width = w;
      p.height = h;
      pg.fillStyle = '#000';
      pg.fillRect(0, 0, w, h);
      this.paint(pg, 0, this.done, h, aw);
    } else this.paint(pg, from, this.done, h, aw);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(p, 0, 0);
    return line;
  }

  private draw3d(g: CanvasRenderingContext2D, w: number, h: number, aw: number): void {
    const b = this.box;
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    const span = Math.max(b.x1 - b.x0, b.y1 - b.y0) || 1;
    const k = (Math.min(aw, h) * 0.62) / span;
    const H = span * 0.6; // how tall the stack of strokes stands
    if (!this.finished) this.yaw += 0.003;
    else this.yaw += 0.004;
    const sy = Math.sin(this.yaw), cyw = Math.cos(this.yaw), sp = Math.sin(this.pitch), cp = Math.cos(this.pitch);
    const n = Math.max(1, this.strokes.length - 1);
    const proj = (x: number, y: number, z: number): [number, number] => {
      const X = (x - cx) * cyw - (y - cy) * sy;
      const D = (x - cx) * sy + (y - cy) * cyw;
      return [aw / 2 + X * k, h / 2 - (z * cp - D * sp) * k];
    };
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    g.lineCap = 'round';
    for (let i = 0; i < this.done; i++) {
      const s = this.strokes[i];
      const z = (i / n - 0.5) * H;
      const [x1, y1] = proj(s.x1, s.y1, z);
      const [x2, y2] = proj(s.x2, s.y2, z);
      g.strokeStyle = s.col;
      g.lineWidth = Math.max(0.75, Math.min(s.w * k, s.w * 3));
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.stroke();
    }
  }

  private paint(g: CanvasRenderingContext2D, from: number, to: number, h: number, aw: number): void {
    const b = this.box;
    const m = 0.08;
    const k = Math.min((aw * (1 - 2 * m)) / (b.x1 - b.x0 || 1), (h * (1 - 2 * m)) / (b.y1 - b.y0 || 1));
    const ox = aw / 2 - ((b.x0 + b.x1) / 2) * k;
    const oy = h / 2 + ((b.y0 + b.y1) / 2) * k; // +y is up in the drawings
    g.lineCap = 'round';
    for (let i = from; i < to; i++) {
      const s = this.strokes[i];
      g.strokeStyle = s.col;
      // scaled with the drawing, but a curve drawn at r ~ 1 must not get 100-pixel lines
      g.lineWidth = Math.max(0.75, Math.min(s.w * k, s.w * 3));
      g.beginPath();
      g.moveTo(ox + s.x1 * k, oy - s.y1 * k);
      g.lineTo(ox + s.x2 * k, oy - s.y2 * k);
      g.stroke();
    }
  }
}
