import { CODE_WARN_LEN, copyText } from '../game/share';
import { h } from './widgets';

/**
 * The SHARE dialog.
 *
 * The link always goes on screen in a selectable field, even when the
 * clipboard write succeeds: `navigator.clipboard` is undefined on plain http
 * and rejects outright when the page is not focused, and a player who only
 * ever sees "COPIED" has no way to recover the link when it silently was not.
 */
export function showSharePanel(url: string): void {
  const overlay = document.getElementById('overlay')!;
  overlay.innerHTML = '';
  overlay.classList.remove('hidden');

  const box = h('div', 'screen share-box');
  box.appendChild(h('h2', '', 'SHARE THIS WORLD'));
  box.appendChild(
    h(
      'p',
      'share-blurb',
      'Anyone who opens this link gets your world loaded into the sandbox.',
    ),
  );

  const field = document.createElement('input');
  field.type = 'text';
  field.readOnly = true;
  field.className = 'share-url';
  field.value = url;
  field.setAttribute('aria-label', 'Shareable link to this world');
  field.onclick = () => field.select();
  box.appendChild(field);

  const meta = h('div', 'share-meta', `${url.length.toLocaleString()} characters`);
  if (url.length > CODE_WARN_LEN) {
    meta.classList.add('warn');
    meta.textContent =
      `${url.length.toLocaleString()} characters - long links get truncated by ` +
      'some chat apps. Use SAVE for a busy world.';
  }
  box.appendChild(meta);

  const row = h('div', 'btn-row');
  const copy = h('button', 'px primary', 'COPY LINK') as HTMLButtonElement;
  copy.type = 'button';
  copy.onclick = () => {
    void copyText(url).then((ok) => {
      copy.textContent = ok ? 'COPIED' : 'PRESS CTRL+C';
      if (!ok) {
        field.focus();
        field.select();
      }
    });
  };
  const close = h('button', 'px', 'CLOSE') as HTMLButtonElement;
  close.type = 'button';
  close.onclick = () => {
    overlay.innerHTML = '';
    overlay.classList.add('hidden');
  };
  row.appendChild(copy);
  row.appendChild(close);
  box.appendChild(row);

  overlay.appendChild(box);
  field.focus();
  field.select();
}
