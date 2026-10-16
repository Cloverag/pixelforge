import { MATS } from '../sim/materials';
import { SIM_H, SIM_W } from '../sim/protocol';
import type { CursorMsg } from '../net/presence';

/**
 * Other players' cursors, drawn as DOM over the canvas.
 *
 * Each is a pointer arrow in the player's colour, a name tag, and a tool
 * mark centred on the tip that says what they are holding:
 *   brush - a ring the size of their brush, in their material's colour
 *   erase - a dashed ring
 *   wind  - a turning swirl
 *   fill  - a paint bucket
 * The mark is faint while they hover and solid while they paint, so you
 * can see what someone is about to do as well as what they are doing.
 * Positions arrive ~20 times a second; a short transition smooths them.
 */

/** a cursor that has not moved in this long fades out */
const STALE_MS = 4000;

const SVG = 'http://www.w3.org/2000/svg';

/** how long a reaction bubble stays on a cursor or avatar */
export const REACT_MS = 2600;

interface Remote {
  el: HTMLElement;
  bubble: HTMLElement | null;
  arrow: SVGPathElement;
  tool: HTMLElement;
  label: HTMLElement;
  seen: number;
  k: string;
}

/** ABGR ramp colour -> CSS */
function css(abgr: number): string {
  return `rgb(${abgr & 255}, ${(abgr >>> 8) & 255}, ${(abgr >>> 16) & 255})`;
}

function arrowSvg(): { svg: SVGSVGElement; path: SVGPathElement } {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'peer-arrow');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '22');
  svg.setAttribute('viewBox', '0 0 18 22');
  const path = document.createElementNS(SVG, 'path');
  // the classic pointer, tip at (1, 1)
  path.setAttribute('d', 'M1 1 L1 17 L5.2 13 L8.2 20 L11 18.8 L8.1 12 L14 12 Z');
  path.setAttribute('stroke', '#0b0b14');
  path.setAttribute('stroke-width', '1.6');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  return { svg, path };
}

/** the bucket glyph for the fill tool */
const BUCKET =
  '<svg viewBox="0 0 20 20" width="22" height="22">' +
  // handle, a tilted pail, and paint pouring from its lip
  '<path d="M5.5 7.5 Q3.5 2 9 2.5" fill="none" stroke="#0b0b14" stroke-width="1.6" stroke-linecap="round"/>' +
  '<path d="M3.5 8 L10.5 4 L15.5 12 L8.5 16 Z" fill="currentColor" stroke="#0b0b14" stroke-width="1.4" stroke-linejoin="round"/>' +
  '<path d="M3.5 8 L10.5 4" stroke="#fff" stroke-opacity="0.5" stroke-width="1"/>' +
  '<path d="M16.5 12.5 c1.3 1.9 1.9 3 1.9 3.8 a1.9 1.9 0 0 1 -3.8 0 c0 -.8 .6 -1.9 1.9 -3.8 z" fill="currentColor" stroke="#0b0b14" stroke-width="1.1"/>' +
  '</svg>';

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
      const tool = document.createElement('div');
      tool.className = 'peer-tool';
      const { svg, path } = arrowSvg();
      const label = document.createElement('div');
      label.className = 'peer-name';
      el.append(tool, svg, label);
      this.host().appendChild(el);
      r = { el, arrow: path, tool, label, seen: 0, k: '', bubble: null };
      this.remotes.set(id, r);
      this.timer ??= setInterval(() => this.sweep(), 1000);
    }
    r.seen = performance.now();
    // who first: an idle player's cursor arrives hidden, and must still say
    // who it is when it shows
    r.label.textContent = c.n;
    r.label.style.background = c.c;
    r.arrow.setAttribute('fill', c.c);
    r.el.style.color = c.c; // the reaction bubble's border

    const canvas = document.getElementById('screen') as HTMLCanvasElement | null;
    if (!canvas || c.hidden) {
      r.el.classList.add('gone');
      return;
    }
    const cr = canvas.getBoundingClientRect();
    const sr = this.host().getBoundingClientRect();
    const px = cr.left - sr.left + ((c.x + 0.5) / SIM_W) * cr.width;
    const py = cr.top - sr.top + ((c.y + 0.5) / SIM_H) * cr.height;
    r.el.classList.remove('gone');
    r.el.style.transform = `translate(${px}px, ${py}px)`;
    this.drawTool(r, c, cr.width / SIM_W);
  }

  private drawTool(r: Remote, c: CursorMsg, cell: number): void {
    const k = c.k ?? 'b';
    const t = r.tool;
    if (k !== r.k) {
      r.k = k;
      t.className = `peer-tool tool-${k}`;
      t.innerHTML = k === 'f' ? BUCKET : k === 'w' ? '<span></span><span></span><span></span>' : '';
    }
    t.classList.toggle('active', c.d);
    // brush-sized marks: the brush is a disc about `size` cells across
    const d = Math.max(12, c.s * cell);
    if (k === 'b' || k === 'e' || k === 'w') t.style.width = t.style.height = `${d}px`;
    const mat = MATS[c.m];
    const colour = k === 'b' && mat ? css(mat.ramp[0]) : k === 'e' ? '#ff8a8a' : c.c;
    t.style.color = colour;
    t.style.borderColor = colour;
  }

  /**
   * A reaction, as a speech bubble on this player's cursor: it moves with
   * them, so it reads as theirs. If their cursor is off the canvas the
   * room badge's avatar carries it instead.
   */
  react(id: string, emoji: string): void {
    const r = this.remotes.get(id);
    if (!r) return;
    r.bubble?.remove();
    const b = document.createElement('div');
    b.className = 'peer-bubble';
    b.textContent = emoji;
    b.addEventListener('animationend', () => {
      b.remove();
      if (r.bubble === b) r.bubble = null;
    });
    r.el.appendChild(b);
    r.bubble = b;
    // a reaction is a sign of life: keep the cursor visible while it shows
    r.seen = performance.now();
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
