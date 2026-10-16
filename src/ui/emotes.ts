import { SIM_H, SIM_W } from '../sim/protocol';
import { EMOTES, PING, type EmoteMsg } from '../net/presence';

/**
 * Reactions over the canvas: an emoji that floats up from where it was
 * sent, ringed in the sender's colour, or a ping - rings pulsing outward
 * with "name: look here" - to point at something. Pure DOM and CSS
 * animation; each removes itself when its animation ends.
 */

/** more than this at once and the oldest go first */
const MAX_LIVE = 24;

export class EmoteLayer {
  private live: HTMLElement[] = [];

  show(e: EmoteMsg): void {
    const canvas = document.getElementById('screen') as HTMLCanvasElement | null;
    const stage = document.getElementById('stage');
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
        r.style.animationDelay = `${k * 0.28}s`;
        el.appendChild(r);
      }
      const label = document.createElement('span');
      label.className = 'ping-label';
      label.textContent = `${e.n}: LOOK HERE`;
      el.appendChild(label);
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

  private drop(el: HTMLElement): void {
    el.remove();
    const i = this.live.indexOf(el);
    if (i >= 0) this.live.splice(i, 1);
  }

  clear(): void {
    for (const el of [...this.live]) this.drop(el);
  }
}
