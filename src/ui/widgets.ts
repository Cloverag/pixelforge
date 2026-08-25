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

function starString(n: number, total = 3): { on: string; off: string } {
  return {
    on: '\u2605'.repeat(n),
    off: '\u2605'.repeat(Math.max(0, total - n)),
  };
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

export function showResult(o: ResultOpts): void {
  const overlay = document.getElementById('overlay')!;
  overlay.innerHTML = '';
  overlay.classList.remove('hidden');
  const box = h('div', 'screen result-box');
  const title = h('h2', o.status === 'win' ? 'win' : 'lose', o.status === 'win' ? 'LEVEL CLEAR' : 'FAILED');
  box.appendChild(title);
  box.appendChild(h('div', 'result-stats', `${o.name}\n${o.reason}\nTIME ${o.timeSecs.toFixed(1)}S`));
  const s = starString(o.stars);
  const starsEl = h('div', 'result-stars');
  starsEl.innerHTML = s.on + s.off;
  box.appendChild(starsEl);
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
  box.appendChild(row);
  overlay.appendChild(box);

  // star chimes
  for (let i = 0; i < o.stars; i++) {
    window.setTimeout(() => window.dispatchEvent(new CustomEvent('pf-star', { detail: i })), 500 + i * 300);
  }
}

export function hideOverlay(): void {
  const overlay = document.getElementById('overlay')!;
  overlay.innerHTML = '';
  overlay.classList.add('hidden');
}
