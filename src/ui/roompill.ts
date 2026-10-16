import { cleanName, EMOTES, initials, PING, type Identity, type PeerInfo } from '../net/presence';

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
  onCopy: () => void = () => {};
  /** the player renamed themselves */
  onRename: (name: string) => void = () => {};
  /** the player picked a reaction (index into EMOTES, or PING) */
  onEmote: (e: number) => void = () => {};
  private tray!: HTMLElement;
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
    // reactions: a button that opens a tray of emoji and a ping
    const react = document.createElement('button');
    react.className = 'px room-react';
    react.type = 'button';
    react.textContent = '😀';
    react.title = 'React (Z pings where your cursor is)';
    react.setAttribute('aria-label', 'React');
    this.tray = document.createElement('div');
    this.tray.className = 'room-tray';
    this.tray.hidden = true;
    const pick = (e: number, label: string, title: string) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tray-btn' + (e === PING ? ' ping' : '');
      b.textContent = label;
      b.title = title;
      b.onclick = () => {
        this.onEmote(e);
        this.tray.hidden = true;
      };
      this.tray.appendChild(b);
    };
    EMOTES.forEach((emo, i) => pick(i, emo, 'React'));
    pick(PING, 'PING', 'Point at where your cursor is (Z)');
    react.onclick = () => (this.tray.hidden = !this.tray.hidden);
    const leave = document.createElement('button');
    leave.className = 'px';
    leave.type = 'button';
    leave.textContent = 'LEAVE';
    leave.onclick = () => this.onLeave();
    el.append(dot, this.codeEl, this.roleEl, this.dots, this.people, react, copy, leave, this.tray);
    (document.getElementById('stage') ?? document.body).appendChild(el);
    return el;
  }

  /** Me first, then everyone else, as coloured initials. */
  setRoster(me: Identity, peers: PeerInfo[]): void {
    this.el ??= this.build();
    this.dots.replaceChildren();
    const dot = (p: Identity, title: string, self = false) => {
      const d = document.createElement('span');
      d.className = 'room-avatar' + (self ? ' self' : '');
      d.style.background = p.color;
      d.textContent = initials(p.name);
      d.title = title;
      this.dots.appendChild(d);
      return d;
    };
    const self = dot(me, `${me.name} (you) - click to rename`, true);
    self.onclick = () => this.rename(me.name);
    for (const p of peers) dot(p, p.ping >= 0 ? `${p.name} - ${p.ping} ms` : p.name);
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

  show(code: string, role: 'host' | 'guest'): void {
    this.el ??= this.build();
    this.codeEl.textContent = `ROOM ${code}`;
    this.role = role === 'host' ? 'HOST' : 'GUEST';
    this.roleEl.textContent = this.role;
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
