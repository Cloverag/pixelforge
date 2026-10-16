import { SIM_H, SIM_W } from '../sim/protocol';
import { EMOTES, PING, type EmoteMsg } from '../net/presence';

/**
 * Reactions in a room, built to be noticed:
 *
 * - a reaction bar along the bottom of the canvas: one tap each, no tray;
 * - the effect itself where the sender was working: a big emoji that
 *   floats up, or rings pulsing outward for a ping;
 * - a feed in the corner ("🔥 FROSTY OWL") that stays for a few seconds,
 *   so a reaction you were not looking at is still there to read;
 * - while the tab is hidden, reactions wait in the feed and the tab title
 *   counts them, so switching back shows what you missed.
 *
 * The first version was a 38px bubble for 1.7 s at the sender's cursor -
 * which was usually off the canvas, on the tray button - and players did
 * not notice it at all.
 */

/** effects on screen at once; more and the oldest go first */
const MAX_LIVE = 24;
/** feed lines kept, and how long each stays readable */
const FEED_MAX = 5;
const FEED_MS = 6000;

const BASE_TITLE = 'PIXELFORGE';

export class EmoteLayer {
  private live: HTMLElement[] = [];
  private bar: HTMLElement | null = null;
  private feedEl: HTMLElement | null = null;
  private unseen = 0;
  /** arrived while the tab was hidden: shown when it is visible again */
  private missed: EmoteMsg[] = [];
  onPick: (e: number) => void = () => {};

  constructor() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      this.unseen = 0;
      document.title = BASE_TITLE;
      for (const e of this.missed.splice(0)) this.feed(e);
    });
  }

  private stage(): HTMLElement | null {
    return document.getElementById('stage');
  }

  /** The reaction bar and feed, while in a room. */
  open(): void {
    const stage = this.stage();
    if (!stage || this.bar) return;
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
    add(PING, '📍 PING', 'Ping: point everyone at where you were working (Z)');
    stage.appendChild(bar);
    this.bar = bar;
    const feed = document.createElement('div');
    feed.className = 'react-feed';
    feed.setAttribute('aria-live', 'polite');
    stage.appendChild(feed);
    this.feedEl = feed;
  }

  close(): void {
    this.bar?.remove();
    this.feedEl?.remove();
    this.bar = this.feedEl = null;
    for (const el of [...this.live]) this.drop(el);
    this.missed.length = 0;
    this.unseen = 0;
    document.title = BASE_TITLE;
  }

  show(e: EmoteMsg, mine: boolean): void {
    if (document.hidden) {
      // nobody would see the effect; keep it for the feed and say so in the tab
      this.missed.push(e);
      if (this.missed.length > FEED_MAX) this.missed.shift();
      this.unseen++;
      document.title = `(${this.unseen}) ${BASE_TITLE}`;
      return;
    }
    this.effect(e);
    if (!mine) this.feed(e);
  }

  private effect(e: EmoteMsg): void {
    const canvas = document.getElementById('screen') as HTMLCanvasElement | null;
    const stage = this.stage();
    if (!canvas || !stage) return;
    const cr = canvas.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    const x = cr.left - sr.left + ((e.x + 0.5) / SIM_W) * cr.width;
    const y = cr.top - sr.top + ((e.y + 0.5) / SIM_H) * cr.height;
    const el = document.createElement('div');
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.setProperty('--who', e.c);
    if (e.e === PING) {
      el.className = 'emote ping';
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
    } else {
      el.className = 'emote pop';
      const face = document.createElement('span');
      face.className = 'emote-face';
      face.textContent = EMOTES[e.e] ?? '❔';
      const who = document.createElement('span');
      who.className = 'emote-who';
      who.textContent = e.n;
      el.append(face, who);
    }
    el.addEventListener('animationend', (ev) => {
      if (ev.target === el) this.drop(el);
    });
    stage.appendChild(el);
    this.live.push(el);
    while (this.live.length > MAX_LIVE) this.drop(this.live[0]);
  }

  /** a line in the corner feed: readable for a few seconds */
  private feed(e: EmoteMsg): void {
    const f = this.feedEl;
    if (!f) return;
    const line = document.createElement('div');
    line.className = 'feed-line';
    line.style.setProperty('--who', e.c);
    const icon = document.createElement('span');
    icon.className = 'feed-icon';
    icon.textContent = e.e === PING ? '📍' : (EMOTES[e.e] ?? '❔');
    const text = document.createElement('span');
    text.textContent = e.e === PING ? `${e.n}: LOOK HERE` : e.n;
    line.append(icon, text);
    f.appendChild(line);
    while (f.children.length > FEED_MAX) f.firstElementChild?.remove();
    setTimeout(() => line.classList.add('fading'), FEED_MS);
    setTimeout(() => line.remove(), FEED_MS + 600);
  }

  private drop(el: HTMLElement): void {
    el.remove();
    const i = this.live.indexOf(el);
    if (i >= 0) this.live.splice(i, 1);
  }
}
