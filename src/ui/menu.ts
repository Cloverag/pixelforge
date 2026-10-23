import { CHALLENGES } from '../sim/challenges';
import { isUnlocked, loadProgress, Progress } from '../game/progress';
import { h } from './widgets';

/** A card in the PLAY column; main.ts owns the list and its hotkeys. */
export interface MenuEntry {
  name: string;
  sub: string;
  /** the key shown on the card */
  key: string;
  /** the key as Input reports it ('enter', 'p') */
  hotkey: string;
  primary?: boolean;
  cls?: string;
  /** hovering or focusing the card previews this on the background */
  preview?: 'pg' | 'chem';
  run(): void;
}

export interface MenuCallbacks {
  entries: MenuEntry[];
  onChallenge(id: string): void;
  onToggleMute(): void;
  onToggleCrt(): void;
  /** cycles the backdrop; returns the new one's name */
  onToggleBg(): string;
  /** the backdrop now showing */
  backdrop: string;
  onToggleMusic(): void;
  onPreview(kind: 'pg' | 'chem'): void;
  onHelp(): void;
  onToggle3d(): void;
  /** one sentence saying what the game is */
  tagline: string;
  onCycleTheme(): string;
  theme: string;
}

const STARS_PER_LEVEL = 3;

function starHtml(n: number): string {
  let out = '';
  for (let i = 0; i < STARS_PER_LEVEL; i++)
    out += `<span class="${i < n ? 'on' : 'off'}">★</span>`;
  return out;
}

/** A mode card: big label, one line of what it is, the key that starts it. */
function modeButton(label: string, sub: string, key: string, primary: boolean, onClick: () => void, onPreview?: () => void): HTMLElement {
  const b = h('button', 'px mode-btn' + (primary ? ' primary' : '')) as HTMLButtonElement;
  b.type = 'button';
  const text = h('span', 'mode-text');
  text.appendChild(h('span', 'mode-name', label));
  text.appendChild(h('span', 'sub', sub));
  b.appendChild(text);
  b.appendChild(h('kbd', 'mode-key', key));
  b.onclick = onClick;
  if (onPreview) {
    b.onmouseenter = onPreview;
    b.onfocus = onPreview;
  }
  return b;
}

/** "LIVE: <scene>" under the panel while the game runs behind the menu; null hides it. */
export function setMenuLive(name: string | null): void {
  const el = document.getElementById('menu-live');
  if (!el) return;
  el.textContent = name ? `LIVE: ${name}` : '';
  el.classList.toggle('hidden', !name);
}

/** A settings key with an indicator lamp, matching the in-game topbar. */
function lampButton(label: string, on: boolean, onClick: (b: HTMLButtonElement) => void): HTMLButtonElement {
  const b = h('button', 'px has-led' + (on ? ' toggled' : '')) as HTMLButtonElement;
  b.type = 'button';
  const led = h('span', 'led');
  led.setAttribute('aria-hidden', 'true');
  b.append(led, h('span', 'lbl', label));
  b.onclick = () => onClick(b);
  return b;
}

/** One per visit. Each names a mechanic that nothing on screen teaches. */
const TIPS: string[] = [
  'Fire lights TNT on a short fuse - watch it blink, then stand back. Stacks go off in a chain.',
  'A torch on the end of a wire sends sparks down it. Sparks set off TNT and gunpowder instantly.',
  'W turns the brush into wind. Fan fire to spread it, or blow smoke out of a chimney.',
  'Salt melts ice. Snow piles up light and drifts in the wind.',
  'Water on lava cools it to stone - and sizzles.',
  'F is a bucket: one click fills the whole connected area.',
  'SHARE copies a link that loads your world on someone else\'s screen.',
  'Clone copies whatever touches it first. Void deletes everything that touches it.',
];

const KEYS: [string, string][] = [
  ['LMB', 'paint'], ['RMB', 'erase'], ['WHEEL', 'brush size'], ['SPACE', 'pause'],
  ['R', 'surprise'], ['N', 'step'], ['F', 'bucket'], ['W', 'wind'], ['M', 'sound'], ['C', 'crt'], ['T', 'theme'], ['ESC', 'menu'],
];

export function showMenu(cbs: MenuCallbacks): void {
  const overlay = document.getElementById('overlay')!;
  overlay.innerHTML = '';
  overlay.classList.remove('hidden');

  const screen = h('div', 'screen menu');

  // ---- head: wordmark left, settings right ----
  const head = h('header', 'menu-head');
  const brand = h('div', 'menu-brand');
  brand.appendChild(h('h1', 'game-title', 'PIXELFORGE'));
  brand.appendChild(h('p', 'tagline', cbs.tagline));
  head.appendChild(brand);

  const settings = h('div', 'menu-settings');
  settings.appendChild(lampButton('SFX', !document.body.classList.contains('muted'), (b) => {
    cbs.onToggleMute();
    b.classList.toggle('toggled', !document.body.classList.contains('muted'));
  }));
  settings.appendChild(lampButton('CRT', document.body.classList.contains('crt-on'), (b) => {
    cbs.onToggleCrt();
    b.classList.toggle('toggled', document.body.classList.contains('crt-on'));
  }));
  const bg = h('button', 'px', `BACKDROP: ${cbs.backdrop}`) as HTMLButtonElement;
  bg.type = 'button';
  bg.title = 'The picture around the game screen';
  bg.onclick = () => { bg.textContent = `BACKDROP: ${cbs.onToggleBg()}`; };
  const help = h('button', 'px', '? HELP') as HTMLButtonElement;
  help.type = 'button';
  help.onclick = () => cbs.onHelp();
  const themeLabel = (t: string) => `THEME: ${t.toUpperCase()}`;
  const theme = h('button', 'px', themeLabel(cbs.theme)) as HTMLButtonElement;
  theme.type = 'button';
  theme.title = 'Light / dark / follow system (T)';
  // the T key changes theme without clicking this; main.ts updates it by role
  theme.dataset.role = 'theme-label';
  theme.onclick = () => { theme.textContent = themeLabel(cbs.onCycleTheme()); };
  settings.append(bg, theme, help);
  head.appendChild(settings);
  screen.appendChild(head);

  // ---- body: modes | challenges ----
  const body = h('div', 'menu-body');

  const modes = h('section', 'menu-modes');
  modes.appendChild(h('h2', 'section-title', 'PLAY'));
  for (const e of cbs.entries) {
    const kind = e.preview;
    const b = modeButton(e.name, e.sub, e.key, e.primary ?? false, e.run, kind && (() => cbs.onPreview(kind)));
    if (e.cls) b.classList.add(e.cls);
    modes.appendChild(b);
  }
  const tip = h('aside', 'menu-tip');
  tip.appendChild(h('span', 'tip-label', 'TIP'));
  tip.appendChild(h('p', 'tip-text', TIPS[Math.floor(Math.random() * TIPS.length)]));
  modes.appendChild(tip);
  body.appendChild(modes);

  const prog: Progress = loadProgress();
  const order = CHALLENGES.map((c) => c.id);
  const earned = CHALLENGES.reduce((sum, c) => sum + (prog[c.id] ?? 0), 0);
  const total = CHALLENGES.length * STARS_PER_LEVEL;

  const chal = h('section', 'menu-chal');
  const chalTitle = h('h2', 'section-title');
  chalTitle.appendChild(h('span', '', 'CHALLENGES'));
  chalTitle.appendChild(h('span', 'count', `★ ${earned} / ${total}`));
  chal.appendChild(chalTitle);
  const bar = h('div', 'chal-progress');
  const fill = h('span', 'chal-fill');
  fill.style.width = `${((earned / total) * 100).toFixed(1)}%`;
  bar.appendChild(fill);
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', String(total));
  bar.setAttribute('aria-valuenow', String(earned));
  bar.setAttribute('aria-label', 'Stars earned');
  chal.appendChild(bar);

  const listEl = h('ol', 'challenge-list');
  CHALLENGES.forEach((c, i) => {
    const unlocked = isUnlocked(i, order, prog);
    const stars = prog[c.id] ?? 0;
    const row = h(
      'li',
      'challenge-card' + (unlocked ? '' : ' locked') + (stars > 0 ? ' cleared' : ''),
    );
    row.appendChild(h('span', 'cnum', String(i + 1).padStart(2, '0')));
    const text = h('div', 'ctext');
    text.appendChild(h('span', 'cname', c.name));
    // a locked level says why once, quietly - not seven times in full
    text.appendChild(h('span', 'cdesc', unlocked ? c.desc : 'Clear the level above to unlock.'));
    row.appendChild(text);
    const starsEl = h('span', 'stars');
    starsEl.innerHTML = unlocked ? starHtml(stars) : '<span class="lock" aria-label="locked">LOCKED</span>';
    row.appendChild(starsEl);

    if (unlocked) {
      row.onclick = () => cbs.onChallenge(c.id);
      row.title = c.hint;
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.onkeydown = (e) => {
        const k = (e as KeyboardEvent).key;
        if (k === 'Enter' || k === ' ') {
          e.preventDefault();
          cbs.onChallenge(c.id);
        }
      };
    }
    listEl.appendChild(row);
  });
  chal.appendChild(listEl);
  body.appendChild(chal);
  screen.appendChild(body);

  // ---- foot: the controls, as keys rather than a sentence ----
  const foot = h('footer', 'menu-keys');
  for (const [k, what] of KEYS) {
    const item = h('span', 'key-item');
    item.append(h('kbd', '', k), h('span', '', what));
    foot.appendChild(item);
  }
  screen.appendChild(foot);

  overlay.appendChild(screen);
  const live = h('div', 'menu-live hidden');
  live.id = 'menu-live';
  overlay.appendChild(live);
}
