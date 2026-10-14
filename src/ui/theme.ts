/**
 * Light / dark / auto. AUTO leaves data-theme unset, so the stylesheet's
 * prefers-color-scheme block decides and an OS switch applies live. The
 * choice persists per browser; index.html applies it before first paint.
 */
export type Theme = 'auto' | 'light' | 'dark';

const KEY = 'pf-theme';
const ORDER: Theme[] = ['auto', 'light', 'dark'];

export function loadTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'auto') return v;
  } catch {
    /* storage blocked: fall through to auto */
  }
  return 'auto';
}

export function applyTheme(t: Theme): void {
  const root = document.documentElement;
  if (t === 'auto') delete root.dataset.theme;
  else root.dataset.theme = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* not persisted, still applied */
  }
  syncThemeColor();
}

export function cycleTheme(): Theme {
  const next = ORDER[(ORDER.indexOf(loadTheme()) + 1) % ORDER.length];
  applyTheme(next);
  return next;
}

/** Keep the browser chrome colour (mobile address bar) in step. */
function syncThemeColor(): void {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const t = loadTheme();
  const light = t === 'light' || (t === 'auto' && matchMedia('(prefers-color-scheme: light)').matches);
  meta.setAttribute('content', light ? '#f1ebe1' : '#0c0a09');
}

matchMedia('(prefers-color-scheme: light)').addEventListener('change', syncThemeColor);
