import { SIM_H, SIM_W } from '../sim/protocol';
import { EMOTES, PING, type EmoteMsg } from '../net/presence';

/**
 * The reaction bar along the bottom of the canvas, and pings.
 *
 * A reaction shows on the person - a bubble on their cursor and their
 * avatar in the room badge (ui/cursors.ts, ui/roompill.ts) - because
 * an emoji floating somewhere on the canvas, and then a list of them in
 * a corner, did not read as anyone's. A ping is about a place, so it is
 * also drawn there: rings pulsing outward round a dot, "NAME: LOOK HERE".
 *
 * While the tab is hidden nobody sees any of it, so the tab title counts
 * what arrived ("(2) PIXELFORGE") until you come back.
 */

const MAX_LIVE = 12;
const BASE_TITLE = 'PIXELFORGE';

export class EmoteLayer {
  private live: HTMLElement[] = [];
  private bar: HTMLElement | null = null;
  private unseen = 0;
  onPick: (e: number) => void = () => {};

  constructor() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      this.unseen = 0;
      document.title = BASE_TITLE;
    });
  }

  /**
   * The reaction bar, while in a room: its own column beside the canvas
   * (a row under it on a portrait phone), never on top of the world - laid
   * over the bottom of the canvas it covered what people were building.
   */
  open(): void {
    const host = document.getElementById('workspace');
    if (!host || this.bar) return;
    const bar = document.createElement('div');
    bar.className = 'react-bar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Reactions');
    const add = (e: number, label: string, title: string) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'react-btn' + (e === PING ? ' ping' : '');
      b.textContent = label;
      b.title = title;
      b.setAttribute('aria-label', title);
      b.onclick = () => this.onPick(e);
      bar.appendChild(b);
    };
    const names = ['Thumbs up', 'Fire', 'Laugh', 'Wow', 'Love'];
    EMOTES.forEach((emo, i) => add(i, emo, names[i] ?? 'React'));
    add(PING, '📍', 'Ping: point everyone at where you were working (Z)');
    host.appendChild(bar);
    this.bar = bar;
    // the canvas refits to the space that is left
    dispatchEvent(new Event('resize'));
  }

  close(): void {
    if (this.bar) dispatchEvent(new Event('resize'));
    this.bar?.remove();
    this.bar = null;
    for (const el of [...this.live]) this.drop(el);
    this.unseen = 0;
    document.title = BASE_TITLE;
  }

  /** Count a reaction that arrived while the tab was hidden. */
  noteHidden(): void {
    this.unseen++;
    document.title = `(${this.unseen}) ${BASE_TITLE}`;
  }

  /** A ping: rings where it was aimed. */
  ping(e: EmoteMsg): void {
    if (e.e !== PING) return;
    const canvas = document.getElementById('screen') as HTMLCanvasElement | null;
    const stage = document.getElementById('stage');
    if (!canvas || !stage) return;
    const cr = canvas.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'emote ping';
    el.style.left = `${cr.left - sr.left + ((e.x + 0.5) / SIM_W) * cr.width}px`;
    el.style.top = `${cr.top - sr.top + ((e.y + 0.5) / SIM_H) * cr.height}px`;
    el.style.setProperty('--who', e.c);
    for (let k = 0; k < 3; k++) {
      const r = document.createElement('span');
      r.className = 'ping-ring';
      r.style.animationDelay = `${k * 0.35}s`;
      el.appendChild(r);
    }
    const dot = document.createElement('span');
    dot.className = 'ping-dot';
    const label = document.createElement('span');
    label.className = 'ping-label';
    label.textContent = `${e.n}: LOOK HERE`;
    el.append(dot, label);
    el.addEventListener('animationend', (ev) => {
      if (ev.target === el) this.drop(el);
    });
    stage.appendChild(el);
    this.live.push(el);
    while (this.live.length > MAX_LIVE) this.drop(this.live[0]);
  }

  private drop(el: HTMLElement): void {
    el.remove();
    const i = this.live.indexOf(el);
    if (i >= 0) this.live.splice(i, 1);
  }
}
