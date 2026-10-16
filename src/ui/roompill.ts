import { cleanName, initials, type Identity, type PeerInfo } from '../net/presence';

/**
 * The room badge shown while playing together: room code, who is here (a
 * dot per player, name and ping on hover), copy-link and leave. Lives over
 * the top of the stage.
 */
export class RoomPill {
  private el: HTMLElement | null = null;
  private people!: HTMLElement;
  private codeEl!: HTMLElement;
  private roleEl!: HTMLElement;
  private dots!: HTMLElement;
  /** reactions showing on avatars: player id ('me' for me) -> emoji, until */
  private reacting = new Map<string, { emoji: string; until: number }>();
  private lastMe: Identity | null = null;
  private lastPeers: PeerInfo[] = [];
  onCopy: () => void = () => {};
  /** the player renamed themselves */
  onRename: (name: string) => void = () => {};
  /** host: switch the room to the other mode */
  onSwitchMode: () => void = () => {};
  private modeBtn!: HTMLButtonElement;

  /** the count can arrive before the badge is built: keep it until then */
  private count = 1;

  constructor(private onLeave: () => void) {}

  private build(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'room-pill';
    el.setAttribute('role', 'status');
    const dot = document.createElement('span');
    dot.className = 'room-dot';
    this.codeEl = document.createElement('span');
    this.codeEl.className = 'room-code';
    this.roleEl = document.createElement('span');
    this.roleEl.className = 'room-role';
    this.people = document.createElement('span');
    this.people.className = 'room-people';
    this.dots = document.createElement('span');
    this.dots.className = 'room-dots';
    const copy = document.createElement('button');
    copy.className = 'px';
    copy.type = 'button';
    copy.textContent = 'COPY LINK';
    copy.onclick = () => this.onCopy();
    // host only: take everyone to the other mode
    this.modeBtn = document.createElement('button');
    this.modeBtn.className = 'px room-mode';
    this.modeBtn.type = 'button';
    this.modeBtn.onclick = () => this.onSwitchMode();
    const leave = document.createElement('button');
    leave.className = 'px';
    leave.type = 'button';
    leave.textContent = 'LEAVE';
    leave.onclick = () => this.onLeave();
    el.append(dot, this.codeEl, this.roleEl, this.dots, this.people, this.modeBtn, copy, leave);
    (document.getElementById('stage') ?? document.body).appendChild(el);
    return el;
  }

  /** Me first, then everyone else, as coloured initials. */
  setRoster(me: Identity, peers: PeerInfo[]): void {
    this.el ??= this.build();
    this.lastMe = me;
    this.lastPeers = peers;
    this.dots.replaceChildren();
    const now = performance.now();
    const dot = (id: string, p: Identity, title: string, self = false) => {
      const d = document.createElement('span');
      d.className = 'room-avatar' + (self ? ' self' : '');
      d.style.background = p.color;
      d.style.setProperty('--who', p.color);
      d.title = title;
      d.dataset.id = id;
      // the roster redraws every few seconds (ping): keep a reaction showing
      const r = this.reacting.get(id);
      if (r && r.until > now) {
        d.classList.add('reacting', 'held');
        d.textContent = r.emoji;
      } else {
        d.textContent = initials(p.name);
      }
      this.dots.appendChild(d);
      return d;
    };
    const self = dot('me', me, `${me.name} (you) - click to rename`, true);
    self.onclick = () => this.rename(me.name);
    for (const p of peers) dot(p.id, p, p.ping >= 0 ? `${p.name} - ${p.ping} ms` : p.name);
  }

  /** A player (null: me) reacted: their avatar becomes the emoji for a moment. */
  react(id: string | null, emoji: string, ms: number): void {
    const key = id ?? 'me';
    this.reacting.set(key, { emoji, until: performance.now() + ms });
    const d = this.dots?.querySelector<HTMLElement>(`[data-id="${CSS.escape(key)}"]`);
    if (d) {
      d.textContent = emoji;
      d.classList.remove('reacting', 'held');
      void d.offsetWidth; // restart the pop if it was already reacting
      d.classList.add('reacting');
    }
    setTimeout(() => {
      const r = this.reacting.get(key);
      if (r && r.until <= performance.now() + 30) {
        this.reacting.delete(key);
        if (this.lastMe) this.setRoster(this.lastMe, this.lastPeers);
      }
    }, ms);
  }

  /** An inline name field in place of the avatars; Enter saves, Esc cancels. */
  private rename(current: string): void {
    const input = document.createElement('input');
    input.className = 'room-rename';
    input.value = current;
    input.maxLength = 14;
    input.setAttribute('aria-label', 'Your name');
    const done = (save: boolean) => {
      const name = cleanName(input.value);
      input.remove();
      this.dots.hidden = false;
      if (save && name && name !== current) this.onRename(name);
    };
    input.onkeydown = (e) => {
      e.stopPropagation(); // typing must not trigger game shortcuts
      if (e.key === 'Enter') done(true);
      else if (e.key === 'Escape') done(false);
    };
    input.onblur = () => done(true);
    this.dots.hidden = true;
    this.dots.after(input);
    input.focus();
    input.select();
  }

  /** guest: the host dropped and we are waiting for it */
  setWaiting(on: boolean): void {
    this.el?.classList.toggle('waiting', on);
    if (this.roleEl) this.roleEl.textContent = on ? 'WAITING FOR HOST' : this.role;
  }

  private role = 'GUEST';

  /** The mode the room is in; the host's button offers the other one. */
  setMode(m: 'sand' | 'playground'): void {
    if (!this.modeBtn) return;
    const next = m === 'sand' ? 'PLAYGROUND' : 'SANDBOX';
    this.modeBtn.textContent = `→ ${next}`;
    this.modeBtn.title = `Take everyone to the ${next.toLowerCase()}`;
  }

  show(code: string, role: 'host' | 'guest'): void {
    this.el ??= this.build();
    this.codeEl.textContent = `ROOM ${code}`;
    this.role = role === 'host' ? 'HOST' : 'GUEST';
    this.roleEl.textContent = this.role;
    this.modeBtn.hidden = role !== 'host';
    this.el.hidden = false;
    this.setPeople(this.count);
  }

  setPeople(n: number): void {
    this.count = n;
    if (!this.el) return;
    this.people.textContent = n === 1 ? 'JUST YOU' : `${n} PLAYERS`;
    this.el.classList.toggle('alone', n === 1);
  }

  hide(): void {
    if (this.el) this.el.hidden = true;
  }
}
