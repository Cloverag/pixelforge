import type { PointerEvt } from '../core/input';
import type { ModeCtx } from './types';

/**
 * A brush stroke: each pointer move paints the line from the last point, so
 * a fast drag leaves a continuous trail instead of a string of dots.
 */
export class Stroke {
  private last: { x: number; y: number } | null = null;

  constructor(private ctx: ModeCtx) {}

  end(): void {
    this.last = null;
  }

  /** Paint `mat` (Mat.EMPTY erases) along the stroke for this event. */
  at(e: PointerEvt, mat: number): void {
    if (e.phase === 'up') {
      this.last = null;
      return;
    }
    const pts = this.last && e.phase === 'move' ? this.line(this.last.x, this.last.y, e.x, e.y) : [e.x, e.y];
    if (pts.length === 0) return;
    this.last = { x: e.x, y: e.y };
    const c = this.ctx;
    c.send({ k: 'paint', pts, mat, size: c.brush(), kind: c.paintKind() });
    c.sfx.place();
    c.nudge(); // visual feedback while paused
  }

  private line(x0: number, y0: number, x1: number, y1: number): number[] {
    const pts: number[] = [];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dist = Math.max(Math.abs(dx), Math.abs(dy));
    const steps = Math.max(1, Math.floor(dist / Math.max(1, this.ctx.brush() >> 2)));
    for (let i = 1; i <= steps; i++) {
      pts.push(Math.round(x0 + (dx * i) / steps), Math.round(y0 + (dy * i) / steps));
    }
    return pts;
  }
}
