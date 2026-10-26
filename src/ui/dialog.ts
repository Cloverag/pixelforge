import { cleanName, initials, PLAYER_COLORS, type Identity } from '../net/presence';

/**
 * Small in-game dialogs: a yes/no confirm and a "who are you" prompt for
 * playing together. Not window.confirm/prompt - those block the page (and
 * the sim worker's messages) and cannot be styled.
 *
 * While one is open, isDialogOpen() is true and the game ignores its
 * shortcuts; Enter confirms and Escape cancels.
 */

let open = 0;
export const isDialogOpen = (): boolean => open > 0;

function shell(title: string): { root: HTMLElement; box: HTMLElement; close: () => void } {
  const root = document.createElement('div');
  root.className = 'pf-dialog';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  const box = document.createElement('div');
  box.className = 'pf-dialog-box panel';
  const h = document.createElement('h2');
  h.textContent = title;
  box.appendChild(h);
  root.appendChild(box);
  document.body.appendChild(root);
  open++;
  return {
    root,
    box,
    close: () => {
      root.remove();
      open--;
    },
  };
}

function button(label: string, primary: boolean, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'px' + (primary ? ' primary' : '');
  b.textContent = label;
  b.onclick = onClick;
  return b;
}

/** Enter -> ok, Escape -> cancel, caught before the game sees them. */
function keys(onOk: () => void, onCancel: () => void): () => void {
  const h = (e: KeyboardEvent) => {
    if (e.key === 'Enter') onOk();
    else if (e.key === 'Escape') onCancel();
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  addEventListener('keydown', h, true);
  return () => removeEventListener('keydown', h, true);
}

/**
 * A dialog to fill with your own content (PICTURE): Escape or a click
 * outside calls `onCancel`; set what Enter does with `onEnter`. Null while
 * another dialog is open - one question at a time.
 */
export function panelDialog(title: string, onCancel: () => void): { box: HTMLElement; close: () => void; onEnter: (f: () => void) => void } | null {
  if (open > 0) return null;
  const { box, root, close } = shell(title);
  let enter = (): void => {};
  const unkey = keys(() => enter(), onCancel);
  root.onclick = (e) => e.target === root && onCancel();
  return {
    box,
    close: () => {
      unkey();
      close();
    },
    onEnter: (f) => (enter = f),
  };
}

export function confirmDialog(o: { title: string; body: string; ok: string; cancel: string }): Promise<boolean> {
  // one question at a time: a second click while one is open is a no, not a second dialog
  if (open > 0) return Promise.resolve(false);
  return new Promise((resolve) => {
    const { box, root, close } = shell(o.title);
    const p = document.createElement('p');
    p.textContent = o.body;
    box.appendChild(p);
    const row = document.createElement('div');
    row.className = 'pf-dialog-actions';
    const finish = (v: boolean) => {
      unkey();
      close();
      resolve(v);
    };
    const cancel = button(o.cancel, false, () => finish(false));
    const ok = button(o.ok, true, () => finish(true));
    row.append(cancel, ok);
    box.appendChild(row);
    root.onclick = (e) => e.target === root && finish(false);
    const unkey = keys(() => finish(true), () => finish(false));
    requestAnimationFrame(() => cancel.focus()); // the safe choice has focus
  });
}

/**
 * "What should the others call you?" with the current name filled in and
 * a choice of colour, so nobody has to discover renaming later.
 */
export function nameDialog(o: { title: string; action: string; me: Identity }): Promise<Identity | null> {
  return new Promise((resolve) => {
    const { box, root, close } = shell(o.title);
    let color = o.me.color;

    const p = document.createElement('p');
    p.textContent = 'What should the others call you?';
    const row = document.createElement('div');
    row.className = 'pf-name-row';
    const avatar = document.createElement('span');
    avatar.className = 'room-avatar big';
    const input = document.createElement('input');
    input.className = 'pf-name-input';
    input.value = o.me.name;
    input.maxLength = 14;
    input.setAttribute('aria-label', 'Your name');
    input.spellcheck = false;
    row.append(avatar, input);

    const swatches = document.createElement('div');
    swatches.className = 'pf-swatches';
    swatches.setAttribute('role', 'radiogroup');
    swatches.setAttribute('aria-label', 'Your colour');
    const paint = () => {
      avatar.style.background = color;
      avatar.textContent = initials(cleanName(input.value) || o.me.name);
      for (const s of swatches.children) (s as HTMLElement).classList.toggle('on', (s as HTMLElement).dataset.c === color);
    };
    for (const c of PLAYER_COLORS) {
      const s = document.createElement('button');
      s.type = 'button';
      s.className = 'pf-swatch';
      s.style.background = c;
      s.dataset.c = c;
      s.setAttribute('aria-label', `colour ${c}`);
      s.onclick = () => {
        color = c;
        paint();
        input.focus();
      };
      swatches.appendChild(s);
    }
    input.oninput = paint;
    paint();

    const hint = document.createElement('p');
    hint.className = 'pf-dialog-hint';
    hint.textContent = 'You can change it later by clicking your dot in the room badge.';

    const actions = document.createElement('div');
    actions.className = 'pf-dialog-actions';
    const finish = (ok: boolean) => {
      unkey();
      close();
      resolve(ok ? { name: cleanName(input.value) || o.me.name, color } : null);
    };
    actions.append(button('CANCEL', false, () => finish(false)), button(o.action, true, () => finish(true)));
    box.append(p, row, swatches, hint, actions);
    root.onclick = (e) => e.target === root && finish(false);
    const unkey = keys(() => finish(true), () => finish(false));
    // Next frame, not now: opened from a key (O), focusing during that
    // keydown let the same key's character land in the field - the name
    // came up as "o".
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  });
}
