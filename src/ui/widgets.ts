export function h(
  tag: string,
  cls?: string,
  txt?: string,
): HTMLElement {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (txt !== undefined) el.textContent = txt;
  return el;
}

export function toast(msg: string, bad = false): void {
  let wrap = document.getElementById('toast-wrap');
  if (!wrap) {
    wrap = h('div');
    wrap.id = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const t = h('div', 'toast' + (bad ? ' bad' : ''), msg);
  wrap.appendChild(t);
  window.setTimeout(() => t.remove(), 2400);
}

/** Three star glyphs, the earned ones marked so CSS can pop them in. */
function starsHtml(n: number, total = 3): string {
  let out = '';
  for (let i = 0; i < total; i++)
    out += `<span class="${i < n ? 'on' : 'off'}">★</span>`;
  return out;
}

export interface ResultOpts {
  name: string;
  status: 'win' | 'lose';
  reason: string;
  stars: number;
  timeSecs: number;
  onRetry: () => void;
  onNext?: () => void;
  onMenu: () => void;
}

function statRow(label: string, value: string): HTMLElement {
  const row = h('div', 'row');
  row.appendChild(h('span', '', label));
  row.appendChild(h('b', '', value));
  return row;
}

export function showResult(o: ResultOpts): void {
  const overlay = document.getElementById('overlay')!;
  overlay.innerHTML = '';
  overlay.classList.remove('hidden');

  const box = h('div', 'screen result-box');
  box.appendChild(
    h('h2', o.status === 'win' ? 'win' : 'lose', o.status === 'win' ? 'LEVEL CLEAR' : 'FAILED'),
  );
  box.appendChild(h('div', 'result-name', o.name));

  const starsEl = h('div', 'result-stars');
  starsEl.innerHTML = starsHtml(o.stars);
  box.appendChild(starsEl);

  const stats = h('div', 'result-stats');
  stats.appendChild(statRow('RESULT', o.reason));
  stats.appendChild(statRow('TIME', `${o.timeSecs.toFixed(1)}s`));
  stats.appendChild(statRow('STARS', `${o.stars} / 3`));
  box.appendChild(stats);

  const row = h('div', 'btn-row');
  const retry = h('button', 'px', 'RETRY');
  retry.onclick = () => { o.onRetry(); };
  row.appendChild(retry);
  if (o.status === 'win' && o.onNext) {
    const next = h('button', 'px primary', 'NEXT >');
    next.onclick = () => { o.onNext!(); };
    row.appendChild(next);
  }
  const menu = h('button', 'px', 'MENU');
  menu.onclick = () => { o.onMenu(); };
  row.appendChild(menu);
  for (const b of Array.from(row.children)) (b as HTMLButtonElement).type = 'button';
  box.appendChild(row);
  overlay.appendChild(box);

  // star chimes -- timings match the .result-stars .on animation delays
  for (let i = 0; i < o.stars; i++) {
    window.setTimeout(() => window.dispatchEvent(new CustomEvent('pf-star', { detail: i })), 500 + i * 300);
  }
}

export function hideOverlay(): void {
  const overlay = document.getElementById('overlay')!;
  overlay.innerHTML = '';
  overlay.classList.add('hidden');
}
