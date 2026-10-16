import { MATS } from '../sim/materials';
import { SIM_H, SIM_W } from '../sim/protocol';
import type { CursorMsg } from '../net/presence';

/**
 * Other players' cursors, drawn as DOM over the canvas: a ring in the
 * player's colour with their name, which grows to their brush size and
 * takes their material's colour while they paint. Positions arrive ~20 times
 * a second; a short CSS transition smooths the steps between them.
 */

/** a cursor that has not moved in this long fades out */
const STALE_MS = 4000;

interface Remote {
  el: HTMLElement;
  ring: HTMLElement;
  label: HTMLElement;
  seen: number;
}

/** ABGR ramp colour -> CSS */
function css(abgr: number): string {
  return `rgb(${abgr & 255}, ${(abgr >>> 8) & 255}, ${(abgr >>> 16) & 255})`;
}

export class CursorLayer {
  private remotes = new Map<string, Remote>();
  private timer: ReturnType<typeof setInterval> | null = null;

  private host(): HTMLElement {
    return document.getElementById('stage') ?? document.body;
  }

  update(id: string, c: CursorMsg | null): void {
    if (!c) {
      this.remove(id);
      return;
    }
    let r = this.remotes.get(id);
    if (!r) {
      const el = document.createElement('div');
      el.className = 'peer-cursor';
      const ring = document.createElement('div');
      ring.className = 'peer-ring';
      const label = document.createElement('div');
      label.className = 'peer-name';
      el.append(ring, label);
      this.host().appendChild(el);
      r = { el, ring, label, seen: 0 };
      this.remotes.set(id, r);
      this.timer ??= setInterval(() => this.sweep(), 1000);
    }
    r.seen = performance.now();
    // name and colour first: an idle player's cursor arrives hidden, and it
    // must still say who it is when it shows
    r.label.textContent = c.n;
    r.label.style.background = c.c;
    const canvas = document.getElementById('screen') as HTMLCanvasElement | null;
    const stage = this.host();
    if (!canvas || c.hidden) {
      r.el.classList.add('gone');
      return;
    }
    const cr = canvas.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    const px = cr.left - sr.left + ((c.x + 0.5) / SIM_W) * cr.width;
    const py = cr.top - sr.top + ((c.y + 0.5) / SIM_H) * cr.height;
    const cell = cr.width / SIM_W;
    // the brush is a disc of radius ~size/2 cells; never smaller than a dot
    const d = c.d ? Math.max(10, c.s * cell) : 12;
    r.el.classList.remove('gone');
    r.el.style.transform = `translate(${px}px, ${py}px)`;
    r.ring.style.width = r.ring.style.height = `${d}px`;
    const paint = c.d && MATS[c.m] ? css(MATS[c.m].ramp[0]) : c.c;
    r.ring.style.borderColor = paint;
    r.ring.style.boxShadow = `0 0 8px ${paint}`;
    r.ring.classList.toggle('painting', c.d);
  }

  private sweep(): void {
    const now = performance.now();
    for (const r of this.remotes.values()) if (now - r.seen > STALE_MS) r.el.classList.add('gone');
  }

  private remove(id: string): void {
    this.remotes.get(id)?.el.remove();
    this.remotes.delete(id);
  }

  clear(): void {
    for (const id of [...this.remotes.keys()]) this.remove(id);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
