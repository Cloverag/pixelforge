import { CHALLENGES } from '../sim/challenges';
import { isUnlocked, loadProgress, Progress } from '../game/progress';
import { h } from './widgets';

export interface MenuCallbacks {
  onSandbox(): void;
  onPlayground(): void;
  onChallenge(id: string): void;
  onToggleMute(): void;
  onToggleCrt(): void;
  onToggleBg(): void;
  onToggleMusic(): void;
  onHelp(): void;
}

function starHtml(n: number): string {
  const total = 3;
  const s = (filled: boolean) =>
    `<span class="${filled ? '' : 'off'}">\u2605</span>`;
  let out = '';
  for (let i = 0; i < total; i++) out += s(i < n);
  return out;
}

export function showMenu(cbs: MenuCallbacks): void {
  const overlay = document.getElementById('overlay')!;
  overlay.innerHTML = '';
  overlay.classList.remove('hidden');

  const screen = h('div', 'screen');
  screen.appendChild(h('div', 'game-title', 'PIXELFORGE'));
  screen.appendChild(h('div', 'tagline', 'A PIXEL PARTICLE SANDBOX'));

  const col = h('div', 'menu-col');
  const sandbox = h('button', 'px primary', 'SANDBOX');
  sandbox.onclick = cbs.onSandbox;
  const pg = h('button', 'px', 'PARTICLE PLAYGROUND');
  pg.onclick = cbs.onPlayground;
  col.appendChild(sandbox);
  col.appendChild(pg);
  screen.appendChild(col);

  screen.appendChild(h('div', 'section-title', 'CHALLENGES'));
  const listEl = h('div', 'challenge-list');
  const prog: Progress = loadProgress();
  const order = CHALLENGES.map((c) => c.id);
  CHALLENGES.forEach((c, i) => {
    const unlocked = isUnlocked(i, order, prog);
    const stars = prog[c.id] ?? 0;
    const card = h('div', 'challenge-card' + (unlocked ? '' : ' locked'));
    card.appendChild(h('div', 'cname', `${i + 1}. ${c.name}`));
    card.appendChild(h('div', 'cdesc', unlocked ? c.desc : 'LOCKED - earn a star on the previous level'));
    const starsEl = h('div', 'stars');
    starsEl.innerHTML = unlocked ? starHtml(stars) : '\u25A0 \u25A0 \u25A0';
    card.appendChild(starsEl);
    if (unlocked) {
      card.onclick = () => cbs.onChallenge(c.id);
      card.title = c.hint;
    }
    listEl.appendChild(card);
  });
  screen.appendChild(listEl);

  screen.appendChild(h('div', 'section-title', 'CONTROLS'));
  screen.appendChild(
    h(
      'div',
      'hint-line',
      'LEFT DRAG paint / RIGHT DRAG erase / WHEEL or [ ] brush size\n' +
        'SPACE pause / N single step / M sound / C crt / ESC menu',
    ),
  );

  const row = h('div', 'btn-row');
  const mute = h('button', 'px', 'SFX: ON');
  mute.onclick = () => {
    cbs.onToggleMute();
    mute.textContent = document.body.classList.contains('muted') ? 'SFX: OFF' : 'SFX: ON';
  };
  const crt = h('button', 'px toggled', 'CRT: ON');
  crt.onclick = () => {
    cbs.onToggleCrt();
    crt.classList.toggle('toggled', document.body.classList.contains('crt-on'));
    crt.textContent = document.body.classList.contains('crt-on') ? 'CRT: ON' : 'CRT: OFF';
  };
  const bg = h('button', 'px', 'WALLPAPER');
  bg.onclick = () => {
    cbs.onToggleBg();
  };
  const help = h('button', 'px', '? HELP');
  help.onclick = () => cbs.onHelp();
  row.appendChild(mute);
  row.appendChild(crt);
  row.appendChild(bg);
  row.appendChild(help);
  screen.appendChild(row);

  overlay.appendChild(screen);
}
