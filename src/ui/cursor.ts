import { SIM_W } from '../sim/protocol';
import type { PaintKind } from '../sim/protocol';

/**
 * A ring on the canvas showing exactly what the brush will touch.
 *
 * The brush size used to live only in a slider and a dot in the toolbar, so
 * the first stroke at a new size was always a guess. The ring is sized from
 * the same rule World.paint uses (radius = size >> 1, in cells) and snapped to
 * the cell grid, so what it outlines is what gets painted. WIND blows over a
 * wider radius (World.blow: max(10, size * 3)), so it gets its own dashed
 * ring; BUCKET fills a region, so it gets a point marker instead of a size.
 *
 * Pure DOM over the canvas, pointer-events none - it never sees a click.
 */
export class BrushCursor {
  private el: HTMLElement | null = null;
  private wrap: HTMLElement | null = null;
  private size = 6;
  private mode: PaintKind = 'brush';
  private lastX = 0;
  private lastY = 0;
  private inside = false;

  setSize(n: number): void {
    this.size = n;
    this.place();
  }

  setMode(m: PaintKind): void {
    this.mode = m;
    if (this.el) this.el.dataset.mode = m;
    this.place();
  }

  /** Attach on first use, so the HUD can own one before the DOM is laid out. */
  private ensure(): boolean {
    if (this.el) return true;
    const wrap = document.getElementById('screen-wrap');
    if (!wrap) return false;
    this.wrap = wrap;
    const el = document.createElement('div');
    el.id = 'brush-ring';
    el.dataset.mode = this.mode;
    el.setAttribute('aria-hidden', 'true');
    wrap.appendChild(el);
    this.el = el;
    wrap.addEventListener('pointermove', (e) => {
      const r = wrap.getBoundingClientRect();
      this.lastX = e.clientX - r.left;
      this.lastY = e.clientY - r.top;
      this.inside = true;
      this.place();
    });
    wrap.addEventListener('pointerleave', () => {
      this.inside = false;
      this.place();
    });
    return true;
  }

  private place(): void {
    if (!this.ensure() || !this.el || !this.wrap) return;
    const view3d = document.getElementById('view3d');
    const hidden = !this.inside || (view3d !== null && !view3d.classList.contains('hidden'));
    this.el.style.opacity = hidden ? '0' : '1';
    if (hidden) return;
    const canvas = this.wrap.querySelector('canvas#screen') as HTMLCanvasElement | null;
    const cell = (canvas?.clientWidth ?? this.wrap.clientWidth) / SIM_W;
    // snap the centre to the middle of the cell under the pointer
    const cx = (Math.floor(this.lastX / cell) + 0.5) * cell;
    const cy = (Math.floor(this.lastY / cell) + 0.5) * cell;
    let d: number;
    if (this.mode === 'wind') d = Math.max(10, this.size * 3) * 2 * cell;
    else if (this.mode === 'flood') d = 10;
    else d = ((this.size >> 1) * 2 + 1) * cell;
    this.el.style.width = `${d}px`;
    this.el.style.height = `${d}px`;
    this.el.style.transform = `translate(${(cx - d / 2).toFixed(1)}px, ${(cy - d / 2).toFixed(1)}px)`;
  }
}
