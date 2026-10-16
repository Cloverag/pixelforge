/**
 * The room badge shown while playing together: room code, how many are
 * here, copy-link and leave. Lives over the top of the stage.
 */
export class RoomPill {
  private el: HTMLElement | null = null;
  private people!: HTMLElement;
  private codeEl!: HTMLElement;
  private roleEl!: HTMLElement;
  onCopy: () => void = () => {};
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
    const copy = document.createElement('button');
    copy.className = 'px';
    copy.type = 'button';
    copy.textContent = 'COPY LINK';
    copy.onclick = () => this.onCopy();
    const leave = document.createElement('button');
    leave.className = 'px';
    leave.type = 'button';
    leave.textContent = 'LEAVE';
    leave.onclick = () => this.onLeave();
    el.append(dot, this.codeEl, this.roleEl, this.people, copy, leave);
    (document.getElementById('stage') ?? document.body).appendChild(el);
    return el;
  }

  show(code: string, role: 'host' | 'guest'): void {
    this.el ??= this.build();
    this.codeEl.textContent = `ROOM ${code}`;
    this.roleEl.textContent = role === 'host' ? 'HOST' : 'GUEST';
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
