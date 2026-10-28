import { MATS, Mat } from '../sim/materials';
import { rampGradient } from './hud';
import { LAB_ELEMENTS } from '../modes/chem';

const SYMBOL = new Map([...LAB_ELEMENTS].map(([sym, m]) => [m, sym]));

/**
 * What the cursor is over, named beside it: many materials share a colour
 * (a dozen metals are grey), so pointing at one is the way to tell. The sim
 * lives in the worker, so the tag asks it (`probe`) for the cell under the
 * pointer and shows the answer - on every move to a new cell, and once a
 * frame while it rests, since sand flows past a still cursor.
 *
 * Pure DOM over the canvas, pointer-events none - it never sees a click.
 */
export class HoverTag {
  private el: HTMLElement | null = null;
  private chip: HTMLElement | null = null;
  private text: HTMLElement | null = null;
  private wrap: HTMLElement | null = null;
  private px = 0;
  private py = 0;
  private cx = -1;
  private cy = -1;
  private clientX = 0;
  private clientY = 0;
  private inside = false;

  constructor(
    /** ask the worker for the cell at (x, y); its answer comes back through answer() */
    private probe: (x: number, y: number) => void,
    /** whether the screen showing is a world of cells: the sandbox or the chem lab, being played */
    private enabled: () => boolean,
    /** the world's size in cells */
    private size: { w: number; h: number },
    /** a 3D view showing the world answers itself, at once; null: none is showing */
    private pick: (clientX: number, clientY: number) => number | null = () => null,
  ) {}

  /** A frame came in: look again at what is under a resting cursor. */
  tick(): void {
    this.ensure();
    this.ask();
  }

  /** The worker's answer: the material at the cell last asked about. */
  answer(m: number): void {
    this.render(this.inside ? m : null);
  }

  private ask(): void {
    if (!this.inside) return;
    if (!this.enabled()) return this.render(null);
    const m = this.pick(this.clientX, this.clientY);
    if (m !== null) return this.render(m);
    this.probe(this.cx, this.cy);
  }

  private ensure(): void {
    if (this.el) return;
    const wrap = document.getElementById('screen-wrap');
    const canvas = document.getElementById('screen');
    if (!wrap || !canvas) return;
    this.wrap = wrap;
    const el = document.createElement('div');
    el.id = 'hover-tag';
    el.setAttribute('aria-hidden', 'true');
    this.chip = document.createElement('span');
    this.chip.className = 'hover-chip';
    this.text = document.createElement('span');
    el.append(this.chip, this.text);
    wrap.appendChild(el);
    this.el = el;
    wrap.addEventListener('pointermove', (e) => {
      const w = wrap.getBoundingClientRect();
      const r = canvas.getBoundingClientRect();
      this.clientX = e.clientX;
      this.clientY = e.clientY;
      this.px = e.clientX - w.left;
      this.py = e.clientY - w.top;
      // over a canvas, not a button drawn on one (the 3D view's camera pill)
      this.inside =
        (e.target as Element).tagName === 'CANVAS' &&
        e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom;
      const cx = Math.floor(((e.clientX - r.left) / r.width) * this.size.w);
      const cy = Math.floor(((e.clientY - r.top) / r.height) * this.size.h);
      if (!this.inside) this.render(null);
      else if (cx !== this.cx || cy !== this.cy) {
        this.cx = cx;
        this.cy = cy;
        this.ask();
      } else this.place();
    });
    wrap.addEventListener('pointerleave', () => {
      this.inside = false;
      this.render(null);
    });
  }

  private render(m: number | null): void {
    const el = this.el;
    if (!el || !this.chip || !this.text) return;
    if (m === null || m === Mat.EMPTY || !MATS[m] || !this.enabled()) {
      el.classList.remove('on');
      return;
    }
    this.text.textContent = matLabel(m, SYMBOL.get(m));
    this.chip.style.background = rampGradient(MATS[m].ramp);
    el.classList.add('on');
    this.place();
  }

  /** beside the cursor, flipped to its left near the right edge so it stays on screen */
  private place(): void {
    const el = this.el;
    if (!el || !this.wrap) return;
    const flip = this.px + 18 + el.offsetWidth > this.wrap.clientWidth;
    const x = flip ? this.px - 14 - el.offsetWidth : this.px + 18;
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(this.py + 16)}px)`;
  }
}

/** A material as a person would say it: "Iodine gas", "Silver"; an element with its symbol, "Sodium Na". */
export function matLabel(m: number, symbol?: string): string {
  const n = MATS[m].name.replace(/_/g, ' ').toLowerCase();
  const name = n[0].toUpperCase() + n.slice(1);
  return symbol ? `${name} ${symbol}` : name;
}
