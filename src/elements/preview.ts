import { Atom3D } from './atom3d';
import { atomOf, elementByZ, tintOf } from './screen';

/**
 * ELEMENTS behind the title screen: an atom turning on the right, clear of
 * the menu, a new element every few seconds with its symbol and name. Only
 * shown while its entry is hovered (main.ts), and gone with the menu.
 */

/** the tour: light to heavy, each with something different to show (s, p, d, f) */
export const TOUR = [1, 6, 8, 10, 11, 18, 26, 29, 47, 60, 79, 80, 92, 118];
const STEP_MS = 5000;

export class ElementsPreview {
  private root: HTMLElement | null = null;
  private atom: Atom3D | null = null;
  private label: HTMLElement | null = null;
  private timer = 0;
  private i = 0;

  /** Mount (if it is not) and play the tour from stop `start`; names each element through `onName`. */
  play(start: number, onName: (name: string) => void): void {
    if (!this.root) {
      const wrap = document.getElementById('screen-wrap');
      if (!wrap) return;
      this.root = document.createElement('div');
      this.root.className = 'el-preview';
      this.root.setAttribute('aria-hidden', 'true');
      this.label = document.createElement('div');
      this.label.className = 'el-preview-label';
      this.root.append(this.label);
      wrap.append(this.root);
      this.atom = new Atom3D(this.root, { shiftX: 0.3, interactive: false });
      this.root.prepend(this.root.lastElementChild!);
      document.body.classList.add('elements-preview');
    }
    this.i = start % TOUR.length;
    const step = () => {
      const e = elementByZ(TOUR[this.i]);
      this.atom?.show(atomOf(e).spec);
      if (this.label) {
        this.label.style.setProperty('--el-tint', tintOf(e));
        this.label.replaceChildren(span('el-preview-sym', e.sym), span('el-preview-name', e.name.toUpperCase()));
      }
      onName(`${e.z} ${e.name.toUpperCase()}`);
      this.i = (this.i + 1) % TOUR.length;
    };
    window.clearInterval(this.timer);
    step();
    this.timer = window.setInterval(step, STEP_MS);
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
    this.atom?.dispose();
    this.atom = null;
    this.root?.remove();
    this.root = null;
    this.label = null;
    document.body.classList.remove('elements-preview');
  }
}

function span(cls: string, text: string): HTMLElement {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text;
  return s;
}
